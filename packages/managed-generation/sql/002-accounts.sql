BEGIN;
CREATE TABLE nina_starter.account (
  user_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'unapproved' CHECK (status IN ('approved','unapproved','suspended')),
  remaining_actions bigint NOT NULL DEFAULT 0 CHECK (remaining_actions >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE nina_starter.allowance_grant (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES nina_starter.account(user_id),
  actions bigint NOT NULL CHECK (actions > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE nina_starter.reservation ADD COLUMN user_id text REFERENCES nina_starter.account(user_id);
ALTER TABLE nina_starter.reservation ADD COLUMN operation text;
ALTER TABLE nina_starter.reservation ADD COLUMN model_id text;
ALTER TABLE nina_starter.reservation ADD COLUMN outcome text NOT NULL DEFAULT 'unknown';
ALTER TABLE nina_starter.reservation ADD COLUMN duration_ms bigint;
ALTER TABLE nina_starter.reservation ADD COLUMN usage jsonb;
ALTER FUNCTION nina_starter.reserve(uuid,uuid,text,text,bigint) RENAME TO reserve_global;
ALTER FUNCTION nina_starter.permit(uuid,uuid,text) RENAME TO permit_global;
ALTER FUNCTION nina_starter.settle(uuid,uuid,bigint) RENAME TO settle_global;
CREATE FUNCTION nina_starter.access(uid text) RETURNS TABLE(status text, remaining_actions bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog,nina_starter AS $$
  SELECT a.status,a.remaining_actions FROM nina_starter.account a WHERE a.user_id=uid
$$;
CREATE FUNCTION nina_starter.reserve(bid uuid,rid uuid,network text,digest text,amount bigint,uid text,operation_name text,model text)
RETURNS text LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path = pg_catalog,nina_starter AS $$
DECLARE a nina_starter.account; result text;
BEGIN
  -- Consistent global-budget then account lock ordering for reserve and settle.
  PERFORM 1 FROM nina_starter.budget WHERE id=bid FOR UPDATE;
  SELECT * INTO a FROM nina_starter.account WHERE user_id=uid FOR UPDATE;
  IF NOT FOUND OR a.status <> 'approved' THEN RETURN 'forbidden'; END IF;
  IF a.remaining_actions < 1 THEN RETURN 'exhausted'; END IF;
  result := nina_starter.reserve_global(bid,rid,network,digest,amount);
  IF result <> 'reserved' THEN RETURN result; END IF;
  UPDATE nina_starter.account SET remaining_actions=remaining_actions-1,updated_at=clock_timestamp() WHERE user_id=uid;
  UPDATE nina_starter.reservation SET user_id=uid,operation=operation_name,model_id=model WHERE budget_id=bid AND id=rid;
  RETURN 'reserved';
END $$;
CREATE FUNCTION nina_starter.permit(bid uuid,rid uuid,digest text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,nina_starter AS $$
  SELECT nina_starter.permit_global(bid,rid,digest) AND EXISTS(
    SELECT 1 FROM nina_starter.reservation r JOIN nina_starter.account a ON a.user_id=r.user_id
    WHERE r.budget_id=bid AND r.id=rid AND a.status='approved')
$$;
CREATE FUNCTION nina_starter.settle(bid uuid,rid uuid,charge bigint,attempted integer,result text,elapsed bigint,metrics jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,nina_starter AS $$
DECLARE r nina_starter.reservation; success boolean;
BEGIN
  PERFORM 1 FROM nina_starter.budget WHERE id=bid FOR UPDATE;
  SELECT * INTO r FROM nina_starter.reservation WHERE budget_id=bid AND id=rid FOR UPDATE;
  IF NOT FOUND OR attempted NOT BETWEEN 0 AND 2 THEN RETURN false; END IF;
  IF r.settled THEN RETURN r.charged_micro_usd=charge; END IF;
  success := nina_starter.settle_global(bid,rid,charge);
  IF NOT success THEN RETURN false; END IF;
  IF attempted=0 THEN
    UPDATE nina_starter.account SET remaining_actions=remaining_actions+1,updated_at=clock_timestamp() WHERE user_id=r.user_id;
  END IF;
  UPDATE nina_starter.reservation SET outcome=result,duration_ms=elapsed,usage=metrics WHERE budget_id=bid AND id=rid;
  RETURN true;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA nina_starter FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nina_starter FROM PUBLIC;
-- Runtime role receives only access/reserve/permit/settle EXECUTE. In particular,
-- revoke any historical grants on renamed *_global functions before activation.
COMMIT;
