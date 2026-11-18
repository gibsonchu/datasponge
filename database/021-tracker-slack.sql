-- 021: Slack reports in the tracker. The FloodLine bug bot gets its own key
-- (named "slack", added outside this file); its items are marked as coming from
-- Slack. Admins (and the keyed tools) can also move an item to another product,
-- since the bot only learns the product when Gibson picks it.

create or replace function fc_private.tracker_apply(item bigint, actor text, admin boolean, req jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 cur fc_private.tracker_items;
 new_status text := nullif(req->>'status', '');
 new_priority text := nullif(req->>'priority', '');
 note text := nullif(trim(req->>'note'), '');
 new_product text := nullif(req->>'product', '');
 labels constant jsonb := '{"review":"For review","approved":"Approved","in_progress":"In progress","fixed":"Fixed","rejected":"Rejected"}';
begin
 select * into cur from fc_private.tracker_items where id = item for update;
 if cur.id is null then raise exception 'There is no FL-%.', item; end if;
 if (new_status is not null and new_status <> cur.status) or (new_priority is not null and new_priority <> cur.priority) then
  if not admin then raise exception 'Only an admin can change status or priority.' using errcode = '42501'; end if;
 end if;
 if new_product is not null and new_product <> cur.product then
  if not admin then raise exception 'Only an admin can change the product.' using errcode = '42501'; end if;
  update fc_private.tracker_items set product = new_product, updated_at = now() where id = item;
  insert into fc_private.tracker_events(item_id, actor, what)
   values (item, actor, 'Product: ' || (select name from fc_private.tracker_products where key = new_product));
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

create or replace function public.fc_tracker_report(key text, req jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 actor := left(coalesce(nullif(trim(req->>'actor'), ''), case who when 'github' then 'GitHub' when 'slack' then 'Slack' else 'Claude Code' end), 200);

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
  -- Slack reports come from the team, so the bug bot sends them in as "review".
  return fc_private.tracker_create(actor, coalesce(nullif(req->>'status', ''), 'approved'),
   case who when 'slack' then 'slack' when 'github' then 'github' else 'claude' end, req);
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
