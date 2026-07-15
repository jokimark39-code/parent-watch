// Supabase Edge Function: send-telegram-alert
// Deploy: `supabase functions deploy send-telegram-alert`
//
// Uses the APP's external Supabase (iuuvannpblamllbsqtfl) with the caller's
// JWT so all reads/writes go through RLS as that user. No service role needed.
//
// Secrets required:
//   LOVABLE_API_KEY
//   TELEGRAM_API_KEY
//   DASHBOARD_URL (optional)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY")!;
const DASHBOARD_URL = Deno.env.get("DASHBOARD_URL") ?? "";

// External app database (same as src/lib/supabase.ts)
const APP_SUPABASE_URL = "https://iuuvannpblamllbsqtfl.supabase.co";
const APP_SUPABASE_ANON = "sb_publishable_cXZHltdEI5WB4GKzjcwdQg_u3RJlPZ1";

const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function sendTg(chatId: string, text: string) {
  const r = await fetch(`${GATEWAY}/sendMessage`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!r.ok) {
    console.error(`Telegram gateway failed [${r.status}]: ${await r.text()}`);
    return false;
  }
  const data = await r.json().catch(() => ({}));
  if (data && data.ok === false) {
    console.error(`Telegram error: ${JSON.stringify(data)}`);
    return false;
  }
  return true;
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
    if (!jwt) return json({ error: "unauthorized" }, 401);

    // Use the caller's JWT so RLS scopes queries to that user.
    const app = createClient(APP_SUPABASE_URL, APP_SUPABASE_ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: userRes, error: uErr } = await app.auth.getUser(jwt);
    if (uErr || !userRes?.user) return json({ error: "unauthorized" }, 401);
    const user = userRes.user;

    const body = await req.json().catch(() => ({}));
    const { alert_id, test } = body as { alert_id?: string; test?: boolean };

    const { data: conn } = await app
      .from("telegram_connections")
      .select("telegram_chat_id, is_connected")
      .eq("parent_id", user.id)
      .maybeSingle();

    if (!conn?.is_connected || !conn?.telegram_chat_id) {
      return json({ error: "telegram_not_connected" }, 400);
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
      return json({ ok });
    }

    if (!alert_id) return json({ error: "missing alert_id" }, 400);

    const { data: alert } = await app.from("alerts").select("*").eq("id", alert_id).maybeSingle();
    if (!alert) return json({ error: "alert_not_found" }, 404);
    if (alert.telegram_sent) return json({ ok: true, skipped: "already_sent" });
    if (String(alert.severity || "").toUpperCase() !== "HIGH") {
      return json({ ok: false, skipped: "not_high" });
    }

    let deviceName: string | null = null;
    if (alert.device_id) {
      const { data: dev } = await app.from("devices").select("child_name,device_name,device_model").eq("id", alert.device_id).maybeSingle();
      deviceName = dev?.child_name || dev?.device_name || dev?.device_model || null;
    }

    const ok = await sendTg(conn.telegram_chat_id, fmt(alert, deviceName));
    if (ok) {
      await app.from("alerts").update({ telegram_sent: true, telegram_sent_at: new Date().toISOString() }).eq("id", alert_id);
    }
    return json({ ok });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
