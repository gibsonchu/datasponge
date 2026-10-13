-- 014: Fix paths.
--
-- Problem -> fix -> program links. Each row says: for this flooding problem and
-- these people (renter, homeowner, business owner), this is the fix, and these
-- published DataSponge services help with it (free assessments, funding,
-- installation). Flood Chat looks them up instead of keeping hand-written rules
-- in its instructions; editors change them in the DataSponge Editor's Fixes tab.
--
--  * fc_private.fix_paths: one row per problem + fix.
--  * fc_fix_paths / fc_save_fix_paths / fc_set_fix_path_status: the Editor.
--    Contributors save drafts; editors publish. Publishing records who reviewed it.
--  * fc_published_fix_paths: published paths with their services, open to anyone.
create sequence fc_private.fix_path_no_seq;
create table fc_private.fix_paths(
 id uuid primary key default gen_random_uuid(),
 path_no integer not null unique default nextval('fc_private.fix_path_no_seq'),
 scope_id uuid not null references fc_private.scopes,
 problem text not null check (length(trim(problem)) between 3 and 300),
 keywords text[] not null default '{}',
 audiences text[] not null default array['homeowner'] check (cardinality(audiences) > 0 and audiences <@ array['renter', 'homeowner', 'business_owner']),
 fix text not null check (length(trim(fix)) between 2 and 200),
 details text check (length(details) <= 2000),
 service_ids uuid[] not null default '{}',
 sort integer not null default 100,
 status text not null default 'draft' check (status in ('published', 'draft', 'hidden', 'trashed')),
 reviewed_by uuid, reviewed_at timestamptz,
 created_by uuid not null, created_at timestamptz not null default now(),
 updated_by uuid, updated_at timestamptz not null default now()
);
alter sequence fc_private.fix_path_no_seq owned by fc_private.fix_paths.path_no;
create index on fc_private.fix_paths(status);
alter table fc_private.fix_paths enable row level security;
revoke all on fc_private.fix_paths from public, anon, authenticated;

create function fc_private.list_fix_paths() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not fc_private.is_member() then raise exception 'Members only' using errcode = '42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(f) - 'scope_id' order by f.sort, f.path_no) from fc_private.fix_paths f
  where f.scope_id = fc_private.my_scope() or fc_private.is_admin()), '[]');
end $$;

-- items: [{id?, expected_updated_at?, status, ...fields}]. Fields left out keep their values. All or nothing.
create function fc_private.save_fix_paths(items jsonb, source text default 'editor') returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; f fc_private.fix_paths; scope uuid := fc_private.my_scope(); editor boolean; target text; result jsonb := '[]'; n integer := 0;
begin
 if scope is null or not fc_private.allowed(scope) then raise exception 'Only DataSponge members can save fixes' using errcode = '42501'; end if;
 editor := fc_private.allowed(scope, array['editor', 'admin']);
 if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then raise exception 'Nothing to save'; end if;
 if jsonb_array_length(items) > 500 then raise exception 'Up to 500 fixes at a time'; end if;
 for item in select value from jsonb_array_elements(items) loop
  n := n + 1;
  begin
   f := null;
   if nullif(item->>'id', '') is not null then
    select * into f from fc_private.fix_paths where id = (item->>'id')::uuid for update;
    if f.id is null then raise exception 'This fix no longer exists' using errcode = '40001'; end if;
    if item ? 'expected_updated_at' and f.updated_at is distinct from (item->>'expected_updated_at')::timestamptz then
     raise exception 'Someone else saved fix % after you opened it. Reload, then try again.', f.path_no using errcode = '40001';
    end if;
   end if;
   target := coalesce(nullif(item->>'status', ''), f.status, 'draft');
   if target not in ('published', 'draft', 'hidden') then raise exception 'Status must be published, draft, or hidden'; end if;
   if not editor and (target <> 'draft' or coalesce(f.status, 'draft') <> 'draft') then
    raise exception 'Contributors can save drafts; an editor publishes and changes published fixes' using errcode = '42501';
   end if;
   if f.status = 'trashed' then raise exception 'Fix % is in the trash. Restore it first.', f.path_no; end if;
   if f.id is null then
    if nullif(trim(item->>'problem'), '') is null or nullif(trim(item->>'fix'), '') is null then raise exception 'A fix needs a problem and a fix'; end if;
    insert into fc_private.fix_paths(scope_id, problem, fix, status, created_by)
    values (scope, trim(item->>'problem'), trim(item->>'fix'), target, fc_private.uid()) returning * into f;
   end if;
   update fc_private.fix_paths set
    problem = case when item ? 'problem' then trim(item->>'problem') else problem end,
    keywords = case when item ? 'keywords' then array(select lower(trim(k)) from jsonb_array_elements_text(item->'keywords') k where trim(k) <> '') else keywords end,
    audiences = case when item ? 'audiences' then array(select jsonb_array_elements_text(item->'audiences')) else audiences end,
    fix = case when item ? 'fix' then trim(item->>'fix') else fix end,
    details = case when item ? 'details' then nullif(trim(item->>'details'), '') else details end,
    service_ids = case when item ? 'service_ids' then array(select (jsonb_array_elements_text(item->'service_ids'))::uuid) else service_ids end,
    sort = case when item ? 'sort' then coalesce(nullif(item->>'sort', '')::integer, 100) else sort end,
    status = target,
    reviewed_by = case when target = 'published' and editor and coalesce(item->>'reviewed', '') = 'true' then fc_private.uid() else reviewed_by end,
    reviewed_at = case when target = 'published' and editor and coalesce(item->>'reviewed', '') = 'true' then clock_timestamp() else reviewed_at end,
    updated_by = fc_private.uid(), updated_at = clock_timestamp()
   where id = f.id returning * into f;
   result := result || jsonb_build_object('id', f.id, 'path_no', f.path_no, 'status', f.status, 'updated_at', f.updated_at);
  exception when others then
   raise exception '%', case when jsonb_array_length(items) > 1 then 'Row ' || n || ': ' else '' end || sqlerrm using errcode = sqlstate;
  end;
 end loop;
 insert into fc_private.audit_events(actor, action, target) values (fc_private.uid(), 'save_fix_paths', source || ': ' || n || ' fix' || case when n = 1 then '' else 'es' end);
 return result;
end $$;

-- target: published, draft, hidden, trashed, restore (back to draft). Publishing marks it reviewed by the editor.
create function fc_private.set_fix_path_status(path uuid, target text) returns text language plpgsql security definer set search_path='' as $$
declare f fc_private.fix_paths; final text;
begin
 select * into f from fc_private.fix_paths where id = path for update;
 if f.id is null or not fc_private.allowed(f.scope_id, array['editor', 'admin']) then raise exception 'Only editors can change whether a fix is public' using errcode = '42501'; end if;
 final := case when target = 'restore' then 'draft' when target in ('published', 'draft', 'hidden', 'trashed') then target end;
 if final is null then raise exception 'Unknown fix status %', target; end if;
 update fc_private.fix_paths set status = final,
  reviewed_by = case when final = 'published' then fc_private.uid() else reviewed_by end,
  reviewed_at = case when final = 'published' then clock_timestamp() else reviewed_at end,
  updated_by = fc_private.uid(), updated_at = clock_timestamp()
 where id = path;
 insert into fc_private.audit_events(actor, action, target) values (fc_private.uid(), 'fix_path_' || target, 'Fix ' || f.path_no);
 return final;
end $$;

-- Published fixes with their services. Only public, current services (fc_current_catalog: not closed, not past deadline) are included.
create function fc_private.published_fix_paths() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'path_no', f.path_no, 'problem', f.problem, 'keywords', f.keywords, 'audiences', f.audiences, 'fix', f.fix, 'details', f.details,
  'reviewed', f.reviewed_at is not null, 'reviewed_at', f.reviewed_at, 'updated_at', f.updated_at,
  'services', coalesce((select jsonb_agg(jsonb_build_object(
     'id', c.id, 'name', c.document->>'title', 'summary', c.document->>'summary',
     'url', coalesce(c.document#>>'{service,contact_url}', c.document#>>'{source,url}'),
     'phone', c.document#>>'{service,phone}', 'eligibility', c.document#>>'{service,eligibility}')
     order by array_position(f.service_ids, c.id))
   from public.fc_current_catalog c join public.fc_catalog pub on pub.id = c.id and pub.audience = 'public'
   where c.id = any(f.service_ids) and c.collection = 'help'), '[]'::jsonb)
 ) order by f.sort, f.path_no), '[]'::jsonb)
 from fc_private.fix_paths f where f.status = 'published'
$$;

create function public.fc_fix_paths() returns jsonb language sql security invoker set search_path='' as $$ select fc_private.list_fix_paths(); $$;
create function public.fc_save_fix_paths(items jsonb, source text default 'editor') returns jsonb language sql security invoker set search_path='' as $$ select fc_private.save_fix_paths(items, source); $$;
create function public.fc_set_fix_path_status(path uuid, target text) returns text language sql security invoker set search_path='' as $$ select fc_private.set_fix_path_status(path, target); $$;
-- Anyone may read published fixes (Flood Chat); runs with its owner's rights like fc_published_stories.
create function public.fc_published_fix_paths() returns jsonb language sql stable security definer set search_path='' as $$ select fc_private.published_fix_paths(); $$;

revoke all on function fc_private.list_fix_paths(), fc_private.save_fix_paths(jsonb,text), fc_private.set_fix_path_status(uuid,text), fc_private.published_fix_paths(),
 public.fc_fix_paths(), public.fc_save_fix_paths(jsonb,text), public.fc_set_fix_path_status(uuid,text), public.fc_published_fix_paths()
 from public, anon, authenticated;
grant execute on function fc_private.list_fix_paths(), fc_private.save_fix_paths(jsonb,text), fc_private.set_fix_path_status(uuid,text),
 public.fc_fix_paths(), public.fc_save_fix_paths(jsonb,text), public.fc_set_fix_path_status(uuid,text)
 to authenticated;
grant execute on function public.fc_published_fix_paths() to anon, authenticated;
