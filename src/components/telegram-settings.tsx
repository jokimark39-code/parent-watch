import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useRealtimeInvalidate } from "@/lib/realtime";
import { claimTelegramLinkAttempt, sendTelegramAlert } from "@/lib/telegram-link.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Copy, Send, Sparkles, Trash2, Info, MessageCircle, Crown, Lock } from "lucide-react";
import { toast } from "sonner";
import { PremiumUpgradeModal } from "@/components/premium-upgrade-modal";

const BOT_USERNAME =
  (import.meta as any).env?.VITE_TELEGRAM_BOT_USERNAME || "Yat_Lite_Bot";

function genCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `TG-${s}`;
}

export function TelegramSettings() {
  const { session, user } = useAuth();
  const uid = user?.id;
  const qc = useQueryClient();
  const claimTelegramLink = useServerFn(claimTelegramLinkAttempt);
  const sendTelegram = useServerFn(sendTelegramAlert);
  const claimingCode = useRef<string | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  useRealtimeInvalidate("telegram_connections", [["telegram-connection"]], uid);

  const profileQ = useQuery({
    queryKey: ["profile-premium", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("is_premium, premium_plan, premium_activated_at")
        .eq("id", uid!)
        .maybeSingle();
      if (error && !/no rows/i.test(error.message)) return null;
      return data;
    },
  });
  const localPremium =
    typeof window !== "undefined" && !!uid && localStorage.getItem(`premium:${uid}`) === "1";
  const isPremium = !!profileQ.data?.is_premium || localPremium;

  const connQ = useQuery({
    queryKey: ["telegram-connection", uid],
    enabled: !!uid,
    refetchInterval: 5_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_connections")
        .select("*")
        .eq("parent_id", uid!)
        .maybeSingle();
      if (error && !/no rows/i.test(error.message)) throw error;
      return data;
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const code = genCode();
      const payload = {
        parent_id: user.id,
        email: user.email,
        link_code: code,
        is_connected: false,
        telegram_chat_id: null,
        telegram_username: null,
        connected_at: null,
        updated_at: new Date().toISOString(),
      };
      // Upsert on parent_id (one row per parent)
      const { error } = await supabase
        .from("telegram_connections")
        .upsert(payload, { onConflict: "parent_id" });
      if (error) {
        // Fallback if unique constraint not on parent_id
        await supabase.from("telegram_connections").delete().eq("parent_id", user.id);
        const { error: e2 } = await supabase.from("telegram_connections").insert(payload);
        if (e2) throw e2;
      }
      return code;
    },
    onSuccess: () => {
      toast.success("Link code generated");
      qc.invalidateQueries({ queryKey: ["telegram-connection"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to generate code"),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      if (!user) return;
      const { error } = await supabase.from("telegram_connections").delete().eq("parent_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Telegram disconnected");
      qc.invalidateQueries({ queryKey: ["telegram-connection"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const [sending, setSending] = useState(false);

  useEffect(() => {
    const conn = connQ.data;
    if (!session?.access_token || !user || !conn?.link_code || conn.is_connected) return;
    const code = String(conn.link_code).trim().toUpperCase();
    if (claimingCode.current === code) return;

    let cancelled = false;
    claimingCode.current = code;

    (async () => {
      try {
        const claimed = await claimTelegramLink({ data: { code, accessToken: session.access_token } });
        if (cancelled || !claimed.linked) return;
        toast.success("Telegram connected");
        qc.invalidateQueries({ queryKey: ["telegram-connection"] });
      } catch (e: any) {
        console.error("Telegram claim failed", e);
      } finally {
        if (claimingCode.current === code) claimingCode.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [claimTelegramLink, connQ.data, qc, session?.access_token, user]);

  async function sendTest() {
    setSending(true);
    try {
      if (!session?.access_token) throw new Error("Not signed in");
      const res: any = await sendTelegram({ data: { test: true, accessToken: session.access_token } });
      if (res?.skipped === "not_connected") {
        toast.error("Telegram is not connected yet. Send /start <code> to the bot first.");
      } else {
        toast.success("Test alert sent to your Telegram");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Failed to send test");
    } finally {
      setSending(false);
    }
  }

  const conn = connQ.data;
  const code = conn?.link_code as string | undefined;
  const command = code ? `/start ${code}` : "";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>Telegram Alerts</CardTitle>
            <CardDescription>
              Get instant Telegram messages when a HIGH-risk gambling app is detected.
            </CardDescription>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {isPremium ? (
              <Badge className="bg-amber-500 hover:bg-amber-500">
                <Crown className="mr-1 h-3 w-3" /> Premium Active
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                <Lock className="mr-1 h-3 w-3" /> Premium Required
              </Badge>
            )}
            {conn?.is_connected ? (
              <Badge className="bg-emerald-600 hover:bg-emerald-600">Connected</Badge>
            ) : (
              <Badge variant="outline">Not connected</Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!isPremium ? (
          <>
            <Alert>
              <Crown className="h-4 w-4" />
              <AlertTitle>Telegram Alerts is a Premium feature</AlertTitle>
              <AlertDescription className="text-xs">
                Upgrade to unlock instant Telegram notifications for high-risk app detections.
              </AlertDescription>
            </Alert>
            <Button onClick={() => setUpgradeOpen(true)} className="bg-amber-500 hover:bg-amber-600">
              <Crown className="mr-2 h-4 w-4" /> Upgrade to Premium
            </Button>
          </>
        ) : conn?.is_connected ? (
          <>
            <Alert>
              <Sparkles className="h-4 w-4" />
              <AlertTitle>Telegram connected successfully</AlertTitle>
              <AlertDescription className="text-xs">
                Chat:{" "}
                <span className="font-mono">
                  {conn.telegram_username ? `@${conn.telegram_username}` : conn.telegram_chat_id}
                </span>
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-2">
              <Button onClick={sendTest} disabled={sending}>
                <Send className="mr-2 h-4 w-4" />
                {sending ? "Sending…" : "Send Test Telegram Alert"}
              </Button>
              <Button variant="outline" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                <Trash2 className="mr-2 h-4 w-4" /> Disconnect
              </Button>
            </div>
          </>
        ) : code ? (
          <>
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Almost there — link your Telegram chat</AlertTitle>
              <AlertDescription className="text-xs">
                Send the command below to our bot from your Telegram app. The dashboard will update automatically.
              </AlertDescription>
            </Alert>

            <ol className="space-y-2 text-sm">
              <li>
                <span className="font-medium">1.</span> Open Telegram and search for our bot:{" "}
                <a
                  className="text-primary underline"
                  href={`https://t.me/${BOT_USERNAME}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  @{BOT_USERNAME}
                </a>
              </li>
              <li>
                <span className="font-medium">2.</span> Send this message:
                <div className="mt-2 flex items-center gap-2 rounded-md border bg-muted/40 p-2">
                  <code className="flex-1 font-mono text-sm">{command}</code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(command);
                      toast.success("Copied");
                    }}
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" /> Copy
                  </Button>
                </div>
              </li>
              <li>
                <span className="font-medium">3.</span> Wait a moment — the status above will flip to{" "}
                <Badge className="bg-emerald-600 hover:bg-emerald-600">Connected</Badge>.
              </li>
            </ol>

            <Button variant="outline" size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
              Regenerate code
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              You haven't linked a Telegram chat yet. Generate a link code and send it to our bot.
            </p>
            <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Telegram Link Code
            </Button>
          </>
        )}

        <details className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">Admin setup (one-time)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Create a bot with @BotFather and copy the bot token.</li>
            <li>Set <code>VITE_TELEGRAM_BOT_USERNAME</code> in your project env to the bot's username.</li>
            <li>
              In Supabase → Edge Functions → Secrets, add: <code>TELEGRAM_BOT_TOKEN</code>,{" "}
              <code>DASHBOARD_URL</code>.
            </li>
            <li>
              Deploy the two edge functions in <code>supabase/functions/</code>:{" "}
              <code>telegram-webhook</code> (with <code>--no-verify-jwt</code>) and{" "}
              <code>send-telegram-alert</code>.
            </li>
            <li>
              Run <code>supabase/migrations_manual/telegram_setup.sql</code> in the SQL editor.
            </li>
            <li>
              Register the webhook:{" "}
              <code>
                https://api.telegram.org/bot&lt;TOKEN&gt;/setWebhook?url=https://&lt;project&gt;.supabase.co/functions/v1/telegram-webhook
              </code>
            </li>
          </ol>
        </details>
      </CardContent>
      <PremiumUpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        onActivated={() => qc.invalidateQueries({ queryKey: ["profile-premium"] })}
      />
    </Card>
  );
}
