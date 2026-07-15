// Supabase Edge Function: send-telegram-alert
// Deploy: `supabase functions deploy send-telegram-alert`
//
// Called by the dashboard (authenticated user) to send a Telegram message
// for one alert id, or a test message. Uses service role to look up the
// caller's telegram_connections row and to mark the alert as sent.
//
// Secrets required:
//   TELEGRAM_BOT_TOKEN
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   DASHBOARD_URL (optional)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DASHBOARD_URL = Deno.env.get("DASHBOARD_URL") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const admin = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function sendTg(chatId: string, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  return r.ok;
}

function fmt(alert: any, deviceName?: string | null) {
  const when = alert.created_at ? new Date(alert.created_at).toLocaleString() : new Date().toLocaleString();
  const pkgMatch = (alert.message || "").match(/\(([^)]+)\)/);
  const pkg = pkgMatch?.[1] ?? "—";
  const cleanMsg = (alert.message || "").replace(/\s*\[pkg:[^\]]+\]\s*/g, "").trim();
  return [
    "🚨 <b>SafeGuard High Risk App Alert</b>",
    "",
    `<b>Child Device:</b> ${deviceName ?? "Child Phone"}`,
    `<b>Alert:</b> ${alert.title ?? "Suspicious app detected"}`,
    `<b>Package:</b> <code>${pkg}</code>`,
    `<b>Risk Level:</b> ${alert.severity ?? "HIGH"}`,
    `<b>Reason:</b> ${cleanMsg || "Gambling/slot-related app detected"}`,
    `<b>Detected At:</b> ${when}`,
    DASHBOARD_URL ? `\n🔗 <a href="${DASHBOARD_URL}">Open Dashboard</a>` : "",
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: userRes, error: uErr } = await admin.auth.getUser(jwt);
    if (uErr || !userRes?.user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

    const user = userRes.user;
    const body = await req.json().catch(() => ({}));
    const { alert_id, test } = body as { alert_id?: string; test?: boolean };

    const { data: conn } = await admin
      .from("telegram_connections")
      .select("telegram_chat_id, is_connected")
      .eq("parent_id", user.id)
      .maybeSingle();

    if (!conn?.is_connected || !conn?.telegram_chat_id) {
      return new Response(JSON.stringify({ error: "telegram_not_connected" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (test) {
      const now = new Date().toLocaleString();
      const text = [
        "🧪 <b>SafeGuard Test Alert</b>",
        "",
        `<b>Parent:</b> ${user.email ?? "—"}`,
        `<b>Title:</b> Test notification`,
        `<b>Time:</b> ${now}`,
        "",
        "If you can read this, your Telegram alerts are working ✅",
      ].join("\n");
      const ok = await sendTg(conn.telegram_chat_id, text);
      return new Response(JSON.stringify({ ok }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (!alert_id) return new Response(JSON.stringify({ error: "missing alert_id" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: alert } = await admin.from("alerts").select("*").eq("id", alert_id).eq("parent_id", user.id).maybeSingle();
    if (!alert) return new Response(JSON.stringify({ error: "alert_not_found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
    if (alert.telegram_sent) return new Response(JSON.stringify({ ok: true, skipped: "already_sent" }), { headers: { ...cors, "Content-Type": "application/json" } });
    if (String(alert.severity || "").toUpperCase() !== "HIGH") {
      return new Response(JSON.stringify({ ok: false, skipped: "not_high" }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    let deviceName: string | null = null;
    if (alert.device_id) {
      const { data: dev } = await admin.from("devices").select("child_name,device_name,device_model").eq("id", alert.device_id).maybeSingle();
      deviceName = dev?.child_name || dev?.device_name || dev?.device_model || null;
    }

    const ok = await sendTg(conn.telegram_chat_id, fmt(alert, deviceName));
    if (ok) {
      await admin.from("alerts").update({ telegram_sent: true, telegram_sent_at: new Date().toISOString() }).eq("id", alert_id);
    }
    return new Response(JSON.stringify({ ok }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
