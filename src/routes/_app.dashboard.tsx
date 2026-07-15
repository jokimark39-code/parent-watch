import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useRealtimeInvalidate, formatRelative, isOnline, formatMs, usageDurationMs, usageTime } from "@/lib/realtime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Smartphone, Wifi, AppWindow, ShieldAlert, AlertTriangle, Clock, BellRing, TrendingUp,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, LineChart,
} from "recharts";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = useAuth();
  const uid = user?.id;

  useRealtimeInvalidate("devices", [["dash"]], uid);
  useRealtimeInvalidate("installed_apps", [["dash"]], uid);
  useRealtimeInvalidate("alerts", [["dash"]], uid);
  useRealtimeInvalidate("usage_events", [["dash"]], uid);

  const q = useQuery({
    queryKey: ["dash", uid],
    enabled: !!uid,
    staleTime: 0,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86400_000).toISOString();
      const [devicesR, appsR, alertsR, usageR] = await Promise.all([
        supabase.from("devices").select("*").order("last_seen", { ascending: false }),
        supabase.from("installed_apps").select("*").order("updated_at", { ascending: false, nullsFirst: false }),
        supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(50),
        supabase
          .from("usage_events")
          .select("*")
          .gte("opened_at", since)
          .order("opened_at", { ascending: false })
          .limit(2000),
      ]);
      return {
        devices: devicesR.data ?? [],
        devicesErr: devicesR.error,
        apps: appsR.data ?? [],
        appsErr: appsR.error,
        alerts: alertsR.data ?? [],
        alertsErr: alertsR.error,
        usage: usageR.data ?? [],
        usageErr: usageR.error,
      };
    },
  });

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const d = q.data!;
  const errs = [d.devicesErr, d.appsErr, d.alertsErr, d.usageErr].filter(Boolean);
  const onlineCount = d.devices.filter((x: any) => isOnline(x.last_seen)).length;
  const highRisk = d.apps.filter((a: any) => Number(a.ai_risk_score ?? a.local_risk_score ?? 0) >= 70).length;
  const needsReview = d.apps.filter((a: any) => !a.parent_review || a.parent_review === "pending" || a.parent_review === "monitor").length;
  const unread = d.alerts.filter((a: any) => !(a.is_read ?? a.read)).length;

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const todayMs = d.usage.filter((u: any) => new Date(usageTime(u) ?? 0) >= today0)
    .reduce((s: number, u: any) => s + usageDurationMs(u), 0);

  const daily: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(); dt.setHours(0, 0, 0, 0); dt.setDate(dt.getDate() - i);
    daily[dt.toISOString().slice(0, 10)] = 0;
  }
  for (const u of d.usage) {
    const key = new Date(usageTime(u) ?? 0).toISOString().slice(0, 10);
    if (key in daily) daily[key] += usageDurationMs(u);
  }
  const weeklyData = Object.entries(daily).map(([day, ms]) => ({
    day: day.slice(5),
    minutes: Math.round(ms / 60000),
  }));

  const hourly: Record<number, number> = {};
  for (let h = 0; h < 24; h++) hourly[h] = 0;
  for (const u of d.usage.filter((u: any) => new Date(usageTime(u) ?? 0) >= today0)) {
    hourly[new Date(usageTime(u) ?? 0).getHours()] += usageDurationMs(u);
  }
  const todayData = Object.entries(hourly).map(([h, ms]) => ({
    hour: `${h}h`, minutes: Math.round(Number(ms) / 60000),
  }));

  return (
    <div className="space-y-6">
      {errs.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Some data could not be loaded</AlertTitle>
          <AlertDescription className="text-xs">
            {errs.map((e: any, i) => <div key={i}>• {e.message}</div>)}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Smartphone />} label="Total Devices" value={d.devices.length} />
        <StatCard icon={<Wifi />} label="Online" value={onlineCount} accent />
        <StatCard icon={<AppWindow />} label="Installed Apps" value={d.apps.length} />
        <StatCard icon={<ShieldAlert />} label="Needs Review" value={needsReview} />
        <StatCard icon={<AlertTriangle />} label="High Risk Apps" value={highRisk} />
        <StatCard icon={<Clock />} label="Today's Usage" value={formatMs(todayMs)} />
        <StatCard icon={<BellRing />} label="Unread Alerts" value={unread} />
        <StatCard icon={<TrendingUp />} label="Weekly Usage" value={formatMs(d.usage.reduce((s: number, u: any) => s + usageDurationMs(u), 0))} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Today's Usage</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={todayData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="hour" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Line type="monotone" dataKey="minutes" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Weekly Usage</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="minutes" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recent Devices</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {d.devices.slice(0, 5).map((dev: any) => (
              <div key={dev.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">{dev.name || "Device"}</div>
                  <div className="text-xs text-muted-foreground">
                    {dev.model || "—"} · {formatRelative(dev.last_seen)}
                  </div>
                </div>
                <Badge variant={isOnline(dev.last_seen) ? "default" : "secondary"}>
                  {isOnline(dev.last_seen) ? "Online" : "Offline"}
                </Badge>
              </div>
            ))}
            {d.devices.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No devices yet. <Link to="/pair" className="text-primary hover:underline">Pair one now</Link>.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent Alerts</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {d.alerts.slice(0, 5).map((a: any) => (
              <div key={a.id} className="flex items-start justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">{a.title || a.alert_type || "Alert"}</div>
                  <div className="text-xs text-muted-foreground">{formatRelative(a.created_at)}</div>
                </div>
                <SeverityBadge s={a.severity} />
              </div>
            ))}
            {d.alerts.length === 0 && <p className="text-sm text-muted-foreground">No alerts.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recently Installed Apps</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {d.apps.slice(0, 5).map((a: any) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">{a.app_name || a.package_name}</div>
                  <div className="text-xs text-muted-foreground">{a.package_name} · v{a.version_name || "—"}</div>
                </div>
                <Badge variant="outline">{a.classification || "unknown"}</Badge>
              </div>
            ))}
            {d.apps.length === 0 && <p className="text-sm text-muted-foreground">No apps reported yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Highest Risk Apps</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {[...d.apps]
              .sort((a: any, b: any) => Number(b.ai_risk_score ?? b.local_risk_score ?? 0) - Number(a.ai_risk_score ?? a.local_risk_score ?? 0))
              .slice(0, 5)
              .map((a: any) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <div className="text-sm font-medium">{a.app_name || a.package_name}</div>
                    <div className="text-xs text-muted-foreground">{a.package_name}</div>
                  </div>
                  <Badge variant="destructive">
                    {Number(a.ai_risk_score ?? a.local_risk_score ?? 0)}
                  </Badge>
                </div>
              ))}
            {d.apps.length === 0 && <p className="text-sm text-muted-foreground">Nothing to rank.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <Card className={accent ? "border-primary/40" : ""}>
      <CardContent className="flex items-center gap-3 p-5">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}>
          {icon}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function SeverityBadge({ s }: { s?: string }) {
  const key = (s || "info").toLowerCase();
  const map: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
    critical: "destructive", high: "destructive", medium: "default", low: "secondary", info: "outline",
  };
  return <Badge variant={map[key] ?? "outline"}>{key}</Badge>;
}
