-- REVIEW ONLY: no default budget, enabled row, role, credential or provider resource.
-- Apply once through the maintainer's separately approved database migration.
-- All app calls use single committed statements on the primary, never a replica.
BEGIN;
CREATE SCHEMA nina_starter;
CREATE TABLE nina_starter.budget (
  id uuid PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('preview','production')),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^[a-f0-9]{64}$'),
  enabled boolean NOT NULL DEFAULT false,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  cost_valid_until timestamptz NOT NULL,
  limit_micro_usd bigint NOT NULL CHECK (limit_micro_usd > 0),
  charged_micro_usd bigint NOT NULL DEFAULT 0 CHECK (charged_micro_usd >= 0 AND charged_micro_usd <= limit_micro_usd),
  reservation_micro_usd bigint NOT NULL CHECK (reservation_micro_usd > 0),
  requests_per_minute integer NOT NULL CHECK (requests_per_minute BETWEEN 1 AND 100),
  global_requests_per_minute integer NOT NULL CHECK (global_requests_per_minute BETWEEN 1 AND 1000),
  maximum_concurrent integer NOT NULL CHECK (maximum_concurrent BETWEEN 1 AND 100)
);
CREATE TABLE nina_starter.reservation (
  budget_id uuid NOT NULL REFERENCES nina_starter.budget(id),
  id uuid NOT NULL,
  reserved_micro_usd bigint NOT NULL CHECK (reserved_micro_usd > 0),
  charged_micro_usd bigint NOT NULL CHECK (charged_micro_usd >= 0 AND charged_micro_usd <= reserved_micro_usd),
  settled boolean NOT NULL DEFAULT false,
  admitted_at timestamptz NOT NULL,
  lease_until timestamptz NOT NULL,
  PRIMARY KEY (budget_id,id)
);
CREATE INDEX reservation_admissions ON nina_starter.reservation(budget_id,admitted_at);
CREATE INDEX reservation_active ON nina_starter.reservation(budget_id,lease_until) WHERE NOT settled;
-- Only keyed, rotating network hashes; never IPs, learner IDs, prompts or output.
CREATE TABLE nina_starter.throttle (
  budget_id uuid NOT NULL REFERENCES nina_starter.budget(id),
  network_hash text NOT NULL,
  minute timestamptz NOT NULL,
  requests integer NOT NULL CHECK (requests > 0),
  PRIMARY KEY (budget_id,network_hash,minute)
);
CREATE FUNCTION nina_starter.reserve(bid uuid, rid uuid, network text, digest text, amount bigint)
RETURNS text LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path = pg_catalog, nina_starter AS $$
DECLARE b nina_starter.budget; t timestamptz; bucket timestamptz; n integer;
BEGIN
  SELECT * INTO b FROM nina_starter.budget WHERE id=bid FOR UPDATE;
  t := clock_timestamp(); bucket := date_trunc('minute',t);
  IF NOT FOUND OR b.policy_digest <> digest OR b.reservation_micro_usd <> amount OR network !~ '^[a-f0-9]{64}$' THEN RETURN 'unavailable'; END IF;
  IF NOT b.enabled THEN RETURN 'shutdown'; END IF;
  IF t < b.starts_at OR t >= b.ends_at OR t >= b.cost_valid_until THEN RETURN 'unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM nina_starter.reservation WHERE budget_id=bid AND id=rid) THEN RETURN 'conflict'; END IF;
  IF b.charged_micro_usd > b.limit_micro_usd-amount THEN RETURN 'exhausted'; END IF;
  SELECT count(*) INTO n FROM nina_starter.reservation WHERE budget_id=bid AND NOT settled AND lease_until>t;
  IF n >= b.maximum_concurrent THEN RETURN 'throttled'; END IF;
  SELECT count(*) INTO n FROM nina_starter.reservation WHERE budget_id=bid AND admitted_at>=bucket;
  IF n >= b.global_requests_per_minute THEN RETURN 'throttled'; END IF;
  SELECT requests INTO n FROM nina_starter.throttle WHERE budget_id=bid AND network_hash=network AND minute=bucket;
  IF coalesce(n,0) >= b.requests_per_minute THEN RETURN 'throttled'; END IF;
  -- This lock serializes budget, global concurrency and network throttling.
  UPDATE nina_starter.budget SET charged_micro_usd=charged_micro_usd+amount WHERE id=bid;
  INSERT INTO nina_starter.reservation VALUES(bid,rid,amount,amount,false,t,t+interval '120 seconds');
  INSERT INTO nina_starter.throttle VALUES(bid,network,bucket,1)
    ON CONFLICT(budget_id,network_hash,minute) DO UPDATE SET requests=nina_starter.throttle.requests+1;
  DELETE FROM nina_starter.throttle WHERE budget_id=bid AND minute<bucket-interval '2 minutes';
  RETURN 'reserved';
END $$;
CREATE FUNCTION nina_starter.permit(bid uuid,rid uuid,digest text)
RETURNS boolean LANGUAGE sql STRICT SECURITY DEFINER SET search_path = pg_catalog, nina_starter AS $$
 SELECT EXISTS(SELECT 1 FROM nina_starter.budget b JOIN nina_starter.reservation r ON r.budget_id=b.id
 WHERE b.id=bid AND r.id=rid AND b.enabled AND b.policy_digest=digest AND NOT r.settled
 AND clock_timestamp()>=b.starts_at AND clock_timestamp()<b.ends_at
 AND clock_timestamp()<b.cost_valid_until AND clock_timestamp()<r.lease_until)
$$;
CREATE FUNCTION nina_starter.settle(bid uuid,rid uuid,charge bigint)
RETURNS boolean LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path = pg_catalog, nina_starter AS $$
DECLARE r nina_starter.reservation;
BEGIN
  PERFORM 1 FROM nina_starter.budget WHERE id=bid FOR UPDATE;
  SELECT * INTO r FROM nina_starter.reservation WHERE budget_id=bid AND id=rid FOR UPDATE;
  IF NOT FOUND OR charge<0 OR charge>r.reserved_micro_usd THEN RETURN false; END IF;
  IF r.settled THEN RETURN r.charged_micro_usd=charge; END IF;
  UPDATE nina_starter.budget SET charged_micro_usd=charged_micro_usd-(r.reserved_micro_usd-charge) WHERE id=bid;
  UPDATE nina_starter.reservation SET settled=true,charged_micro_usd=charge WHERE budget_id=bid AND id=rid;
  RETURN true;
END $$;
-- A lost caller, process crash or expired lease NEVER refunds a reservation.
-- No cleanup deletes reservations in an active budget epoch: duplicate prevention
-- and conservative financial accounting survive restarts. Retire whole expired
-- epochs only after audited accounting; provision a NEW approved budget, no reset.
REVOKE ALL ON SCHEMA nina_starter FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA nina_starter FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nina_starter FROM PUBLIC;
-- Maintainer grants only schema USAGE and these three function EXECUTEs to a
-- dedicated service role; never table writes, schema creation or function owner.
COMMIT;
