DROP FUNCTION IF EXISTS public.tg_link_chat(text, text, text);
DROP FUNCTION IF EXISTS public.tg_status_by_chat(text);

CREATE TABLE IF NOT EXISTS public.telegram_link_attempts (
  link_code text PRIMARY KEY,
  telegram_chat_id text NOT NULL,
  telegram_username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

GRANT ALL ON public.telegram_link_attempts TO service_role;

ALTER TABLE public.telegram_link_attempts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_telegram_link_attempts_chat ON public.telegram_link_attempts(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_link_attempts_created ON public.telegram_link_attempts(created_at DESC);