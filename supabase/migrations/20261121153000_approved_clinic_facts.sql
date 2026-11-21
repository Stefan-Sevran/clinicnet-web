begin;

-- Messenger already reads these location facts. Preserve its language and booking mode.
alter table public.clinic_locations add column if not exists messenger_facts jsonb;

create or replace function public.workspace_clinic_facts(
  p_location uuid, p_facts jsonb default null, p_expected jsonb default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  current_facts jsonb;
  approved_facts jsonb;
  field text;
  value text;
begin
  select l.messenger_facts into current_facts
    from public.clinic_locations l
    where l.id = p_location and exists (
      select 1 from public.clinic_memberships m
      where m.account_id = l.account_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
    );
  if not found then
    raise exception 'Clinic profile is unavailable.' using errcode = '42501';
  end if;
  if p_facts is null then
    return current_facts;
  end if;
  if jsonb_typeof(p_facts) <> 'object' then
    raise exception 'Expected clinic facts.' using errcode = '22023';
  end if;
  approved_facts := case when jsonb_typeof(current_facts) = 'object' then current_facts else '{}'::jsonb end;
  foreach field in array array['services', 'hours', 'address', 'bookingRules'] loop
    value := btrim(p_facts ->> field);
    if jsonb_typeof(p_facts -> field) is distinct from 'string' or coalesce(length(value), 0) not between 1 and 900 then
      raise exception 'Enter 1–900 characters for each clinic fact.' using errcode = '22023';
    end if;
    approved_facts := approved_facts || jsonb_build_object(field, value);
  end loop;
  approved_facts := approved_facts || jsonb_build_object('profileApprovedAt', now());
  update public.clinic_locations l set messenger_facts = approved_facts
    where l.id = p_location and l.messenger_facts is not distinct from p_expected and exists (
      select 1 from public.clinic_memberships m
      where m.account_id = l.account_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
    );
  if not found then
    raise exception 'Clinic facts changed. Reload before approving.' using errcode = '40001';
  end if;
  return approved_facts;
end;
$$;
revoke all on function public.workspace_clinic_facts(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.workspace_clinic_facts(uuid, jsonb, jsonb) to authenticated;

commit;
