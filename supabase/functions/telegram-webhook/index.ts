// Supabase Edge Function: telegram-webhook
// Deploy: `supabase functions deploy telegram-webhook --no-verify-jwt`
//
// Uses the Lovable connector gateway for Telegram (no bot token needed).
// Register webhook via the gateway:
//   POST https://connector-gateway.lovable.dev/telegram/setWebhook
//   Headers: Authorization: Bearer $LOVABLE_API_KEY, X-Connection-Api-Key: $TELEGRAM_API_KEY
//   Body: { "url": "https://<project>.supabase.co/functions/v1/telegram-webhook" }
//
// Secrets required:
//   LOVABLE_API_KEY
//   TELEGRAM_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

const admin = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function reply(chat_id: number | string, text: string) {
  const r = await fetch(`${GATEWAY}/sendMessage`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chat_id, text, parse_mode: "HTML" }),
  });
  if (!r.ok) {
    const body = await r.text();
    console.error(`Telegram gateway failed [${r.status}]: ${body}`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  let update: any;
  try { update = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  const msg = update.message ?? update.edited_message;
  if (!msg?.chat?.id) return new Response("ok");

  const chatId = String(msg.chat.id);
  const username = msg.from?.username ?? null;
  const text: string = (msg.text ?? "").trim();

  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    const code = (parts[1] ?? "").trim().toUpperCase();
    if (!code) {
      await reply(chatId, "👋 Welcome to SafeGuard.\nGenerate a link code in your dashboard, then send:\n<code>/start YOUR-CODE</code>");
      return new Response("ok");
    }

    const { data: row, error } = await admin
      .from("telegram_connections")
      .select("id, parent_id, is_connected")
      .eq("link_code", code)
      .maybeSingle();

    if (error || !row) {
      await reply(chatId, "❌ Invalid or expired link code. Please generate a new code from your dashboard.");
      return new Response("ok");
    }

    await admin.from("telegram_connections").update({
      telegram_chat_id: chatId,
      telegram_username: username,
      is_connected: true,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);

    await reply(chatId, "✅ <b>SafeGuard Telegram alerts connected successfully.</b>\nYou will receive high-risk app alerts here.");
    return new Response("ok");
  }

  if (text === "/status") {
    const { data } = await admin
      .from("telegram_connections")
      .select("email, is_connected")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();
    if (data?.is_connected) await reply(chatId, `✅ Connected as <b>${data.email ?? "parent"}</b>`);
    else await reply(chatId, "⚠️ Not connected. Generate a code in the dashboard and send /start CODE.");
    return new Response("ok");
  }

  await reply(chatId, "Send <code>/start YOUR-CODE</code> to link this chat to your SafeGuard dashboard.");
  return new Response("ok");
});
