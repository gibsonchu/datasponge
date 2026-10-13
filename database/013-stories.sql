-- 013: Stories.
--
-- Neighborhood stories: a photo, illustration, diagram, or map with a short
-- text, tagged with where, when, and who it's for. Flood Chat shows one when a
-- real example would land a point. They used to live in a Google Sheet; now
-- they're edited in the DataSponge Editor's Stories tab.
--
--  * fc_private.stories: one row per story. story_no is the stable number
--    Flood Chat and the old sheet's ID column use.
--  * fc_stories / fc_save_stories / fc_set_story_status: the Editor.
--    Contributors save drafts; editors publish.
--  * fc_published_stories: published stories, open to anyone (Flood Chat).
--  * Public "stories" bucket for uploaded images; only members upload.

create sequence fc_private.story_no_seq;

create table fc_private.stories(
 id uuid primary key default gen_random_uuid(),
 story_no integer not null unique default nextval('fc_private.story_no_seq'),
 scope_id uuid not null references fc_private.scopes,
 image_url text check (image_url ~ '^https?://[^[:space:]]+$' and length(image_url) <= 2000),
 kind text not null default 'photo' check (kind in ('photo', 'art', 'diagram', 'map', 'video', 'story', 'education')),
 text text not null check (length(trim(text)) between 1 and 4000),
 alt_text text check (length(alt_text) <= 1000),
 places text[] not null default '{}',
 stage text not null default 'general' check (stage in ('before', 'during', 'after', 'general')),
 setting text check (setting in ('inside', 'outside', 'both')),
 audience text not null default 'both' check (audience in ('both', 'renter', 'owner', 'small_business')),
 building_types text[] not null default '{}' check (building_types <@ array['apartment', 'basement', 'single_family', 'multi_family', 'small_business', 'school', 'street', 'neighborhood']),
 hazard_type text check (hazard_type in ('combined', 'stormwater', 'street', 'basement', 'coastal')),
 risk_level text check (risk_level in ('low', 'medium', 'high')),
 cost_tier text check (cost_tier in ('low', 'medium', 'high')),
 purposes text[] not null default '{}' check (purposes <@ array['understand_risk', 'see_examples', 'prepare_before_flooding', 'protect_home', 'protect_business',
  'respond_during_flooding', 'recover_after_flooding', 'get_financial_help', 'deal_with_landlord', 'maintain_business_operations', 'learn_systems']),
 tags text[] not null default '{}',
 credit text check (length(credit) <= 300),
 source_url text check (source_url ~ '^https?://[^[:space:]]+$' and length(source_url) <= 2000),
 status text not null default 'draft' check (status in ('published', 'draft', 'hidden', 'trashed')),
 created_by uuid not null, created_at timestamptz not null default now(),
 updated_by uuid, updated_at timestamptz not null default now()
);
alter sequence fc_private.story_no_seq owned by fc_private.stories.story_no;
create index on fc_private.stories(status);
alter table fc_private.stories enable row level security;
revoke all on fc_private.stories from public, anon, authenticated;

create function fc_private.list_stories() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not fc_private.is_member() then raise exception 'Members only' using errcode = '42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(s) - 'scope_id' order by s.story_no) from fc_private.stories s where s.scope_id = fc_private.my_scope() or fc_private.is_admin()), '[]');
end $$;

-- items: [{id?, story_no?, expected_updated_at?, status, ...fields}]. Matches an
-- existing story by id, else by story_no (the sheet's ID column), else adds one.
-- Fields left out of an item keep their current values. All or nothing.
create function fc_private.save_stories(items jsonb, source text default 'editor') returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; s fc_private.stories; scope uuid := fc_private.my_scope(); editor boolean; target text; result jsonb := '[]'; n integer := 0;
 arr text[];
begin
 if scope is null or not fc_private.allowed(scope) then raise exception 'Only DataSponge members can save stories' using errcode = '42501'; end if;
 editor := fc_private.allowed(scope, array['editor', 'admin']);
 if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then raise exception 'Nothing to save'; end if;
 if jsonb_array_length(items) > 1000 then raise exception 'Up to 1,000 stories at a time'; end if;
 for item in select value from jsonb_array_elements(items) loop
  n := n + 1;
  begin
   s := null;
   if item ? 'id' and nullif(item->>'id', '') is not null then
    select * into s from fc_private.stories where id = (item->>'id')::uuid for update;
    if s.id is null then raise exception 'This story no longer exists' using errcode = '40001'; end if;
   elsif nullif(item->>'story_no', '') is not null then
    select * into s from fc_private.stories where story_no = (item->>'story_no')::integer for update;
   end if;
   if s.id is not null and item ? 'expected_updated_at' and s.updated_at is distinct from (item->>'expected_updated_at')::timestamptz then
    raise exception 'Someone else saved story % after you opened it. Reload, then try again.', s.story_no using errcode = '40001';
   end if;
   target := coalesce(nullif(item->>'status', ''), s.status, 'draft');
   if target not in ('published', 'draft', 'hidden') then raise exception 'Status must be published, draft, or hidden'; end if;
   if not editor and (target <> 'draft' or coalesce(s.status, 'draft') <> 'draft') then
    raise exception 'Contributors can save drafts; an editor publishes and changes published stories' using errcode = '42501';
   end if;
   if s.status = 'trashed' then raise exception 'Story % is in the trash. Restore it first.', s.story_no; end if;
   if s.id is null then
    if nullif(trim(item->>'text'), '') is null then raise exception 'A story needs its text'; end if;
    insert into fc_private.stories(story_no, scope_id, text, status, created_by)
    values (coalesce(nullif(item->>'story_no', '')::integer, nextval('fc_private.story_no_seq')), scope, trim(item->>'text'), target, fc_private.uid())
    returning * into s;
    perform setval('fc_private.story_no_seq', greatest((select max(story_no) from fc_private.stories), 1));
   end if;
   update fc_private.stories set
    image_url = case when item ? 'image_url' then nullif(trim(item->>'image_url'), '') else image_url end,
    kind = case when item ? 'kind' then coalesce(nullif(item->>'kind', ''), 'photo') else kind end,
    text = case when item ? 'text' then trim(item->>'text') else text end,
    alt_text = case when item ? 'alt_text' then nullif(trim(item->>'alt_text'), '') else alt_text end,
    places = case when item ? 'places' then array(select jsonb_array_elements_text(item->'places')) else places end,
    stage = case when item ? 'stage' then coalesce(nullif(item->>'stage', ''), 'general') else stage end,
    setting = case when item ? 'setting' then nullif(item->>'setting', '') else setting end,
    audience = case when item ? 'audience' then coalesce(nullif(item->>'audience', ''), 'both') else audience end,
    building_types = case when item ? 'building_types' then array(select jsonb_array_elements_text(item->'building_types')) else building_types end,
    hazard_type = case when item ? 'hazard_type' then nullif(item->>'hazard_type', '') else hazard_type end,
    risk_level = case when item ? 'risk_level' then nullif(item->>'risk_level', '') else risk_level end,
    cost_tier = case when item ? 'cost_tier' then nullif(item->>'cost_tier', '') else cost_tier end,
    purposes = case when item ? 'purposes' then array(select jsonb_array_elements_text(item->'purposes')) else purposes end,
    tags = case when item ? 'tags' then array(select jsonb_array_elements_text(item->'tags')) else tags end,
    credit = case when item ? 'credit' then nullif(trim(item->>'credit'), '') else credit end,
    source_url = case when item ? 'source_url' then nullif(trim(item->>'source_url'), '') else source_url end,
    status = target, updated_by = fc_private.uid(), updated_at = clock_timestamp()
   where id = s.id
   returning * into s;
   if s.status = 'published' and s.image_url is null then raise exception 'Add an image before publishing'; end if;
   result := result || jsonb_build_object('id', s.id, 'story_no', s.story_no, 'status', s.status, 'updated_at', s.updated_at);
  exception when others then
   raise exception '%', case when jsonb_array_length(items) > 1 then 'Row ' || coalesce(item->>'line', n::text) || ': ' else '' end || sqlerrm using errcode = sqlstate;
  end;
 end loop;
 insert into fc_private.audit_events(actor, action, target) values (fc_private.uid(), 'save_stories', source || ': ' || n || ' stor' || case when n = 1 then 'y' else 'ies' end);
 return result;
end $$;

-- target: published, draft, hidden, trashed, restore (back to draft).
create function fc_private.set_story_status(story uuid, target text) returns text language plpgsql security definer set search_path='' as $$
declare s fc_private.stories; final text;
begin
 select * into s from fc_private.stories where id = story for update;
 if s.id is null or not fc_private.allowed(s.scope_id, array['editor', 'admin']) then raise exception 'Only editors can change whether a story is public' using errcode = '42501'; end if;
 final := case when target = 'restore' then 'draft' when target in ('published', 'draft', 'hidden', 'trashed') then target end;
 if final is null then raise exception 'Unknown story status %', target; end if;
 if final = 'published' and s.image_url is null then raise exception 'Add an image before publishing'; end if;
 update fc_private.stories set status = final, updated_by = fc_private.uid(), updated_at = clock_timestamp() where id = story;
 insert into fc_private.audit_events(actor, action, target) values (fc_private.uid(), 'story_' || target, 'Story ' || s.story_no);
 return final;
end $$;

create function fc_private.published_stories() returns table(
 story_no integer, image_url text, kind text, text text, alt_text text, places text[], stage text, setting text, audience text,
 building_types text[], hazard_type text, risk_level text, cost_tier text, purposes text[], tags text[], credit text, source_url text, updated_at timestamptz
) language sql stable security definer set search_path='' as $$
 select s.story_no, s.image_url, s.kind, s.text, s.alt_text, s.places, s.stage, s.setting, s.audience, s.building_types, s.hazard_type,
  s.risk_level, s.cost_tier, s.purposes, s.tags, s.credit, s.source_url, s.updated_at
 from fc_private.stories s where s.status = 'published' order by s.story_no
$$;

create function public.fc_stories() returns jsonb language sql security invoker set search_path='' as $$ select fc_private.list_stories(); $$;
create function public.fc_save_stories(items jsonb, source text default 'editor') returns jsonb language sql security invoker set search_path='' as $$ select fc_private.save_stories(items, source); $$;
create function public.fc_set_story_status(story uuid, target text) returns text language sql security invoker set search_path='' as $$ select fc_private.set_story_status(story, target); $$;
-- Anyone may read published stories; runs with its owner's rights like fc_search_sources.
create function public.fc_published_stories() returns table(
 story_no integer, image_url text, kind text, text text, alt_text text, places text[], stage text, setting text, audience text,
 building_types text[], hazard_type text, risk_level text, cost_tier text, purposes text[], tags text[], credit text, source_url text, updated_at timestamptz
) language sql stable security definer set search_path='' as $$ select * from fc_private.published_stories(); $$;

revoke all on function fc_private.list_stories(), fc_private.save_stories(jsonb,text), fc_private.set_story_status(uuid,text), fc_private.published_stories(),
 public.fc_stories(), public.fc_save_stories(jsonb,text), public.fc_set_story_status(uuid,text), public.fc_published_stories()
 from public, anon, authenticated;
grant execute on function fc_private.list_stories(), fc_private.save_stories(jsonb,text), fc_private.set_story_status(uuid,text),
 public.fc_stories(), public.fc_save_stories(jsonb,text), public.fc_set_story_status(uuid,text)
 to authenticated;
grant execute on function public.fc_published_stories() to anon, authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('stories', 'stories', true, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy datasponge_stories_upload on storage.objects for insert to authenticated with check (bucket_id = 'stories' and fc_private.is_member());
