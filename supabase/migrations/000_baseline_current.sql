--
-- PostgreSQL database dump
--

\restrict aFdhFnhfUtzFiG1QVXsd4sXFVNxeuqM3i6atPjo2h71JJAC0dtXVd2eCcbUq0gi

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: cleanup_old_logs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_logs() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  DELETE FROM activity_log  WHERE created_at < NOW() - INTERVAL '90 days';
  DELETE FROM reminder_logs WHERE sent_at < NOW() - INTERVAL '90 days';
END;
$$;


--
-- Name: get_my_gym_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_gym_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT gym_id
  FROM public.gym_users
  WHERE user_id = auth.uid()
    AND role = 'owner'
  ORDER BY is_selected DESC NULLS LAST
  LIMIT 1;
$$;


--
-- Name: get_my_gym_id_as_staff(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_gym_id_as_staff() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT gu.gym_id
  FROM public.gym_users gu
  JOIN public.staff s
    ON s.user_id = gu.user_id
   AND s.gym_id  = gu.gym_id
  WHERE gu.user_id = auth.uid()
    AND gu.role = 'staff'
    AND s.is_active = true
    AND s.login_enabled = true
  LIMIT 1;
$$;


--
-- Name: FUNCTION get_my_gym_id_as_staff(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_my_gym_id_as_staff() IS 'Resolves the caller''s gym as a staff member, or NULL if they are not staff, or their staff row is inactive, or their login has been disabled. Every staff RLS policy and staff-scoped RPC in this schema is gated through this one function on purpose, so fixing the check here (rather than in each policy) revokes access everywhere at once. See 115_staff_login_revocation.sql.';


--
-- Name: get_my_member_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_member_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT id FROM members WHERE user_id = auth.uid() AND is_active = true LIMIT 1;
$$;


--
-- Name: get_my_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT role
  FROM public.gym_users
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;


--
-- Name: is_gym_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_gym_owner() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.gym_users
    WHERE user_id = auth.uid()
      AND role = 'owner'
  );
$$;


--
-- Name: is_my_gym(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_my_gym(check_gym_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.gym_users
    WHERE user_id = auth.uid()
      AND role = 'owner'
      AND gym_id = check_gym_id
  );
$$;


--
-- Name: is_my_gym_any_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_my_gym_any_role(check_gym_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select check_gym_id is not null and exists (
    select 1 from public.gym_users
     where user_id = auth.uid()
       and gym_id  = check_gym_id
       and role in ('owner', 'staff')
  );
$$;


--
-- Name: is_platform_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_platform_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.gym_users
    WHERE user_id = auth.uid()
      AND role = 'admin'
  );
$$;


--
-- Name: mark_notifications_read(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL::uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_gym_id uuid;
  v_count  integer;
begin
  -- Owner first (respects the selected branch), then staff.
  v_gym_id := coalesce(get_my_gym_id(), get_my_gym_id_as_staff());
  if v_gym_id is null then
    return 0;
  end if;

  update public.notifications
     set is_read = true,
         read_at = now()
   where gym_id = v_gym_id
     and is_read = false
     and (user_id is null or user_id = auth.uid())
     and (p_ids is null or id = any(p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: prune_old_notifications(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_old_notifications() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer;
begin
  delete from public.notifications
   where created_at < now() - interval '60 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: public_gym_plans(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.public_gym_plans(p_gym_code text) RETURNS TABLE(name text, duration_months integer, price numeric, features text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT p.name, p.duration_months, p.price, p.features
  FROM plans p
  JOIN gyms g ON g.id = p.gym_id
  WHERE g.gym_code = p_gym_code
    AND g.is_active
    AND g.public_plans_enabled
    AND p.is_active
  ORDER BY p.duration_months, p.price;
$$;


--
-- Name: FUNCTION public_gym_plans(p_gym_code text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.public_gym_plans(p_gym_code text) IS 'Read-only marketing projection of active plans for one gym, by gym code. Used by the public landing page. Exposes no member, payment or staff data.';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.members (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    gym_id uuid NOT NULL,
    full_name text NOT NULL,
    phone text,
    email text,
    date_of_birth date,
    gender text,
    join_date date DEFAULT CURRENT_DATE NOT NULL,
    plan_id uuid,
    plan_name text,
    plan_price numeric(10,2),
    plan_duration_months integer,
    expiry_date date,
    payment_mode text,
    payment_status text DEFAULT 'Paid'::text,
    member_type text DEFAULT 'Paid'::text,
    notes text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    cardio_addon boolean DEFAULT false,
    cardio_price numeric(10,2),
    last_reminder_sent date,
    member_addons jsonb,
    referred_by uuid,
    discount_amount numeric DEFAULT 0,
    balance_due numeric DEFAULT 0,
    cancelled_at timestamp with time zone,
    application_number text,
    aadhar_number text,
    aadhar_photo_url text,
    user_id uuid,
    login_enabled boolean DEFAULT true NOT NULL,
    added_by_staff_id uuid,
    added_by_name text,
    CONSTRAINT members_balance_due_check CHECK ((balance_due >= (0)::numeric)),
    CONSTRAINT members_discount_amount_check CHECK ((discount_amount >= (0)::numeric)),
    CONSTRAINT members_gender_check CHECK (((gender = ANY (ARRAY['Male'::text, 'Female'::text, 'Other'::text])) OR (gender IS NULL))),
    CONSTRAINT members_member_type_check CHECK ((member_type = ANY (ARRAY['Paid'::text, 'Unpaid'::text, 'Trial'::text]))),
    CONSTRAINT members_payment_mode_check CHECK (((payment_mode = ANY (ARRAY['Cash'::text, 'Online'::text, 'Card'::text])) OR (payment_mode IS NULL))),
    CONSTRAINT members_payment_status_check CHECK ((payment_status = ANY (ARRAY['Paid'::text, 'Due'::text, 'Partial'::text]))),
    CONSTRAINT members_plan_price_check CHECK (((plan_price IS NULL) OR (plan_price >= (0)::numeric)))
);


--
-- Name: COLUMN members.member_addons; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.members.member_addons IS 'JSON array of add-ons chosen by this member, e.g. [{"name":"Cardio","price":500}]';


--
-- Name: sculpt_add_member(uuid, uuid, text, text, text, date, text, date, uuid, text, numeric, integer, text, date, text, text, text, text, text, text, numeric, numeric, numeric, timestamp with time zone, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_add_member(p_id uuid, p_gym_id uuid, p_full_name text, p_phone text, p_email text, p_date_of_birth date, p_gender text, p_join_date date, p_plan_id uuid, p_plan_name text, p_plan_price numeric, p_plan_duration_months integer, p_member_addons text, p_expiry_date date, p_payment_mode text, p_payment_status text, p_member_type text, p_notes text, p_application_number text, p_aadhar_number text, p_discount_amount numeric, p_balance_due numeric, p_amount_paid numeric, p_paid_at timestamp with time zone, p_payment_notes text, p_added_by_staff_id uuid DEFAULT NULL::uuid, p_added_by_name text DEFAULT NULL::text) RETURNS public.members
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_row public.members;
  v_app_number text;
BEGIN
  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'Full name is required.';
  END IF;
  IF p_join_date IS NULL THEN
    RAISE EXCEPTION 'Join date is required.';
  END IF;
  PERFORM public.sculpt_assert_payment_mode(p_payment_mode);

  IF p_payment_status IS NULL OR p_payment_status NOT IN ('Paid', 'Due', 'Partial') THEN
    RAISE EXCEPTION 'Payment status must be Paid, Due or Partial (got %).', p_payment_status;
  END IF;
  IF p_member_type IS NULL OR p_member_type NOT IN ('Paid', 'Unpaid', 'Trial') THEN
    RAISE EXCEPTION 'Member type must be Paid, Unpaid or Trial (got %).', p_member_type;
  END IF;

  v_app_number := sculpt_generate_application_number(p_gym_id);

  INSERT INTO public.members (
    id, gym_id, full_name, phone, email, date_of_birth, gender, join_date,
    plan_id, plan_name, plan_price, plan_duration_months, member_addons,
    expiry_date, payment_mode, payment_status, member_type, notes,
    application_number, aadhar_number, discount_amount, balance_due,
    added_by_staff_id, added_by_name
  ) VALUES (
    p_id, p_gym_id, p_full_name, p_phone, p_email, p_date_of_birth, p_gender, p_join_date,
    p_plan_id, p_plan_name, p_plan_price, p_plan_duration_months,
    -- Was: p_member_addons (bare text). See header — this is 038's fix,
    -- lost when 104 copied the pre-038 body.
    public.sculpt_addons_to_jsonb(p_member_addons),
    CASE WHEN p_member_type = 'Trial' THEN p_expiry_date ELSE NULL END,
    p_payment_mode, p_payment_status, p_member_type, p_notes,
    v_app_number, p_aadhar_number,
    coalesce(p_discount_amount, 0), coalesce(p_balance_due, 0),
    p_added_by_staff_id, p_added_by_name
  )
  RETURNING * INTO v_row;

  IF coalesce(p_amount_paid, 0) > 0 AND p_member_type <> 'Trial' THEN
    INSERT INTO public.payment_history
      (gym_id, member_id, amount, payment_mode, plan_id, plan_name, paid_at, notes)
    VALUES
      (p_gym_id, v_row.id, p_amount_paid, coalesce(p_payment_mode, 'Cash'),
       p_plan_id, p_plan_name, coalesce(p_paid_at, now()), p_payment_notes);
  END IF;

  RETURN v_row;
END;
$$;


--
-- Name: sculpt_addons_to_jsonb(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_addons_to_jsonb(p_value text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  return p_value::jsonb;
exception when others then
  raise exception 'Add-ons could not be saved — invalid data format.';
end;
$$;


--
-- Name: sculpt_assert_payment_mode(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_assert_payment_mode(p_mode text) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    AS $$
begin
  if p_mode is not null and p_mode not in ('Cash', 'Online', 'Card') then
    raise exception 'Payment mode must be Cash, Online or Card (got %).', p_mode;
  end if;
end;
$$;


--
-- Name: sculpt_checkin_followup(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_checkin_followup(p_gym_id uuid, p_threshold_days integer DEFAULT NULL::integer) RETURNS TABLE(member_id uuid, full_name text, phone text, join_date date, last_visit timestamp with time zone, days_since_last_visit integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH threshold AS (
    SELECT COALESCE(p_threshold_days, (SELECT checkin_followup_days FROM gyms WHERE id = p_gym_id), 21) AS days
  ),
  last_ok AS (
    SELECT c.member_id, MAX(c.checked_in_at) AS last_visit
    FROM member_checkins c
    WHERE c.gym_id = p_gym_id AND c.status = 'ok'
    GROUP BY c.member_id
  )
  SELECT
    m.id, m.full_name, m.phone, m.join_date, lo.last_visit,
    CASE
      WHEN lo.last_visit IS NOT NULL THEN EXTRACT(DAY FROM now() - lo.last_visit)::int
      ELSE EXTRACT(DAY FROM now() - m.join_date::timestamptz)::int
    END AS days_since_last_visit
  FROM members m
  LEFT JOIN last_ok lo ON lo.member_id = m.id
  CROSS JOIN threshold t
  WHERE m.gym_id = p_gym_id
    AND m.is_active = true
    AND m.cancelled_at IS NULL
    AND (m.expiry_date IS NULL OR m.expiry_date >= CURRENT_DATE)
    AND (
      (lo.last_visit IS NOT NULL AND lo.last_visit < now() - (t.days || ' days')::interval)
      -- Never checked in: only surfaced once they've HAD threshold days
      -- to do so, measured from join_date — a member who joined
      -- yesterday must not appear on a 21-day follow-up list.
      OR (lo.last_visit IS NULL AND m.join_date <= CURRENT_DATE - t.days)
    )
  ORDER BY days_since_last_visit DESC;
$$;


--
-- Name: FUNCTION sculpt_checkin_followup(p_gym_id uuid, p_threshold_days integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sculpt_checkin_followup(p_gym_id uuid, p_threshold_days integer) IS 'Active, non-expired, non-cancelled members who have not checked in within the threshold — the owner''s renewal call list, distinct from the denied_expired rows member_checkins already records for people who tried to enter and were blocked.';


--
-- Name: sculpt_clear_balance(uuid, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_clear_balance(p_member_id uuid, p_gym_id uuid, p_amount numeric, p_payment_mode text) RETURNS public.members
    LANGUAGE plpgsql
    AS $$
declare
  v_row         public.members;
  v_current     numeric;
  v_new_balance numeric;
  v_new_status  text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  perform public.flym_assert_payment_mode(p_payment_mode);

  select * into v_row
    from public.members
   where id = p_member_id
     and gym_id = p_gym_id
   for update;

  if not found then
    raise exception 'Member not found, or you do not have access to them.';
  end if;

  v_current := coalesce(v_row.balance_due, 0);

  if p_amount > v_current then
    raise exception 'Amount cannot exceed the balance due (%).', v_current;
  end if;

  v_new_balance := round(v_current - p_amount, 2);
  v_new_status  := case when v_new_balance <= 0 then 'Paid' else 'Partial' end;

  update public.members
     set balance_due    = v_new_balance,
         payment_status = v_new_status
   where id = p_member_id
     and gym_id = p_gym_id
  returning * into v_row;

  insert into public.payment_history
    (gym_id, member_id, amount, payment_mode, plan_id, plan_name, notes)
  values
    (p_gym_id, p_member_id, p_amount, coalesce(p_payment_mode, 'Cash'),
     v_row.plan_id, v_row.plan_name, 'Balance payment');

  return v_row;
end;
$$;


--
-- Name: sculpt_generate_application_number(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_generate_application_number(p_gym_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; -- no 0/O/1/I/L — easy to misread on a phone
  v_seq int;
  v_suffix text := '';
  v_bytes bytea;
  i int;
  v_authorized boolean;
BEGIN
  SELECT
    (get_my_gym_id_as_staff() = p_gym_id)
    OR EXISTS (SELECT 1 FROM gym_users WHERE user_id = auth.uid() AND gym_id = p_gym_id AND role = 'owner')
  INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE gyms SET next_application_seq = next_application_seq + 1
  WHERE id = p_gym_id
  RETURNING next_application_seq INTO v_seq;

  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'Gym not found.';
  END IF;

  v_bytes := gen_random_bytes(3);
  FOR i IN 0..2 LOOP
    v_suffix := v_suffix || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % length(v_alphabet)), 1);
  END LOOP;

  RETURN 'SC-' || lpad(v_seq::text, 4, '0') || '-' || v_suffix;
END;
$$;


--
-- Name: sculpt_issue_checkin_token(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_issue_checkin_token() RETURNS TABLE(token text, expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_gym_id uuid;
  v_token text;
  v_expires timestamptz;
BEGIN
  v_gym_id := COALESCE(get_my_gym_id_as_staff(), (
    SELECT gym_id FROM gym_users WHERE user_id = auth.uid() AND role = 'owner' LIMIT 1
  ));

  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Was: WHERE gym_id = v_gym_id AND expires_at < now() - interval '5
  -- minutes' — bare expires_at resolved to the RETURNS TABLE variable,
  -- not checkin_tokens.expires_at, and Postgres refused to guess.
  DELETE FROM checkin_tokens ct
  WHERE ct.gym_id = v_gym_id AND ct.expires_at < now() - interval '5 minutes';

  v_token := encode(gen_random_bytes(16), 'hex');
  v_expires := now() + interval '90 seconds';

  INSERT INTO checkin_tokens (gym_id, token, expires_at, created_by)
  VALUES (v_gym_id, v_token, v_expires, auth.uid());

  RETURN QUERY SELECT v_token, v_expires;
END;
$$;


--
-- Name: FUNCTION sculpt_issue_checkin_token(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sculpt_issue_checkin_token() IS 'Owner/staff only. Issues a 90s-lived rotating check-in token for the caller''s gym. Raising here (auth failure) is fine — nothing has been written yet, unlike sculpt_staff_checkin which must never raise.';


--
-- Name: sculpt_manual_checkin(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_manual_checkin(p_member_id uuid, p_gym_id uuid) RETURNS TABLE(status text, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_authorized boolean;
  v_member record;
  v_tz text;
  v_local_date date;
  v_recent_ok boolean;
BEGIN
  SELECT
    (get_my_gym_id_as_staff() = p_gym_id)
    OR EXISTS (SELECT 1 FROM gym_users WHERE user_id = auth.uid() AND gym_id = p_gym_id AND role = 'owner')
  INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN QUERY SELECT 'NOT_AUTHORIZED', 'You do not have access to check in members for this gym.';
    RETURN;
  END IF;

  SELECT id, gym_id, is_active INTO v_member
  FROM members
  WHERE id = p_member_id AND gym_id = p_gym_id;

  IF v_member.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND', 'Member not found.';
    RETURN;
  END IF;

  SELECT timezone INTO v_tz FROM gyms WHERE id = p_gym_id;
  v_local_date := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  -- Same shadowing bug as sculpt_member_checkin above, same fix.
  SELECT EXISTS (
    SELECT 1 FROM member_checkins mc
    WHERE mc.member_id = v_member.id AND mc.status = 'ok'
      AND mc.checked_in_at > now() - interval '90 minutes'
  ) INTO v_recent_ok;

  IF v_recent_ok THEN
    RETURN QUERY SELECT 'ALREADY_CHECKED_IN', 'Already checked in.';
    RETURN;
  END IF;

  INSERT INTO member_checkins (gym_id, member_id, local_date, status, source)
  VALUES (p_gym_id, v_member.id, v_local_date, 'ok', 'manual');
  RETURN QUERY SELECT 'OK', 'Checked in manually.';
END;
$$;


--
-- Name: FUNCTION sculpt_manual_checkin(p_member_id uuid, p_gym_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sculpt_manual_checkin(p_member_id uuid, p_gym_id uuid) IS 'Staff/owner fallback for when the desk tablet is offline and the QR has stopped rotating — see HANDOVER.md §6. Writes source=''manual''.';


--
-- Name: sculpt_member_checkin(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_member_checkin(p_token text) RETURNS TABLE(status text, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_member record;
  v_token_gym_id uuid;
  v_tz text;
  v_grace_days int;
  v_local_date date;
  v_recent_ok boolean;
BEGIN
  SELECT id, gym_id, is_active, cancelled_at, expiry_date, login_enabled
  INTO v_member
  FROM members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_member.id IS NULL OR NOT v_member.login_enabled THEN
    RETURN QUERY SELECT 'NOT_A_MEMBER', 'This account is not recognised.';
    RETURN;
  END IF;

  SELECT gym_id INTO v_token_gym_id
  FROM checkin_tokens
  WHERE token = p_token AND expires_at > now();

  IF v_token_gym_id IS NULL OR v_token_gym_id <> v_member.gym_id THEN
    RETURN QUERY SELECT 'INVALID_TOKEN', 'This code has expired. Ask the desk to refresh it.';
    RETURN;
  END IF;

  SELECT timezone, checkin_grace_days INTO v_tz, v_grace_days
  FROM gyms WHERE id = v_member.gym_id;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');
  v_grace_days := COALESCE(v_grace_days, 0);
  v_local_date := (now() AT TIME ZONE v_tz)::date;

  -- Was: WHERE member_id = v_member.id AND status = 'ok' — bare status
  -- resolved to this function's own RETURNS TABLE variable, not
  -- member_checkins.status.
  SELECT EXISTS (
    SELECT 1 FROM member_checkins mc
    WHERE mc.member_id = v_member.id AND mc.status = 'ok'
      AND mc.checked_in_at > now() - interval '90 minutes'
  ) INTO v_recent_ok;

  IF v_recent_ok THEN
    RETURN QUERY SELECT 'ALREADY_CHECKED_IN', 'Already checked in.';
    RETURN;
  END IF;

  IF NOT v_member.is_active THEN
    INSERT INTO member_checkins (gym_id, member_id, local_date, status)
    VALUES (v_member.gym_id, v_member.id, v_local_date, 'denied_inactive');
    RETURN QUERY SELECT 'DENIED_INACTIVE', 'Your membership is inactive. Please see the front desk.';
    RETURN;
  END IF;

  IF v_member.cancelled_at IS NOT NULL THEN
    INSERT INTO member_checkins (gym_id, member_id, local_date, status)
    VALUES (v_member.gym_id, v_member.id, v_local_date, 'denied_cancelled');
    RETURN QUERY SELECT 'DENIED_CANCELLED', 'Your membership was cancelled. Please see the front desk.';
    RETURN;
  END IF;

  IF v_member.expiry_date IS NOT NULL
     AND v_member.expiry_date < (v_local_date - v_grace_days) THEN
    INSERT INTO member_checkins (gym_id, member_id, local_date, status)
    VALUES (v_member.gym_id, v_member.id, v_local_date, 'denied_expired');
    RETURN QUERY SELECT 'DENIED_EXPIRED', 'Your membership has expired. Please renew at the front desk.';
    RETURN;
  END IF;

  INSERT INTO member_checkins (gym_id, member_id, local_date, status)
  VALUES (v_member.gym_id, v_member.id, v_local_date, 'ok');
  RETURN QUERY SELECT 'OK', 'Checked in. Have a great workout!';
END;
$$;


--
-- Name: FUNCTION sculpt_member_checkin(p_token text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sculpt_member_checkin(p_token text) IS 'Member scan of the desk QR. Always returns a status, never raises — a denied attempt (expired/cancelled/inactive) still writes a row, and that row is the owner''s renewal call list. Eligibility is computed in the gym''s own timezone, never CURRENT_DATE.';


--
-- Name: sculpt_my_membership(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_my_membership() RETURNS TABLE(member_id uuid, gym_id uuid, gym_name text, gym_logo_url text, member_name text, application_number text, plan_name text, join_date date, expiry_date date, days_remaining integer, balance_due numeric, payment_status text, computed_status text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT
    m.id, m.gym_id, g.name, g.logo_url,
    m.full_name, m.application_number, m.plan_name, m.join_date, m.expiry_date,
    CASE WHEN m.expiry_date IS NOT NULL THEN (m.expiry_date - CURRENT_DATE) ELSE NULL END,
    m.balance_due, m.payment_status,
    CASE
      WHEN m.cancelled_at IS NOT NULL THEN 'Cancelled'
      WHEN m.member_type = 'Trial' AND m.expiry_date IS NOT NULL AND m.expiry_date < CURRENT_DATE THEN 'Expired'
      WHEN m.member_type = 'Trial' THEN 'Trial'
      WHEN m.expiry_date IS NOT NULL AND m.expiry_date < CURRENT_DATE THEN 'Expired'
      WHEN m.expiry_date IS NOT NULL AND m.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'Expiring'
      WHEN m.payment_status = 'Due' THEN 'Due'
      ELSE 'Active'
    END
  FROM members m
  JOIN gyms g ON g.id = m.gym_id
  WHERE m.id = get_my_member_id();
$$;


--
-- Name: FUNCTION sculpt_my_membership(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sculpt_my_membership() IS 'Read-only projection for the signed-in member''s own row plus their gym''s public name/logo. Never exposes gyms.owner_password or any other gym column. Returns zero rows for a non-member session.';


--
-- Name: sculpt_my_receipts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_my_receipts() RETURNS TABLE(id uuid, amount numeric, payment_mode text, plan_name text, paid_at timestamp with time zone, notes text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT p.id, p.amount, p.payment_mode, p.plan_name, p.paid_at, p.notes
  FROM payment_history p
  WHERE p.member_id = get_my_member_id()
  ORDER BY p.paid_at DESC
  LIMIT 200;
$$;


--
-- Name: FUNCTION sculpt_my_receipts(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sculpt_my_receipts() IS 'The member''s own payment history, newest first. There is no durable invoice-number/storage-path record in this schema (PDFs are generated on demand from payment_history and uploaded with a throwaway invoice number — see genInvoiceNo() in helpers.js) so this returns the payment rows themselves; the member portal separately lists any already-generated PDFs from the invoices bucket via a signed URL (migration 110), which is best-effort and not guaranteed to exist for every row.';


--
-- Name: sculpt_my_visits(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_my_visits(p_limit integer DEFAULT 20) RETURNS TABLE(checked_in_at timestamp with time zone, status text, source text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT c.checked_in_at, c.status, c.source
  FROM member_checkins c
  WHERE c.member_id = get_my_member_id()
  ORDER BY c.checked_in_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
$$;


--
-- Name: sculpt_regenerate_application_number(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_regenerate_application_number(p_member_id uuid, p_gym_id uuid) RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_new text;
BEGIN
  v_new := sculpt_generate_application_number(p_gym_id);

  UPDATE members
  SET application_number = v_new
  WHERE id = p_member_id AND gym_id = p_gym_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found, or you do not have access to them.';
  END IF;

  RETURN v_new;
END;
$$;


--
-- Name: sculpt_renew_member(uuid, uuid, uuid, text, numeric, integer, date, text, text, text, text, numeric, numeric, numeric, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_renew_member(p_member_id uuid, p_gym_id uuid, p_plan_id uuid, p_plan_name text, p_plan_price numeric, p_plan_duration_months integer, p_join_date date, p_member_addons text, p_payment_mode text, p_payment_status text, p_member_type text, p_discount_amount numeric, p_balance_due numeric, p_amount_paid numeric, p_paid_at timestamp with time zone, p_payment_notes text) RETURNS public.members
    LANGUAGE plpgsql
    AS $$
declare
  v_row public.members;
begin
  perform public.flym_assert_payment_mode(p_payment_mode);

  if p_payment_status is null or p_payment_status not in ('Paid', 'Due', 'Partial') then
    raise exception 'Payment status must be Paid, Due or Partial (got %).', p_payment_status;
  end if;
  if p_member_type is null or p_member_type not in ('Paid', 'Unpaid', 'Trial') then
    raise exception 'Member type must be Paid, Unpaid or Trial (got %).', p_member_type;
  end if;
  if p_amount_paid is not null and p_amount_paid < 0 then
    raise exception 'Amount paid cannot be negative.';
  end if;

  -- Lock first so a renewal and a balance collection can't interleave.
  perform 1 from public.members
   where id = p_member_id and gym_id = p_gym_id
   for update;

  if not found then
    raise exception 'Member not found, or you do not have access to them.';
  end if;

  update public.members
     set plan_id              = p_plan_id,
         plan_name            = p_plan_name,
         plan_price           = p_plan_price,
         plan_duration_months = p_plan_duration_months,
         join_date            = p_join_date,
         member_addons        = public.flym_addons_to_jsonb(p_member_addons),
         payment_mode         = p_payment_mode,
         payment_status       = p_payment_status,
         member_type          = p_member_type,
         discount_amount      = coalesce(p_discount_amount, 0),
         balance_due          = coalesce(p_balance_due, 0),
         cancelled_at         = null
   where id = p_member_id
     and gym_id = p_gym_id
  returning * into v_row;
  -- expiry_date is recomputed by the existing trg_member_expiry trigger.

  if coalesce(p_amount_paid, 0) > 0 then
    insert into public.payment_history
      (gym_id, member_id, amount, payment_mode, plan_id, plan_name, paid_at, notes)
    values
      (p_gym_id, p_member_id, p_amount_paid, coalesce(p_payment_mode, 'Cash'),
       p_plan_id, p_plan_name, coalesce(p_paid_at, now()),
       coalesce(p_payment_notes, 'Membership renewal'));
  end if;

  return v_row;
end;
$$;


--
-- Name: sculpt_revenue_monthly(uuid, timestamp with time zone[], timestamp with time zone[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_revenue_monthly(p_gym_id uuid, p_starts timestamp with time zone[], p_ends timestamp with time zone[]) RETURNS TABLE(bucket_index integer, total_amount numeric, payment_count bigint)
    LANGUAGE sql STABLE
    AS $$
  select
    i::int                            as bucket_index,
    coalesce(sum(ph.amount), 0)       as total_amount,
    count(ph.id)                      as payment_count
  from generate_subscripts(p_starts, 1) as i
  left join public.payment_history ph
    on  ph.gym_id  = p_gym_id
    and ph.paid_at >= p_starts[i]
    and ph.paid_at <= p_ends[i]
    and exists (
      select 1 from public.members m
       where m.id = ph.member_id
         and m.is_active = true
    )
  group by i
  order by i;
$$;


--
-- Name: sculpt_revenue_rows(uuid, timestamp with time zone, timestamp with time zone, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_revenue_rows(p_gym_id uuid, p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, member_id uuid, member_name text, amount numeric, payment_mode text, plan_name text, paid_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $$
  select ph.id, ph.member_id, m.full_name, ph.amount,
         ph.payment_mode, ph.plan_name, ph.paid_at
    from public.payment_history ph
    join public.members m
      on m.id = ph.member_id
     and m.is_active = true
   where ph.gym_id = p_gym_id
     and (p_start is null or ph.paid_at >= p_start)
     and (p_end   is null or ph.paid_at <= p_end)
   order by ph.paid_at desc, ph.id desc
   limit  greatest(0, least(coalesce(p_limit, 200), 1000))
  offset greatest(0, coalesce(p_offset, 0));
$$;


--
-- Name: sculpt_revenue_summary(uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_revenue_summary(p_gym_id uuid, p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(total_amount numeric, payment_count bigint, cash_amount numeric, card_amount numeric, online_amount numeric)
    LANGUAGE sql STABLE
    AS $$
  select
    coalesce(sum(ph.amount), 0)                                              as total_amount,
    count(*)                                                                 as payment_count,
    coalesce(sum(ph.amount) filter (where ph.payment_mode = 'Cash'),   0)    as cash_amount,
    coalesce(sum(ph.amount) filter (where ph.payment_mode = 'Card'),   0)    as card_amount,
    coalesce(sum(ph.amount) filter (where ph.payment_mode = 'Online'), 0)    as online_amount
  from public.payment_history ph
  where ph.gym_id = p_gym_id
    and (p_start is null or ph.paid_at >= p_start)
    and (p_end   is null or ph.paid_at <= p_end)
    and exists (
      select 1 from public.members m
       where m.id = ph.member_id
         and m.is_active = true
    );
$$;


--
-- Name: sculpt_staff_checkin(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sculpt_staff_checkin(p_token text) RETURNS TABLE(status text, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_staff_id uuid;
  v_gym_id uuid;
  v_token_gym_id uuid;
  v_tz text;
  v_local_date date;
  v_local_time time;
  v_row staff_attendance%ROWTYPE;
  v_last_event time;
BEGIN
  SELECT id, gym_id INTO v_staff_id, v_gym_id
  FROM staff
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF v_staff_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_STAFF', 'This account is not an active staff member.';
    RETURN;
  END IF;

  SELECT gym_id INTO v_token_gym_id
  FROM checkin_tokens
  WHERE token = p_token AND expires_at > now();

  IF v_token_gym_id IS NULL THEN
    RETURN QUERY SELECT 'INVALID_TOKEN', 'This code has expired. Ask the desk to refresh it.';
    RETURN;
  END IF;

  IF v_token_gym_id <> v_gym_id THEN
    RETURN QUERY SELECT 'INVALID_TOKEN', 'This code belongs to a different gym.';
    RETURN;
  END IF;

  SELECT timezone INTO v_tz FROM gyms WHERE id = v_gym_id;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');
  v_local_date := (now() AT TIME ZONE v_tz)::date;
  v_local_time := (now() AT TIME ZONE v_tz)::time;

  SELECT * INTO v_row
  FROM staff_attendance
  WHERE staff_id = v_staff_id AND date = v_local_date
  FOR UPDATE;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO staff_attendance (gym_id, staff_id, date, status, check_in)
      VALUES (v_gym_id, v_staff_id, v_local_date, 'Present', v_local_time);
      RETURN QUERY SELECT 'CHECKED_IN', 'Checked in.';
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      -- Two simultaneous first scans: the other transaction's INSERT
      -- won the (staff_id, date) race and committed in the gap between
      -- our FOR UPDATE (which found nothing, because the row didn't
      -- exist yet) and our own INSERT. Re-read the now-existing row
      -- under lock and fall through to the update path below instead
      -- of surfacing the constraint error.
      SELECT * INTO v_row
      FROM staff_attendance
      WHERE staff_id = v_staff_id AND date = v_local_date
      FOR UPDATE;
    END;
  END IF;

  -- Cooldown is measured from whichever event happened more recently
  -- today — check_out if this isn't the first update, otherwise
  -- check_in — so a rapid double-scan can't move check_out twice in
  -- the same walk-in.
  v_last_event := COALESCE(v_row.check_out, v_row.check_in);

  IF v_last_event IS NOT NULL AND (v_local_time - v_last_event) < interval '10 minutes' THEN
    RETURN QUERY SELECT 'TOO_SOON', 'Already checked in a moment ago.';
    RETURN;
  END IF;

  UPDATE staff_attendance
  SET check_out = v_local_time
  WHERE id = v_row.id;
  RETURN QUERY SELECT 'CHECKED_OUT', 'Checked out.';
END;
$$;


--
-- Name: FUNCTION sculpt_staff_checkin(p_token text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sculpt_staff_checkin(p_token text) IS 'Staff/trainer scan of the desk QR. Resolves auth.uid() via staff.user_id, validates the token, and upserts today''s staff_attendance row by hand (FOR UPDATE, not ON CONFLICT) so the 10-minute cooldown check can read the existing row first. Every scan past the first moves check_out forward, not just the second — there is no terminal "done for today" state. A unique_violation on concurrent first-inserts is caught and retried as an update, not raised. Always returns a status; never raises for a business-logic rejection.';


--
-- Name: set_member_expiry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_member_expiry() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.plan_duration_months IS NOT NULL AND NEW.plan_duration_months > 0
     AND NEW.join_date IS NOT NULL
     AND NEW.member_type != 'Trial' THEN
    NEW.expiry_date := (NEW.join_date + (NEW.plan_duration_months || ' months')::INTERVAL)::DATE;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;


--
-- Name: trigger_generate_notifications(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_generate_notifications() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'flym_cron_secret'
   limit 1;

  if v_secret is null then
    raise warning '[flym] cron secret missing — skipping notification run';
    return;
  end if;

  perform net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/generate-notifications',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', v_secret
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;


--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    gym_id uuid,
    user_id uuid,
    action text NOT NULL,
    description text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: addon_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addon_templates (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    gym_id uuid NOT NULL,
    name text NOT NULL,
    default_price numeric(12,2) DEFAULT 0 NOT NULL,
    is_one_time boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT addon_templates_default_price_check CHECK ((default_price >= (0)::numeric))
);


--
-- Name: checkin_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkin_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    token text NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_by uuid
);


--
-- Name: enquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enquiries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    name text NOT NULL,
    phone text,
    source text DEFAULT 'Walk-in'::text,
    status text DEFAULT 'New'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    followed_up_at timestamp with time zone,
    is_active boolean DEFAULT true
);


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    gym_id uuid NOT NULL,
    category text,
    description text,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    expense_date date DEFAULT CURRENT_DATE NOT NULL,
    expense_month text,
    is_recurring boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    receipt_url text,
    CONSTRAINT expenses_amount_check CHECK ((amount >= (0)::numeric))
);


--
-- Name: gyms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gyms (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    gym_code text NOT NULL,
    name text NOT NULL,
    owner_name text NOT NULL,
    phone text,
    address text,
    city text,
    email text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    default_cardio_price numeric(10,2) DEFAULT 500,
    wa_template text,
    reminder_days integer DEFAULT 7,
    monthly_budget numeric(10,2) DEFAULT 0,
    wa_birthday_template text,
    wa_welcome_template text,
    gst_enabled boolean DEFAULT false,
    gstin text,
    logo_url text,
    phone2 text,
    owner_password text,
    gst_percentage numeric DEFAULT 18,
    invoice_terms text,
    discount_enabled boolean DEFAULT false,
    default_discount_pct numeric DEFAULT 0,
    password_changed_at timestamp with time zone,
    subscription_tier text DEFAULT 'core'::text NOT NULL,
    public_plans_enabled boolean DEFAULT true NOT NULL,
    timezone text DEFAULT 'Asia/Kolkata'::text NOT NULL,
    next_application_seq integer DEFAULT 0 NOT NULL,
    credentials_wa_template text,
    checkin_grace_days integer DEFAULT 0 NOT NULL,
    checkin_followup_days integer DEFAULT 21 NOT NULL,
    followup_wa_template text,
    CONSTRAINT gyms_subscription_tier_check CHECK ((subscription_tier = ANY (ARRAY['core'::text, 'pro'::text])))
);


--
-- Name: COLUMN gyms.public_plans_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gyms.public_plans_enabled IS 'When false, public_gym_plans() returns no rows for this gym and the marketing site hides its membership section.';


--
-- Name: COLUMN gyms.timezone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gyms.timezone IS 'IANA timezone name. All check-in dates/times are computed as (now() AT TIME ZONE gyms.timezone), never CURRENT_DATE or client UTC.';


--
-- Name: COLUMN gyms.checkin_grace_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gyms.checkin_grace_days IS 'Days past expiry_date a member is still let in. Client said block at the door; this exists so that can be softened later without a deploy.';


--
-- Name: COLUMN gyms.checkin_followup_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gyms.checkin_followup_days IS 'Days since last check-in (or since join_date, for a member who has never checked in) before they appear on the follow-up call list.';


--
-- Name: gym_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.gym_summary WITH (security_invoker='true') AS
 SELECT g.id AS gym_id,
    g.name AS gym_name,
    g.gym_code,
    g.owner_name,
    g.phone,
    g.city,
    g.address,
    g.email,
    g.is_active,
    g.created_at,
    count(m.id) AS total_members,
    count(m.id) FILTER (WHERE ((m.member_type <> 'Trial'::text) AND (m.expiry_date >= CURRENT_DATE) AND (m.payment_status <> 'Due'::text) AND (m.cancelled_at IS NULL))) AS active_members,
    count(m.id) FILTER (WHERE (((m.payment_status = 'Due'::text) OR ((m.member_type <> 'Trial'::text) AND (m.expiry_date < CURRENT_DATE))) AND (m.cancelled_at IS NULL))) AS payment_due,
    count(m.id) FILTER (WHERE (((m.expiry_date >= CURRENT_DATE) AND (m.expiry_date <= (CURRENT_DATE + '7 days'::interval))) AND (m.cancelled_at IS NULL))) AS expiring_soon
   FROM (public.gyms g
     LEFT JOIN public.members m ON (((m.gym_id = g.id) AND (m.is_active = true))))
  GROUP BY g.id, g.name, g.gym_code, g.owner_name, g.phone, g.city, g.address, g.email, g.is_active, g.created_at;


--
-- Name: gym_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    gym_id uuid,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    is_selected boolean DEFAULT false NOT NULL,
    CONSTRAINT gym_users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text])))
);


--
-- Name: member_checkins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_checkins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    checked_in_at timestamp with time zone DEFAULT now() NOT NULL,
    local_date date NOT NULL,
    status text NOT NULL,
    source text DEFAULT 'qr'::text NOT NULL,
    CONSTRAINT member_checkins_source_check CHECK ((source = ANY (ARRAY['qr'::text, 'manual'::text]))),
    CONSTRAINT member_checkins_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'denied_expired'::text, 'denied_cancelled'::text, 'denied_inactive'::text])))
);


--
-- Name: member_login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_login_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid,
    application_number text,
    ip text,
    succeeded boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: members_with_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.members_with_status WITH (security_invoker='true') AS
 SELECT id,
    gym_id,
    full_name,
    phone,
    email,
    date_of_birth,
    gender,
    join_date,
    plan_id,
    plan_name,
    plan_price,
    plan_duration_months,
    expiry_date,
    payment_mode,
    payment_status,
    member_type,
    notes,
    is_active,
    created_at,
    updated_at,
    cardio_addon,
    cardio_price,
    last_reminder_sent,
    member_addons,
    referred_by,
    discount_amount,
    balance_due,
    cancelled_at,
    application_number,
    aadhar_number,
    aadhar_photo_url,
    user_id,
    login_enabled,
    added_by_staff_id,
    added_by_name,
        CASE
            WHEN (cancelled_at IS NOT NULL) THEN 'Cancelled'::text
            WHEN ((member_type = 'Trial'::text) AND (expiry_date IS NOT NULL) AND (expiry_date < CURRENT_DATE)) THEN 'Expired'::text
            WHEN (member_type = 'Trial'::text) THEN 'Trial'::text
            WHEN ((expiry_date IS NOT NULL) AND (expiry_date < CURRENT_DATE)) THEN 'Expired'::text
            WHEN ((expiry_date IS NOT NULL) AND (expiry_date <= (CURRENT_DATE + '7 days'::interval))) THEN 'Expiring'::text
            WHEN (payment_status = 'Due'::text) THEN 'Due'::text
            ELSE 'Active'::text
        END AS computed_status,
        CASE
            WHEN (expiry_date IS NOT NULL) THEN (expiry_date - CURRENT_DATE)
            ELSE NULL::integer
        END AS days_until_expiry
   FROM public.members m
  WHERE (is_active = true);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    user_id uuid,
    type text DEFAULT 'general'::text NOT NULL,
    title text NOT NULL,
    body text,
    link_section text,
    ref_id uuid,
    dedupe_key text DEFAULT (gen_random_uuid())::text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_severity_chk CHECK ((severity = ANY (ARRAY['info'::text, 'success'::text, 'warning'::text, 'critical'::text]))),
    CONSTRAINT notifications_type_chk CHECK ((type = ANY (ARRAY['expiring'::text, 'expired'::text, 'payment_due'::text, 'birthday'::text, 'enquiry'::text, 'payment'::text, 'broadcast'::text, 'staff'::text, 'system'::text, 'general'::text])))
);


--
-- Name: payment_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    amount numeric(10,2) NOT NULL,
    payment_mode text,
    plan_id uuid,
    plan_name text,
    paid_at timestamp with time zone DEFAULT now(),
    notes text,
    CONSTRAINT payment_history_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT payment_history_payment_mode_check CHECK (((payment_mode = ANY (ARRAY['Cash'::text, 'Online'::text, 'Card'::text])) OR (payment_mode IS NULL)))
);


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    gym_id uuid NOT NULL,
    name text NOT NULL,
    duration_months integer NOT NULL,
    price numeric(10,2) NOT NULL,
    features text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_featured boolean DEFAULT false,
    CONSTRAINT plans_duration_months_check CHECK ((duration_months > 0)),
    CONSTRAINT plans_price_check CHECK ((price >= (0)::numeric))
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth_key text NOT NULL,
    user_agent text,
    is_active boolean DEFAULT true NOT NULL,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reminder_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminder_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    message text NOT NULL,
    sent_at timestamp with time zone DEFAULT now(),
    channel text DEFAULT 'whatsapp'::text
);


--
-- Name: staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    full_name text NOT NULL,
    phone text,
    role text DEFAULT 'Trainer'::text NOT NULL,
    aadhaar text,
    photo_url text,
    salary_amount numeric DEFAULT 0,
    join_date date DEFAULT CURRENT_DATE,
    is_active boolean DEFAULT true,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    login_enabled boolean DEFAULT false NOT NULL,
    login_email text,
    login_created_at timestamp with time zone
);


--
-- Name: COLUMN staff.login_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.staff.login_email IS 'Denormalized copy of the auth.users email for this staff member''s login, for display only. Written by create-staff-user / manage-staff-login (service role). Cleared when the login is removed.';


--
-- Name: COLUMN staff.login_created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.staff.login_created_at IS 'When the login account was created. Set once by create-staff-user, never touched by disable/enable/reset-password. Cleared when the login is removed (a re-created login gets a fresh timestamp).';


--
-- Name: staff_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    status text DEFAULT 'Present'::text NOT NULL,
    check_in time without time zone,
    check_out time without time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: staff_salary_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_salary_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    amount numeric NOT NULL,
    payment_date date DEFAULT CURRENT_DATE NOT NULL,
    payment_mode text DEFAULT 'Cash'::text,
    is_advance boolean DEFAULT false,
    notes text,
    expense_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT staff_salary_payments_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT staff_salary_payments_payment_mode_check CHECK ((payment_mode = ANY (ARRAY['Cash'::text, 'Online'::text, 'Card'::text])))
);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: addon_templates addon_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addon_templates
    ADD CONSTRAINT addon_templates_pkey PRIMARY KEY (id);


--
-- Name: checkin_tokens checkin_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkin_tokens
    ADD CONSTRAINT checkin_tokens_pkey PRIMARY KEY (id);


--
-- Name: checkin_tokens checkin_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkin_tokens
    ADD CONSTRAINT checkin_tokens_token_key UNIQUE (token);


--
-- Name: enquiries enquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enquiries
    ADD CONSTRAINT enquiries_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: gym_users gym_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_users
    ADD CONSTRAINT gym_users_pkey PRIMARY KEY (id);


--
-- Name: gym_users gym_users_user_gym_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_users
    ADD CONSTRAINT gym_users_user_gym_unique UNIQUE (user_id, gym_id);


--
-- Name: gyms gyms_gym_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gyms
    ADD CONSTRAINT gyms_gym_code_key UNIQUE (gym_code);


--
-- Name: gyms gyms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gyms
    ADD CONSTRAINT gyms_pkey PRIMARY KEY (id);


--
-- Name: member_checkins member_checkins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_checkins
    ADD CONSTRAINT member_checkins_pkey PRIMARY KEY (id);


--
-- Name: member_login_attempts member_login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_login_attempts
    ADD CONSTRAINT member_login_attempts_pkey PRIMARY KEY (id);


--
-- Name: members members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (id);


--
-- Name: members members_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_user_id_unique UNIQUE (user_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: payment_history payment_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_pkey PRIMARY KEY (id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: reminder_logs reminder_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_logs
    ADD CONSTRAINT reminder_logs_pkey PRIMARY KEY (id);


--
-- Name: staff_attendance staff_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_pkey PRIMARY KEY (id);


--
-- Name: staff_attendance staff_attendance_staff_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_staff_id_date_key UNIQUE (staff_id, date);


--
-- Name: staff staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (id);


--
-- Name: staff_salary_payments staff_salary_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_salary_payments
    ADD CONSTRAINT staff_salary_payments_pkey PRIMARY KEY (id);


--
-- Name: staff staff_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_user_id_unique UNIQUE (user_id);


--
-- Name: idx_activity_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_log_created ON public.activity_log USING btree (created_at DESC);


--
-- Name: idx_activity_log_gym_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_log_gym_created ON public.activity_log USING btree (gym_id, created_at DESC);


--
-- Name: idx_activity_log_gym_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_log_gym_id ON public.activity_log USING btree (gym_id);


--
-- Name: idx_addon_templates_gym; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_addon_templates_gym ON public.addon_templates USING btree (gym_id, is_active, sort_order);


--
-- Name: idx_checkin_tokens_gym_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checkin_tokens_gym_expiry ON public.checkin_tokens USING btree (gym_id, expires_at DESC);


--
-- Name: idx_checkin_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checkin_tokens_token ON public.checkin_tokens USING btree (token);


--
-- Name: idx_enquiries_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enquiries_created ON public.enquiries USING btree (created_at DESC);


--
-- Name: idx_enquiries_gym_created_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enquiries_gym_created_active ON public.enquiries USING btree (gym_id, created_at DESC) WHERE (is_active = true);


--
-- Name: idx_enquiries_gym_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enquiries_gym_id ON public.enquiries USING btree (gym_id);


--
-- Name: idx_enquiries_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enquiries_status ON public.enquiries USING btree (status);


--
-- Name: idx_expenses_gym_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_gym_date ON public.expenses USING btree (gym_id, expense_date DESC);


--
-- Name: idx_expenses_gym_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_gym_month ON public.expenses USING btree (gym_id, expense_month);


--
-- Name: idx_gym_users_gym_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gym_users_gym_id ON public.gym_users USING btree (gym_id);


--
-- Name: idx_gym_users_one_selected; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_gym_users_one_selected ON public.gym_users USING btree (user_id) WHERE (is_selected = true);


--
-- Name: idx_gym_users_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gym_users_user_id ON public.gym_users USING btree (user_id);


--
-- Name: idx_member_checkins_gym_date_ok; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_checkins_gym_date_ok ON public.member_checkins USING btree (gym_id, local_date) WHERE (status = 'ok'::text);


--
-- Name: idx_member_checkins_gym_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_checkins_gym_time ON public.member_checkins USING btree (gym_id, checked_in_at DESC);


--
-- Name: idx_member_checkins_member_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_checkins_member_time ON public.member_checkins USING btree (member_id, checked_in_at DESC);


--
-- Name: idx_member_login_attempts_appnum; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_login_attempts_appnum ON public.member_login_attempts USING btree (application_number, created_at DESC);


--
-- Name: idx_member_login_attempts_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_login_attempts_ip ON public.member_login_attempts USING btree (ip, created_at DESC);


--
-- Name: idx_members_addons; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_addons ON public.members USING btree (gym_id) WHERE (member_addons IS NOT NULL);


--
-- Name: idx_members_app_number_gym; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_members_app_number_gym ON public.members USING btree (gym_id, application_number) WHERE ((application_number IS NOT NULL) AND (is_active = true));


--
-- Name: idx_members_cardio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_cardio ON public.members USING btree (gym_id, cardio_addon) WHERE (cardio_addon = true);


--
-- Name: idx_members_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_expiry ON public.members USING btree (expiry_date, gym_id);


--
-- Name: idx_members_expiry_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_expiry_date ON public.members USING btree (expiry_date);


--
-- Name: idx_members_gym_expiry_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_gym_expiry_live ON public.members USING btree (gym_id, expiry_date) WHERE ((is_active = true) AND (cancelled_at IS NULL));


--
-- Name: idx_members_gym_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_gym_id ON public.members USING btree (gym_id);


--
-- Name: idx_members_gym_join_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_gym_join_active ON public.members USING btree (gym_id, join_date DESC) WHERE (is_active = true);


--
-- Name: idx_members_gym_paystatus_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_gym_paystatus_live ON public.members USING btree (gym_id, payment_status) WHERE ((is_active = true) AND (cancelled_at IS NULL));


--
-- Name: idx_members_gym_phone_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_gym_phone_active ON public.members USING btree (gym_id, phone) WHERE ((is_active = true) AND (phone IS NOT NULL));


--
-- Name: idx_members_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_is_active ON public.members USING btree (is_active);


--
-- Name: idx_members_join_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_join_date ON public.members USING btree (join_date);


--
-- Name: idx_members_member_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_member_type ON public.members USING btree (member_type);


--
-- Name: idx_members_payment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_payment_status ON public.members USING btree (payment_status);


--
-- Name: idx_members_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_phone ON public.members USING btree (phone) WHERE ((is_active = true) AND (phone IS NOT NULL));


--
-- Name: idx_members_referred_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_referred_by ON public.members USING btree (referred_by) WHERE (referred_by IS NOT NULL);


--
-- Name: idx_members_reminder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_reminder ON public.members USING btree (last_reminder_sent, gym_id);


--
-- Name: idx_payment_history_gym_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_history_gym_id ON public.payment_history USING btree (gym_id);


--
-- Name: idx_payment_history_gym_paid_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_history_gym_paid_id ON public.payment_history USING btree (gym_id, paid_at DESC, id DESC);


--
-- Name: idx_payment_history_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_history_member ON public.payment_history USING btree (member_id);


--
-- Name: idx_payment_history_paid_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_history_paid_at ON public.payment_history USING btree (paid_at DESC);


--
-- Name: idx_plans_gym_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plans_gym_id ON public.plans USING btree (gym_id);


--
-- Name: idx_plans_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plans_is_active ON public.plans USING btree (is_active);


--
-- Name: idx_reminder_logs_gym_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminder_logs_gym_id ON public.reminder_logs USING btree (gym_id);


--
-- Name: idx_staff_att_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_att_date ON public.staff_attendance USING btree (gym_id, date);


--
-- Name: idx_staff_gym; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_gym ON public.staff USING btree (gym_id) WHERE (is_active = true);


--
-- Name: idx_staff_pay_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_pay_date ON public.staff_salary_payments USING btree (gym_id, payment_date);


--
-- Name: notifications_gym_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_gym_created_idx ON public.notifications USING btree (gym_id, created_at DESC);


--
-- Name: notifications_gym_dedupe_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notifications_gym_dedupe_uidx ON public.notifications USING btree (gym_id, dedupe_key);


--
-- Name: notifications_gym_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_gym_unread_idx ON public.notifications USING btree (gym_id, is_read) WHERE (is_read = false);


--
-- Name: push_subscriptions_endpoint_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX push_subscriptions_endpoint_uidx ON public.push_subscriptions USING btree (endpoint);


--
-- Name: push_subscriptions_gym_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_gym_idx ON public.push_subscriptions USING btree (gym_id) WHERE (is_active = true);


--
-- Name: gyms trg_gyms_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gyms_updated BEFORE UPDATE ON public.gyms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: members trg_member_expiry; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_member_expiry BEFORE INSERT OR UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.set_member_expiry();


--
-- Name: plans trg_plans_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: activity_log activity_log_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: activity_log activity_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: addon_templates addon_templates_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addon_templates
    ADD CONSTRAINT addon_templates_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: checkin_tokens checkin_tokens_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkin_tokens
    ADD CONSTRAINT checkin_tokens_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: enquiries enquiries_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enquiries
    ADD CONSTRAINT enquiries_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: expenses expenses_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: gym_users gym_users_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_users
    ADD CONSTRAINT gym_users_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE SET NULL;


--
-- Name: gym_users gym_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_users
    ADD CONSTRAINT gym_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: member_checkins member_checkins_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_checkins
    ADD CONSTRAINT member_checkins_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: member_checkins member_checkins_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_checkins
    ADD CONSTRAINT member_checkins_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_login_attempts member_login_attempts_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_login_attempts
    ADD CONSTRAINT member_login_attempts_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: members members_added_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_added_by_staff_id_fkey FOREIGN KEY (added_by_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;


--
-- Name: members members_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: members members_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE SET NULL;


--
-- Name: members members_referred_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_referred_by_fkey FOREIGN KEY (referred_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: members members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: notifications notifications_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: payment_history payment_history_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: payment_history payment_history_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: payment_history payment_history_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE SET NULL;


--
-- Name: plans plans_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reminder_logs reminder_logs_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_logs
    ADD CONSTRAINT reminder_logs_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: reminder_logs reminder_logs_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_logs
    ADD CONSTRAINT reminder_logs_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: staff_attendance staff_attendance_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: staff_attendance staff_attendance_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: staff staff_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: staff_salary_payments staff_salary_payments_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_salary_payments
    ADD CONSTRAINT staff_salary_payments_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.gyms(id) ON DELETE CASCADE;


--
-- Name: staff_salary_payments staff_salary_payments_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_salary_payments
    ADD CONSTRAINT staff_salary_payments_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;


--
-- Name: staff staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: enquiries Admin full access to enquiries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin full access to enquiries" ON public.enquiries USING (public.is_platform_admin());


--
-- Name: enquiries Owners see own gym enquiries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners see own gym enquiries" ON public.enquiries USING (public.is_my_gym(gym_id)) WITH CHECK (public.is_my_gym(gym_id));


--
-- Name: activity_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

--
-- Name: addon_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.addon_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_log admin_all_activity; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_activity ON public.activity_log USING (public.is_platform_admin());


--
-- Name: addon_templates admin_all_addon_tpl; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_addon_tpl ON public.addon_templates USING (public.is_platform_admin());


--
-- Name: expenses admin_all_expenses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_expenses ON public.expenses USING (public.is_platform_admin());


--
-- Name: gym_users admin_all_gym_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_gym_users ON public.gym_users USING (public.is_platform_admin());


--
-- Name: gyms admin_all_gyms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_gyms ON public.gyms USING (public.is_platform_admin());


--
-- Name: members admin_all_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_members ON public.members USING (public.is_platform_admin());


--
-- Name: payment_history admin_all_payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_payments ON public.payment_history USING (public.is_platform_admin());


--
-- Name: plans admin_all_plans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_plans ON public.plans USING (public.is_platform_admin());


--
-- Name: reminder_logs admin_all_reminders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_reminders ON public.reminder_logs USING (public.is_platform_admin());


--
-- Name: checkin_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checkin_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: enquiries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enquiries ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: gym_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gym_users ENABLE ROW LEVEL SECURITY;

--
-- Name: gyms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gyms ENABLE ROW LEVEL SECURITY;

--
-- Name: member_checkins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_checkins ENABLE ROW LEVEL SECURITY;

--
-- Name: member_login_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_login_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: member_checkins member_read_own_checkins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_read_own_checkins ON public.member_checkins FOR SELECT USING ((member_id = public.get_my_member_id()));


--
-- Name: payment_history member_read_own_payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_read_own_payments ON public.payment_history FOR SELECT USING ((member_id = public.get_my_member_id()));


--
-- Name: members member_read_own_row; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_read_own_row ON public.members FOR SELECT USING ((id = public.get_my_member_id()));


--
-- Name: members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

--
-- Name: checkin_tokens no_direct_access_checkin_tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY no_direct_access_checkin_tokens ON public.checkin_tokens USING (false);


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_delete ON public.notifications FOR DELETE USING ((public.is_platform_admin() OR public.is_my_gym_any_role(gym_id)));


--
-- Name: notifications notifications_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_insert ON public.notifications FOR INSERT WITH CHECK ((public.is_platform_admin() OR public.is_my_gym_any_role(gym_id)));


--
-- Name: notifications notifications_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_select ON public.notifications FOR SELECT USING ((public.is_platform_admin() OR (public.is_my_gym_any_role(gym_id) AND ((user_id IS NULL) OR (user_id = auth.uid())))));


--
-- Name: notifications notifications_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_update ON public.notifications FOR UPDATE USING ((public.is_platform_admin() OR (public.is_my_gym_any_role(gym_id) AND ((user_id IS NULL) OR (user_id = auth.uid())))));


--
-- Name: activity_log owner_all_own_activity; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_all_own_activity ON public.activity_log USING (public.is_my_gym(gym_id)) WITH CHECK (public.is_my_gym(gym_id));


--
-- Name: addon_templates owner_all_own_addon_tpl; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_all_own_addon_tpl ON public.addon_templates USING (public.is_my_gym(gym_id)) WITH CHECK (public.is_my_gym(gym_id));


--
-- Name: expenses owner_all_own_expenses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_all_own_expenses ON public.expenses USING (public.is_my_gym(gym_id)) WITH CHECK (public.is_my_gym(gym_id));


--
-- Name: members owner_all_own_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_all_own_members ON public.members USING (public.is_my_gym(gym_id)) WITH CHECK (public.is_my_gym(gym_id));


--
-- Name: payment_history owner_all_own_payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_all_own_payments ON public.payment_history USING (public.is_my_gym(gym_id)) WITH CHECK (public.is_my_gym(gym_id));


--
-- Name: plans owner_all_own_plans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_all_own_plans ON public.plans USING (public.is_my_gym(gym_id)) WITH CHECK (public.is_my_gym(gym_id));


--
-- Name: reminder_logs owner_all_own_reminders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_all_own_reminders ON public.reminder_logs USING (public.is_my_gym(gym_id)) WITH CHECK (public.is_my_gym(gym_id));


--
-- Name: member_checkins owner_read_gym_checkins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read_gym_checkins ON public.member_checkins FOR SELECT USING ((gym_id = public.get_my_gym_id()));


--
-- Name: gyms owner_read_own_gym; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_read_own_gym ON public.gyms FOR SELECT USING ((id = public.get_my_gym_id()));


--
-- Name: gyms owner_update_own_gym; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_update_own_gym ON public.gyms FOR UPDATE USING (public.is_my_gym(id)) WITH CHECK (public.is_my_gym(id));


--
-- Name: payment_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_history ENABLE ROW LEVEL SECURITY;

--
-- Name: plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subs_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subs_delete ON public.push_subscriptions FOR DELETE USING ((public.is_platform_admin() OR (public.is_my_gym_any_role(gym_id) AND (user_id = auth.uid()))));


--
-- Name: push_subscriptions push_subs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subs_insert ON public.push_subscriptions FOR INSERT WITH CHECK ((public.is_my_gym_any_role(gym_id) AND (user_id = auth.uid())));


--
-- Name: push_subscriptions push_subs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subs_select ON public.push_subscriptions FOR SELECT USING ((public.is_platform_admin() OR (public.is_my_gym_any_role(gym_id) AND (user_id = auth.uid()))));


--
-- Name: push_subscriptions push_subs_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subs_update ON public.push_subscriptions FOR UPDATE USING ((public.is_platform_admin() OR (public.is_my_gym_any_role(gym_id) AND (user_id = auth.uid()))));


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: reminder_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reminder_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: staff; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_attendance staff_att_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_att_delete ON public.staff_attendance FOR DELETE USING ((public.is_my_gym(gym_id) OR public.is_platform_admin()));


--
-- Name: staff_attendance staff_att_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_att_insert ON public.staff_attendance FOR INSERT WITH CHECK ((public.is_my_gym(gym_id) OR public.is_platform_admin()));


--
-- Name: staff_attendance staff_att_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_att_select ON public.staff_attendance FOR SELECT USING ((public.is_my_gym(gym_id) OR public.is_platform_admin()));


--
-- Name: staff_attendance staff_att_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_att_update ON public.staff_attendance FOR UPDATE USING ((public.is_my_gym(gym_id) OR public.is_platform_admin())) WITH CHECK ((public.is_my_gym(gym_id) OR public.is_platform_admin()));


--
-- Name: staff_attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: staff staff_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_delete ON public.staff FOR DELETE USING ((public.is_my_gym(gym_id) OR public.is_platform_admin()));


--
-- Name: staff staff_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_insert ON public.staff FOR INSERT WITH CHECK ((public.is_my_gym(gym_id) OR public.is_platform_admin()));


--
-- Name: activity_log staff_insert_activity; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_insert_activity ON public.activity_log FOR INSERT WITH CHECK ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: staff_attendance staff_insert_attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_insert_attendance ON public.staff_attendance FOR INSERT WITH CHECK ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: enquiries staff_insert_enquiries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_insert_enquiries ON public.enquiries FOR INSERT WITH CHECK ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: expenses staff_insert_expenses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_insert_expenses ON public.expenses FOR INSERT WITH CHECK ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: members staff_insert_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_insert_members ON public.members FOR INSERT WITH CHECK ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: payment_history staff_insert_payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_insert_payments ON public.payment_history FOR INSERT WITH CHECK ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: staff_salary_payments staff_pay_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_pay_delete ON public.staff_salary_payments FOR DELETE USING ((public.is_my_gym(gym_id) OR public.is_platform_admin()));


--
-- Name: staff_salary_payments staff_pay_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_pay_insert ON public.staff_salary_payments FOR INSERT WITH CHECK ((public.is_my_gym(gym_id) OR public.is_platform_admin()));


--
-- Name: staff_salary_payments staff_pay_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_pay_select ON public.staff_salary_payments FOR SELECT USING ((public.is_my_gym(gym_id) OR public.is_platform_admin()));


--
-- Name: staff_salary_payments staff_pay_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_pay_update ON public.staff_salary_payments FOR UPDATE USING ((public.is_my_gym(gym_id) OR public.is_platform_admin())) WITH CHECK ((public.is_my_gym(gym_id) OR public.is_platform_admin()));


--
-- Name: staff_attendance staff_read_attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_attendance ON public.staff_attendance FOR SELECT USING ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: enquiries staff_read_enquiries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_enquiries ON public.enquiries FOR SELECT USING ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: expenses staff_read_expenses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_expenses ON public.expenses FOR SELECT USING ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: member_checkins staff_read_gym_checkins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_gym_checkins ON public.member_checkins FOR SELECT USING ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: members staff_read_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_members ON public.members FOR SELECT USING ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: gyms staff_read_own_gym; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_own_gym ON public.gyms FOR SELECT USING ((id = public.get_my_gym_id_as_staff()));


--
-- Name: payment_history staff_read_payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_payments ON public.payment_history FOR SELECT USING ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: plans staff_read_plans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_plans ON public.plans FOR SELECT USING ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: staff staff_read_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_read_staff ON public.staff FOR SELECT USING ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: staff_salary_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_salary_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: staff staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_select ON public.staff FOR SELECT USING ((public.is_my_gym(gym_id) OR public.is_platform_admin()));


--
-- Name: staff staff_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_update ON public.staff FOR UPDATE USING ((public.is_my_gym(gym_id) OR public.is_platform_admin())) WITH CHECK ((public.is_my_gym(gym_id) OR public.is_platform_admin()));


--
-- Name: staff_attendance staff_update_attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_update_attendance ON public.staff_attendance FOR UPDATE USING ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: enquiries staff_update_enquiries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_update_enquiries ON public.enquiries FOR UPDATE USING ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: members staff_update_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_update_members ON public.members FOR UPDATE USING ((gym_id = public.get_my_gym_id_as_staff()));


--
-- Name: gym_users users_read_own_row; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_read_own_row ON public.gym_users FOR SELECT USING ((user_id = auth.uid()));


--
-- PostgreSQL database dump complete
--

\unrestrict aFdhFnhfUtzFiG1QVXsd4sXFVNxeuqM3i6atPjo2h71JJAC0dtXVd2eCcbUq0gi

