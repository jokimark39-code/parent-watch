
CREATE TABLE IF NOT EXISTS public.telegram_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  telegram_chat_id text,
  telegram_username text,
  link_code text UNIQUE,
  is_connected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  connected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_conn_parent ON public.telegram_connections(parent_id);
CREATE INDEX IF NOT EXISTS idx_tg_conn_code ON public.telegram_connections(link_code);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_connections TO authenticated;
GRANT ALL ON public.telegram_connections TO service_role;

ALTER TABLE public.telegram_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own tg select" ON public.telegram_connections
  FOR SELECT TO authenticated USING (auth.uid() = parent_id);

CREATE POLICY "own tg insert" ON public.telegram_connections
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = parent_id);

CREATE POLICY "own tg update" ON public.telegram_connections
  FOR UPDATE TO authenticated USING (auth.uid() = parent_id) WITH CHECK (auth.uid() = parent_id);

CREATE POLICY "own tg delete" ON public.telegram_connections
  FOR DELETE TO authenticated USING (auth.uid() = parent_id);
