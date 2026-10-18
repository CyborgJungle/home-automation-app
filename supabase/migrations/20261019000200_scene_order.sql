-- Scenes in the order you drag them into on the Scenes page. New scenes go
-- last; reorder_scenes saves a whole new order in one go.
alter table public.scenes add column position int;

update public.scenes s set position = o.n
from (select id, row_number() over (order by created_at) - 1 as n from public.scenes) o
where o.id = s.id;

create function public.reorder_scenes(ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member() then
    raise exception 'Not allowed';
  end if;
  update public.scenes s set position = o.n - 1
  from unnest(ids) with ordinality as o(id, n)
  where s.id = o.id and s.position is distinct from o.n - 1;
end;
$$;

revoke all on function public.reorder_scenes(uuid[]) from public, anon;
grant execute on function public.reorder_scenes(uuid[]) to authenticated;
