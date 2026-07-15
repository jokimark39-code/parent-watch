import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import {
  useRealtimeInvalidate,
  formatMs,
  formatDuration,
  usageDurationMs,
  usageTime,
} from "@/lib/realtime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, AlertTriangle } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export const Route = createFileRoute("/_app/usage")({
  component: UsagePage,
});

function UsagePage() {
  const { user } = useAuth();
  const uid = user?.id;
  useRealtimeInvalidate("usage_events", [["usage"]], uid);
  useRealtimeInvalidate("devices", [["usage"]], uid);

  const q = useQuery({
    queryKey: ["usage", uid],
    enabled: !!uid,
    staleTime: 0,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const [events, devices] = await Promise.all([
        supabase
          .from("usage_events")
          .select("*")
          .gte("opened_at", since)
          .order("opened_at", { ascending: false })
          .limit(5000),
        supabase.from("devices").select("id,name,model"),
      ]);
      if (events.error) throw events.error;
      return { data: events.data ?? [], devices: devices.data ?? [] };
    },
  });

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE = 15;

  const deviceById = useMemo(() => {
    const m = new Map<string, any>();
    for (const d of q.data?.devices ?? []) m.set(d.id, d);
    return m;
  }, [q.data]);

  const stats = useMemo(() => {
    const list = q.data?.data ?? [];
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const week0 = new Date(); week0.setDate(week0.getDate() - 7);
    const month0 = new Date(); month0.setDate(month0.getDate() - 30);
    let today = 0, week = 0, month = 0, totalMs = 0;
    const byApp: Record<string, number> = {};
    const openCountByApp: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(); dt.setHours(0, 0, 0, 0); dt.setDate(dt.getDate() - i);
      byDay[dt.toISOString().slice(0, 10)] = 0;
    }
    let latest: any = null;
    for (const u of list) {
      const t = new Date(usageTime(u) ?? 0);
      const ms = usageDurationMs(u);
      totalMs += ms;
      if (t >= month0) month += ms;
      if (t >= week0) {
        week += ms;
        const k = t.toISOString().slice(0, 10);
        if (k in byDay) byDay[k] += ms;
      }
      if (t >= today0) today += ms;
      const label = u.app_name || u.package_name || "unknown";
      byApp[label] = (byApp[label] ?? 0) + ms;
      openCountByApp[label] = (openCountByApp[label] ?? 0) + 1;
      if (!latest || t > new Date(usageTime(latest) ?? 0)) latest = u;
    }
    const topApps = Object.entries(byApp).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([pkg, ms]) => ({ pkg, min: Math.round(ms / 60000) }));
    const dayChart = Object.entries(byDay).map(([d, ms]) => ({ day: d.slice(5), min: Math.round(ms / 60000) }));
    const mostOpened = Object.entries(openCountByApp).sort((a, b) => b[1] - a[1])[0];
    return {
      today, week, month, topApps, dayChart, totalMs,
      totalEvents: list.length,
      mostOpened: mostOpened ? { name: mostOpened[0], count: mostOpened[1] } : null,
      latest,
    };
  }, [q.data]);

  const filteredEvents = useMemo(() => {
    let list = q.data?.data ?? [];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((u: any) =>
        (u.package_name || "").toLowerCase().includes(s) ||
        (u.app_name || "").toLowerCase().includes(s),
      );
    }
    return list;
  }, [q.data, search]);

  const paged = filteredEvents.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(filteredEvents.length / PAGE));

  const latestName = stats.latest ? (stats.latest.app_name || stats.latest.package_name || "—") : "—";
  const totalUsageLabel = stats.totalMs > 0 ? formatMs(stats.totalMs) : "Tracking opens only";

  return (
    <div className="space-y-4">
      {q.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Failed to load usage</AlertTitle>
          <AlertDescription>{(q.error as Error).message}</AlertDescription>
        </Alert>
      )}
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card><CardContent className="p-5"><div className="text-xs text-muted-foreground">Total open events</div><div className="text-2xl font-semibold">{stats.totalEvents}</div></CardContent></Card>
          <Card><CardContent className="p-5"><div className="text-xs text-muted-foreground">Most opened app</div><div className="text-2xl font-semibold truncate">{stats.mostOpened?.name ?? "—"}</div><div className="text-xs text-muted-foreground">{stats.mostOpened ? `${stats.mostOpened.count} opens` : ""}</div></CardContent></Card>
          <Card><CardContent className="p-5"><div className="text-xs text-muted-foreground">Latest opened app</div><div className="text-2xl font-semibold truncate">{latestName}</div><div className="text-xs text-muted-foreground">{stats.latest ? new Date(usageTime(stats.latest) ?? 0).toLocaleString() : ""}</div></CardContent></Card>
          <Card><CardContent className="p-5"><div className="text-xs text-muted-foreground">Total usage time</div><div className="text-2xl font-semibold">{totalUsageLabel}</div></CardContent></Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Daily usage (last 7 days)</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.dayChart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="min" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Most used apps</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.topApps} layout="vertical" margin={{ left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis type="number" fontSize={11} />
                <YAxis dataKey="pkg" type="category" fontSize={10} width={120} />
                <Tooltip />
                <Bar dataKey="min" fill="var(--color-chart-2)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Usage events</CardTitle>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8 w-56" placeholder="Filter by app or package…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </CardHeader>
        <CardContent>
          {filteredEvents.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No usage events.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>App Name</TableHead>
                    <TableHead>Package Name</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Opened At</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Recorded At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((u: any) => {
                    const dev = u.device_id ? deviceById.get(u.device_id) : null;
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.app_name || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{u.package_name || "—"}</TableCell>
                        <TableCell>{dev?.name || dev?.model || "—"}</TableCell>
                        <TableCell>{u.opened_at ? new Date(u.opened_at).toLocaleString() : "—"}</TableCell>
                        <TableCell>{formatDuration(usageDurationMs(u))}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {u.recorded_at ? new Date(u.recorded_at).toLocaleString() : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {filteredEvents.length > PAGE && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span>Page {page} of {pages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</Button>
                <Button size="sm" variant="outline" disabled={page === pages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
