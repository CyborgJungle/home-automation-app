-- Lets the web app tell a signed-in user that their email isn't on the
-- household list (instead of showing an empty dashboard).
create function public.am_i_member()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.is_member();
$$;

revoke all on function public.am_i_member() from public, anon;
grant execute on function public.am_i_member() to authenticated;
