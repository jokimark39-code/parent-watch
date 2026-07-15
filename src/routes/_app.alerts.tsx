import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useRealtimeInvalidate, formatRelative } from "@/lib/realtime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCheck, Check } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/alerts")({
  component: AlertsPage,
});

function AlertsPage() {
  const { user } = useAuth();
  const uid = user?.id;
  const qc = useQueryClient();
  useRealtimeInvalidate("alerts", [["alerts"]], uid);

  const q = useQuery({
    queryKey: ["alerts", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(500);
      return { data: data ?? [], error };
    },
  });

  const [filter, setFilter] = useState<"all" | "unread">("all");

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("alerts").update({ is_read: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const markAll = useMutation({
    mutationFn: async () => {
      const ids = (q.data?.data ?? []).filter((a: any) => !(a.is_read ?? a.read)).map((a: any) => a.id);
      if (ids.length === 0) return;
      const { error } = await supabase.from("alerts").update({ is_read: true }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("All marked read"); qc.invalidateQueries({ queryKey: ["alerts"] }); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const list = useMemo(() => {
    let l = q.data?.data ?? [];
    if (filter === "unread") l = l.filter((a: any) => !(a.is_read ?? a.read));
    return l;
  }, [q.data, filter]);

  const unread = (q.data?.data ?? []).filter((a: any) => !(a.is_read ?? a.read)).length;

  return (
    <div className="space-y-4">
      {q.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Failed to load alerts</AlertTitle>
          <AlertDescription>{(q.error as Error).message}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Alerts</CardTitle>
            {unread > 0 && <Badge variant="destructive">{unread} unread</Badge>}
          </div>
          <div className="flex gap-2">
            <select className="rounded-md border bg-background px-2 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as any)}>
              <option value="all">All</option>
              <option value="unread">Unread only</option>
            </select>
            <Button size="sm" variant="outline" onClick={() => markAll.mutate()} disabled={unread === 0 || markAll.isPending}>
              <CheckCheck className="mr-2 h-4 w-4" /> Mark all read
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {q.isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No alerts.</p>
          ) : list.map((a: any) => {
            const isRead = a.is_read ?? a.read;
            return (
              <div key={a.id} className={`flex items-start gap-3 rounded-lg border p-4 ${isRead ? "" : "bg-accent/40"}`}>
                <SeverityDot s={a.severity} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{a.title || a.alert_type || "Alert"}</span>
                    <Badge variant="outline" className="text-xs">{a.alert_type || "info"}</Badge>
                  </div>
                  {a.description && <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">{formatRelative(a.created_at)}</p>
                </div>
                {!isRead && (
                  <Button size="sm" variant="ghost" onClick={() => markRead.mutate(a.id)}>
                    <Check className="mr-1 h-4 w-4" /> Mark read
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function SeverityDot({ s }: { s?: string }) {
  const key = (s || "info").toLowerCase();
  const color =
    key === "critical" || key === "high" ? "bg-destructive"
      : key === "medium" ? "bg-primary"
        : "bg-muted-foreground";
  return <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`} />;
}
