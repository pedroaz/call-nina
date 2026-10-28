BEGIN;
ALTER TABLE nina_starter.account ADD COLUMN hosted_ai_enabled boolean NOT NULL DEFAULT false;
UPDATE nina_starter.account SET hosted_ai_enabled=(status='approved');
DROP FUNCTION nina_starter.access(text);
CREATE FUNCTION nina_starter.access(uid text) RETURNS TABLE(hosted_ai_enabled boolean, remaining_actions bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog,nina_starter AS $$
 SELECT a.hosted_ai_enabled,a.remaining_actions FROM nina_starter.account a WHERE a.user_id=uid
$$;
CREATE OR REPLACE FUNCTION nina_starter.reserve(bid uuid,rid uuid,network text,digest text,amount bigint,uid text,operation_name text,model text)
RETURNS text LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path = pg_catalog,nina_starter AS $$
DECLARE a nina_starter.account; result text;
BEGIN
  -- Consistent global-budget then account lock ordering for reserve and settle.
  PERFORM 1 FROM nina_starter.budget WHERE id=bid FOR UPDATE;
  SELECT * INTO a FROM nina_starter.account WHERE user_id=uid FOR UPDATE;
  IF NOT FOUND OR NOT a.hosted_ai_enabled THEN RETURN 'forbidden'; END IF;
  IF a.remaining_actions < 1 THEN RETURN 'exhausted'; END IF;
  result := nina_starter.reserve_global(bid,rid,network,digest,amount);
  IF result <> 'reserved' THEN RETURN result; END IF;
  UPDATE nina_starter.account SET remaining_actions=remaining_actions-1,updated_at=clock_timestamp() WHERE user_id=uid;
  UPDATE nina_starter.reservation SET user_id=uid,operation=operation_name,model_id=model WHERE budget_id=bid AND id=rid;
  RETURN 'reserved';
END $$;
CREATE OR REPLACE FUNCTION nina_starter.permit(bid uuid,rid uuid,digest text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,nina_starter AS $$
  SELECT nina_starter.permit_global(bid,rid,digest) AND EXISTS(
    SELECT 1 FROM nina_starter.reservation r JOIN nina_starter.account a ON a.user_id=r.user_id
    WHERE r.budget_id=bid AND r.id=rid AND a.hosted_ai_enabled)
$$;
ALTER TABLE nina_starter.account DROP COLUMN status;
REVOKE ALL ON FUNCTION nina_starter.access(text) FROM PUBLIC;
COMMIT;
