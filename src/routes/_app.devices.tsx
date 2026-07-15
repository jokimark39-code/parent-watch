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
import { Trash2, Eye, Search, AlertTriangle, Pencil, Check, X } from "lucide-react";
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
  const [sort, setSort] = useState<"last_seen" | "name" | "model">("last_seen");
  const [page, setPage] = useState(1);
  const PAGE = 10;
  const [viewing, setViewing] = useState<any | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

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

  const rename = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      if (!uid) throw new Error("Not signed in");
      const { error } = await supabase
        .from("devices")
        .update({ name })
        .eq("id", id)
        .eq("parent_id", uid);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Device name updated successfully.");
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: () => toast.error("Could not update device name. Please try again."),
  });

  const rows = useMemo(() => {
    const list = (query.data?.devices ?? []).filter((d: any) => {
      if (!q) return true;
      const s = q.toLowerCase();
      return (
        (d.name || "").toLowerCase().includes(s) ||
        (d.model || "").toLowerCase().includes(s)
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

  const startEdit = (d: any) => {
    setEditingId(d.id);
    setEditValue(d.name || "");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };
  const saveEdit = (id: string) => {
    const trimmed = editValue.trim();
    if (!trimmed) {
      toast.error("Device name cannot be empty.");
      return;
    }
    rename.mutate({ id, name: trimmed });
  };

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
              <option value="name">Device name</option>
              <option value="model">Model</option>
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
                    <TableHead>Device Name</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Android Version</TableHead>
                    <TableHead>Last Seen</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Apps</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((d: any) => {
                    const isEditing = editingId === d.id;
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">
                          {isEditing ? (
                            <Input
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit(d.id);
                                if (e.key === "Escape") cancelEdit();
                              }}
                              className="h-8 w-48"
                              placeholder="Device name"
                            />
                          ) : (
                            <span>{d.name || "Unnamed device"}</span>
                          )}
                        </TableCell>
                        <TableCell>{d.model || "—"}</TableCell>
                        <TableCell>{d.os_version || "—"}</TableCell>
                        <TableCell>{formatRelative(d.last_seen)}</TableCell>
                        <TableCell>
                          <Badge variant={isOnline(d.last_seen) ? "default" : "secondary"}>
                            {isOnline(d.last_seen) ? "Online" : "Offline"}
                          </Badge>
                        </TableCell>
                        <TableCell>{appsCount[d.id] ?? 0}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {isEditing ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={!editValue.trim() || rename.isPending}
                                onClick={() => saveEdit(d.id)}
                              >
                                <Check className="h-4 w-4 mr-1" /> Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelEdit}>
                                <X className="h-4 w-4 mr-1" /> Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Edit name"
                                onClick={() => startEdit(d)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" title="View details" onClick={() => setViewing(d)}>
                                <Eye className="h-4 w-4" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" title="Delete">
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete this device?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This removes {d.name || d.model || "the device"} from your dashboard.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => del.mutate(d.id)}>Delete</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
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
          <DialogHeader><DialogTitle>{viewing?.name || viewing?.model || "Device"}</DialogTitle></DialogHeader>
          {viewing && (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Name</dt><dd>{viewing.name || "—"}</dd>
              <dt className="text-muted-foreground">Model</dt><dd>{viewing.model || "—"}</dd>
              <dt className="text-muted-foreground">Android version</dt><dd>{viewing.os_version || "—"}</dd>
              <dt className="text-muted-foreground">Last seen</dt><dd>{formatRelative(viewing.last_seen)}</dd>
              <dt className="text-muted-foreground">Installed apps</dt><dd>{appsCount[viewing.id] ?? 0}</dd>
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
