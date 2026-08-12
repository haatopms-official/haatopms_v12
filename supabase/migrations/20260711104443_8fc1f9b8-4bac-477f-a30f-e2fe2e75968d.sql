CREATE TABLE IF NOT EXISTS public.hotel_app_state (
  state_key TEXT PRIMARY KEY CHECK (state_key ~ '^[a-z0-9_-]{1,64}$'),
  state_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hotel_app_state TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hotel_app_state TO anon;
GRANT ALL ON public.hotel_app_state TO service_role;

ALTER TABLE public.hotel_app_state ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.update_hotel_app_state_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_hotel_app_state_updated_at ON public.hotel_app_state;
CREATE TRIGGER update_hotel_app_state_updated_at
BEFORE UPDATE ON public.hotel_app_state
FOR EACH ROW EXECUTE FUNCTION public.update_hotel_app_state_updated_at();

DROP POLICY IF EXISTS "No direct read access to hotel app state" ON public.hotel_app_state;
DROP POLICY IF EXISTS "No direct create access to hotel app state" ON public.hotel_app_state;
DROP POLICY IF EXISTS "No direct edit access to hotel app state" ON public.hotel_app_state;
DROP POLICY IF EXISTS "No direct delete access to hotel app state" ON public.hotel_app_state;

CREATE POLICY "No direct read access to hotel app state" ON public.hotel_app_state FOR SELECT USING (false);
CREATE POLICY "No direct create access to hotel app state" ON public.hotel_app_state FOR INSERT WITH CHECK (false);
CREATE POLICY "No direct edit access to hotel app state" ON public.hotel_app_state FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY "No direct delete access to hotel app state" ON public.hotel_app_state FOR DELETE USING (false);

CREATE OR REPLACE FUNCTION public.hotel_app_state_cas(
  p_key TEXT,
  p_expected_version BIGINT,
  p_state_data JSONB
) RETURNS SETOF public.hotel_app_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current BIGINT;
BEGIN
  SELECT version INTO v_current FROM public.hotel_app_state WHERE state_key = p_key FOR UPDATE;
  IF NOT FOUND THEN
    IF p_expected_version = 0 THEN
      RETURN QUERY
      INSERT INTO public.hotel_app_state (state_key, state_data, version)
      VALUES (p_key, p_state_data, 1)
      ON CONFLICT (state_key) DO NOTHING
      RETURNING *;
    END IF;
    RETURN QUERY SELECT * FROM public.hotel_app_state WHERE state_key = p_key;
    RETURN;
  END IF;

  IF v_current = p_expected_version THEN
    RETURN QUERY
    UPDATE public.hotel_app_state
       SET state_data = p_state_data
     WHERE state_key = p_key
    RETURNING *;
  ELSE
    RETURN QUERY SELECT * FROM public.hotel_app_state WHERE state_key = p_key;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hotel_app_state_cas(TEXT, BIGINT, JSONB) TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'hotel_app_state'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.hotel_app_state';
  END IF;
END $$;

ALTER TABLE public.hotel_app_state REPLICA IDENTITY FULL;