-- =========================================================
-- TELEGRAM ALERTS SETUP — run this in your Supabase SQL Editor
-- for the app's database project (iuuvannpblamllbsqtfl).
-- Safe to run multiple times.
-- =========================================================

-- 1) telegram_connections table
CREATE TABLE IF NOT EXISTS public.telegram_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  telegram_chat_id text,
  telegram_username text,
  link_code text UNIQUE,
  is_connected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  connected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure parent_id is unique (needed for upsert onConflict=parent_id)
DO $$ BEGIN
  ALTER TABLE public.telegram_connections
    ADD CONSTRAINT telegram_connections_parent_id_key UNIQUE (parent_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_tg_conn_parent ON public.telegram_connections(parent_id);
CREATE INDEX IF NOT EXISTS idx_tg_conn_code   ON public.telegram_connections(link_code);
CREATE INDEX IF NOT EXISTS idx_tg_conn_chat   ON public.telegram_connections(telegram_chat_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_connections TO authenticated;
GRANT ALL ON public.telegram_connections TO service_role;

ALTER TABLE public.telegram_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own tg select" ON public.telegram_connections;
CREATE POLICY "own tg select" ON public.telegram_connections
  FOR SELECT TO authenticated USING (auth.uid() = parent_id);

DROP POLICY IF EXISTS "own tg insert" ON public.telegram_connections;
CREATE POLICY "own tg insert" ON public.telegram_connections
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = parent_id);

DROP POLICY IF EXISTS "own tg update" ON public.telegram_connections;
CREATE POLICY "own tg update" ON public.telegram_connections
  FOR UPDATE TO authenticated USING (auth.uid() = parent_id) WITH CHECK (auth.uid() = parent_id);

DROP POLICY IF EXISTS "own tg delete" ON public.telegram_connections;
CREATE POLICY "own tg delete" ON public.telegram_connections
  FOR DELETE TO authenticated USING (auth.uid() = parent_id);

-- 2) De-dupe columns on alerts
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS telegram_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS telegram_sent_at timestamptz;

-- 3) SECURITY DEFINER RPCs so the Telegram webhook (no auth) can
--    link a chat by code and check status without breaking RLS.

CREATE OR REPLACE FUNCTION public.tg_link_chat(
  _code text,
  _chat_id text,
  _username text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rows int;
BEGIN
  UPDATE public.telegram_connections
     SET telegram_chat_id  = _chat_id,
         telegram_username = _username,
         is_connected      = true,
         connected_at      = now(),
         updated_at        = now()
   WHERE upper(link_code) = upper(_code);
  GET DIAGNOSTICS _rows = ROW_COUNT;
  RETURN _rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_link_chat(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_link_chat(text, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_status_by_chat(_chat_id text)
RETURNS TABLE(email text, is_connected boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email, is_connected
    FROM public.telegram_connections
   WHERE telegram_chat_id = _chat_id
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.tg_status_by_chat(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_status_by_chat(text) TO anon, authenticated, service_role;
