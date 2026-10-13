-- 016: Remove the retired Fixes list (014). Its nine fixes were moved into
-- Q/A in 015 and nothing reads it any more.
drop function if exists public.fc_fix_paths(), public.fc_save_fix_paths(jsonb, text), public.fc_set_fix_path_status(uuid, text), public.fc_published_fix_paths();
drop function if exists fc_private.list_fix_paths(), fc_private.save_fix_paths(jsonb, text), fc_private.set_fix_path_status(uuid, text), fc_private.published_fix_paths();
drop table if exists fc_private.fix_paths;
