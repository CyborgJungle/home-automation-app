-- Supabase pauses free projects after a week without enough user database
-- activity. The Pi's heartbeat normally covers that, but if the Pi or the
-- internet at home is down (say, during a holiday), Vercel still calls
-- keepalive() once a day (web/app/api/keepalive), which writes a row.

create table public.keepalive (
  id smallint primary key default 1 check (id = 1),
  pinged_at timestamptz not null default now(),
  pings bigint not null default 0
);
-- No policies: only the function below touches it.
alter table public.keepalive enable row level security;
insert into public.keepalive default values;

-- Callable without signing in, but all it can do is bump a timestamp.
create function public.keepalive()
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  update public.keepalive set pinged_at = now(), pings = pings + 1 where id = 1 returning pinged_at;
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
