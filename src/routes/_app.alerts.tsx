import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useRealtimeInvalidate, formatRelative } from "@/lib/realtime";
import {
  parseAlertTag,
  cleanDescription,
  scanAndCreateAlerts,
  isSafelisted,
  classifyApp,
} from "@/lib/risk-scanner";
import { classifyAppsWithAi, type AiRiskItem } from "@/lib/ai-classify.functions";
import { AppIcon } from "@/routes/_app.apps";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCheck, Check, Search, ShieldAlert, RefreshCw, Info, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/alerts")({
  component: AlertsPage,
});

type FilterKey = "all" | "high" | "medium" | "unread" | "read";

function AlertsPage() {
  const { user } = useAuth();
  const uid = user?.id;
  const qc = useQueryClient();
  useRealtimeInvalidate("alerts", [["alerts"], ["alerts-unread-count"]], uid);
  useRealtimeInvalidate("installed_apps", [["alerts-apps"]], uid);

  const alertsQ = useQuery({
    queryKey: ["alerts", uid],
    enabled: !!uid,
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Enrichment maps (icons + device names)
  const appsQ = useQuery({
    queryKey: ["alerts-apps", uid],
    enabled: !!uid,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data } = await supabase.from("installed_apps").select("*");
      return data ?? [];
    },
  });
  const devicesQ = useQuery({
    queryKey: ["alerts-devices", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data } = await supabase.from("devices").select("id,name,model");
      return data ?? [];
    },
  });

  const iconByPkg = useMemo(() => {
    const m = new Map<string, any>();
    for (const a of appsQ.data ?? []) if (a.package_name) m.set(a.package_name, a);
    return m;
  }, [appsQ.data]);

  const deviceById = useMemo(() => {
    const m = new Map<string, any>();
    for (const d of devicesQ.data ?? []) m.set(d.id, d);
    return m;
  }, [devicesQ.data]);

  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("alerts").update({ is_read: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["alerts-unread-count"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const markAll = useMutation({
    mutationFn: async () => {
      const ids = (alertsQ.data ?? []).filter((a: any) => !(a.is_read ?? a.read)).map((a: any) => a.id);
      if (ids.length === 0) return;
      const { error } = await supabase.from("alerts").update({ is_read: true }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("All marked read");
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["alerts-unread-count"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const rescan = useMutation({
    mutationFn: async () => {
      if (!uid) return { inserted: 0 };
      return scanAndCreateAlerts(uid);
    },
    onSuccess: (r) => {
      if (r?.error) toast.error(r.error);
      else if (r?.inserted) toast.success(`Detected ${r.inserted} new suspicious app${r.inserted > 1 ? "s" : ""}`);
      else toast.success("Scan complete — no new suspicious apps");
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["alerts-unread-count"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Scan failed"),
  });

  const [aiResults, setAiResults] = useState<Map<string, AiRiskItem>>(new Map());
  const classifyAi = useServerFn(classifyAppsWithAi);
  const aiScan = useMutation({
    mutationFn: async () => {
      const apps = appsQ.data ?? [];
      // De-duplicate by package_name (installed_apps may repeat per device)
      const byPkg = new Map<string, { package_name: string; app_name: string | null }>();
      for (const a of apps) {
        if (!a.package_name) continue;
        if (!byPkg.has(a.package_name)) {
          byPkg.set(a.package_name, {
            package_name: a.package_name,
            app_name: a.app_name ?? null,
          });
        }
      }
      const payload = Array.from(byPkg.values());
      if (payload.length === 0) return { results: [] as AiRiskItem[] };

      // Chunk to keep prompt small
      const chunks: typeof payload[] = [];
      for (let i = 0; i < payload.length; i += 40) chunks.push(payload.slice(i, i + 40));

      const all: AiRiskItem[] = [];
      for (const c of chunks) {
        const r = await classifyAi({ data: { apps: c } });
        if (r.error) throw new Error(r.error);
        all.push(...r.results);
      }

      // Also create alerts for HIGH/MEDIUM findings (dedup handled server-side by unique title)
      if (uid) {
        const highs = all.filter((x) => x.risk === "HIGH" || x.risk === "MEDIUM");
        if (highs.length > 0) {
          // Load recent alerts to dedup by pkg
          const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
          const { data: recent } = await supabase
            .from("alerts")
            .select("message")
            .eq("alert_type", "SUSPICIOUS_APP")
            .gte("created_at", sinceIso);
          const seen = new Set<string>();
          for (const a of recent ?? []) {
            const m = (a.message || "").match(/\[pkg:([^\]|]+)/);
            if (m) seen.add(m[1]);
          }
          // enrich with device_id and app_name from installed_apps
          const appIndex = new Map<string, any>();
          for (const a of apps) if (a.package_name && !appIndex.has(a.package_name)) appIndex.set(a.package_name, a);
          const inserts = highs
            .filter((x) => !seen.has(x.package_name))
            .map((x) => {
              const meta = appIndex.get(x.package_name);
              const name = meta?.app_name || x.package_name;
              return {
                parent_id: uid,
                device_id: meta?.device_id ?? null,
                alert_type: "SUSPICIOUS_APP",
                severity: x.risk === "HIGH" ? "HIGH" : "MEDIUM",
                title: `AI flagged: ${name}`,
                message: `${name} (${x.package_name}) — AI risk: ${x.risk}. ${x.reason} [pkg:${x.package_name}]`,
                is_read: false,
              };
            });
          if (inserts.length > 0) {
            await supabase.from("alerts").insert(inserts);
          }
        }
      }

      return { results: all };
    },
    onSuccess: (r) => {
      const map = new Map<string, AiRiskItem>();
      for (const x of r.results) map.set(x.package_name, x);
      setAiResults(map);
      const highs = r.results.filter((x) => x.risk === "HIGH").length;
      const meds = r.results.filter((x) => x.risk === "MEDIUM").length;
      toast.success(`AI scan complete — ${highs} high, ${meds} medium`);
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["alerts-unread-count"] });
    },
    onError: (e: any) => toast.error(e.message ?? "AI scan failed"),
  });

  // Build per-app risk view (local heuristic + AI overlay)
  const appRiskRows = useMemo(() => {
    const apps = appsQ.data ?? [];
    const byPkg = new Map<string, any>();
    for (const a of apps) {
      if (!a.package_name) continue;
      if (!byPkg.has(a.package_name)) byPkg.set(a.package_name, a);
    }
    const rows = Array.from(byPkg.values()).map((a) => {
      const local = classifyApp(a);
      const safelisted = isSafelisted(a);
      const ai = aiResults.get(a.package_name);
      // final = worst of local & AI (unless safelisted and no AI HIGH)
      let final: "HIGH" | "MEDIUM" | "SAFE" = "SAFE";
      const localLevel: "HIGH" | "MEDIUM" | "SAFE" =
        local.classification === "HIGH_RISK" || local.classification === "LIKELY_GAMBLING"
          ? "HIGH"
          : local.classification === "NEEDS_REVIEW"
            ? "MEDIUM"
            : "SAFE";
      const aiLevel = ai?.risk ?? "SAFE";
      const rank = { HIGH: 3, MEDIUM: 2, SAFE: 1 } as const;
      final = rank[aiLevel] >= rank[localLevel] ? aiLevel : localLevel;
      if (safelisted && !ai) final = "SAFE";
      return {
        app: a,
        local,
        ai,
        final,
        reason: ai?.reason || local.reasons.join("; ") || (safelisted ? "Safelisted" : "No signals"),
      };
    });
    // Sort HIGH > MEDIUM > SAFE, then name
    const order = { HIGH: 0, MEDIUM: 1, SAFE: 2 } as const;
    rows.sort((a, b) => order[a.final] - order[b.final] || String(a.app.app_name || "").localeCompare(String(b.app.app_name || "")));
    return rows;
  }, [appsQ.data, aiResults]);


  const list = useMemo(() => {
    let l = alertsQ.data ?? [];
    if (filter === "unread") l = l.filter((a: any) => !(a.is_read ?? a.read));
    else if (filter === "read") l = l.filter((a: any) => (a.is_read ?? a.read));
    else if (filter === "high")
      l = l.filter((a: any) => String(a.severity || "").toUpperCase() === "HIGH" || String(a.severity || "").toUpperCase() === "CRITICAL");
    else if (filter === "medium") l = l.filter((a: any) => String(a.severity || "").toUpperCase() === "MEDIUM");

    if (search.trim()) {
      const s = search.toLowerCase();
      l = l.filter((a: any) => {
        const tag = parseAlertTag(a.message);
        return (
          (a.title || "").toLowerCase().includes(s) ||
          (a.message || "").toLowerCase().includes(s) ||
          (tag.pkg || "").toLowerCase().includes(s)
        );
      });
    }
    return l;
  }, [alertsQ.data, filter, search]);

  const all = alertsQ.data ?? [];
  const unread = all.filter((a: any) => !(a.is_read ?? a.read)).length;
  const highCount = all.filter((a: any) => ["HIGH", "CRITICAL"].includes(String(a.severity || "").toUpperCase())).length;
  const mediumCount = all.filter((a: any) => String(a.severity || "").toUpperCase() === "MEDIUM").length;

  return (
    <div className="space-y-4">
      {alertsQ.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Failed to load alerts</AlertTitle>
          <AlertDescription>{(alertsQ.error as Error).message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">AI App Risk Scanner</CardTitle>
              <p className="text-xs text-muted-foreground">
                Detects slot / casino / gambling / 777 / betting apps automatically.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => rescan.mutate()} disabled={rescan.isPending}>
              <RefreshCw className={`mr-2 h-4 w-4 ${rescan.isPending ? "animate-spin" : ""}`} />
              Local scan
            </Button>
            <Button
              size="sm"
              onClick={() => aiScan.mutate()}
              disabled={aiScan.isPending || (appsQ.data ?? []).length === 0}
            >
              <Sparkles className={`mr-2 h-4 w-4 ${aiScan.isPending ? "animate-pulse" : ""}`} />
              {aiScan.isPending ? "AI scanning…" : "Scan all with AI"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total" value={all.length} />
            <Stat label="Unread" value={unread} accent={unread > 0} />
            <Stat label="High risk" value={highCount} destructive={highCount > 0} />
            <Stat label="Medium" value={mediumCount} />
          </div>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              AI risk detection is an estimate. Please review flagged apps before making decisions.
            </AlertDescription>
          </Alert>

          {/* All installed apps with risk classification */}
          <div className="rounded-lg border">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
              <div className="text-sm font-medium">
                All installed apps ({appRiskRows.length})
              </div>
              <div className="flex gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-destructive" /> High
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-yellow-500" /> Medium
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Safe
                </span>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto divide-y">
              {appRiskRows.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No installed apps yet.
                </div>
              ) : (
                appRiskRows.map((row) => (
                  <div key={row.app.package_name} className="flex items-start gap-3 px-3 py-2">
                    <AppIcon name={row.app.icon_path || row.app.package_name} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {row.app.app_name || row.app.package_name}
                        </span>
                        <RiskDot level={row.final} />
                        {row.ai && (
                          <Badge variant="outline" className="text-[10px]">AI: {row.ai.risk}</Badge>
                        )}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground truncate">
                        {row.app.package_name}
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        {row.reason}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Alerts</CardTitle>
            {unread > 0 && <Badge variant="destructive">{unread} unread</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8 w-56"
                placeholder="Search app or package…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="rounded-md border bg-background px-2 text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterKey)}
            >
              <option value="all">All</option>
              <option value="high">High risk</option>
              <option value="medium">Medium risk</option>
              <option value="unread">Unread</option>
              <option value="read">Read</option>
            </select>
            <Button size="sm" variant="outline" onClick={() => markAll.mutate()} disabled={unread === 0 || markAll.isPending}>
              <CheckCheck className="mr-2 h-4 w-4" /> Mark all read
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {alertsQ.isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No alerts match your filters.</p>
          ) : (
            list.map((a: any) => {
              const isRead = a.is_read ?? a.read;
              const tag = parseAlertTag(a.message);
              const pkg = tag.pkg;
              const app = pkg ? iconByPkg.get(pkg) : undefined;
              const device = a.device_id ? deviceById.get(a.device_id) : undefined;
              const iconRef = app?.icon_path || pkg;
              return (
                <div
                  key={a.id}
                  className={`flex items-start gap-3 rounded-lg border p-4 ${isRead ? "" : "bg-accent/40"}`}
                >
                  <div className="shrink-0">
                    <AppIcon name={iconRef} size={40} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium truncate">
                        {app?.app_name || a.title || "Suspicious app"}
                      </span>
                      <SeverityBadge s={a.severity} />
                      <Badge variant="outline" className="text-[10px]">
                        {a.alert_type || "ALERT"}
                      </Badge>
                    </div>
                    {pkg && (
                      <div className="mt-0.5 font-mono text-xs text-muted-foreground truncate">{pkg}</div>
                    )}
                    <p className="mt-1 text-sm text-muted-foreground">
                      {cleanDescription(a.message) || "No details."}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      {device && <span>Device: {device.name || device.model}</span>}
                      <span>{formatRelative(a.created_at)}</span>
                    </div>
                  </div>
                  {!isRead && (
                    <Button size="sm" variant="ghost" onClick={() => markRead.mutate(a.id)}>
                      <Check className="mr-1 h-4 w-4" /> Mark read
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  destructive,
}: {
  label: string;
  value: number;
  accent?: boolean;
  destructive?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        destructive ? "border-destructive/40 bg-destructive/5" : accent ? "border-primary/40 bg-primary/5" : ""
      }`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

function SeverityBadge({ s }: { s?: string }) {
  const key = (s || "info").toUpperCase();
  const variant =
    key === "HIGH" || key === "CRITICAL"
      ? "destructive"
      : key === "MEDIUM"
        ? "default"
        : "secondary";
  return <Badge variant={variant as any}>{key}</Badge>;
}

function RiskDot({ level }: { level: "HIGH" | "MEDIUM" | "SAFE" }) {
  const cls =
    level === "HIGH"
      ? "bg-destructive text-destructive-foreground"
      : level === "MEDIUM"
        ? "bg-yellow-500 text-black"
        : "bg-emerald-500 text-white";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {level}
    </span>
  );
}
