-- This migration exists to close a schema-drift gap: the original
-- `install_curated_setup` / `sync_all_curated_setups` / `get_shared_addons`
-- system (along with `curated_addon_settings`, `curated_addon_urls`, the
-- `profiles.stream_addons_enabled` column, and the `profiles_install_curated_setup`
-- trigger) was built directly against the live database and never committed
-- as a migration — the file that should have introduced it
-- (`20260811_curated_addons_auto_install.sql`, referenced only in comments in
-- 20260802130000_curated_setup_sync.sql and supabase/functions/curated-setup-sync/index.ts)
-- never actually existed in git history. This migration is idempotent and
-- brings git back in sync with what's actually deployed, plus applies one
-- real behavior fix on top (see below).
--
-- Fix included here: `install_curated_setup` previously only excluded
-- role='admin' from curated auto-install. `premium_plus` profiles are
-- self-managed in the portal (AddonsPage.tsx: canEdit includes premium_plus,
-- and the "One-tap setup" card never renders for them) but the backend had
-- no matching exclusion — the on-insert trigger and the 2-day cron resync
-- would silently force-install/re-sync curated addon rows onto a
-- premium_plus profile's supposedly self-managed list. Excluded here
-- alongside admin.
--
-- Note on `installed_addons.provides_stream`: leaving an addon unmarked
-- (provides_stream = FALSE, the default) means it is included in curated
-- setup for every recipient regardless of any stream grant — this is
-- intentional for this deployment (all curated addons, streaming ones
-- included, go out to everyone). Only set provides_stream = TRUE on an
-- addon if you specifically want it withheld from users whose invite code
-- didn't grant streaming.

CREATE TABLE IF NOT EXISTS curated_addon_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  curated_streams_enabled BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO curated_addon_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stream_addons_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.curated_addon_urls(p_include_streams boolean DEFAULT false)
 RETURNS TABLE(addon_url text, sort_order integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ia.addon_url, MIN(ia.sort_order)::INT AS sort_order
  FROM installed_addons ia
  JOIN profiles p ON p.id = ia.profile_id
  WHERE p.role = 'admin'
    AND ia.enabled = TRUE
    AND (p_include_streams OR ia.provides_stream = FALSE)
  GROUP BY ia.addon_url
  ORDER BY sort_order ASC;
$function$;

CREATE OR REPLACE FUNCTION public.get_shared_addons()
 RETURNS TABLE(addon_url text, sort_order integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ia.addon_url, min(ia.sort_order)::int as sort_order
  from installed_addons ia
  join profiles p on p.id = ia.profile_id
  where p.role = 'admin'
    and coalesce(ia.enabled, true) = true
  group by ia.addon_url
  order by sort_order asc
$function$;

CREATE OR REPLACE FUNCTION public.install_curated_setup(p_profile_id uuid, p_include_streams boolean DEFAULT NULL::boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role         TEXT;
  v_owner        UUID;
  v_profile_flag BOOLEAN;
  v_streams      BOOLEAN;
  v_added        INT := 0;
  v_removed      INT := 0;
BEGIN
  SELECT p.role, p.user_id, p.stream_addons_enabled
    INTO v_role, v_owner, v_profile_flag
  FROM profiles p WHERE p.id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile % not found', p_profile_id;
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() <> v_owner THEN
    RAISE EXCEPTION 'not allowed to provision addons for another user''s profile';
  END IF;

  -- admin curates the list; premium_plus self-manages theirs (canEdit=true,
  -- no one-tap-setup button in the portal) — neither should have curated
  -- rows force-installed by the signup trigger or the 2-day cron resync.
  IF v_role IN ('admin', 'premium_plus') THEN
    RETURN 0;
  END IF;

  -- NULLIF: a profile flag of false falls THROUGH to the global default rather
  -- than overriding it, so the profile flag can only ever grant, never revoke.
  v_streams := COALESCE(
    p_include_streams,
    NULLIF(v_profile_flag, FALSE),
    (SELECT curated_streams_enabled FROM curated_addon_settings WHERE id = 1),
    FALSE
  );

  WITH curated AS (
    SELECT * FROM curated_addon_urls(v_streams)
  ), inserted AS (
    INSERT INTO installed_addons (profile_id, addon_url, enabled, sort_order, source)
    SELECT p_profile_id, c.addon_url, TRUE, c.sort_order, 'curated'
    FROM curated c
    ON CONFLICT (profile_id, addon_url) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_added FROM inserted;

  WITH deleted AS (
    DELETE FROM installed_addons ia
    WHERE ia.profile_id = p_profile_id
      AND ia.source = 'curated'
      AND ia.addon_url NOT IN (SELECT addon_url FROM curated_addon_urls(v_streams))
    RETURNING 1
  )
  SELECT count(*) INTO v_removed FROM deleted;

  UPDATE profiles
  SET uses_primary_addons = FALSE,
      curated_setup_installed = TRUE,
      curated_setup_synced_at = now()
  WHERE id = p_profile_id;

  RETURN v_added + v_removed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_all_curated_setups()
 RETURNS TABLE(profile_id uuid, changed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT p.id FROM profiles p WHERE p.role <> 'admin' LOOP
    BEGIN
      profile_id := r.id;
      changed := install_curated_setup(r.id);
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'curated sync failed for profile %: %', r.id, SQLERRM;
    END;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_install_curated_setup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    -- Only the account's FIRST profile inherits the invite grant; extra
    -- profiles on the same account inherit from their siblings.
    UPDATE profiles
    SET stream_addons_enabled = (
      user_has_stream_grant(NEW.user_id)
      OR EXISTS (
        SELECT 1 FROM profiles sib
        WHERE sib.user_id = NEW.user_id
          AND sib.id <> NEW.id
          AND sib.stream_addons_enabled
      )
    )
    WHERE id = NEW.id;

    PERFORM install_curated_setup(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'install_curated_setup failed for profile %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS profiles_install_curated_setup ON public.profiles;
CREATE TRIGGER profiles_install_curated_setup AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION tg_install_curated_setup();
