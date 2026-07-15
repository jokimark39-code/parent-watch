import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, AlertTriangle, Shield, Eye, Ban } from "lucide-react";
import { toast } from "sonner";
import { AppIcon } from "./_app.apps";
import { formatMs, usageDurationMs, usageTime } from "@/lib/realtime";

export const Route = createFileRoute("/_app/apps/$pkg")({
  component: AppDetailPage,
});

function AppDetailPage() {
  const { pkg } = Route.useParams();
  const { user } = useAuth();
  const uid = user?.id;
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["app-detail", pkg, uid],
    enabled: !!uid,
    queryFn: async () => {
      const [appR, aiR, usageR] = await Promise.all([
        supabase.from("installed_apps").select("*").eq("package_name", pkg).limit(1).maybeSingle(),
        supabase.from("ai_results").select("*").eq("package_name", pkg).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase
          .from("usage_events")
          .select("*")
          .eq("package_name", pkg)
          .gte("opened_at", new Date(Date.now() - 7 * 86400_000).toISOString())
          .order("opened_at", { ascending: false })
          .limit(500),
      ]);
      return {
        app: appR.data, appErr: appR.error,
        ai: aiR.data, usage: usageR.data ?? [],
      };
    },
  });

  const review = useMutation({
    mutationFn: async (val: "safe" | "monitor" | "block") => {
      const { error } = await supabase
        .from("installed_apps")
        .update({ parent_review: val })
        .eq("package_name", pkg);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["app-detail", pkg] });
      qc.invalidateQueries({ queryKey: ["apps"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  if (q.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (q.data?.appErr) return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Failed to load</AlertTitle>
      <AlertDescription>{q.data.appErr.message}</AlertDescription>
    </Alert>
  );
  const a = q.data?.app;
  if (!a) return (
    <Card>
      <CardContent className="py-12 text-center">
        <p className="text-sm text-muted-foreground">App not found.</p>
        <Button asChild variant="link"><Link to="/apps"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link></Button>
      </CardContent>
    </Card>
  );

  const totalMs = q.data!.usage.reduce((s: number, u: any) => s + usageDurationMs(u), 0);
  const reasons = (q.data?.ai?.risk_reasons as string[]) || (a.risk_reasons as string[]) || [];
  const keywords = (q.data?.ai?.matched_keywords as string[]) || (a.matched_keywords as string[]) || [];

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm"><Link to="/apps"><ArrowLeft className="mr-1 h-4 w-4" />Back to apps</Link></Button>
      <Card>
        <CardContent className="flex flex-col gap-6 p-6 sm:flex-row">
          <AppIcon name={a.icon_path || a.package_name} size={96} />
          <div className="flex-1">
            <h2 className="text-2xl font-semibold">{a.app_name || a.package_name}</h2>
            <p className="font-mono text-sm text-muted-foreground">{a.package_name}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="outline">v{a.version_name || "—"}</Badge>
              <Badge variant="outline">{a.classification || "unknown"}</Badge>
              <Badge variant={Number(a.ai_risk_score ?? 0) >= 70 ? "destructive" : "secondary"}>
                AI risk: {a.ai_risk_score ?? "—"}
              </Badge>
              <Badge variant="secondary">Local risk: {a.local_risk_score ?? "—"}</Badge>
              <Badge>{a.parent_review || "pending"}</Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div><div className="text-xs text-muted-foreground">Installed</div>{a.install_date ? new Date(a.install_date).toLocaleDateString() : "—"}</div>
              <div><div className="text-xs text-muted-foreground">Updated</div>{a.update_date ? new Date(a.update_date).toLocaleDateString() : "—"}</div>
              <div><div className="text-xs text-muted-foreground">7-day usage</div>{formatMs(totalMs)}</div>
              <div><div className="text-xs text-muted-foreground">Events</div>{q.data!.usage.length}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Risk reasons</CardTitle></CardHeader>
          <CardContent>
            {reasons.length ? (
              <ul className="space-y-1 text-sm">{reasons.map((r, i) => <li key={i}>• {r}</li>)}</ul>
            ) : <p className="text-sm text-muted-foreground">No risk reasons reported.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Matched keywords</CardTitle></CardHeader>
          <CardContent>
            {keywords.length ? (
              <div className="flex flex-wrap gap-1">{keywords.map((k, i) => <Badge key={i} variant="secondary">{k}</Badge>)}</div>
            ) : <p className="text-sm text-muted-foreground">No keywords matched.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Parent review</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="default" onClick={() => review.mutate("safe")} disabled={review.isPending}>
            <Shield className="mr-2 h-4 w-4" /> Mark safe
          </Button>
          <Button variant="secondary" onClick={() => review.mutate("monitor")} disabled={review.isPending}>
            <Eye className="mr-2 h-4 w-4" /> Monitor
          </Button>
          <Button variant="destructive" onClick={() => review.mutate("block")} disabled={review.isPending}>
            <Ban className="mr-2 h-4 w-4" /> Block
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent usage</CardTitle></CardHeader>
        <CardContent>
          {q.data!.usage.length === 0 ? (
            <p className="text-sm text-muted-foreground">No usage events in the last 7 days.</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {q.data!.usage.slice(0, 50).map((u: any) => (
                <li key={u.id} className="flex justify-between border-b py-1">
                  <span>{new Date(usageTime(u) ?? 0).toLocaleString()}</span>
                  <span className="text-muted-foreground">{formatMs(usageDurationMs(u))}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
