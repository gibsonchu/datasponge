-- 009: Flood Commons is now DataSponge.
--
--  * The stored standards point at the renamed repository
--    (github.com/gibsonchu/datasponge; the old address redirects).
--  * Clips approved from now on are published by "DataSponge".
--  * Internal names (fc_ prefixes, the fc_private schema) are unchanged so
--    every page and app that reads the database keeps working.

update fc_private.standard_schemas
 set schema_document = jsonb_set(schema_document, '{$id}',
  to_jsonb(replace(schema_document->>'$id', 'github.com/gibsonchu/flood-commons/', 'github.com/gibsonchu/datasponge/')));

create or replace function fc_private.approve_clip(submission uuid, edits jsonb default '{}', scope uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare s fc_private.clip_submissions; rid uuid := gen_random_uuid(); rev uuid; doc jsonb; stamp text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
 loc text; depth text; place text; storm text; observed date; point jsonb := null;
begin
 select * into s from fc_private.clip_submissions where id = submission for update;
 if s.id is null or s.status <> 'pending' then raise exception 'submission is not pending'; end if;
 if scope is null then select scope_id into scope from fc_private.memberships where user_id = fc_private.uid() and active; end if;
 if not fc_private.allowed(scope, array['editor','admin']) then raise exception 'editor required' using errcode='42501'; end if;
 loc := coalesce(edits->>'location_type', s.location_type);
 depth := coalesce(edits->>'depth', s.depth);
 place := coalesce(edits->>'place_name', s.place_name);
 storm := coalesce(edits->>'storm', s.storm);
 observed := coalesce((edits->>'observed_on')::date, s.observed_on);
 if loc not in ('street','highway','subway','other') or depth not in ('ankle','knee','waist','above_waist','unknown') then raise exception 'invalid edit'; end if;
 if loc <> 'other' then
  if s.lon is null then raise exception 'a public-space clip needs a map point'; end if;
  point := jsonb_build_object('type','Point','coordinates', jsonb_build_array(fc_private.round_coord(s.lon), fc_private.round_coord(s.lat)));
 end if;
 doc := jsonb_build_object(
  'id', 'urn:uuid:' || rid,
  'local_id', 'clip-' || left(rid::text, 8),
  'standard', 'FMS', 'schema_version', '0.1.0',
  'publisher', jsonb_build_object('id', 'https://github.com/gibsonchu/datasponge', 'name', 'DataSponge'),
  'title', coalesce(edits->>'title', case when storm is not null then storm || ' — ' || place else 'Flooding — ' || place end),
  'summary', coalesce(edits->>'summary', s.caption, 'Resident-submitted flood footage near ' || place || '.'),
  'categories', case loc when 'street' then '["observed_impacts","public_space"]' when 'other' then '["observed_impacts"]' else '["observed_impacts","transportation"]' end::jsonb,
  'tags', jsonb_build_array('location:' || loc, 'platform:' || s.platform, 'depth:' || depth),
  'action_stages', '["respond"]'::jsonb, 'audiences', '["residents"]'::jsonb, 'languages', '["en"]'::jsonb,
  'places', jsonb_build_array(jsonb_build_object('id', 'clip-' || left(rid::text, 8), 'name', place, 'relation', 'observed_at',
    'precision', case when point is null then 'named_area' else 'approximate' end, 'geometry', point)),
  'event', case when storm is null then null else jsonb_build_object('id', 'storm:' || trim(both '-' from regexp_replace(lower(storm), '[^a-z0-9]+', '-', 'g')), 'name', storm,
    'date_text', coalesce(to_char(observed, 'FMMonth FMDD, YYYY'), 'Date not given')) end,
  'source', jsonb_build_object('url', s.url, 'organization', initcap(s.platform), 'checked_at', to_char(current_date, 'YYYY-MM-DD'), 'evidence_status', 'website_documented'),
  'rights', jsonb_build_object('status', 'not_assessed', 'license', null, 'license_url', null, 'attribution', s.creator),
  'verification', jsonb_build_object('status', 'source_checked', 'method', 'An editor viewed the original post before publishing.', 'verified_at', to_char(current_date, 'YYYY-MM-DD')),
  'relationships', '[]'::jsonb,
  'metadata', jsonb_build_object('created_at', stamp, 'updated_at', stamp, 'record_version', 1),
  'media', jsonb_build_object('type', s.media_type, 'creator', s.creator, 'capture_date', to_char(observed, 'YYYY-MM-DD'), 'capture_date_text', null,
    'asset_url', null, 'alt_text', edits->>'alt_text', 'duration_seconds', null, 'evidence_kind', null,
    'observation', jsonb_build_object('observed_at', null, 'description', coalesce(edits->>'summary', s.caption, 'Resident-submitted flood footage.'),
      'flood_depth_cm', fc_private.depth_cm(depth), 'damage_classification', 'unknown')));
 rev := fc_private.propose_standard(doc, scope, 'public', fc_private.uid());
 perform fc_private.review(rev, 'publish', coalesce(edits->>'note', 'Approved resident clip submission.'), null);
 update fc_private.clip_submissions set status = 'approved', record_id = rid, reviewed_by = fc_private.uid(), reviewed_at = now(), review_note = edits->>'note' where id = s.id;
 insert into fc_private.audit_events(actor, action, target) values (fc_private.uid(), 'approve_clip', s.id::text);
 return rid;
end $$;
