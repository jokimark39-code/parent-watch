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
          .gte("recorded_at", since)
          .order("recorded_at", { ascending: false })
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
    let totalMs = 0;
    const byApp: Record<string, { name: string; pkg: string; ms: number; count: number; last: string | null }> = {};
    let latest: any = null;
    for (const u of list) {
      const ms = usageDurationMs(u);
      totalMs += ms;
      const name = u.app_name || u.package_name || "unknown";
      const pkg = u.package_name || "—";
      const key = pkg + "|" + name;
      const t = u.opened_at || u.recorded_at || null;
      if (!byApp[key]) byApp[key] = { name, pkg, ms: 0, count: 0, last: null };
      byApp[key].ms += ms;
      byApp[key].count += 1;
      if (t && (!byApp[key].last || new Date(t) > new Date(byApp[key].last!))) byApp[key].last = t;
      const lt = u.recorded_at || u.opened_at;
      if (!latest || (lt && new Date(lt) > new Date(latest.recorded_at || latest.opened_at || 0))) latest = u;
    }
    const perApp = Object.values(byApp).sort((a, b) => b.count - a.count);
    const mostOpened = perApp[0] || null;
    return {
      totalMs,
      totalEvents: list.length,
      mostOpened,
      latest,
      perApp,
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
  const latestTime = stats.latest ? (stats.latest.recorded_at || stats.latest.opened_at) : null;
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
          <Card><CardContent className="p-5"><div className="text-xs text-muted-foreground">Latest opened app</div><div className="text-2xl font-semibold truncate">{latestName}</div><div className="text-xs text-muted-foreground">{latestTime ? new Date(latestTime).toLocaleString() : ""}</div></CardContent></Card>
          <Card><CardContent className="p-5"><div className="text-xs text-muted-foreground">Most opened app</div><div className="text-2xl font-semibold truncate">{stats.mostOpened?.name ?? "—"}</div><div className="text-xs text-muted-foreground">{stats.mostOpened ? `${stats.mostOpened.count} opens` : ""}</div></CardContent></Card>
          <Card><CardContent className="p-5"><div className="text-xs text-muted-foreground">Total usage time</div><div className="text-2xl font-semibold">{totalUsageLabel}</div></CardContent></Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>App usage summary</CardTitle></CardHeader>
        <CardContent>
          {stats.perApp.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No usage yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>App name</TableHead>
                    <TableHead>Package name</TableHead>
                    <TableHead>Total duration</TableHead>
                    <TableHead>Open count</TableHead>
                    <TableHead>Last opened</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.perApp.slice(0, 20).map((a) => (
                    <TableRow key={a.pkg + a.name}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell className="font-mono text-xs">{a.pkg}</TableCell>
                      <TableCell>{a.ms > 0 ? formatMs(a.ms) : "Opened only"}</TableCell>
                      <TableCell>{a.count}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{a.last ? new Date(a.last).toLocaleString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Usage history</CardTitle>
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
                    <TableHead>Device Name</TableHead>
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
