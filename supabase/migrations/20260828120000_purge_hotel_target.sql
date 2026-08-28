-- ============================================================
-- HARD PURGE: every booking of the given room numbers and/or
-- category, in EVERY status (confirmed, pending, booked,
-- in-house, checked-out, maintenance, dirty, cleaned), plus the
-- guest rows that existed only for those bookings.
-- Exact numeric matching: purging 101 never touches 1101.
-- ============================================================
CREATE OR REPLACE FUNCTION public.purge_hotel_target(
  p_rooms    INTEGER[] DEFAULT '{}',
  p_category TEXT      DEFAULT NULL
)
RETURNS TABLE (deleted_bookings INTEGER, deleted_guests INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rooms  INTEGER[] := COALESCE(p_rooms, '{}');
  v_cat    TEXT      := NULLIF(BTRIM(COALESCE(p_category, '')), '');
  v_ids    TEXT[];
  v_mains  TEXT[];
  v_bookings INTEGER := 0;
  v_guests   INTEGER := 0;
BEGIN
  IF COALESCE(array_length(v_rooms, 1), 0) = 0 AND v_cat IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- 1) collect every matching booking (all statuses, past and future)
  SELECT COALESCE(array_agg(b.booking_uid), '{}'),
         COALESCE(array_agg(DISTINCT b.main_id), '{}')
    INTO v_ids, v_mains
  FROM public.bookings b
  WHERE
    (
      COALESCE(array_length(v_rooms, 1), 0) > 0
      AND (
        b.room_current = ANY (v_rooms)
        -- multi-segment strings like '101(3d) -- 204(3d)': compare whole numbers only
        OR EXISTS (
          SELECT 1
          FROM regexp_matches(COALESCE(b.room_number, ''), '(\d+)', 'g') AS m
          WHERE (m[1])::INTEGER = ANY (v_rooms)
        )
      )
    )
    OR (v_cat IS NOT NULL AND b.category = v_cat);

  v_bookings := COALESCE(array_length(v_ids, 1), 0);
  IF v_bookings = 0 THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- 2) hard delete the bookings
  DELETE FROM public.bookings WHERE booking_uid = ANY (v_ids);

  -- 3) delete the guests that no longer have ANY booking left
  WITH dead AS (
    DELETE FROM public.guests g
    WHERE g.main_id = ANY (v_mains)
      AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.main_id = g.main_id)
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO v_guests FROM dead;

  RETURN QUERY SELECT v_bookings, v_guests;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_hotel_target(INTEGER[], TEXT)
  TO anon, authenticated, service_role;