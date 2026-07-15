DROP POLICY IF EXISTS "backend can manage telegram link attempts" ON public.telegram_link_attempts;
CREATE POLICY "backend can manage telegram link attempts"
ON public.telegram_link_attempts
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);