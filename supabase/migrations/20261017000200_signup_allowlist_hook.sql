-- Google sign-in creates the account on first login, so sign-ups have to stay
-- enabled. This "Before User Created" auth hook rejects any email that isn't on
-- the household allowlist, so strangers can't even create an account.
--
-- Enable it once in the dashboard: Authentication -> Hooks -> Before User Created
-- -> Postgres -> public.hook_allowlist_signup

create function public.hook_allowlist_signup(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.allowed_emails
    where email = lower(coalesce(event -> 'user' ->> 'email', ''))
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This account is not on the household list.'
    )
  );
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_allowlist_signup(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_allowlist_signup(jsonb) from authenticated, anon, public;

grant select on table public.allowed_emails to supabase_auth_admin;
create policy "auth server reads allowlist"
  on public.allowed_emails for select
  to supabase_auth_admin
  using (true);
