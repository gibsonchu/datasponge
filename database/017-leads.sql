-- 017: Leads. Page views on Local Help and the calls, website visits, and
-- emails it sends to listed partners, kept in one place for every FloodLine
-- product (Local Help, Blue Dots Urgent, Blue Dots).
--
--  * fc_log_lead(text): Local Help sends one event as a plain-text JSON body
--    (navigator.sendBeacon). Anyone may call it; it only ever inserts.
--  * fc_lead_report(days): totals, leads by partner, and recent leads for the
--    Editor's Leads tab. Members only.
--  * fc_leads_for(via, days): the raw events that came through one product, for
--    that product's own admin (which knows who its refs belong to). Server
--    keys only.
--
-- No names, phone numbers, or emails are stored here. A visitor is a random id
-- kept in their browser; `ref` is a random id issued by the product that sent
-- them (e.g. Blue Dots Urgent's /go/local-help), and only that product can tell
-- who it belongs to.

create table fc_private.lead_events(
 id bigint generated always as identity primary key,
 at timestamptz not null default now(),
 site text not null default 'local-help' check (site in ('local-help')),
 type text not null check (type in ('page_view', 'outbound_click')),
 visitor_id text not null check (visitor_id ~ '^[A-Za-z0-9_-]{8,64}$'),
 via text check (via in ('bdu', 'bdu_sms', 'bluedots')),
 ref text check (ref ~ '^[A-Za-z0-9_-]{8,64}$'),
 listing_id text check (length(listing_id) <= 200),
 listing_name text check (length(listing_name) <= 200),
 link_kind text check (link_kind in ('phone', 'website', 'email', 'other')),
 link_url text check (length(link_url) <= 500),
 borough text check (length(borough) <= 40),
 audience text check (length(audience) <= 40),
 need text check (length(need) <= 40),
 search text check (length(search) <= 120),
 referrer text check (length(referrer) <= 200)
);
create index lead_events_at_idx on fc_private.lead_events (at desc);
create index lead_events_listing_idx on fc_private.lead_events (listing_id, at desc);
create index lead_events_via_idx on fc_private.lead_events (via, at desc);
alter table fc_private.lead_events enable row level security;

-- A single unnamed text argument lets PostgREST take a text/plain body, which a
-- beacon can send without a CORS preflight.
create function public.fc_log_lead(text) returns void language plpgsql security definer set search_path='' as $$
declare
 p jsonb;
 s text := '^[A-Za-z0-9_-]{8,64}$';
 clip text := '';
begin
 begin p := $1::jsonb; exception when others then raise exception 'Not JSON'; end;
 if jsonb_typeof(p) <> 'object' then raise exception 'Not an event'; end if;
 if (select count(*) from fc_private.lead_events where at > now() - interval '1 minute') >= 1000 then
  raise exception 'Too many events right now.';
 end if;
 insert into fc_private.lead_events(type, visitor_id, via, ref, listing_id, listing_name, link_kind, link_url, borough, audience, need, search, referrer)
 values (
  p->>'type',
  p->>'visitor_id',
  nullif(p->>'via', ''),
  case when p->>'ref' ~ s then p->>'ref' end,
  left(nullif(p->>'listing_id', ''), 200),
  left(nullif(trim(p->>'listing_name'), ''), 200),
  nullif(p->>'link_kind', ''),
  left(nullif(p->>'link_url', ''), 500),
  left(nullif(p->>'borough', ''), 40),
  left(nullif(p->>'audience', ''), 40),
  left(nullif(p->>'need', ''), 40),
  left(nullif(trim(p->>'search'), ''), 120),
  left(nullif(p->>'referrer', ''), 200));
end $$;

-- Who a row stands for: the product's ref when there is one, else the browser.
create function fc_private.lead_person(e fc_private.lead_events) returns text language sql immutable set search_path='' as $$
 select coalesce('r:' || e.via || ':' || e.ref, 'v:' || e.visitor_id)
$$;

create function public.fc_lead_report(days integer default 30) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(days, 366)));
begin
 if not fc_private.is_member() then raise exception 'Members only'; end if;
 return jsonb_build_object(
  'totals', (
   select jsonb_build_object(
    'views', count(*) filter (where e.type = 'page_view'),
    'visitors', count(distinct fc_private.lead_person(e)),
    'leads', count(*) filter (where e.type = 'outbound_click'),
    'leaders', count(distinct fc_private.lead_person(e)) filter (where e.type = 'outbound_click'),
    'by_via', (select coalesce(jsonb_object_agg(v, n), '{}') from (
      select coalesce(x.via, 'direct') v, count(distinct fc_private.lead_person(x)) n from fc_private.lead_events x where x.at > since group by 1) t))
   from fc_private.lead_events e where e.at > since),
  'partners', (
   select coalesce(jsonb_agg(row_to_json(t) order by t.total desc, t.name), '[]') from (
    select coalesce(max(e.listing_name), max(e.link_url), 'Unknown') as name, max(e.listing_id) as listing_id,
     count(*) filter (where e.link_kind = 'phone') as calls,
     count(*) filter (where e.link_kind = 'website') as sites,
     count(*) filter (where e.link_kind = 'email') as emails,
     count(*) as total,
     count(distinct fc_private.lead_person(e)) as people,
     count(distinct fc_private.lead_person(e)) filter (where e.via is not null) as via_products,
     max(e.at) as last_at
    from fc_private.lead_events e where e.at > since and e.type = 'outbound_click'
    group by coalesce(e.listing_id, e.link_url) limit 500) t),
  'recent', (
   select coalesce(jsonb_agg(row_to_json(t)), '[]') from (
    select e.at, e.listing_name, e.link_kind, e.link_url, e.via, e.ref is not null as has_ref, left(e.visitor_id, 6) as visitor,
     e.borough, e.need, e.search, e.referrer
    from fc_private.lead_events e where e.at > since and e.type = 'outbound_click' order by e.at desc limit 200) t));
end $$;

-- For a product's own admin: everything that came through it, refs included.
create function public.fc_leads_for(source text, days integer default 30) returns setof fc_private.lead_events language sql stable security definer set search_path='' as $$
 select * from fc_private.lead_events
 where at > now() - make_interval(days => greatest(1, least(days, 366)))
   and (via = source or (source = 'bdu' and via = 'bdu_sms'))
 order by at desc limit 5000
$$;

revoke all on function public.fc_log_lead(text), public.fc_lead_report(integer), public.fc_leads_for(text, integer), fc_private.lead_person(fc_private.lead_events)
 from public, anon, authenticated;
grant execute on function public.fc_log_lead(text) to anon, authenticated;
grant execute on function public.fc_lead_report(integer), fc_private.lead_person(fc_private.lead_events) to authenticated;
grant execute on function public.fc_leads_for(text, integer) to service_role;
