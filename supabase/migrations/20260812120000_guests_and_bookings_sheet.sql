-- ============================================================
-- SYNC GUEST FLOW — MAIN GUESTS TABLE + BOOKINGS (sheet layout)
-- ============================================================

-- ---------- 0. clean re-run helpers (safe) ----------
DROP VIEW IF EXISTS public.v_booking_sheet;

-- ============================================================
-- 1. MAIN TABLE: public.guests   (the table "on top")
-- ============================================================
CREATE TABLE IF NOT EXISTS public.guests (
  guest_uid   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- № of the guest
  guest_no    BIGINT GENERATED ALWAYS AS IDENTITY,

  -- "ID (Main)"  ->  #0000001 main
  main_id     TEXT UNIQUE,

  -- "F.I.O"      ->  Kambar Aziz Baxt o'g'li
  fio         TEXT NOT NULL DEFAULT '',
  last_name   TEXT NOT NULL DEFAULT '',
  first_name  TEXT NOT NULL DEFAULT '',
  middle_name TEXT NOT NULL DEFAULT '',

  -- "Тип гостя"  ->  офф | онлайн
  guest_kind  TEXT NOT NULL DEFAULT 'офф'
              CHECK (guest_kind IN ('офф','онлайн')),

  -- contacts
  tel         TEXT NOT NULL DEFAULT '',   -- "Tel"     9986050054
  whats       TEXT NOT NULL DEFAULT '',   -- "WHATS"   9986050054
  email       TEXT NOT NULL DEFAULT '',   -- "email"   kambar@gmail.com
  telega      TEXT NOT NULL DEFAULT '',   -- "Telega"  @asdfef
  inst        TEXT NOT NULL DEFAULT '',   -- "INST"    @asefd

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

-- main_id auto = '#' + lpad(guest_no,7,'0') + ' main'
CREATE OR REPLACE FUNCTION public.guests_before_write()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.main_id IS NULL OR NEW.main_id = '' THEN
    NEW.main_id := '#' || lpad(NEW.guest_no::text, 7, '0') || ' main';
  END IF;
  IF NEW.fio IS NULL OR NEW.fio = '' THEN
    NEW.fio := btrim(concat_ws(' ', NEW.last_name, NEW.first_name, NEW.middle_name));
  END IF;
  -- keep phone digits only for reliable matching
  NEW.tel   := regexp_replace(coalesce(NEW.tel,''),   '\D', '', 'g');
  NEW.whats := regexp_replace(coalesce(NEW.whats,''), '\D', '', 'g');
  IF NEW.whats = '' THEN NEW.whats := NEW.tel; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guests_before_write ON public.guests;
CREATE TRIGGER guests_before_write
BEFORE INSERT OR UPDATE ON public.guests
FOR EACH ROW EXECUTE FUNCTION public.guests_before_write();

-- one person = one phone (this is what prevents duplicated "main" ids)
CREATE UNIQUE INDEX IF NOT EXISTS guests_tel_uidx
  ON public.guests (tel) WHERE tel <> '';
CREATE INDEX IF NOT EXISTS guests_fio_idx ON public.guests (lower(fio));

-- ============================================================
-- 2. BOOKINGS  (one row per stay, linked to guests.main_id)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bookings (
  booking_uid  TEXT PRIMARY KEY,                  -- frontend Booking.id

  -- "№"
  no           BIGINT GENERATED ALWAYS AS IDENTITY,

  -- "ID (bkg)"  ->  #000001bkg
  bkg_id       TEXT UNIQUE,

  -- "ID (Main)" ->  FK to the main table
  main_id      TEXT NOT NULL
               REFERENCES public.guests(main_id)
               ON UPDATE CASCADE ON DELETE RESTRICT,

  -- "Тип"       ->  рез | нерез
  resident_type TEXT NOT NULL DEFAULT 'рез'
                CHECK (resident_type IN ('рез','нерез')),

  -- "Проживание" ->  11.08.26 - 12.08.26  (generated, never typed by hand)
  stay_from    DATE NOT NULL,
  stay_to      DATE NOT NULL,
  residement   TEXT GENERATED ALWAYS AS (
                 to_char(stay_from,'DD.MM.YY') || ' - ' || to_char(stay_to,'DD.MM.YY')
               ) STORED,
  CONSTRAINT bookings_dates_ok CHECK (stay_to >= stay_from),

  -- "Гости"
  guests_count INTEGER NOT NULL DEFAULT 1 CHECK (guests_count > 0),

  -- "Заезд" / "Выезд"
  check_in     TEXT NOT NULL DEFAULT 'стандарт' CHECK (check_in  IN ('ранний','стандарт')),
  check_out    TEXT NOT NULL DEFAULT 'стандарт' CHECK (check_out IN ('поздний','стандарт')),

  -- "Сумма"  ->  numeric + formatted "100,000 сумм"
  amount       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency     TEXT NOT NULL DEFAULT 'сумм',
  amount_text  TEXT GENERATED ALWAYS AS (
                 to_char(amount, 'FM999,999,999,990') || ' ' || currency
               ) STORED,

  -- "Тип оплаты" ->  нал | карта | перевод
  payment_type TEXT NOT NULL DEFAULT 'нал'
               CHECK (payment_type IN ('нал','карта','перевод')),

  -- "Доп заметки"
  notes        TEXT NOT NULL DEFAULT '',

  -- room info kept from the old sheet (not shown in this sheet but needed by the app)
  room_number  TEXT NOT NULL DEFAULT '',
  room_current INTEGER,
  category     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'booked'
               CHECK (status IN ('confirmed','pending','booked','in-house',
                                 'checked-out','maintenance','dirty','cleaned')),

  -- the whole frontend Booking object, so no feature is lost
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   TEXT
);

-- bkg_id auto = '#' + lpad(no,6,'0') + 'bkg'
CREATE OR REPLACE FUNCTION public.bookings_before_write()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.bkg_id IS NULL OR NEW.bkg_id = '' THEN
    NEW.bkg_id := '#' || lpad(NEW.no::text, 6, '0') || 'bkg';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_before_write ON public.bookings;
CREATE TRIGGER bookings_before_write
BEFORE INSERT OR UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_before_write();

CREATE INDEX IF NOT EXISTS bookings_main_idx   ON public.bookings (main_id);
CREATE INDEX IF NOT EXISTS bookings_dates_idx  ON public.bookings (stay_from, stay_to);
CREATE INDEX IF NOT EXISTS bookings_status_idx ON public.bookings (status);

-- ============================================================
-- 3. THE LINK HELPER: one call creates/finds the guest and books
--    (this is "linking the fillings with the table on top")
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_guest(
  p_fio    TEXT,
  p_tel    TEXT,
  p_whats  TEXT DEFAULT '',
  p_email  TEXT DEFAULT '',
  p_telega TEXT DEFAULT '',
  p_inst   TEXT DEFAULT '',
  p_kind   TEXT DEFAULT 'офф'
) RETURNS TEXT                        -- returns main_id
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tel  TEXT := regexp_replace(coalesce(p_tel,''), '\D', '', 'g');
  v_main TEXT;
BEGIN
  IF v_tel <> '' THEN
    SELECT main_id INTO v_main FROM public.guests WHERE tel = v_tel;
  END IF;
  IF v_main IS NULL AND coalesce(p_fio,'') <> '' THEN
    SELECT main_id INTO v_main FROM public.guests
     WHERE lower(fio) = lower(btrim(p_fio)) LIMIT 1;
  END IF;

  IF v_main IS NULL THEN
    INSERT INTO public.guests (fio, tel, whats, email, telega, inst, guest_kind)
    VALUES (btrim(coalesce(p_fio,'')), v_tel, coalesce(p_whats,''),
            coalesce(p_email,''), coalesce(p_telega,''), coalesce(p_inst,''),
            coalesce(NULLIF(p_kind,''),'офф'))
    RETURNING main_id INTO v_main;
  ELSE
    UPDATE public.guests SET
      fio        = COALESCE(NULLIF(btrim(p_fio),''), fio),
      whats      = COALESCE(NULLIF(p_whats,''),  whats),
      email      = COALESCE(NULLIF(p_email,''),  email),
      telega     = COALESCE(NULLIF(p_telega,''), telega),
      inst       = COALESCE(NULLIF(p_inst,''),   inst),
      guest_kind = COALESCE(NULLIF(p_kind,''),   guest_kind)
    WHERE main_id = v_main;
  END IF;

  RETURN v_main;
END;
$$;

-- ============================================================
-- 4. THE SHEET VIEW — exactly your 18 columns, in your order
-- ============================================================
CREATE VIEW public.v_booking_sheet AS
SELECT
  b.no                AS "№",
  b.bkg_id            AS "ID (bkg)",
  g.main_id           AS "ID (Main)",
  g.fio               AS "F.I.O",
  b.resident_type     AS "Тип",
  b.residement        AS "Проживание",
  b.guests_count      AS "Гости",
  b.check_in          AS "Заезд",
  b.check_out         AS "Выезд",
  b.amount_text       AS "Сумма",
  b.payment_type      AS "Тип оплаты",
  g.tel               AS "Tel",
  g.whats             AS "WHATS",
  g.email             AS "email",
  g.telega            AS "Telega",
  g.inst              AS "INST",
  b.notes             AS "Доп заметки",
  g.guest_kind        AS "Тип гостя",
  b.booking_uid, b.status, b.room_number, b.category,
  b.stay_from, b.stay_to, b.amount, b.updated_at
FROM public.bookings b
JOIN public.guests   g ON g.main_id = b.main_id
ORDER BY b.no;

-- ============================================================
-- 5. GRANTS  (mandatory — PostgREST is blind without them)
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guests   TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookings TO anon, authenticated;
GRANT SELECT                          ON public.v_booking_sheet TO anon, authenticated;
GRANT ALL ON public.guests, public.bookings TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_guest(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
  TO anon, authenticated, service_role;

-- ============================================================
-- 6. RLS  (app uses its own AuthContext, so the browser is `anon`)
-- ============================================================
ALTER TABLE public.guests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff all guests"   ON public.guests;
DROP POLICY IF EXISTS "staff all bookings" ON public.bookings;

CREATE POLICY "staff all guests"   ON public.guests
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff all bookings" ON public.bookings
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 7. REALTIME  (cross-user live sync)
-- ============================================================
ALTER TABLE public.guests   REPLICA IDENTITY FULL;
ALTER TABLE public.bookings REPLICA IDENTITY FULL;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['guests','bookings'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t)
    THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;