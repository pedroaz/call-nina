BEGIN;
-- Read-only status for the configured epoch; never reserve funds to probe availability.
CREATE FUNCTION nina_starter.service_enabled(bid uuid,digest text) RETURNS boolean
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog,nina_starter AS $$
 SELECT EXISTS(SELECT 1 FROM nina_starter.budget b
 WHERE b.id=bid AND b.enabled AND b.policy_digest=digest
 AND statement_timestamp()>=b.starts_at AND statement_timestamp()<b.ends_at
 AND statement_timestamp()<b.cost_valid_until)
$$;
CREATE FUNCTION nina_speech.service_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nina_speech AS $$
 SELECT EXISTS(SELECT 1 FROM nina_speech.budget WHERE id AND enabled)
$$;
REVOKE ALL ON FUNCTION nina_starter.service_enabled(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION nina_speech.service_enabled() FROM PUBLIC;
COMMIT;
