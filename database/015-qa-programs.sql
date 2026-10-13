-- 015: Q/A can link to the programs that help.
--
-- A Q/A answers a question, and some answers have services that help with
-- them (a free assessment, funding, installation). The Editor's Q/A form adds
-- them under "Programs that help"; they're saved in the standard record's
-- `relationships` as {target_id: <service urn>, relation: "helped_by"}.
--
-- The record-link tables already existed (fc_private.relationships per
-- revision, public.fc_relationships for published records, and fc_records
-- adds them to each document), but documents saved through fc_save_record
-- never passed their links along. envelope() now does, so publishing a Q/A
-- publishes its links, and a link disappears when its service is unpublished.
--
-- This replaces the separate Fixes list (014): fixes are now Q/A records.
create or replace function fc_private.envelope(doc jsonb, review_owner uuid default null) returns jsonb language plpgsql stable set search_path='' as $$
declare collection text := case doc->>'standard' when 'FSS' then 'help' when 'FRS' then 'source' when 'FMS' then 'media' end;
 details jsonb := '{}'; k text; links jsonb;
begin
 if collection is null then raise exception 'unknown standard %', doc->>'standard'; end if;
 if doc->>'id' !~ '^urn:uuid:' then raise exception 'id must be a urn:uuid'; end if;
 if collection = 'help' then
  foreach k in array array['service_area','eligibility','availability','contact_url','phone','email','cost','hours','deadline','accessibility'] loop
   details := details || jsonb_build_object(k, coalesce(doc#>array['service',k], 'null'::jsonb));
  end loop;
 elsif collection = 'media' then
  foreach k in array array['creator','capture_date','capture_date_text','duration_seconds','evidence_kind'] loop
   details := details || jsonb_build_object(k, coalesce(doc#>array['media',k], 'null'::jsonb));
  end loop;
 elsif doc#>>'{resource,evidence_kind}' is not null then
  details := jsonb_build_object('evidence_kind', doc#>'{resource,evidence_kind}');
 end if;
 -- Links to records that exist; propose() looks them up by external id. Links to unknown records are dropped.
 select coalesce(jsonb_agg(distinct jsonb_build_object('record_id', r.external_id, 'relation', l->>'relation')), '[]') into links
 from jsonb_array_elements(case when jsonb_typeof(doc->'relationships') = 'array' then doc->'relationships' else '[]' end) l
 join fc_private.records r on l->>'target_id' ~ '^urn:uuid:[0-9a-f-]{36}$' and r.id = substr(l->>'target_id', 10)::uuid
 where nullif(trim(l->>'relation'), '') is not null;
 return jsonb_build_object(
  'id', doc->>'local_id',
  'uuid', substr(doc->>'id', 10),
  'collection', collection,
  'title', doc->>'title',
  'summary', doc->>'summary',
  'source_url', doc#>>'{source,url}',
  'organization', doc#>>'{source,organization}',
  'topics', coalesce(doc->'categories', '[]'::jsonb),
  'action_stages', coalesce(doc->'action_stages', '[]'::jsonb),
  'audiences', coalesce(doc->'audiences', '[]'::jsonb),
  'languages', coalesce(doc->'languages', '[]'::jsonb),
  'evidence_status', doc#>>'{source,evidence_status}',
  'rights_status', doc#>>'{rights,status}',
  'source_checked_at', doc#>>'{source,checked_at}',
  'provider_confirmed_at', doc#>>'{service,provider_confirmed_at}',
  'next_review_due', doc#>>'{service,review_due}',
  'review_owner', review_owner,
  'publication_mode', 'link_only',
  'geography_precision', 'named_area',
  'publication_blockers', '[]'::jsonb,
  'related_records', links,
  'details', details,
  'standard_record', doc);
end $$;
