-- "Turn on for N minutes" keeps a light on while its trigger still holds. Only
-- ongoing rules count for that (device states like motion, weather, time
-- ranges); one-off moments (at a time, at sunset, a doorbell ring) are left
-- out, or "motion and 60 min before sunset" would never hold past that minute.
create or replace function private.automation_holds(a public.automations)
returns boolean language plpgsql security definer set search_path = '' as $$
declare grp jsonb; ongoing jsonb;
begin
  for grp in select value from jsonb_array_elements(case when a.trigger ->> 'type' = 'logic'
    then a.trigger -> 'groups' else jsonb_build_array(jsonb_build_array(a.trigger)) end) loop
    select coalesce(jsonb_agg(r), '[]'::jsonb) into ongoing
    from jsonb_array_elements(grp) r
    where r ->> 'type' in ('device', 'weather', 'time_range');
    if jsonb_array_length(ongoing) > 0
       and private.automation_group_value(ongoing, now(), jsonb_build_object('cause', 'timer'), false) is true then
      return true;
    end if;
  end loop;
  return false;
end;
$$;
