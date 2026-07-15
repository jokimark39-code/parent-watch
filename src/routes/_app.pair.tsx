import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Copy, RefreshCw, X, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/pair")({
  component: PairPage,
});

const CODE_TTL_SEC = 300; // 5 minutes
const STATUS_WAITING = "waiting";
const STATUS_PAIRED = "paired";
const STATUS_EXPIRED = "expired";
const STATUS_CANCELLED = "cancelled";

function normalizeStatus(status?: string | null) {
  return (status ?? STATUS_WAITING).toLowerCase();
}

function makeCode(): string {
  // 6-char alphanumeric, ambiguity removed (no O/0/I/1)
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function PairPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [current, setCurrent] = useState<any | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);

  // countdown
  useEffect(() => {
    if (!current?.expires_at) return;
    const t = setInterval(() => {
      const ms = new Date(current.expires_at).getTime() - Date.now();
      setRemaining(Math.max(0, Math.floor(ms / 1000)));
    }, 500);
    return () => clearInterval(t);
  }, [current?.expires_at]);

  // realtime watch for status changes on our code
  useEffect(() => {
    if (!current?.id) return;
    const ch = supabase
      .channel(`pair:${current.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pairing_codes", filter: `id=eq.${current.id}` },
        (payload) => {
          if (payload.new) {
            setCurrent(payload.new);
            if (normalizeStatus((payload.new as any).status) === STATUS_PAIRED) {
              toast.success("Device paired successfully!");
              qc.invalidateQueries({ queryKey: ["devices"] });
            }
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [current?.id, qc]);

  async function generate() {
    if (!user) return;
    setBusy(true);
    try {
      // Keep only one active pairing code per parent. Some backends enforce this
      // with a unique constraint, so retire the previous waiting code before insert.
      const { error: retireError } = await supabase
        .from("pairing_codes")
        .update({ status: STATUS_CANCELLED })
        .eq("parent_id", user.id)
        .in("status", [STATUS_WAITING, "WAITING"]);
      if (retireError) throw retireError;

      const expires = new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString();
      let lastErr: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = makeCode();
        const { data, error } = await supabase.from("pairing_codes").insert({
          code,
          parent_id: user.id,
          status: STATUS_WAITING,
          expires_at: expires,
        }).select().single();
        if (!error && data) {
          setCurrent(data);
          toast.success("Pairing code generated");
          setBusy(false);
          return;
        }
        lastErr = error;
        // retry on unique-violation only
        if (error && !/duplicate|unique/i.test(error.message)) break;
      }
      throw lastErr ?? new Error("Could not generate a unique code");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate pairing code");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!current) return;
    try {
      const { error } = await supabase.from("pairing_codes").update({ status: STATUS_CANCELLED }).eq("id", current.id);
      if (error) throw error;
      setCurrent({ ...current, status: STATUS_CANCELLED });
      toast.success("Pairing cancelled");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to cancel");
    }
  }

  const status = normalizeStatus(current?.status as string | undefined);
  const isExpired = current && remaining <= 0 && status === STATUS_WAITING;
  const effectiveStatus = isExpired ? STATUS_EXPIRED : status;

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Pair a new device</CardTitle>
          <CardDescription>
            Generate a code, then enter it in the AntiSlot app on your child's Android device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!current ? (
            <Button size="lg" className="w-full" onClick={generate} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Generate pairing code
            </Button>
          ) : (
            <>
              <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-8 text-center">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Pairing code</div>
                <div className="mt-2 font-mono text-5xl font-bold tracking-[0.4em] text-primary">
                  {current.code}
                </div>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <StatusBadge status={effectiveStatus} />
                  {effectiveStatus === STATUS_WAITING && (
                    <span className="text-sm text-muted-foreground inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  onClick={() => { navigator.clipboard.writeText(current.code); toast.success("Copied"); }}
                  disabled={effectiveStatus !== STATUS_WAITING}
                >
                  <Copy className="mr-2 h-4 w-4" /> Copy
                </Button>
                <Button variant="outline" onClick={cancel} disabled={effectiveStatus !== STATUS_WAITING}>
                  <X className="mr-2 h-4 w-4" /> Cancel
                </Button>
                <Button onClick={generate} disabled={busy}>
                  <RefreshCw className="mr-2 h-4 w-4" /> New
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const s = normalizeStatus(status);
  const map: Record<string, { v: "default" | "secondary" | "destructive" | "outline"; icon?: React.ReactNode }> = {
    [STATUS_WAITING]: { v: "default", icon: <Clock className="mr-1 h-3 w-3" /> },
    [STATUS_PAIRED]: { v: "default", icon: <CheckCircle2 className="mr-1 h-3 w-3" /> },
    [STATUS_EXPIRED]: { v: "secondary" },
    [STATUS_CANCELLED]: { v: "secondary" },
  };
  const { v, icon } = map[s] ?? { v: "outline" };
  return <Badge variant={v}>{icon}{s.toUpperCase()}</Badge>;
}
