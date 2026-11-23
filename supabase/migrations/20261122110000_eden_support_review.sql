begin;

create table clinic_operations_private.support_changes (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references clinic_operations_private.support_grants(id),
  before_values jsonb not null,
  proposed_values jsonb not null,
  proposed_at timestamptz not null default clock_timestamp(),
  decision text not null default 'pending' check (decision in ('pending','approved','dismissed','undone')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  undone_by uuid references auth.users(id),
  undone_at timestamptz
);
create index support_changes_grant on clinic_operations_private.support_changes(grant_id, proposed_at);
alter table clinic_operations_private.support_changes enable row level security;
revoke all on table clinic_operations_private.support_changes from public, anon, authenticated;

create function clinic_operations_private.active_support_grant(p_grant uuid)
returns clinic_operations_private.support_grants
language plpgsql set search_path = '' as $$
declare g clinic_operations_private.support_grants;
begin
  select sg.* into g from clinic_operations_private.support_grants sg
    join clinic_operations_private.operators o on o.user_id=sg.operator_id
    where sg.id=p_grant and sg.operator_id=auth.uid() and o.active
      and sg.revoked_at is null for share of sg,o;
  if not found or g.expires_at<=clock_timestamp() then
    raise exception 'This support grant is unavailable or expired' using errcode='42501';
  end if;
  return g;
end $$;

-- Keep the existing read endpoint and close the former immediate-write path.
create or replace function public.eden_support_messenger_facts(p_grant uuid,p_facts jsonb default null,p_expected jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g clinic_operations_private.support_grants; facts jsonb;
begin
  g:=clinic_operations_private.active_support_grant(p_grant);
  if p_facts is not null then
    raise exception 'Send Messenger changes for clinic owner approval. Refresh the workspace to continue.' using errcode='42501';
  end if;
  select jsonb_build_object('services',l.messenger_facts->'services','hours',l.messenger_facts->'hours',
    'address',l.messenger_facts->'address','bookingRules',l.messenger_facts->'bookingRules')
    into facts from public.clinic_locations l where l.id=g.location_id;
  insert into clinic_operations_private.support_activity(grant_id,actor_id,action) values(p_grant,auth.uid(),'opened');
  return facts;
end $$;

create function public.eden_propose_support_change(p_grant uuid,p_changes jsonb,p_expected jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare g clinic_operations_private.support_grants; facts jsonb; old_values jsonb; proposed_id uuid;
begin
  g:=clinic_operations_private.active_support_grant(p_grant);
  if g.scope<>'messenger_facts' then
    raise exception 'This support grant only permits reading' using errcode='42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes)<>'object' or p_changes='{}'::jsonb
    or p_changes - array['services','hours','address','bookingRules'] <> '{}'::jsonb then
    raise exception 'Choose at least one Messenger fact to change' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_each(p_changes) f where jsonb_typeof(f.value)<>'string'
    or length(btrim(f.value #>> '{}')) not between 1 and 900) then
    raise exception 'Enter 1–900 characters for each changed fact' using errcode='22023';
  end if;
  select coalesce(l.messenger_facts,'{}'::jsonb) into facts from public.clinic_locations l
    where l.id=g.location_id for update;
  if g.expires_at<=clock_timestamp() then
    raise exception 'Support grant expired' using errcode='42501';
  end if;
  if exists(select 1 from jsonb_object_keys(p_changes) k(key)
    where coalesce(facts->k.key,'null'::jsonb) is distinct from p_expected->k.key) then
    raise exception 'Clinic facts changed. Reopen the location before proposing again.' using errcode='40001';
  end if;
  select jsonb_object_agg(f.key,btrim(f.value)),jsonb_object_agg(f.key,facts->f.key)
    into p_changes,old_values from jsonb_each_text(p_changes) f
    where to_jsonb(btrim(f.value)) is distinct from coalesce(facts->f.key,'null'::jsonb);
  if p_changes is null then raise exception 'No Messenger facts changed' using errcode='22023'; end if;

  -- Retrying an identical pending proposal returns its existing ID.
  select c.id into proposed_id from clinic_operations_private.support_changes c
    where c.grant_id=p_grant and c.decision='pending' and c.before_values=old_values and c.proposed_values=p_changes limit 1;
  if found then return proposed_id; end if;
  insert into clinic_operations_private.support_changes(grant_id,before_values,proposed_values)
    values(p_grant,old_values,p_changes) returning id into proposed_id;
  return proposed_id;
end $$;

create function public.eden_support_changes(p_location uuid)
returns table(id uuid,operator_email text,before_values jsonb,proposed_values jsonb,
  proposed_at timestamptz,decision text,reviewed_at timestamptz,undone_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not clinic_operations_private.is_owner(p_location) then
    raise exception 'Clinic owner access required' using errcode='42501';
  end if;
  return query select c.id,u.email::text,c.before_values,c.proposed_values,c.proposed_at,c.decision,c.reviewed_at,c.undone_at
    from clinic_operations_private.support_changes c
    join clinic_operations_private.support_grants g on g.id=c.grant_id
    join auth.users u on u.id=g.operator_id
    where g.location_id=p_location
    order by (c.decision='pending') desc,c.proposed_at desc,c.id desc;
end $$;

create function public.eden_review_support_change(p_location uuid,p_change uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c clinic_operations_private.support_changes; facts jsonb; expected jsonb; replacement jsonb;
  field_name text; new_value jsonb; fields text[];
begin
  if not clinic_operations_private.is_owner(p_location) then
    raise exception 'Clinic owner approval required' using errcode='42501';
  end if;
  if p_action is null or p_action not in ('approve','dismiss','undo') then
    raise exception 'Choose approve, dismiss or undo' using errcode='22023';
  end if;
  select c1.* into c from clinic_operations_private.support_changes c1
    join clinic_operations_private.support_grants g on g.id=c1.grant_id
    where c1.id=p_change and g.location_id=p_location for update of c1;
  if not found then raise exception 'Support change unavailable for this location' using errcode='42501'; end if;
  if (c.decision,p_action) in (('approved','approve'),('dismissed','dismiss'),('undone','undo')) then
    if p_action='dismiss' then return null; end if;
    return (select l.messenger_facts from public.clinic_locations l where l.id=p_location);
  end if;
  if (p_action='undo' and c.decision<>'approved') or (p_action<>'undo' and c.decision<>'pending') then
    raise exception 'This support change has already been reviewed' using errcode='22023';
  end if;
  if p_action='dismiss' then
    update clinic_operations_private.support_changes set decision='dismissed',reviewed_by=auth.uid(),reviewed_at=clock_timestamp() where id=p_change;
    return null;
  end if;

  expected:=case when p_action='undo' then c.proposed_values else c.before_values end;
  replacement:=case when p_action='undo' then c.before_values else c.proposed_values end;
  select coalesce(l.messenger_facts,'{}'::jsonb) into facts from public.clinic_locations l
    where l.id=p_location for update;
  if exists(select 1 from jsonb_each(expected) f where f.value is distinct from coalesce(facts->f.key,'null'::jsonb)) then
    raise exception 'A reviewed field has changed since this proposal. Review the current Messenger facts before making another change.' using errcode='40001';
  end if;
  for field_name,new_value in select f.key,f.value from jsonb_each(replacement) f loop
    facts:=case when new_value='null'::jsonb then facts - field_name
      else jsonb_set(facts,array[field_name],new_value) end;
  end loop;
  facts:=facts || jsonb_build_object('profileApprovedAt',clock_timestamp());
  update public.clinic_locations set messenger_facts=facts where id=p_location;
  if p_action='undo' then
    update clinic_operations_private.support_changes set decision='undone',undone_by=auth.uid(),undone_at=clock_timestamp() where id=p_change;
  else
    update clinic_operations_private.support_changes set decision='approved',reviewed_by=auth.uid(),reviewed_at=clock_timestamp() where id=p_change;
    select array_agg(k.key order by k.key) into fields from jsonb_object_keys(replacement) k(key);
    insert into clinic_operations_private.support_activity(grant_id,actor_id,action,changed_fields)
      values(c.grant_id,auth.uid(),'messenger_facts_changed',fields);
  end if;
  return facts;
end $$;

-- Allowlisted configuration state only. Connection update time is not a health probe.
create function public.eden_support_diagnostics(p_grant uuid)
returns table(channel text,status text,updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare g clinic_operations_private.support_grants;
begin
  g:=clinic_operations_private.active_support_grant(p_grant);
  return query select c.channel,c.status,c.updated_at from public.clinic_channel_connections c
    where c.location_id=g.location_id and c.channel in ('website_chat','facebook_messenger','ai_phone')
    order by c.channel;
end $$;

revoke all on function clinic_operations_private.active_support_grant(uuid) from public,anon,authenticated;
revoke all on function public.eden_propose_support_change(uuid,jsonb,jsonb),public.eden_support_changes(uuid),
  public.eden_review_support_change(uuid,uuid,text),public.eden_support_diagnostics(uuid) from public,anon,authenticated;
grant execute on function public.eden_propose_support_change(uuid,jsonb,jsonb),public.eden_support_changes(uuid),
  public.eden_review_support_change(uuid,uuid,text),public.eden_support_diagnostics(uuid) to authenticated;

commit;
