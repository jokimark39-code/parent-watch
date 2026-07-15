// Supabase Edge Function: telegram-webhook
// Deploy: `supabase functions deploy telegram-webhook --no-verify-jwt`
//
// Talks to the APP's external Supabase (iuuvannpblamllbsqtfl) via anon key
// + SECURITY DEFINER RPCs so no service role is needed.
//
// Secrets required:
//   LOVABLE_API_KEY
//   TELEGRAM_API_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY")!;

// External app database (same as src/lib/supabase.ts)
const APP_SUPABASE_URL = "https://iuuvannpblamllbsqtfl.supabase.co";
const APP_SUPABASE_ANON = "sb_publishable_cXZHltdEI5WB4GKzjcwdQg_u3RJlPZ1";

const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

const app = createClient(APP_SUPABASE_URL, APP_SUPABASE_ANON, {
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

      const { data: linked, error } = await app.rpc("tg_link_chat", {
        _code: code,
        _chat_id: chatId,
        _username: username,
      });

      if (error) {
        console.error("tg_link_chat error:", error);
        await reply(chatId, "⚠️ Something went wrong linking your chat. Please try again in a moment.");
        return new Response("ok");
      }

      if (!linked) {
        await reply(chatId, "❌ Invalid or expired link code. Please generate a new code from your dashboard.");
        return new Response("ok");
      }

      await reply(chatId, "✅ <b>SafeGuard Telegram alerts connected successfully.</b>\nYou will receive high-risk app alerts here.");
      return new Response("ok");
    }

    if (text === "/status") {
      const { data } = await app.rpc("tg_status_by_chat", { _chat_id: chatId });
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.is_connected) await reply(chatId, `✅ Connected as <b>${row.email ?? "parent"}</b>`);
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
