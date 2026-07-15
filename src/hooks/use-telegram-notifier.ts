import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useServerFn } from "@tanstack/react-start";
import { sendTelegramAlert } from "@/lib/telegram-link.functions";

/**
 * Watches for new HIGH-severity SUSPICIOUS_APP alerts for the signed-in parent
 * and invokes the Telegram server sender to deliver a Telegram message.
 * The sender de-dupes via the `telegram_sent` flag.
 */
export function useTelegramNotifier() {
  const { session, user } = useAuth();
  const uid = user?.id;
  const sendTelegram = useServerFn(sendTelegramAlert);
  const inFlight = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!uid || !session?.access_token) return;
    const accessToken = session.access_token;

    const trySend = async (alertId: string) => {
      if (inFlight.current.has(alertId)) return;
      inFlight.current.add(alertId);
      try {
        await sendTelegram({ data: { alertId, accessToken } });
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
  }, [sendTelegram, session?.access_token, uid]);
}
