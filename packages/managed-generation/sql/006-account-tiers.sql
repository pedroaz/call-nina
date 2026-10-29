BEGIN;
CREATE TABLE nina_starter.account_event (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('tier','beta-reset')), details jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON TABLE nina_starter.account_event FROM PUBLIC;
-- Identity remains in Clerk. Missing account rows are Free with no allowances.
ALTER TABLE nina_starter.account ADD COLUMN tier text NOT NULL DEFAULT 'free' CHECK(tier IN ('free','plus'));
DROP FUNCTION nina_starter.access(text);
CREATE FUNCTION nina_starter.access(uid text) RETURNS TABLE(tier text,hosted_ai_enabled boolean,remaining_actions bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nina_starter AS $$
 SELECT a.tier,(a.tier='plus' AND a.hosted_ai_enabled),a.remaining_actions FROM nina_starter.account a WHERE a.user_id=uid
$$;
CREATE OR REPLACE FUNCTION nina_starter.reserve(bid uuid,rid uuid,network text,digest text,amount bigint,uid text,operation_name text,model text)
RETURNS text LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path = pg_catalog,nina_starter AS $$
DECLARE a nina_starter.account; result text;
BEGIN
  -- Consistent global-budget then account lock ordering for reserve and settle.
  PERFORM 1 FROM nina_starter.budget WHERE id=bid FOR UPDATE;
  SELECT * INTO a FROM nina_starter.account WHERE user_id=uid FOR UPDATE;
  IF NOT FOUND OR (NOT a.hosted_ai_enabled OR a.tier <> 'plus') THEN RETURN 'forbidden'; END IF;
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
    WHERE r.budget_id=bid AND r.id=rid AND a.hosted_ai_enabled AND a.tier='plus')
$$;
CREATE OR REPLACE FUNCTION nina_speech.access(uid text) RETURNS TABLE(enabled boolean,remaining_characters bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nina_speech AS $$
BEGIN PERFORM nina_speech.expire(); RETURN QUERY SELECT (a.enabled AND EXISTS(SELECT 1 FROM nina_starter.account t WHERE t.user_id=uid AND t.tier='plus')),a.remaining_characters FROM nina_speech.account a WHERE user_id=uid; END $$;
CREATE OR REPLACE FUNCTION nina_speech.reserve(rid uuid,uid text,chars integer,network text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nina_speech AS $$
DECLARE b nina_speech.budget; a nina_speech.account; cost bigint;
BEGIN
 IF chars<1 OR chars>6000 OR length(network)<>64 THEN RETURN 'invalid'; END IF;
 PERFORM nina_speech.expire();
 SELECT * INTO b FROM nina_speech.budget WHERE id FOR UPDATE;
 PERFORM 1 FROM nina_starter.account WHERE user_id=uid FOR SHARE;
 SELECT * INTO a FROM nina_speech.account WHERE user_id=uid FOR UPDATE;
 IF EXISTS(SELECT 1 FROM nina_speech.request WHERE id=rid) THEN RETURN 'duplicate'; END IF;
 IF NOT b.enabled OR a.user_id IS NULL OR NOT a.enabled OR NOT EXISTS(SELECT 1 FROM nina_starter.account WHERE user_id=uid AND tier='plus') THEN RETURN 'disabled'; END IF;
 IF a.remaining_characters<chars THEN RETURN 'exhausted'; END IF;
 cost:=chars::bigint*4;
 IF b.charged_micro_usd+cost>b.cap_micro_usd THEN RETURN 'budget'; END IF;
 IF (SELECT count(*) FROM nina_speech.request WHERE user_id=uid AND state='refunded' AND created_at>clock_timestamp()-interval '10 minutes')>=5
 OR (SELECT count(*) FROM nina_speech.request WHERE state='reserved')>=2
 OR EXISTS(SELECT 1 FROM nina_speech.request WHERE user_id=uid AND state='reserved')
 OR (SELECT count(*) FROM nina_speech.request WHERE created_at>clock_timestamp()-interval '1 minute')>=20
 OR (SELECT count(*) FROM nina_speech.request WHERE user_id=uid AND created_at>clock_timestamp()-interval '1 minute')>=5
 OR (SELECT count(*) FROM nina_speech.request WHERE network_hash=network AND created_at>clock_timestamp()-interval '1 minute')>=10 THEN RETURN 'throttled'; END IF;
 UPDATE nina_speech.budget SET charged_micro_usd=charged_micro_usd+cost WHERE id;
 UPDATE nina_speech.account SET remaining_characters=remaining_characters-chars WHERE user_id=uid;
 INSERT INTO nina_speech.request(id,user_id,characters,cost_micro_usd,network_hash) VALUES(rid,uid,chars,cost,network);
 RETURN 'reserved';
END $$;
CREATE OR REPLACE FUNCTION nina_speech.transition(rid uuid,uid text,action text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nina_speech AS $$
DECLARE r nina_speech.request;
BEGIN
 PERFORM nina_speech.expire();
 PERFORM 1 FROM nina_speech.budget WHERE id FOR UPDATE;
 PERFORM 1 FROM nina_speech.account WHERE user_id=uid FOR UPDATE;
 SELECT * INTO r FROM nina_speech.request WHERE id=rid AND user_id=uid FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF action='ack' AND r.state='charged' THEN RETURN true; END IF;
 IF action='cancel' AND r.state='refunded' THEN RETURN true; END IF;
 IF r.state<>'reserved' THEN RETURN false; END IF;
 IF action='dispatch' THEN
  PERFORM 1 FROM nina_starter.account WHERE user_id=uid FOR SHARE;
  IF NOT EXISTS(SELECT 1 FROM nina_starter.account WHERE user_id=uid AND tier='plus') THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM nina_speech.budget WHERE id AND enabled) OR NOT EXISTS(SELECT 1 FROM nina_speech.account WHERE user_id=uid AND enabled) THEN RETURN false; END IF;
  UPDATE nina_speech.request SET dispatched=true WHERE id=rid;
 ELSIF action='delivered' THEN
  IF NOT r.dispatched THEN RETURN false; END IF;
  UPDATE nina_speech.request SET delivered=true,expires_at=clock_timestamp()+interval '5 minutes' WHERE id=rid;
 ELSIF action='ack' THEN
  IF NOT r.delivered THEN RETURN false; END IF;
  UPDATE nina_speech.request SET state='charged' WHERE id=rid;
 ELSIF action='cancel' THEN
  UPDATE nina_speech.account SET remaining_characters=remaining_characters+r.characters WHERE user_id=uid;
  UPDATE nina_speech.request SET state='refunded' WHERE id=rid;
  IF NOT r.dispatched THEN UPDATE nina_speech.budget SET charged_micro_usd=charged_micro_usd-r.cost_micro_usd WHERE id; END IF;
 ELSE RETURN false;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION nina_starter.access(text) FROM PUBLIC;
COMMIT;
