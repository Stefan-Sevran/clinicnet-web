begin;

alter table clinic_operations_private.support_grants drop constraint support_grants_scope_check,
  add constraint support_grants_scope_check check (scope in ('read','messenger_facts','website_chat','ai_phone','staff_alert'));
alter table clinic_operations_private.support_changes add column target text not null default 'messenger_facts'
  check (target in ('messenger_facts','website_chat','ai_phone','staff_alert'));

create or replace function public.eden_grant_support(p_location uuid,p_operator_email text,p_scope text,p_hours integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare operator_id uuid; grant_id uuid;
begin
  if not clinic_operations_private.is_owner(p_location) then
    raise exception 'Clinic owner approval required' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('read','messenger_facts','website_chat','ai_phone','staff_alert') or p_hours is null or p_hours not between 1 and 24 then
    raise exception 'Choose a support area and 1 to 24 hours' using errcode = '22023';
  end if;
  select o.user_id into operator_id from clinic_operations_private.operators o
    join auth.users u on u.id = o.user_id
    where o.active and lower(u.email) = lower(btrim(p_operator_email)) and u.email_confirmed_at is not null;
  if not found then raise exception 'Eden support identity unavailable' using errcode = '22023'; end if;
  insert into clinic_operations_private.support_grants(location_id,operator_id,approved_by,scope,expires_at)
    values(p_location,operator_id,auth.uid(),p_scope,clock_timestamp() + make_interval(hours => p_hours))
    returning id into grant_id;
  insert into clinic_operations_private.support_activity(grant_id,actor_id,action) values(grant_id,auth.uid(),'granted');
  return grant_id;
end $$;

create or replace function public.eden_support_messenger_facts(p_grant uuid,p_facts jsonb default null,p_expected jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g clinic_operations_private.support_grants; facts jsonb;
begin
  g:=clinic_operations_private.active_support_grant(p_grant);
  if g.scope not in ('read','messenger_facts') then
    raise exception 'This grant is for another support area' using errcode='42501';
  end if;
  if p_facts is not null then
    raise exception 'Send Messenger changes for clinic owner approval. Refresh the workspace to continue.' using errcode='42501';
  end if;
  select jsonb_build_object('services',l.messenger_facts->'services','hours',l.messenger_facts->'hours',
    'address',l.messenger_facts->'address','bookingRules',l.messenger_facts->'bookingRules')
    into facts from public.clinic_locations l where l.id=g.location_id;
  insert into clinic_operations_private.support_activity(grant_id,actor_id,action) values(p_grant,auth.uid(),'opened');
  return facts;
end $$;

create or replace function public.eden_support_changes(p_location uuid)
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
    where g.location_id=p_location and c.target='messenger_facts'
    order by (c.decision='pending') desc,c.proposed_at desc,c.id desc;
end $$;

create or replace function public.eden_review_support_change(p_location uuid,p_change uuid,p_action text)
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
    where c1.id=p_change and g.location_id=p_location and c1.target='messenger_facts' for update of c1;
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

create table clinic_operations_private.support_requests (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.clinic_locations(id),
  operator_id uuid not null references clinic_operations_private.operators(user_id),
  scope text not null check(scope in ('read','messenger_facts','website_chat','ai_phone','staff_alert')),
  created_at timestamptz not null default clock_timestamp(),
  decision text not null default 'pending' check(decision in ('pending','approved','dismissed')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz
);
create unique index support_requests_pending on clinic_operations_private.support_requests(location_id,operator_id,scope)
  where decision='pending';
alter table clinic_operations_private.support_requests enable row level security;
revoke all on table clinic_operations_private.support_requests from public,anon,authenticated;

-- An existing finance assignment or active support grant establishes the location relationship.
create function clinic_operations_private.requestable_locations()
returns table(location_id uuid)
language sql set search_path = '' as $$
  select f.location_id from clinic_operations_private.finance_locations f
    join clinic_operations_private.operators o on o.user_id=f.user_id where o.active and f.user_id=auth.uid()
  union
  select g.location_id from clinic_operations_private.support_grants g
    join clinic_operations_private.operators o on o.user_id=g.operator_id
    where o.active and g.operator_id=auth.uid() and g.revoked_at is null and g.expires_at>clock_timestamp();
$$;

create function public.eden_support_request_locations()
returns table(location_id uuid,account_name text,location_name text)
language sql security definer set search_path = '' as $$
  select l.id,a.name,l.name from clinic_operations_private.requestable_locations() r
    join public.clinic_locations l on l.id=r.location_id
    join public.clinic_accounts a on a.id=l.account_id order by a.name,l.name;
$$;

create function public.eden_request_support(p_location uuid,p_scope text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
begin
  if not exists(select 1 from clinic_operations_private.requestable_locations() r where r.location_id=p_location) then
    raise exception 'This location is unavailable for support requests' using errcode='42501';
  end if;
  if exists (select 1 from clinic_operations_private.support_grants g where g.location_id=p_location
    and g.operator_id=auth.uid() and g.scope=p_scope and g.revoked_at is null and g.expires_at>clock_timestamp()) then
    raise exception 'You already have active access for this area' using errcode='22023';
  end if;
  insert into clinic_operations_private.support_requests(location_id,operator_id,scope)
    values(p_location,auth.uid(),p_scope)
    on conflict(location_id,operator_id,scope) where decision='pending'
    do update set scope=excluded.scope returning id into request_id;
  return request_id;
end $$;

create function public.eden_review_support_request(p_location uuid,p_request uuid,p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare r clinic_operations_private.support_requests; support_grant uuid; decision_name text;
begin
  if not clinic_operations_private.is_owner(p_location) then
    raise exception 'Clinic owner approval required' using errcode='42501';
  end if;
  if p_approve is null then raise exception 'Choose approve or dismiss' using errcode='22023'; end if;
  select * into r from clinic_operations_private.support_requests
    where id=p_request and location_id=p_location for update;
  if not found then raise exception 'Support request unavailable for this location' using errcode='42501'; end if;
  decision_name:=case when p_approve then 'approved' else 'dismissed' end;
  if r.decision=decision_name then return; end if;
  if r.decision<>'pending' then raise exception 'This access request has already been reviewed' using errcode='22023'; end if;
  if p_approve then
    insert into clinic_operations_private.support_grants(location_id,operator_id,approved_by,scope,expires_at)
      select p_location,o.user_id,auth.uid(),r.scope,clock_timestamp()+interval '1 hour'
        from clinic_operations_private.operators o join auth.users u on u.id=o.user_id
        where o.user_id=r.operator_id and o.active and u.email_confirmed_at is not null
      returning id into support_grant;
    if not found then raise exception 'Eden support identity unavailable' using errcode='22023'; end if;
    insert into clinic_operations_private.support_activity(grant_id,actor_id,action)
      values(support_grant,auth.uid(),'granted');
  end if;
  update clinic_operations_private.support_requests set decision=decision_name,
    reviewed_by=auth.uid(),reviewed_at=clock_timestamp() where id=p_request;
end $$;

-- Website Chat and AI Phone use their own publishers. These proposals remain drafts;
-- approval records the decision and lets the owner carry the approved copy to the channel.
create function public.eden_support_draft_context(p_grant uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g clinic_operations_private.support_grants; recipient text;
begin
  g:=clinic_operations_private.active_support_grant(p_grant);
  if g.scope not in ('website_chat','ai_phone','staff_alert') then
    raise exception 'This grant does not permit channel drafts' using errcode='42501';
  end if;
  if g.scope='staff_alert' then
    select l.alert_email into recipient from public.clinic_locations l where l.id=g.location_id;
    return jsonb_build_object('alert_email',recipient);
  end if;
  return '{}'::jsonb;
end $$;

create function public.eden_propose_support_draft(p_grant uuid,p_draft jsonb,p_expected jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare g clinic_operations_private.support_grants; allowed text[]; old jsonb; recipient text; draft_id uuid;
begin
  g:=clinic_operations_private.active_support_grant(p_grant);
  allowed:=case g.scope when 'website_chat' then array['services','hours','address','common_answers','bookingRules','handoff']
    when 'ai_phone' then array['services','hours','address','common_answers','bookingRules','handoff','forwarding_carrier','forwarding_code']
    when 'staff_alert' then array['alert_email'] else null end;
  if allowed is null then raise exception 'This grant does not permit channel drafts' using errcode='42501'; end if;
  if p_draft is null or jsonb_typeof(p_draft)<>'object' or p_draft='{}'::jsonb or p_draft-allowed<>'{}'::jsonb then
    raise exception 'Choose at least one allowed field to propose' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_each(p_draft) f where jsonb_typeof(f.value)<>'string'
    or length(btrim(f.value #>> '{}')) not between 1 and 900) then
    raise exception 'Enter 1–900 characters for each proposed field' using errcode='22023';
  end if;
  select jsonb_object_agg(f.key,btrim(f.value)) into p_draft from jsonb_each_text(p_draft) f;
  if g.scope='ai_phone' and (p_draft ?| array['forwarding_carrier','forwarding_code']) then
    if not (p_draft ?& array['forwarding_carrier','forwarding_code'])
      or length(p_draft->>'forwarding_carrier')>100
      or (p_draft->>'forwarding_code') !~ '^[0-9*#+ ()-]{1,80}$'
      or (p_draft->>'forwarding_code') !~ '[0-9]' then
      raise exception 'Enter the carrier and a forwarding code using dial characters' using errcode='22023';
    end if;
  end if;
  select l.alert_email into recipient from public.clinic_locations l where l.id=g.location_id for update;
  if g.expires_at<=clock_timestamp() then raise exception 'Support grant expired' using errcode='42501'; end if;
  if g.scope='staff_alert' then
    old:=jsonb_build_object('alert_email',recipient);
    if old is distinct from p_expected then raise exception 'Staff alert email changed. Reopen the location.' using errcode='40001'; end if;
    if p_draft->>'alert_email' !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(p_draft->>'alert_email')>254 then
      raise exception 'Enter a valid staff alert email' using errcode='22023';
    end if;
    if old=p_draft then raise exception 'The staff alert email has not changed' using errcode='22023'; end if;
  else
    old:='{}'::jsonb;
  end if;
  select c.id into draft_id from clinic_operations_private.support_changes c where c.grant_id=p_grant
    and c.target=g.scope and c.decision='pending' and c.before_values=old and c.proposed_values=p_draft limit 1;
  if found then return draft_id; end if;
  insert into clinic_operations_private.support_changes(grant_id,target,before_values,proposed_values)
    values(p_grant,g.scope,old,p_draft) returning id into draft_id;
  return draft_id;
end $$;

create function public.eden_review_support_draft(p_location uuid,p_change uuid,p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare c clinic_operations_private.support_changes; recipient text;
begin
  if not clinic_operations_private.is_owner(p_location) then
    raise exception 'Clinic owner approval required' using errcode='42501';
  end if;
  if p_approve is null then raise exception 'Choose approve or dismiss' using errcode='22023'; end if;
  select c1.* into c from clinic_operations_private.support_changes c1
    join clinic_operations_private.support_grants g on g.id=c1.grant_id
    where c1.id=p_change and g.location_id=p_location and c1.target<>'messenger_facts' for update of c1;
  if not found then raise exception 'Support draft unavailable for this location' using errcode='42501'; end if;
  if c.decision=(case when p_approve then 'approved' else 'dismissed' end) then return; end if;
  if c.decision<>'pending' then raise exception 'This draft has already been reviewed' using errcode='22023'; end if;
  if p_approve and c.target='staff_alert' then
    select alert_email into recipient from public.clinic_locations where id=p_location for update;
    if c.before_values is distinct from jsonb_build_object('alert_email',recipient) then
      raise exception 'Staff alert email changed. Review the current address before continuing.' using errcode='40001';
    end if;
  end if;
  update clinic_operations_private.support_changes set decision=case when p_approve then 'approved' else 'dismissed' end,
    reviewed_by=auth.uid(),reviewed_at=clock_timestamp() where id=p_change;
end $$;

create function public.eden_support_inbox(p_location uuid)
returns table(id uuid,kind text,target text,operator_email text,before_values jsonb,proposed_values jsonb,
  created_at timestamptz,decision text)
language plpgsql security definer set search_path = '' as $$
begin
  if not clinic_operations_private.is_owner(p_location) then
    raise exception 'Clinic owner access required' using errcode='42501';
  end if;
  return query
    select * from (
      select c.id,'change'::text as kind,c.target,u.email::text as operator_email,c.before_values,c.proposed_values,c.proposed_at as created_at,c.decision
        from clinic_operations_private.support_changes c join clinic_operations_private.support_grants g on g.id=c.grant_id
        join auth.users u on u.id=g.operator_id where g.location_id=p_location
      union all
      select r.id,'access',r.scope,u.email::text,null::jsonb,null::jsonb,r.created_at,r.decision
        from clinic_operations_private.support_requests r join auth.users u on u.id=r.operator_id where r.location_id=p_location
    ) items order by (items.decision='pending') desc,items.created_at desc,items.id desc;
end $$;

create function public.eden_support_notifications(p_location uuid)
returns table(id uuid,kind text,target text)
language sql security definer set search_path = '' as $$
  select c.id,'change'::text,c.target from clinic_operations_private.support_changes c
    join clinic_operations_private.support_grants g on g.id=c.grant_id
    where g.location_id=p_location and c.decision='pending' and clinic_operations_private.is_owner(p_location)
  union all
  select r.id,'access'::text,r.scope from clinic_operations_private.support_requests r
    where r.location_id=p_location and r.decision='pending' and clinic_operations_private.is_owner(p_location);
$$;

revoke all on function clinic_operations_private.requestable_locations() from public,anon,authenticated;
revoke all on function public.eden_support_request_locations(),public.eden_request_support(uuid,text),
  public.eden_review_support_request(uuid,uuid,boolean),public.eden_support_draft_context(uuid),
  public.eden_propose_support_draft(uuid,jsonb,jsonb),public.eden_review_support_draft(uuid,uuid,boolean),
  public.eden_support_inbox(uuid),public.eden_support_notifications(uuid) from public,anon,authenticated;
grant execute on function public.eden_support_request_locations(),public.eden_request_support(uuid,text),
  public.eden_review_support_request(uuid,uuid,boolean),public.eden_support_draft_context(uuid),
  public.eden_propose_support_draft(uuid,jsonb,jsonb),public.eden_review_support_draft(uuid,uuid,boolean),
  public.eden_support_inbox(uuid),public.eden_support_notifications(uuid) to authenticated;

commit;
