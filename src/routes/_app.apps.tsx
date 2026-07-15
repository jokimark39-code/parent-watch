import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase, APP_ICONS_BUCKET } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useRealtimeInvalidate } from "@/lib/realtime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Search, AlertTriangle, Package, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_app/apps")({
  component: AppsPage,
});

function AppsPage() {
  const { user } = useAuth();
  const uid = user?.id;
  useRealtimeInvalidate("installed_apps", [["apps", uid ?? ""]], uid);

  const q = useQuery({
    queryKey: ["apps", uid],
    enabled: !!uid,
    staleTime: 0,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("installed_apps")
        .select("*")
        .order("install_date", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "high" | "review" | "safe">("all");
  const [sort, setSort] = useState<"install_date" | "risk" | "app_name">("risk");
  const [page, setPage] = useState(1);
  const PAGE = 15;

  const rows = useMemo(() => {
    let list = q.data ?? [];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((a: any) =>
        (a.app_name || "").toLowerCase().includes(s) ||
        (a.package_name || "").toLowerCase().includes(s),
      );
    }
    if (filter === "high") list = list.filter((a: any) => Number(a.ai_risk_score ?? a.local_risk_score ?? 0) >= 70);
    if (filter === "review") list = list.filter((a: any) => !a.parent_review || a.parent_review === "pending" || a.parent_review === "monitor");
    if (filter === "safe") list = list.filter((a: any) => a.parent_review === "safe");
    list = [...list].sort((a: any, b: any) => {
      if (sort === "risk") return Number(b.ai_risk_score ?? b.local_risk_score ?? 0) - Number(a.ai_risk_score ?? a.local_risk_score ?? 0);
      if (sort === "install_date") return new Date(b.install_date ?? 0).getTime() - new Date(a.install_date ?? 0).getTime();
      return String(a.app_name ?? "").localeCompare(String(b.app_name ?? ""));
    });
    return list;
  }, [q.data, search, filter, sort]);

  const paged = rows.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));

  return (
    <div className="space-y-4">
      {q.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Failed to load apps</AlertTitle>
          <AlertDescription>{(q.error as Error).message}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <CardTitle>Installed Apps</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => q.refetch()}
              disabled={q.isFetching}
              aria-label="Refresh apps"
            >
              <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8 w-56" placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <select className="rounded-md border bg-background px-2 text-sm" value={filter} onChange={(e) => { setFilter(e.target.value as any); setPage(1); }}>
              <option value="all">All</option>
              <option value="high">High risk</option>
              <option value="review">Needs review</option>
              <option value="safe">Marked safe</option>
            </select>
            <select className="rounded-md border bg-background px-2 text-sm" value={sort} onChange={(e) => setSort(e.target.value as any)}>
              <option value="risk">Sort: risk</option>
              <option value="install_date">Sort: install date</option>
              <option value="app_name">Sort: name</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No installed apps reported yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>App</TableHead>
                    <TableHead>Package</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Local</TableHead>
                    <TableHead>AI</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((a: any) => (
                    <TableRow key={a.id} className="cursor-pointer">
                      <TableCell>
                        <Link to="/apps/$pkg" params={{ pkg: a.package_name }} className="flex items-center gap-2 hover:underline">
                          <AppIcon name={a.icon_path || a.package_name} />
                          <span className="font-medium">{a.app_name || a.package_name}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{a.package_name}</TableCell>
                      <TableCell>{a.version_name || "—"}</TableCell>
                      <TableCell>{a.local_risk_score ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={Number(a.ai_risk_score ?? 0) >= 70 ? "destructive" : "outline"}>
                          {a.ai_risk_score ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell><Badge variant="outline">{a.classification || "unknown"}</Badge></TableCell>
                      <TableCell><Badge variant="secondary">{a.parent_review || "pending"}</Badge></TableCell>
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
    </div>
  );
}

export function AppIcon({ name, size = 32 }: { name?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!name || failed) {
    return (
      <div style={{ width: size, height: size }} className="flex items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Package className="h-1/2 w-1/2" />
      </div>
    );
  }
  const url = name.startsWith("http")
    ? name
    : supabase.storage.from(APP_ICONS_BUCKET).getPublicUrl(name).data.publicUrl;
  return (
    <img
      src={url}
      onError={() => setFailed(true)}
      alt=""
      width={size}
      height={size}
      className="rounded-md border bg-white object-contain"
    />
  );
}
