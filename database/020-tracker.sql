-- 020: Team tracker. Bugs, issues, and feature requests for every FloodLine
-- product, in one list the team shares (datasponge.floodline.nyc/tracker/).
--
--  * Members (anyone with a DataSponge membership) see every item, submit new
--    ones, and comment. A member's submission waits in "review" until an admin
--    approves, rejects, or prioritizes it. An admin's own items start approved.
--  * Admins change status and priority.
--  * fc_tracker_report(key, request): for tools without a sign-in (the fl-track
--    command Claude Code sessions run, and the GitHub webhook). The key's
--    SHA-256 must be in tracker_keys; keys are added outside this file.
--
-- Items are numbered FL-1, FL-2, ... Mention "FL-12" in a commit or pull request
-- and the GitHub webhook adds the link to that item.

create table fc_private.tracker_products(
 key text primary key check (key ~ '^[a-z0-9-]{2,40}$'),
 name text not null,
 repo text unique,          -- owner/name on GitHub
 url text,
 sort smallint not null default 100
);
alter table fc_private.tracker_products enable row level security;
insert into fc_private.tracker_products(key, name, repo, url, sort) values
 ('bluedots', 'Blue Dots', 'gibsonchu/bluedots', 'https://bluedots.nyc', 10),
 ('blue-dots-urgent', 'Blue Dots Urgent', 'gibsonchu/blue-dots-urgent', 'https://urgent.bluedots.nyc', 20),
 ('local-help', 'Local Help', 'gibsonchu/flooding-local-help', 'https://localhelp.floodline.nyc', 30),
 ('datasponge', 'DataSponge', 'gibsonchu/datasponge', 'https://datasponge.floodline.nyc', 40),
 ('bluedots-profile', 'Blue Dots profile', 'gibsonchu/bluedots-profile', null, 50),
 ('floodline-site', 'FloodLine website', 'gibsonchu/floodline-site', 'https://floodline-site.vercel.app', 60),
 ('flood-clips', 'Flood Clips', 'gibsonchu/flood-clips', 'https://flood-clips.vercel.app', 70),
 ('flood-risk-map', 'NYC Flood Risk Map', 'gibsonchu/nyc-flood-risk-map', null, 80),
 ('floodline-bugbot', 'FloodLine Bug Bot', 'gibsonchu/floodline-bugbot', null, 90),
 ('other', 'Other', null, null, 999);

create table fc_private.tracker_items(
 id bigint generated always as identity primary key,
 product text not null references fc_private.tracker_products,
 kind text not null check (kind in ('bug', 'issue', 'feature')),
 title text not null check (length(trim(title)) between 3 and 200),
 details text not null default '' check (length(details) <= 10000),
 status text not null default 'review' check (status in ('review', 'approved', 'in_progress', 'fixed', 'rejected')),
 priority text not null default 'normal' check (priority in ('urgent', 'high', 'normal', 'low')),
 submitted_by text not null check (length(submitted_by) <= 200),
 source text not null default 'web' check (source in ('web', 'claude', 'github', 'slack')),
 links jsonb not null default '[]' check (jsonb_typeof(links) = 'array'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index tracker_items_updated_idx on fc_private.tracker_items (updated_at desc);
alter table fc_private.tracker_items enable row level security;

create table fc_private.tracker_events(
 id bigint generated always as identity primary key,
 item_id bigint not null references fc_private.tracker_items on delete cascade,
 at timestamptz not null default now(),
 actor text not null,
 what text not null check (length(what) <= 4000)
);
create index tracker_events_item_idx on fc_private.tracker_events (item_id, at);
alter table fc_private.tracker_events enable row level security;

create table fc_private.tracker_keys(
 name text primary key,
 key_hash text not null unique,
 created_at timestamptz not null default now()
);
alter table fc_private.tracker_keys enable row level security;
revoke all on fc_private.tracker_products, fc_private.tracker_items, fc_private.tracker_events, fc_private.tracker_keys from public, anon, authenticated;

create function fc_private.tracker_me() returns text language sql stable security definer set search_path='' as $$
 select coalesce((select email::text from auth.users where id = fc_private.uid()), 'someone')
$$;

create function fc_private.tracker_item_json(i fc_private.tracker_items) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(i) || jsonb_build_object(
  'ref', 'FL-' || i.id,
  'history', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'actor', e.actor, 'what', e.what) order by e.at, e.id)
                       from fc_private.tracker_events e where e.item_id = i.id), '[]'))
$$;

-- Adds a link once (same URL is never added twice).
create function fc_private.tracker_add_link(item bigint, label text, link text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if link is null or link !~ '^https://' or length(link) > 500 then return false; end if;
 update fc_private.tracker_items
    set links = links || jsonb_build_array(jsonb_build_object('label', left(coalesce(nullif(trim(label), ''), 'Link'), 120), 'url', link)),
        updated_at = now()
  where id = item and not links @> jsonb_build_array(jsonb_build_object('url', link));
 return found;
end $$;

-- One change, written by the signed-in member or a keyed tool. Returns the item.
create function fc_private.tracker_apply(item bigint, actor text, admin boolean, req jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 cur fc_private.tracker_items;
 new_status text := nullif(req->>'status', '');
 new_priority text := nullif(req->>'priority', '');
 note text := nullif(trim(req->>'note'), '');
 labels constant jsonb := '{"review":"For review","approved":"Approved","in_progress":"In progress","fixed":"Fixed","rejected":"Rejected"}';
begin
 select * into cur from fc_private.tracker_items where id = item for update;
 if cur.id is null then raise exception 'There is no FL-%.', item; end if;
 if (new_status is not null and new_status <> cur.status) or (new_priority is not null and new_priority <> cur.priority) then
  if not admin then raise exception 'Only an admin can change status or priority.' using errcode = '42501'; end if;
 end if;
 if new_status is not null and new_status <> cur.status then
  if not labels ? new_status then raise exception 'Unknown status %', new_status; end if;
  update fc_private.tracker_items set status = new_status, updated_at = now() where id = item;
  insert into fc_private.tracker_events(item_id, actor, what) values (item, actor, 'Status: ' || (labels->>new_status));
 end if;
 if new_priority is not null and new_priority <> cur.priority then
  update fc_private.tracker_items set priority = new_priority, updated_at = now() where id = item;
  insert into fc_private.tracker_events(item_id, actor, what) values (item, actor, 'Priority: ' || new_priority);
 end if;
 if nullif(req->>'link', '') is not null and fc_private.tracker_add_link(item, req->>'link_label', req->>'link') then
  insert into fc_private.tracker_events(item_id, actor, what) values (item, actor, 'Linked ' || coalesce(nullif(trim(req->>'link_label'), ''), 'a link') || ': ' || (req->>'link'));
 end if;
 if note is not null then
  insert into fc_private.tracker_events(item_id, actor, what) values (item, actor, left(note, 4000));
  update fc_private.tracker_items set updated_at = now() where id = item;
 end if;
 select * into cur from fc_private.tracker_items where id = item;
 return fc_private.tracker_item_json(cur);
end $$;

create function fc_private.tracker_create(actor text, starts text, src text, req jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i fc_private.tracker_items;
begin
 insert into fc_private.tracker_items(product, kind, title, details, status, priority, submitted_by, source)
 values (
  coalesce(nullif(req->>'product', ''), 'other'),
  coalesce(nullif(req->>'kind', ''), 'bug'),
  trim(req->>'title'),
  coalesce(trim(req->>'details'), ''),
  starts,
  coalesce(nullif(req->>'priority', ''), 'normal'),
  actor,
  src)
 returning * into i;
 insert into fc_private.tracker_events(item_id, actor, what) values (i.id, actor, 'Submitted');
 if nullif(req->>'link', '') is not null then perform fc_private.tracker_add_link(i.id, req->>'link_label', req->>'link'); end if;
 select * into i from fc_private.tracker_items where id = i.id;
 return fc_private.tracker_item_json(i);
end $$;

-- ---------- signed-in members (the tracker page) ----------
create function public.fc_tracker() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not fc_private.is_member() then raise exception 'Members only' using errcode = '42501'; end if;
 return jsonb_build_object(
  'me', fc_private.tracker_me(),
  'admin', fc_private.is_admin(),
  'products', (select jsonb_agg(to_jsonb(p) order by p.sort) from fc_private.tracker_products p),
  'items', coalesce((select jsonb_agg(fc_private.tracker_item_json(i) order by i.updated_at desc) from fc_private.tracker_items i), '[]'));
end $$;

create function public.fc_tracker_submit(req jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not fc_private.is_member() then raise exception 'Members only' using errcode = '42501'; end if;
 return fc_private.tracker_create(fc_private.tracker_me(), case when fc_private.is_admin() then 'approved' else 'review' end, 'web', req);
end $$;

create function public.fc_tracker_update(item bigint, req jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not fc_private.is_member() then raise exception 'Members only' using errcode = '42501'; end if;
 return fc_private.tracker_apply(item, fc_private.tracker_me(), fc_private.is_admin(), req);
end $$;

-- ---------- keyed tools (fl-track, GitHub webhook) ----------
-- request: {"action":"list"} | {"action":"add", product, kind, title, details, status, link, ...}
--        | {"action":"update", "item": 12, status, priority, note, link, link_label}
--        | {"action":"mention", "repo": "owner/name", "text": "...", "link": url, "link_label": "...", "actor": "..."}
create function public.fc_tracker_report(key text, req jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 who text;
 actor text;
 item bigint;
 m text[];
 touched jsonb := '[]';
 fixes boolean;
begin
 select name into who from fc_private.tracker_keys where key_hash = encode(extensions.digest(coalesce(key, ''), 'sha256'), 'hex');
 if who is null then raise exception 'Unknown tracker key' using errcode = '42501'; end if;
 actor := left(coalesce(nullif(trim(req->>'actor'), ''), case who when 'github' then 'GitHub' else 'Claude Code' end), 200);

 case req->>'action'
 when 'list' then
  return jsonb_build_object(
   'products', (select jsonb_agg(jsonb_build_object('key', p.key, 'name', p.name, 'repo', p.repo) order by p.sort) from fc_private.tracker_products p),
   'items', coalesce((select jsonb_agg(jsonb_build_object('ref', 'FL-' || i.id, 'product', i.product, 'kind', i.kind, 'status', i.status, 'priority', i.priority, 'title', i.title) order by i.updated_at desc)
                      from fc_private.tracker_items i
                      where (nullif(req->>'product', '') is null or i.product = req->>'product')
                        and (nullif(req->>'status', '') is null or i.status = req->>'status')
                        and (coalesce((req->>'all')::boolean, false) or i.status not in ('fixed', 'rejected'))), '[]'));
 when 'add' then
  -- Claude Code works for Gibson, so its items start approved (or in progress).
  return fc_private.tracker_create(actor, coalesce(nullif(req->>'status', ''), 'approved'), 'claude', req);
 when 'update' then
  return fc_private.tracker_apply((req->>'item')::bigint, actor, true, req);
 when 'mention' then
  -- "FL-12" in a commit or pull request links it; "fixes FL-12" (fix/fixed/closes/resolves) marks it fixed.
  for m in select regexp_matches(coalesce(req->>'text', ''), '(?:\m(fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s+)?\mFL-(\d+)\M', 'gi') loop
   item := m[2]::bigint;
   continue when not exists (select 1 from fc_private.tracker_items where id = item);
   fixes := m[1] is not null and coalesce((req->>'merged')::boolean, false);
   perform fc_private.tracker_apply(item, actor, true, jsonb_build_object(
    'link', req->>'link', 'link_label', req->>'link_label',
    'status', case when fixes then 'fixed'
                   when (select status from fc_private.tracker_items where id = item) in ('review', 'approved') then 'in_progress' end));
   touched := touched || to_jsonb('FL-' || item);
  end loop;
  return jsonb_build_object('touched', touched);
 else
  raise exception 'Unknown action %', req->>'action';
 end case;
end $$;

revoke all on function fc_private.tracker_me(), fc_private.tracker_item_json(fc_private.tracker_items), fc_private.tracker_add_link(bigint, text, text),
 fc_private.tracker_apply(bigint, text, boolean, jsonb), fc_private.tracker_create(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fc_tracker(), public.fc_tracker_submit(jsonb), public.fc_tracker_update(bigint, jsonb), public.fc_tracker_report(text, jsonb) from public, anon, authenticated;
grant execute on function public.fc_tracker(), public.fc_tracker_submit(jsonb), public.fc_tracker_update(bigint, jsonb) to authenticated;
grant execute on function public.fc_tracker_report(text, jsonb) to anon, authenticated;
