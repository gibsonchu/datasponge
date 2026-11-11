-- 018: Analytics for every FloodLine site in one place, for the Editor's
-- Analytics tab (team only).
--
--  * site_events: important actions as they happen (sign-ups, chats started,
--    flood reports, assessment requests, solution submissions). Sites and their
--    servers call fc_log_event(text) with one JSON event. Anyone may call it;
--    it only ever inserts. Like leads (017), no names, phones, or emails: a
--    product's random ref at most.
--  * traffic_daily: a daily summary copied from Google Analytics (all sites
--    share one property) by Blue Dots' scheduled traffic-to-datasponge
--    function through fc_save_traffic (server keys only).
--  * fc_dashboard(days): traffic, actions, and leads together. Members only.

create table fc_private.site_events(
 id bigint generated always as identity primary key,
 at timestamptz not null default now(),
 site text not null check (site in ('local-help', 'bdu', 'bluedots')),
 name text not null check (name ~ '^[a-z][a-z0-9_]{2,40}$'),
 detail text check (length(detail) <= 200),
 visitor_id text check (visitor_id ~ '^[A-Za-z0-9_:-]{8,80}$'),
 ref text check (ref ~ '^[A-Za-z0-9_-]{8,64}$')
);
create index site_events_at_idx on fc_private.site_events (at desc);
create index site_events_name_idx on fc_private.site_events (site, name, at desc);
alter table fc_private.site_events enable row level security;

create function public.fc_log_event(text) returns void language plpgsql security definer set search_path='' as $$
declare p jsonb;
begin
 begin p := $1::jsonb; exception when others then raise exception 'Not JSON'; end;
 if jsonb_typeof(p) <> 'object' then raise exception 'Not an event'; end if;
 if (select count(*) from fc_private.site_events where at > now() - interval '1 minute') >= 1000 then
  raise exception 'Too many events right now.';
 end if;
 insert into fc_private.site_events(site, name, detail, visitor_id, ref)
 values (p->>'site', p->>'name', left(nullif(trim(p->>'detail'), ''), 200), nullif(p->>'visitor_id', ''),
  case when p->>'ref' ~ '^[A-Za-z0-9_-]{8,64}$' then p->>'ref' end);
end $$;

create table fc_private.traffic_daily(
 day date not null,
 site text not null check (site in ('local-help', 'bdu', 'bluedots')),
 metric text not null check (metric in ('visitors', 'visits', 'views', 'page', 'source', 'event')),
 label text not null default '' check (length(label) <= 300),
 value numeric not null,
 primary key (day, site, metric, label)
);
alter table fc_private.traffic_daily enable row level security;

-- rows: [{day, site, metric, label, value}]. A day's rows replace that day's earlier copy.
create function public.fc_save_traffic(rows jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 delete from fc_private.traffic_daily t
  where (t.day, t.site) in (select distinct (r->>'day')::date, r->>'site' from jsonb_array_elements(rows) r);
 insert into fc_private.traffic_daily(day, site, metric, label, value)
 select (r->>'day')::date, r->>'site', r->>'metric', left(coalesce(r->>'label', ''), 300), (r->>'value')::numeric
 from jsonb_array_elements(rows) r
 on conflict (day, site, metric, label) do update set value = excluded.value;
 get diagnostics n = row_count;
 return n;
end $$;

create function public.fc_dashboard(days integer default 30) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 since timestamptz := now() - make_interval(days => greatest(1, least(days, 366)));
 since_day date := (now() at time zone 'America/New_York')::date - greatest(1, least(days, 366));
begin
 if not fc_private.is_member() then raise exception 'Members only'; end if;
 return jsonb_build_object(
  'traffic_through', (select max(day) from fc_private.traffic_daily),
  'traffic', (
   select coalesce(jsonb_agg(row_to_json(t) order by t.site), '[]') from (
    select site,
     sum(value) filter (where metric = 'visits') as visits,
     sum(value) filter (where metric = 'views') as views,
     sum(value) filter (where metric = 'visitors') as daily_visitors
    from fc_private.traffic_daily where day > since_day group by site) t),
  'daily', (
   select coalesce(jsonb_agg(row_to_json(t) order by t.day, t.site), '[]') from (
    select day, site, sum(value) as visits from fc_private.traffic_daily
    where day > since_day and metric = 'visits' group by day, site) t),
  'pages', (
   select coalesce(jsonb_agg(row_to_json(t)), '[]') from (
    select site, label, total from (
     select site, label, sum(value) as total, row_number() over (partition by site order by sum(value) desc) as n
     from fc_private.traffic_daily where day > since_day and metric = 'page' group by site, label) x
    where n <= 8 order by site, total desc) t),
  'sources', (
   select coalesce(jsonb_agg(row_to_json(t)), '[]') from (
    select site, label, total from (
     select site, label, sum(value) as total, row_number() over (partition by site order by sum(value) desc) as n
     from fc_private.traffic_daily where day > since_day and metric = 'source' group by site, label) x
    where n <= 6 order by site, total desc) t),
  'actions', (
   select coalesce(jsonb_agg(row_to_json(t) order by t.site, t.total desc), '[]') from (
    select site, name, count(*) as total, max(at) as last_at
    from fc_private.site_events where at > since group by site, name) t));
end $$;

revoke all on function public.fc_log_event(text), public.fc_save_traffic(jsonb), public.fc_dashboard(integer) from public, anon, authenticated;
grant execute on function public.fc_log_event(text) to anon, authenticated;
grant execute on function public.fc_dashboard(integer) to authenticated;
grant execute on function public.fc_save_traffic(jsonb) to service_role;
