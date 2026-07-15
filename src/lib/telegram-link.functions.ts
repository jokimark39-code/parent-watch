import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const claimTelegramLinkAttempt = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        code: z.string().trim().min(4).max(32),
        accessToken: z.string().min(20),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = createClient(
      "https://iuuvannpblamllbsqtfl.supabase.co",
      "sb_publishable_cXZHltdEI5WB4GKzjcwdQg_u3RJlPZ1",
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${data.accessToken}` } },
      },
    );

    const { data: authData, error: authError } = await app.auth.getUser(data.accessToken);
    if (authError || !authData.user) throw new Error("Not signed in");

    const admin = supabaseAdmin as any;
    const code = data.code.trim().toUpperCase();
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const { data: connection, error: connectionError } = await app
      .from("telegram_connections")
      .select("parent_id, link_code, is_connected")
      .eq("parent_id", authData.user.id)
      .eq("link_code", code)
      .maybeSingle();

    if (connectionError) throw connectionError;
    if (!connection || connection.is_connected) return { linked: false as const };

    const { data: attempt, error } = await admin
      .from("telegram_link_attempts")
      .select("link_code, telegram_chat_id, telegram_username, created_at, consumed_at")
      .eq("link_code", code)
      .is("consumed_at", null)
      .gte("created_at", cutoff)
      .maybeSingle();

    if (error) throw error;
    if (!attempt) return { linked: false as const };

    const now = new Date().toISOString();
    const { error: updateError } = await app
      .from("telegram_connections")
      .update({
        telegram_chat_id: attempt.telegram_chat_id,
        telegram_username: attempt.telegram_username,
        is_connected: true,
        connected_at: now,
        updated_at: now,
      })
      .eq("parent_id", authData.user.id)
      .eq("link_code", code);

    if (updateError) throw updateError;

    const { error: consumeError } = await admin
      .from("telegram_link_attempts")
      .update({ consumed_at: now })
      .eq("link_code", code)
      .is("consumed_at", null);

    if (consumeError) throw consumeError;

    return {
      linked: true as const,
      telegram_chat_id: attempt.telegram_chat_id as string,
      telegram_username: (attempt.telegram_username as string | null) ?? null,
    };
  });

export const sendTelegramAlert = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        accessToken: z.string().min(20),
        alertId: z.string().uuid().optional(),
        test: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const lovableApiKey = process.env.LOVABLE_API_KEY;
    const telegramApiKey = process.env.TELEGRAM_API_KEY;

    if (!lovableApiKey) throw new Error("Telegram service is not configured");
    if (!telegramApiKey) throw new Error("Telegram connection is not configured");

    const app = createClient(
      "https://iuuvannpblamllbsqtfl.supabase.co",
      "sb_publishable_cXZHltdEI5WB4GKzjcwdQg_u3RJlPZ1",
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${data.accessToken}` } },
      },
    );

    const { data: authData, error: authError } = await app.auth.getUser(data.accessToken);
    if (authError || !authData.user) throw new Error("Not signed in");
    const user = authData.user;

    const { data: conn, error: connError } = await app
      .from("telegram_connections")
      .select("telegram_chat_id, is_connected")
      .eq("parent_id", user.id)
      .maybeSingle();

    if (connError) throw connError;
    if (!conn?.is_connected || !conn?.telegram_chat_id) {
      // Not an error: Telegram is optional. Skip silently so background
      // notifiers don't surface runtime errors when the user hasn't linked yet.
      return { ok: false, skipped: "not_connected" as const };
    }

    let message: string;
    if (data.test) {
      message = [
        "🧪 <b>SafeGuard Test Alert</b>",
        "",
        `<b>Parent:</b> ${user.email ?? "—"}`,
        "<b>Title:</b> Test notification",
        `<b>Time:</b> ${new Date().toLocaleString()}`,
        "",
        "If you can read this, your Telegram alerts are working ✅",
      ].join("\n");
    } else {
      if (!data.alertId) throw new Error("Missing alert id");

      const { data: alert, error: alertError } = await app
        .from("alerts")
        .select("*")
        .eq("id", data.alertId)
        .maybeSingle();

      if (alertError) throw alertError;
      if (!alert) throw new Error("Alert not found");
      if (alert.telegram_sent) return { ok: true, skipped: "already_sent" as const };
      if (String(alert.severity || "").toUpperCase() !== "HIGH") {
        return { ok: false, skipped: "not_high" as const };
      }

      let deviceName: string | null = null;
      if (alert.device_id) {
        const { data: device } = await app
          .from("devices")
          .select("name,model")
          .eq("id", alert.device_id)
          .maybeSingle();
        deviceName = device?.name || device?.model || null;
      }

      const pkgMatch = (alert.message || "").match(/\(([^)]+)\)/);
      const pkg = pkgMatch?.[1] ?? "—";
      const cleanMsg = (alert.message || "").replace(/\s*\[pkg:[^\]]+\]\s*/g, "").trim();
      message = [
        "🚨 <b>SafeGuard High Risk App Alert</b>",
        "",
        `<b>Child Device:</b> ${deviceName ?? "Child Phone"}`,
        `<b>Alert:</b> ${alert.title ?? "Suspicious app detected"}`,
        `<b>Package:</b> <code>${pkg}</code>`,
        `<b>Risk Level:</b> ${alert.severity ?? "HIGH"}`,
        `<b>Reason:</b> ${cleanMsg || "Gambling/slot-related app detected"}`,
        `<b>Detected At:</b> ${alert.created_at ? new Date(alert.created_at).toLocaleString() : new Date().toLocaleString()}`,
      ].join("\n");
    }

    const response = await fetch("https://connector-gateway.lovable.dev/telegram/sendMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "X-Connection-Api-Key": telegramApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: conn.telegram_chat_id,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const responseText = await response.text();
    let responseBody: any = null;
    try {
      responseBody = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseBody = responseText;
    }

    if (!response.ok || responseBody?.ok === false) {
      console.error("Telegram send failed", response.status, responseBody);
      const detail =
        typeof responseBody === "string"
          ? responseBody
          : responseBody?.description || responseBody?.error || responseBody?.message || JSON.stringify(responseBody);
      throw new Error(`Failed to send Telegram message${detail ? `: ${detail}` : ""}`);
    }

    if (!data.test && data.alertId) {
      const { error: updateError } = await app
        .from("alerts")
        .update({ telegram_sent: true, telegram_sent_at: new Date().toISOString() })
        .eq("id", data.alertId);
      if (updateError) throw updateError;
    }

    return { ok: true };
  });