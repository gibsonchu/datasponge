-- One person across Blue Dots products (Blue Dots profile, gibsonchu/bluedots-profile).
--
-- Products now send a person's Blue Dots stand-in code as the lead's ref, the same code in
-- every product. A ref used to count once per product ('r:<product>:<ref>'); now a ref is
-- one person wherever it came from. Older refs were random per product, so they can't
-- collide and their counts don't change.
create or replace function fc_private.lead_person(e fc_private.lead_events) returns text language sql immutable set search_path='' as $$
 select coalesce('r:' || e.ref, 'v:' || e.visitor_id)
$$;
