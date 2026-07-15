import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const claimTelegramLinkAttempt = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        code: z.string().trim().min(4).max(32),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const code = data.code.trim().toUpperCase();
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

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