-- 011: Sources and Q/A.
--
-- Sources are the websites, PDFs, and files that answers come from. Members
-- add them; an AI reads each one (site/api/source-read.js), keeps its text as
-- searchable passages, and drafts the questions it answers as Q/A records
-- (FRS faq_answer). Members can also ask questions; an AI answers them from
-- the passages (site/api/answer.js), or the question waits as "open" until a
-- source can answer it.
--
--  * fc_private.sources / source_chunks: what was added and what it says.
--  * fc_private.answer_sources: which sources back which Q/A, with the quote.
--  * fc_private.open_questions: questions waiting for an answer.
--  * public.fc_search_sources: passage search over sources that have been
--    read, open to anyone (Flood Chat uses it when Q/A isn't enough). Sources
--    are public references by design; files go in the public "sources" bucket.
--  * Seeds Sources from the links the current Q/A already cite.

create table fc_private.sources(
 id uuid primary key default gen_random_uuid(),
 scope_id uuid not null references fc_private.scopes,
 kind text not null check (kind in ('website', 'file')),
 url text not null check (url ~ '^https?://[^[:space:]]+$' and length(url) <= 2000),
 file_name text check (length(file_name) <= 300),
 media_type text check (length(media_type) <= 120),
 title text check (length(title) <= 500),
 publisher text check (length(publisher) <= 300),
 summary text check (length(summary) <= 4000),
 status text not null default 'waiting' check (status in ('waiting', 'reading', 'read', 'failed', 'hidden', 'trashed')),
 problem text check (length(problem) <= 1000),
 char_count integer,
 read_at timestamptz, read_by uuid,
 created_by uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (scope_id, url)
);
create index on fc_private.sources(status);

create table fc_private.source_chunks(
 id bigint generated always as identity primary key,
 source_id uuid not null references fc_private.sources on delete cascade,
 position integer not null,
 heading text,
 body text not null,
 fts tsvector generated always as (setweight(to_tsvector('english', coalesce(heading, '')), 'A') || to_tsvector('english', body)) stored
);
create index on fc_private.source_chunks using gin(fts);
create index on fc_private.source_chunks(source_id, position);

create table fc_private.answer_sources(
 record_id uuid not null references fc_private.records,
 source_id uuid not null references fc_private.sources on delete cascade,
 quote text check (length(quote) <= 2000),
 created_by uuid, created_at timestamptz not null default now(),
 primary key (record_id, source_id)
);
create index on fc_private.answer_sources(source_id);

create table fc_private.open_questions(
 id uuid primary key default gen_random_uuid(),
 scope_id uuid not null references fc_private.scopes,
 question text not null check (length(trim(question)) between 5 and 500),
 status text not null default 'open' check (status in ('open', 'answered', 'dismissed')),
 note text check (length(note) <= 1000),
 record_id uuid references fc_private.records,
 tries integer not null default 0,
 created_by uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index on fc_private.open_questions(scope_id, lower(trim(question)));

alter table fc_private.sources enable row level security;
alter table fc_private.source_chunks enable row level security;
alter table fc_private.answer_sources enable row level security;
alter table fc_private.open_questions enable row level security;
revoke all on fc_private.sources, fc_private.source_chunks, fc_private.answer_sources, fc_private.open_questions from public, anon, authenticated;

-- ---------------------------------------------------------------- sources
create function fc_private.list_sources() returns table(
 id uuid, kind text, url text, file_name text, media_type text, title text, publisher text, summary text,
 status text, problem text, char_count integer, read_at timestamptz, created_at timestamptz, added_by text, answers jsonb
) language plpgsql stable security definer set search_path='' as $$
begin
 if not fc_private.is_member() then raise exception 'Members only' using errcode = '42501'; end if;
 return query
  select s.id, s.kind, s.url, s.file_name, s.media_type, s.title, s.publisher, s.summary, s.status, s.problem, s.char_count, s.read_at, s.created_at,
   coalesce(u.email::text, 'DataSponge'),
   coalesce((select jsonb_agg(jsonb_build_object('record_id', a.record_id, 'quote', a.quote)) from fc_private.answer_sources a where a.source_id = s.id), '[]')
  from fc_private.sources s left join auth.users u on u.id = s.created_by
  where s.scope_id = fc_private.my_scope() or fc_private.is_admin()
  order by s.created_at desc;
end $$;

-- items: [{url, kind?, file_name?, media_type?, title?}]. Already-added links
-- are returned as they are (a trashed one comes back as waiting).
create function fc_private.add_sources(items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; scope uuid := fc_private.my_scope();result jsonb := '[]'; sid uuid; was boolean; u text;
begin
 if scope is null or not fc_private.allowed(scope) then raise exception 'Only DataSponge members can add sources' using errcode = '42501'; end if;
 if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then raise exception 'Nothing to add'; end if;
 if jsonb_array_length(items) > 200 then raise exception 'Up to 200 sources at a time'; end if;
 for item in select value from jsonb_array_elements(items) loop
  u := trim(item->>'url');
  if u !~ '^https?://[^[:space:]]+$' then raise exception '“%” is not a full link starting with https://', u; end if;
  select s.id, true into sid, was from fc_private.sources s where s.scope_id = scope and s.url = u;
  if sid is null then
   insert into fc_private.sources(scope_id, kind, url, file_name, media_type, title, created_by)
   values (scope, coalesce(item->>'kind', 'website'), u, item->>'file_name', item->>'media_type', nullif(trim(item->>'title'), ''), fc_private.uid())
   returning fc_private.sources.id into sid;
   was := false;
   insert into fc_private.audit_events(actor, action, target) values (fc_private.uid(), 'add_source', u);
  else
   update fc_private.sources set status = 'waiting', problem = null, updated_at = now() where fc_private.sources.id = sid and fc_private.sources.status = 'trashed';
  end if;
  result := result || jsonb_build_object('id', sid, 'url', u, 'existing', was);
  sid := null;
 end loop;
 return result;
end $$;

-- Editors mark a source as being read, then save what was read (or the problem).
create function fc_private.start_reading(source uuid) returns void language plpgsql security definer set search_path='' as $$
declare s fc_private.sources;
begin
 select * into s from fc_private.sources where id = source for update;
 if s.id is null or not fc_private.allowed(s.scope_id, array['editor', 'admin']) then raise exception 'Only editors can read sources' using errcode = '42501'; end if;
 if s.status = 'trashed' then raise exception 'This source is in the trash'; end if;
 update fc_private.sources set status = 'reading', problem = null, updated_at = now() where id = source;
end $$;

-- chunks: [{heading?, body}]. problem not null = reading failed; passages are kept from any earlier read.
create function fc_private.save_reading(source uuid, title text, publisher text, summary text, chunks jsonb, problem text default null)
returns void language plpgsql security definer set search_path='' as $$
declare s fc_private.sources;
begin
 select * into s from fc_private.sources where id = source for update;
 if s.id is null or not fc_private.allowed(s.scope_id, array['editor', 'admin']) then raise exception 'Only editors can read sources' using errcode = '42501'; end if;
 if problem is not null then
  update fc_private.sources set status = 'failed', problem = left(save_reading.problem, 1000), updated_at = now() where id = source;
  return;
 end if;
 if jsonb_typeof(chunks) <> 'array' or jsonb_array_length(chunks) = 0 then raise exception 'Nothing was read from this source'; end if;
 if jsonb_array_length(chunks) > 2000 then raise exception 'This source is too long to keep (over 2,000 passages)'; end if;
 delete from fc_private.source_chunks where source_id = source;
 insert into fc_private.source_chunks(source_id, position, heading, body)
  select source, (c.ordinality - 1)::integer, nullif(left(c.value->>'heading', 300), ''), left(c.value->>'body', 6000)
  from jsonb_array_elements(chunks) with ordinality c where length(trim(coalesce(c.value->>'body', ''))) > 0;
 update fc_private.sources set
  status = 'read', problem = null,
  title = coalesce(nullif(left(trim(save_reading.title), 500), ''), sources.title),
  publisher = coalesce(nullif(left(trim(save_reading.publisher), 300), ''), sources.publisher),
  summary = coalesce(nullif(left(trim(save_reading.summary), 4000), ''), sources.summary),
  char_count = (select sum(length(body)) from fc_private.source_chunks where source_id = source),
  read_at = now(), read_by = fc_private.uid(), updated_at = now()
 where id = source;
 insert into fc_private.audit_events(actor, action, target) values (fc_private.uid(), 'read_source', s.url);
end $$;

-- target: waiting (read again), hidden (kept, not searchable), trashed, restore.
create function fc_private.set_source_status(source uuid, target text) returns text language plpgsql security definer set search_path='' as $$
declare s fc_private.sources; final text;
begin
 select * into s from fc_private.sources where id = source for update;
 if s.id is null or not fc_private.allowed(s.scope_id, array['editor', 'admin']) then raise exception 'Only editors can change sources' using errcode = '42501'; end if;
 final := case target
  when 'waiting' then 'waiting' when 'hidden' then 'hidden' when 'trashed' then 'trashed'
  when 'restore' then case when exists (select 1 from fc_private.source_chunks where source_id = source) then 'read' else 'waiting' end
 end;
 if final is null then raise exception 'Unknown source status %', target; end if;
 update fc_private.sources set status = final, updated_at = now() where id = source;
 insert into fc_private.audit_events(actor, action, target) values (fc_private.uid(), 'source_' || target, s.url);
 return final;
end $$;

create function fc_private.link_answer(record uuid, source uuid, quote text default null) returns void language plpgsql security definer set search_path='' as $$
declare r fc_private.records; s fc_private.sources;
begin
 select * into r from fc_private.records where id = record;
 select * into s from fc_private.sources where id = source;
 if r.id is null or s.id is null or not fc_private.allowed(r.scope_id) or not fc_private.allowed(s.scope_id) then raise exception 'Only members can link sources' using errcode = '42501'; end if;
 insert into fc_private.answer_sources(record_id, source_id, quote, created_by) values (record, source, left(quote, 2000), fc_private.uid())
 on conflict (record_id, source_id) do update set quote = coalesce(excluded.quote, answer_sources.quote);
end $$;

-- ---------------------------------------------------------------- open questions
create function fc_private.list_questions() returns table(id uuid, question text, status text, note text, record_id uuid, tries integer, created_at timestamptz, updated_at timestamptz, asked_by text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not fc_private.is_member() then raise exception 'Members only' using errcode = '42501'; end if;
 return query select q.id, q.question, q.status, q.note, q.record_id, q.tries, q.created_at, q.updated_at, coalesce(u.email::text, '')
  from fc_private.open_questions q left join auth.users u on u.id = q.created_by
  where q.scope_id = fc_private.my_scope() or fc_private.is_admin()
  order by q.created_at desc;
end $$;

create function fc_private.add_questions(questions text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare q text; scope uuid := fc_private.my_scope();result jsonb := '[]'; qid uuid; was boolean;
begin
 if scope is null or not fc_private.allowed(scope) then raise exception 'Only DataSponge members can add questions' using errcode = '42501'; end if;
 if coalesce(array_length(questions, 1), 0) = 0 then raise exception 'Nothing to add'; end if;
 if array_length(questions, 1) > 200 then raise exception 'Up to 200 questions at a time'; end if;
 foreach q in array questions loop
  q := trim(q);
  continue when length(q) < 5;
  select o.id, true into qid, was from fc_private.open_questions o where o.scope_id = scope and lower(trim(o.question)) = lower(q);
  if qid is null then
   insert into fc_private.open_questions(scope_id, question, created_by) values (scope, left(q, 500), fc_private.uid()) returning fc_private.open_questions.id into qid;
   was := false;
  else
   update fc_private.open_questions set status = 'open', updated_at = now() where fc_private.open_questions.id = qid and fc_private.open_questions.status = 'dismissed';
  end if;
  result := result || jsonb_build_object('id', qid, 'question', q, 'existing', was);
  qid := null;
 end loop;
 return result;
end $$;

-- After an answer attempt: answered (with the new Q/A record), open (with why), or dismissed.
create function fc_private.set_question(question uuid, target text, note text default null, record uuid default null, tried boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare q fc_private.open_questions;
begin
 select * into q from fc_private.open_questions where id = question for update;
 if q.id is null or not fc_private.allowed(q.scope_id) then raise exception 'Only members can change questions' using errcode = '42501'; end if;
 if target not in ('open', 'answered', 'dismissed') then raise exception 'Unknown question status %', target; end if;
 update fc_private.open_questions set status = target, note = left(set_question.note, 1000), record_id = coalesce(record, open_questions.record_id),
  tries = tries + case when tried then 1 else 0 end, updated_at = now()
 where id = question;
end $$;

-- ---------------------------------------------------------------- search (public)
-- All the words first; if nothing matches, any of the words, best matches first.
create function fc_private.search_sources(q text, max_results integer default 8)
returns table(source_id uuid, title text, publisher text, url text, heading text, passage text, score real)
language plpgsql stable security definer set search_path='' as $$
declare tq tsquery; n integer := least(greatest(coalesce(max_results, 8), 1), 20);
begin
 if length(trim(coalesce(q, ''))) < 2 then return; end if;
 tq := websearch_to_tsquery('english', left(q, 500));
 return query
  select s.id, s.title, s.publisher, s.url, c.heading, c.body, ts_rank_cd(c.fts, tq)
  from fc_private.source_chunks c join fc_private.sources s on s.id = c.source_id
  where s.status = 'read' and c.fts @@ tq
  order by 7 desc limit n;
 if found then return; end if;
 select string_agg(quote_literal(l), ' | ') into q from unnest(tsvector_to_array(to_tsvector('english', left(q, 500)))) l;
 if q is null then return; end if;
 tq := to_tsquery('english', q);
 return query
  select s.id, s.title, s.publisher, s.url, c.heading, c.body, ts_rank_cd(c.fts, tq)
  from fc_private.source_chunks c join fc_private.sources s on s.id = c.source_id
  where s.status = 'read' and c.fts @@ tq
  order by 7 desc limit n;
end $$;

-- ---------------------------------------------------------------- public wrappers
create function public.fc_sources() returns table(
 id uuid, kind text, url text, file_name text, media_type text, title text, publisher text, summary text,
 status text, problem text, char_count integer, read_at timestamptz, created_at timestamptz, added_by text, answers jsonb
) language sql security invoker set search_path='' as $$ select * from fc_private.list_sources(); $$;
create function public.fc_add_sources(items jsonb) returns jsonb language sql security invoker set search_path='' as $$ select fc_private.add_sources(items); $$;
create function public.fc_start_reading(source uuid) returns void language sql security invoker set search_path='' as $$ select fc_private.start_reading(source); $$;
create function public.fc_save_reading(source uuid, title text, publisher text, summary text, chunks jsonb, problem text default null)
 returns void language sql security invoker set search_path='' as $$ select fc_private.save_reading(source, title, publisher, summary, chunks, problem); $$;
create function public.fc_set_source_status(source uuid, target text) returns text language sql security invoker set search_path='' as $$ select fc_private.set_source_status(source, target); $$;
create function public.fc_link_answer(record uuid, source uuid, quote text default null) returns void language sql security invoker set search_path='' as $$ select fc_private.link_answer(record, source, quote); $$;
create function public.fc_questions() returns table(id uuid, question text, status text, note text, record_id uuid, tries integer, created_at timestamptz, updated_at timestamptz, asked_by text)
 language sql security invoker set search_path='' as $$ select * from fc_private.list_questions(); $$;
create function public.fc_add_questions(questions text[]) returns jsonb language sql security invoker set search_path='' as $$ select fc_private.add_questions(questions); $$;
create function public.fc_set_question(question uuid, target text, note text default null, record uuid default null, tried boolean default false)
 returns void language sql security invoker set search_path='' as $$ select fc_private.set_question(question, target, note, record, tried); $$;
create function public.fc_search_sources(q text, max_results integer default 8)
 returns table(source_id uuid, title text, publisher text, url text, heading text, passage text, score real)
 language sql stable security invoker set search_path='' as $$ select * from fc_private.search_sources(q, max_results); $$;

revoke all on function fc_private.list_sources(), fc_private.add_sources(jsonb), fc_private.start_reading(uuid), fc_private.save_reading(uuid,text,text,text,jsonb,text),
 fc_private.set_source_status(uuid,text), fc_private.link_answer(uuid,uuid,text), fc_private.list_questions(), fc_private.add_questions(text[]),
 fc_private.set_question(uuid,text,text,uuid,boolean), fc_private.search_sources(text,integer),
 public.fc_sources(), public.fc_add_sources(jsonb), public.fc_start_reading(uuid), public.fc_save_reading(uuid,text,text,text,jsonb,text),
 public.fc_set_source_status(uuid,text), public.fc_link_answer(uuid,uuid,text), public.fc_questions(), public.fc_add_questions(text[]),
 public.fc_set_question(uuid,text,text,uuid,boolean), public.fc_search_sources(text,integer)
 from public, anon, authenticated;
grant execute on function fc_private.list_sources(), fc_private.add_sources(jsonb), fc_private.start_reading(uuid), fc_private.save_reading(uuid,text,text,text,jsonb,text),
 fc_private.set_source_status(uuid,text), fc_private.link_answer(uuid,uuid,text), fc_private.list_questions(), fc_private.add_questions(text[]),
 fc_private.set_question(uuid,text,text,uuid,boolean),
 public.fc_sources(), public.fc_add_sources(jsonb), public.fc_start_reading(uuid), public.fc_save_reading(uuid,text,text,text,jsonb,text),
 public.fc_set_source_status(uuid,text), public.fc_link_answer(uuid,uuid,text), public.fc_questions(), public.fc_add_questions(text[]),
 public.fc_set_question(uuid,text,text,uuid,boolean)
 to authenticated;
grant execute on function fc_private.search_sources(text,integer), public.fc_search_sources(text,integer) to anon, authenticated;

-- ---------------------------------------------------------------- files
-- Uploaded PDFs, documents, and images. Public to read (they are cited as
-- sources); only members can upload.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('sources', 'sources', true, 26214400, array[
 'application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'text/html',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'image/png', 'image/jpeg', 'image/webp', 'image/gif'
])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy datasponge_sources_upload on storage.objects for insert to authenticated with check (bucket_id = 'sources' and fc_private.is_member());

-- ---------------------------------------------------------------- seed from current Q/A
-- Every link the current Q/A cite becomes a waiting source, linked to those Q/A.
insert into fc_private.sources(scope_id, kind, url, file_name, created_by, created_at)
select distinct on (r.scope_id, v.payload->'standard_record'->'source'->>'url')
 r.scope_id,
 case when v.payload->'standard_record'->'source'->>'url' ~* '\.pdf($|\?)' then 'file' else 'website' end,
 v.payload->'standard_record'->'source'->>'url',
 null, r.created_by, now()
from fc_private.records r join fc_private.revisions v on v.id = r.latest_revision
where v.payload->'standard_record'->>'standard' = 'FRS' and not r.retired and r.status <> 'excluded'
 and v.payload->'standard_record'->'source'->>'url' !~* '^https?://(www\.)?bluedots\.nyc/?$'
on conflict (scope_id, url) do nothing;

insert into fc_private.answer_sources(record_id, source_id, created_by)
select r.id, s.id, r.created_by
from fc_private.records r join fc_private.revisions v on v.id = r.latest_revision
join fc_private.sources s on s.scope_id = r.scope_id and s.url = v.payload->'standard_record'->'source'->>'url'
where v.payload->'standard_record'->>'standard' = 'FRS' and not r.retired and r.status <> 'excluded'
on conflict do nothing;
