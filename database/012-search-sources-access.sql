-- 012: anyone can search source passages (Flood Chat uses the publishable key).
-- Anonymous callers have no access to the fc_private schema, so the public
-- wrapper runs with its owner's rights instead of the caller's. It still only
-- returns passages from sources that have been read.
create or replace function public.fc_search_sources(q text, max_results integer default 8)
 returns table(source_id uuid, title text, publisher text, url text, heading text, passage text, score real)
 language sql stable security definer set search_path='' as $$ select * from fc_private.search_sources(q, max_results); $$;
revoke all on function public.fc_search_sources(text,integer) from public;
grant execute on function public.fc_search_sources(text,integer) to anon, authenticated;
revoke execute on function fc_private.search_sources(text,integer) from anon;
