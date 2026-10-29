BEGIN;
CREATE SCHEMA nina_speech;
CREATE TABLE nina_speech.budget (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false,
 cap_micro_usd bigint NOT NULL DEFAULT 10000000 CHECK(cap_micro_usd BETWEEN 0 AND 10000000),
 charged_micro_usd bigint NOT NULL DEFAULT 0 CHECK(charged_micro_usd>=0)
);
INSERT INTO nina_speech.budget(id) VALUES(true);
CREATE TABLE nina_speech.account (
 user_id text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
 remaining_characters bigint NOT NULL DEFAULT 0 CHECK(remaining_characters>=0)
);
CREATE TABLE nina_speech.grant (
 id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES nina_speech.account(user_id),
 characters bigint NOT NULL CHECK(characters>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE nina_speech.request (
 id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES nina_speech.account(user_id),
 characters integer NOT NULL CHECK(characters BETWEEN 1 AND 6000),
 cost_micro_usd bigint NOT NULL, network_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
 dispatched boolean NOT NULL DEFAULT false, delivered boolean NOT NULL DEFAULT false,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','charged','refunded'))
);
CREATE INDEX speech_request_admission ON nina_speech.request(created_at);
-- Every mutation follows budget -> account -> request ordering. Expiry releases
-- character reservations, never an attempted/unknown provider charge.
CREATE FUNCTION nina_speech.expire() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nina_speech AS $$
DECLARE r record;
BEGIN
 PERFORM 1 FROM nina_speech.budget WHERE id FOR UPDATE;
 FOR r IN SELECT * FROM nina_speech.request WHERE state='reserved' AND expires_at<=clock_timestamp() ORDER BY user_id,id LOOP
  UPDATE nina_speech.account SET remaining_characters=remaining_characters+r.characters WHERE user_id=r.user_id;
  UPDATE nina_speech.request SET state='refunded' WHERE id=r.id;
  IF NOT r.dispatched THEN UPDATE nina_speech.budget SET charged_micro_usd=charged_micro_usd-r.cost_micro_usd WHERE id; END IF;
 END LOOP;
END $$;
CREATE FUNCTION nina_speech.access(uid text) RETURNS TABLE(enabled boolean,remaining_characters bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nina_speech AS $$
BEGIN PERFORM nina_speech.expire(); RETURN QUERY SELECT a.enabled,a.remaining_characters FROM nina_speech.account a WHERE user_id=uid; END $$;
CREATE FUNCTION nina_speech.reserve(rid uuid,uid text,chars integer,network text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nina_speech AS $$
DECLARE b nina_speech.budget; a nina_speech.account; cost bigint;
BEGIN
 IF chars<1 OR chars>6000 OR length(network)<>64 THEN RETURN 'invalid'; END IF;
 PERFORM nina_speech.expire();
 SELECT * INTO b FROM nina_speech.budget WHERE id FOR UPDATE;
 SELECT * INTO a FROM nina_speech.account WHERE user_id=uid FOR UPDATE;
 IF EXISTS(SELECT 1 FROM nina_speech.request WHERE id=rid) THEN RETURN 'duplicate'; END IF;
 IF NOT b.enabled OR a.user_id IS NULL OR NOT a.enabled THEN RETURN 'disabled'; END IF;
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
CREATE FUNCTION nina_speech.transition(rid uuid,uid text,action text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nina_speech AS $$
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
REVOKE ALL ON ALL TABLES IN SCHEMA nina_speech FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nina_speech FROM PUBLIC;
COMMIT;
