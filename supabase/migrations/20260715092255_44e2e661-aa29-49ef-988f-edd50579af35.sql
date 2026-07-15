CREATE OR REPLACE FUNCTION public.tg_link_chat(
  _code text,
  _chat_id text,
  _username text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rows int;
BEGIN
  UPDATE public.telegram_connections
     SET telegram_chat_id = _chat_id,
         telegram_username = _username,
         is_connected = true,
         connected_at = now(),
         updated_at = now()
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
  SELECT telegram_connections.email, telegram_connections.is_connected
    FROM public.telegram_connections
   WHERE telegram_connections.telegram_chat_id = _chat_id
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.tg_status_by_chat(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_status_by_chat(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';