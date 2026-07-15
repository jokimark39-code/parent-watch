// Supabase Edge Function: telegram-webhook
// Deploy: `supabase functions deploy telegram-webhook --no-verify-jwt`
//
// Stores Telegram /start attempts in the Lovable Cloud backend. The dashboard
// claims the attempt and updates the parent's own external app row via RLS.
//
// Secrets required:
//   LOVABLE_API_KEY
//   TELEGRAM_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

const backend = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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
  console.log("update:", JSON.stringify(update));

  const msg = update.message ?? update.edited_message;
  if (!msg?.chat?.id) return new Response("ok");

  const chatId = String(msg.chat.id);
  const username = msg.from?.username ?? null;
  const text: string = (msg.text ?? "").trim();

  try {
    if (text.startsWith("/start")) {
      const parts = text.split(/\s+/);
      const code = (parts[1] ?? "").trim().toUpperCase();
      if (!code) {
        await reply(chatId, "👋 Welcome to SafeGuard.\nGenerate a link code in your dashboard, then send:\n<code>/start YOUR-CODE</code>");
        return new Response("ok");
      }

      const { error } = await backend.from("telegram_link_attempts").upsert(
        {
          link_code: code,
          telegram_chat_id: chatId,
          telegram_username: username,
          created_at: new Date().toISOString(),
          consumed_at: null,
        },
        { onConflict: "link_code" },
      );

      if (error) {
        console.error("telegram_link_attempts error:", error);
        await reply(chatId, "⚠️ Something went wrong linking your chat. Please try again in a moment.");
        return new Response("ok");
      }

      await reply(chatId, "✅ <b>Code received.</b>\nReturn to your SafeGuard dashboard — Telegram will show as connected in a few seconds.");
      return new Response("ok");
    }

    if (text === "/status") {
      const { data } = await backend
        .from("telegram_link_attempts")
        .select("consumed_at, created_at")
        .eq("telegram_chat_id", chatId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data?.consumed_at) await reply(chatId, "✅ Code accepted by your SafeGuard dashboard.");
      else if (data) await reply(chatId, "⏳ Code received. Open your SafeGuard dashboard Settings page to finish linking.");
      else await reply(chatId, "⚠️ Not connected. Generate a code in the dashboard and send /start CODE.");
      return new Response("ok");
    }

    await reply(chatId, "Send <code>/start YOUR-CODE</code> to link this chat to your SafeGuard dashboard.");
  } catch (e) {
    console.error("webhook error:", e);
    try { await reply(chatId, "⚠️ Internal error. Please try again."); } catch {}
  }
  return new Response("ok");
});
