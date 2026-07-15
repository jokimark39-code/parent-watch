import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useRealtimeInvalidate, formatRelative, isOnline } from "@/lib/realtime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Trash2, Eye, Search, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_app/devices")({
  component: DevicesPage,
});

function DevicesPage() {
  const { user } = useAuth();
  const uid = user?.id;
  const qc = useQueryClient();
  useRealtimeInvalidate("devices", [["devices"]], uid);
  useRealtimeInvalidate("installed_apps", [["devices"]], uid);

  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"last_seen" | "child_name" | "device_name">("last_seen");
  const [page, setPage] = useState(1);
  const PAGE = 10;
  const [viewing, setViewing] = useState<any | null>(null);

  const query = useQuery({
    queryKey: ["devices", uid],
    enabled: !!uid,
    queryFn: async () => {
      const [dev, apps] = await Promise.all([
        supabase.from("devices").select("*"),
        supabase.from("installed_apps").select("device_id"),
      ]);
      return { devices: dev.data ?? [], apps: apps.data ?? [], error: dev.error };
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("devices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Device deleted");
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to delete"),
  });

  const rows = useMemo(() => {
    const list = (query.data?.devices ?? []).filter((d: any) => {
      if (!q) return true;
      const s = q.toLowerCase();
      return (
        (d.child_name || "").toLowerCase().includes(s) ||
        (d.device_name || "").toLowerCase().includes(s) ||
        (d.device_model || "").toLowerCase().includes(s)
      );
    });
    list.sort((a: any, b: any) => {
      if (sort === "last_seen") return new Date(b.last_seen ?? 0).getTime() - new Date(a.last_seen ?? 0).getTime();
      return String(a[sort] ?? "").localeCompare(String(b[sort] ?? ""));
    });
    return list;
  }, [query.data, q, sort]);

  const appsCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of query.data?.apps ?? []) m[a.device_id] = (m[a.device_id] ?? 0) + 1;
    return m;
  }, [query.data]);

  const paged = rows.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));

  return (
    <div className="space-y-4">
      {query.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Failed to load devices</AlertTitle>
          <AlertDescription>{(query.error as Error).message}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Devices</CardTitle>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8 w-56" placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            </div>
            <select
              className="rounded-md border bg-background px-2 text-sm"
              value={sort} onChange={(e) => setSort(e.target.value as any)}
            >
              <option value="last_seen">Last seen</option>
              <option value="child_name">Child name</option>
              <option value="device_name">Device name</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No devices yet. Pair a device to get started.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Child</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Android</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Apps</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((d: any) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.child_name || "—"}</TableCell>
                      <TableCell>{d.device_name || "—"}</TableCell>
                      <TableCell>{d.device_model || "—"}</TableCell>
                      <TableCell>{d.android_version || "—"}</TableCell>
                      <TableCell>{formatRelative(d.last_seen)}</TableCell>
                      <TableCell>
                        <Badge variant={isOnline(d.last_seen) ? "default" : "secondary"}>
                          {isOnline(d.last_seen) ? "Online" : "Offline"}
                        </Badge>
                      </TableCell>
                      <TableCell>{appsCount[d.id] ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setViewing(d)}><Eye className="h-4 w-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this device?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes {d.device_name || d.child_name || "the device"} from your dashboard.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => del.mutate(d.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {rows.length > PAGE && (
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

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{viewing?.device_name || viewing?.child_name || "Device"}</DialogTitle></DialogHeader>
          {viewing && (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Child</dt><dd>{viewing.child_name || "—"}</dd>
              <dt className="text-muted-foreground">Model</dt><dd>{viewing.device_model || "—"}</dd>
              <dt className="text-muted-foreground">Android</dt><dd>{viewing.android_version || "—"}</dd>
              <dt className="text-muted-foreground">Manufacturer</dt><dd>{viewing.manufacturer || "—"}</dd>
              <dt className="text-muted-foreground">Last seen</dt><dd>{formatRelative(viewing.last_seen)}</dd>
              <dt className="text-muted-foreground">Installed apps</dt><dd>{appsCount[viewing.id] ?? 0}</dd>
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
