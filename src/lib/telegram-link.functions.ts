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

    const { error: consumeError } = await admin
      .from("telegram_link_attempts")
      .update({ consumed_at: new Date().toISOString() })
      .eq("link_code", code)
      .is("consumed_at", null);

    if (consumeError) throw consumeError;

    return {
      linked: true as const,
      telegram_chat_id: attempt.telegram_chat_id as string,
      telegram_username: (attempt.telegram_username as string | null) ?? null,
    };
  });