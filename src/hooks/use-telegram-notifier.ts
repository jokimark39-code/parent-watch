import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

/**
 * Watches for new HIGH-severity SUSPICIOUS_APP alerts for the signed-in parent
 * and invokes the `send-telegram-alert` edge function to deliver a Telegram
 * message. The edge function itself de-dupes via the `telegram_sent` flag.
 */
export function useTelegramNotifier() {
  const { user } = useAuth();
  const uid = user?.id;
  const inFlight = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!uid) return;

    const trySend = async (alertId: string) => {
      if (inFlight.current.has(alertId)) return;
      inFlight.current.add(alertId);
      try {
        await supabase.functions.invoke("send-telegram-alert", {
          body: { alert_id: alertId },
        });
      } catch {
        // silent — dashboard still shows the alert
      } finally {
        // keep in set to avoid re-tries this session
      }
    };

    // Sweep any HIGH alerts that haven't been sent yet (last 24h)
    (async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("alerts")
        .select("id, severity, telegram_sent, created_at, alert_type")
        .eq("parent_id", uid)
        .eq("telegram_sent", false)
        .eq("severity", "HIGH")
        .gte("created_at", since)
        .limit(50);
      for (const a of data ?? []) await trySend(a.id);
    })().catch(() => {});

    const channel = supabase
      .channel(`tg-notifier:${uid}:${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "alerts" },
        (payload) => {
          const a: any = payload.new;
          if (!a) return;
          if (a.parent_id !== uid) return;
          if (String(a.severity || "").toUpperCase() !== "HIGH") return;
          if (a.telegram_sent) return;
          trySend(a.id);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [uid]);
}
