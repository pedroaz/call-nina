BEGIN;
CREATE SCHEMA nina_sync;
CREATE TABLE nina_sync.library (
 user_id text PRIMARY KEY, current_id uuid, published_at timestamptz, last_begin timestamptz
);
CREATE TABLE nina_sync.snapshot (
 user_id text NOT NULL REFERENCES nina_sync.library(user_id), id uuid NOT NULL,
 manifest jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 published_at timestamptz, PRIMARY KEY(user_id,id)
);
CREATE TABLE nina_sync.chunk (
 user_id text NOT NULL, snapshot_id uuid NOT NULL, position integer NOT NULL CHECK(position BETWEEN 0 AND 99),
 data text NOT NULL CHECK(length(data)<=1398104), PRIMARY KEY(user_id,snapshot_id,position),
 FOREIGN KEY(user_id,snapshot_id) REFERENCES nina_sync.snapshot(user_id,id) ON DELETE CASCADE
);
CREATE FUNCTION nina_sync.exchange(uid text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nina_sync AS $$
DECLARE action text:=input->>'action'; sid uuid; s nina_sync.snapshot; l nina_sync.library; result jsonb; pos integer;
BEGIN
 IF uid IS NULL OR length(uid) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'invalid identity'; END IF;
 IF action='begin' THEN
   DELETE FROM nina_sync.snapshot WHERE (user_id,id) IN (
     SELECT user_id,id FROM nina_sync.snapshot WHERE published_at IS NULL
       AND created_at<clock_timestamp()-interval '24 hours'
       ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED
   );
 END IF;
 INSERT INTO nina_sync.library(user_id) VALUES(uid) ON CONFLICT DO NOTHING;
 SELECT * INTO l FROM nina_sync.library WHERE user_id=uid FOR UPDATE;
 DELETE FROM nina_sync.snapshot WHERE user_id=uid AND published_at IS NULL AND created_at<clock_timestamp()-interval '24 hours';
 IF action='manifest' THEN
   SELECT * INTO s FROM nina_sync.snapshot WHERE user_id=uid AND id=l.current_id;
   IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
   RETURN jsonb_build_object('manifest',s.manifest,'publishedAt',to_char(s.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 END IF;
 sid:=(input->>'id')::uuid;
 IF action='begin' THEN
   SELECT * INTO s FROM nina_sync.snapshot WHERE user_id=uid AND id=sid;
   IF FOUND THEN
     IF s.manifest<>input->'manifest' THEN RETURN '{"error":"conflict"}'::jsonb; END IF;
     RETURN '{"ok":true}'::jsonb;
   END IF;
   IF l.last_begin>clock_timestamp()-interval '6 seconds' THEN RETURN '{"error":"throttled"}'::jsonb; END IF;
   IF (SELECT count(*) FROM nina_sync.snapshot WHERE user_id=uid AND published_at IS NULL)>=2 THEN
     DELETE FROM nina_sync.snapshot WHERE user_id=uid AND id=(SELECT id FROM nina_sync.snapshot WHERE user_id=uid AND published_at IS NULL ORDER BY created_at LIMIT 1);
   END IF;
   IF (input->'manifest'->>'byteLength')::bigint NOT BETWEEN 1 AND 104857600 OR jsonb_array_length(input->'manifest'->'chunkHashes') NOT BETWEEN 1 AND 100 THEN RETURN '{"error":"invalid"}'::jsonb; END IF;
   INSERT INTO nina_sync.snapshot(user_id,id,manifest) VALUES(uid,sid,input->'manifest');
   UPDATE nina_sync.library SET last_begin=clock_timestamp() WHERE user_id=uid;
   RETURN '{"ok":true}'::jsonb;
 END IF;
 SELECT * INTO s FROM nina_sync.snapshot WHERE user_id=uid AND id=sid;
 IF NOT FOUND THEN RETURN '{"error":"changed"}'::jsonb; END IF;
 IF action='metadata' THEN RETURN s.manifest; END IF;
 IF action='chunk' THEN
   pos:=(input->>'index')::integer;
   IF pos<0 OR pos>=jsonb_array_length(s.manifest->'chunkHashes') THEN RETURN '{"error":"invalid"}'::jsonb; END IF;
   SELECT to_jsonb(data) INTO result FROM nina_sync.chunk WHERE user_id=uid AND snapshot_id=sid AND position=pos;
   IF FOUND THEN
     IF result<>input->'data' THEN RETURN '{"error":"conflict"}'::jsonb; END IF;
   ELSE
     IF s.published_at IS NOT NULL THEN RETURN '{"error":"conflict"}'::jsonb; END IF;
     INSERT INTO nina_sync.chunk VALUES(uid,sid,pos,input->>'data');
   END IF;
   RETURN '{"ok":true}'::jsonb;
 ELSIF action='inspect' THEN
   RETURN jsonb_build_object('manifest',s.manifest,'chunks',(SELECT coalesce(jsonb_agg(jsonb_build_object('index',position,'data',data) ORDER BY position),'[]'::jsonb) FROM nina_sync.chunk WHERE user_id=uid AND snapshot_id=sid));
 ELSIF action='read' THEN
   IF l.current_id IS DISTINCT FROM sid THEN RETURN '{"error":"changed"}'::jsonb; END IF;
   SELECT to_jsonb(data) INTO result FROM nina_sync.chunk WHERE user_id=uid AND snapshot_id=sid AND position=(input->>'index')::integer;
   RETURN coalesce(result,'{"error":"changed"}'::jsonb);
 ELSIF action='publish' THEN
   IF s.published_at IS NULL THEN
     IF (SELECT count(*) FROM nina_sync.chunk WHERE user_id=uid AND snapshot_id=sid)<>jsonb_array_length(s.manifest->'chunkHashes') THEN RETURN '{"error":"conflict"}'::jsonb; END IF;
     UPDATE nina_sync.snapshot SET published_at=clock_timestamp() WHERE user_id=uid AND id=sid RETURNING * INTO s;
     UPDATE nina_sync.library SET current_id=sid,published_at=s.published_at WHERE user_id=uid;
     DELETE FROM nina_sync.snapshot WHERE user_id=uid AND id<>sid AND published_at IS NOT NULL;
   END IF;
   RETURN jsonb_build_object('manifest',s.manifest,'publishedAt',to_char(s.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 END IF;
 RETURN '{"error":"invalid"}'::jsonb;
END $$;
REVOKE ALL ON SCHEMA nina_sync FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA nina_sync FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nina_sync FROM PUBLIC;
COMMIT;
