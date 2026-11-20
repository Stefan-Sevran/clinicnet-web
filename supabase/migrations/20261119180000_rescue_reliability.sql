-- Keep visit and ledger rows intact. Apply the chronology rule to new links and
-- to report calculations. Approved snapshots retain their original evidence.
create function clinic_rescue_private.valid_attribution(src public.clinic_outcomes, visit_at timestamptz)
returns boolean
language sql immutable
set search_path = ''
as $$
  select (clinic_rescue_private.eligible(src) and src.occurred_at <= visit_at) is true
$$;

create function clinic_rescue_private.guard_attribution_chronology()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.appointment_at is not null and exists (
    select 1 from public.clinic_outcomes e
    where e.event_key = new.event_key and e.account_id = new.account_id and e.location_id = new.location_id
      and clinic_rescue_private.eligible(e) and e.occurred_at > new.appointment_at
  ) then
    raise exception using errcode = '23514', message = 'The appointment must be at or after the original inquiry.';
  end if;
  return new;
end
$$;
revoke all on function clinic_rescue_private.guard_attribution_chronology() from public;
create trigger clinic_followup_attribution_chronology
  before insert on public.clinic_followup_actions
  for each row execute function clinic_rescue_private.guard_attribution_chronology();

-- Staff need the configured currency, without access to owner reporting settings.
create function public.clinic_visit_currency(p_location uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select s.currency
  from public.clinic_rescue_settings s
  join public.clinic_memberships m on m.account_id = s.account_id
  where s.location_id = p_location and m.user_id = auth.uid()
$$;
revoke all on function public.clinic_visit_currency(uuid) from public, anon;
grant execute on function public.clinic_visit_currency(uuid) to authenticated;

create function public.clinic_visit_attribution_reviews(p_location uuid, p_offset integer default 0)
returns table(reference text, channel text, inquiry_at timestamptz, visit_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select coalesce(nullif(v.receipt_ref,''),nullif(e.details->>'patientName',''),
      left(encode(sha256(convert_to(v.event_key,'UTF8')),'hex'),10)),
    src.channel, src.occurred_at, v.appointment_at
  from public.clinic_visit_completions v
  join public.clinic_outcomes e on (e.event_key,e.account_id,e.location_id) = (v.event_key,v.account_id,v.location_id)
  join public.clinic_outcomes src on (src.event_key,src.account_id,src.location_id) = (v.eden_event_key,v.account_id,v.location_id)
  where v.location_id = p_location and src.occurred_at > v.appointment_at
    and exists (select 1 from public.clinic_memberships m where m.account_id = v.account_id and m.user_id = auth.uid())
  order by v.appointment_at desc, v.event_key
  limit 21 offset greatest(p_offset,0)
$$;
revoke all on function public.clinic_visit_attribution_reviews(uuid,integer) from public, anon;
grant execute on function public.clinic_visit_attribution_reviews(uuid,integer) to authenticated;

CREATE OR REPLACE FUNCTION public.record_clinic_visit(p_location uuid, p_event text, p_appointment timestamp with time zone, p_revision integer, p_amount_minor bigint, p_currency text, p_source text DEFAULT NULL::text, p_receipt text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 e public.clinic_outcomes; src public.clinic_outcomes; prev public.clinic_visit_completions;
 st public.clinic_followup_states; origin text; new_rev integer; delta bigint;
begin
 if not exists (select 1 from public.clinic_locations l join public.clinic_memberships m using(account_id)
   where l.id=p_location and m.user_id=auth.uid()) then raise exception 'Location unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_event,0));
 select * into e from public.clinic_outcomes where event_key=p_event and location_id=p_location;
 if e.event_key is null or (e.channel <> 'staff_booking' and clinic_rescue_private.eligible(e) is not true)
   or coalesce(e.details->>'demo','false')='true' then raise exception 'Choose a live booking'; end if;
 select * into st from public.clinic_followup_states where event_key=p_event and location_id=p_location and account_id=e.account_id;
 if st.action is distinct from 'booked' or st.appointment_at is null or st.appointment_at > now()
   or st.appointment_at is distinct from p_appointment then raise exception 'Review the confirmed appointment time'; end if;
 origin := case when e.channel='staff_booking' then p_source else p_event end;
 if origin is not null then
  select * into src from public.clinic_outcomes where event_key=origin and location_id=p_location and account_id=e.account_id;
  if src.event_key is null or clinic_rescue_private.eligible(src) is not true or src.occurred_at>now() then raise exception 'Choose an Eden request from this location'; end if;
 end if;
 select * into prev from public.clinic_visit_completions
 where event_key=p_event and location_id=p_location and account_id=e.account_id;
 -- A previously linked visit can still receive payment updates. For a legacy
 -- direct booking the original link stays visible for review, but earns no fee.
 if e.channel='staff_booking' and origin is not null and prev.eden_event_key is distinct from origin
   and not clinic_rescue_private.valid_attribution(src,p_appointment) then
   raise exception using errcode = '23514', message = 'This inquiry came after the visit. Choose an earlier inquiry or save the payment as a staff booking.';
 end if;
 p_receipt:=nullif(trim(p_receipt),'');
 if prev.event_key is not null and prev.receipt_ref is not distinct from p_receipt and prev.amount_minor is not distinct from p_amount_minor
   and prev.currency=p_currency and prev.eden_event_key is not distinct from origin then return; end if;
 if coalesce(prev.revision,0) is distinct from p_revision then raise exception 'Visit changed. Refresh before saving'; end if;
 if (prev.eden_event_key is not null and prev.eden_event_key is distinct from origin)
 or (prev.amount_minor is not null and (p_amount_minor is null or p_currency <> prev.currency))
 then raise exception 'Keep the recorded source and currency. Enter zero for a fully refunded visit'; end if;
 new_rev := coalesce(prev.revision,0)+1;
 delta := coalesce(p_amount_minor,0) - case when prev.eden_event_key is not distinct from origin then coalesce(prev.amount_minor,0) else 0 end;
 insert into public.clinic_visit_completions(event_key,account_id,location_id,eden_event_key,appointment_at,amount_minor,currency,receipt_ref,revision,recorded_by)
 values(p_event,e.account_id,p_location,origin,p_appointment,p_amount_minor,p_currency,p_receipt,new_rev,auth.uid())
 on conflict(event_key) do update set amount_minor=excluded.amount_minor,currency=excluded.currency,receipt_ref=excluded.receipt_ref,eden_event_key=excluded.eden_event_key,revision=excluded.revision,recorded_by=excluded.recorded_by;
 insert into clinic_rescue_private.visit_entries(event_key,revision,location_id,eden_event_key,amount_minor,delta_minor,currency,receipt_ref,recorded_by)
 values(p_event,new_rev,p_location,origin,p_amount_minor,delta,p_currency,p_receipt,auth.uid());
exception when unique_violation then raise exception 'This Eden request already has a completed visit';
end $function$;

CREATE OR REPLACE FUNCTION clinic_rescue_private.summary(s clinic_rescue_settings, k text, a date, b date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with bounds as (select a::timestamp at time zone s.timezone lo,b::timestamp at time zone s.timezone hi,
 (s.pilot_start+7)::timestamp at time zone s.timezone paid_start),
 requests as (
 select e.*,f.action,f.appointment_at,exists(select 1 from clinic_rescue_private.visit_entries j join public.clinic_visit_completions v using(event_key)
 where j.eden_event_key=e.event_key and j.location_id=e.location_id
   and v.account_id=e.account_id and v.location_id=e.location_id and j.posted_at<hi
   and clinic_rescue_private.valid_attribution(e,v.appointment_at)) as attended from public.clinic_outcomes e cross join bounds
 left join lateral(select x.action,x.appointment_at from public.clinic_followup_actions x
 where (x.event_key,x.account_id,x.location_id)=(e.event_key,e.account_id,e.location_id) and x.created_at<hi
 order by x.created_at desc,x.id desc limit 1) f on true
 where e.location_id=s.location_id and e.account_id=s.account_id and e.occurred_at<hi and clinic_rescue_private.eligible(e)
 ),
 receipts as (
 select j.*,v.appointment_at,src.occurred_at as request_at,src.channel,
   v.appointment_at>=paid_start and src.occurred_at>=paid_start as billable
 from clinic_rescue_private.visit_entries j
 join public.clinic_visit_completions v on (v.event_key,v.location_id)=(j.event_key,j.location_id)
 join public.clinic_outcomes src on (src.event_key,src.account_id,src.location_id)=(j.eden_event_key,v.account_id,v.location_id)
 cross join bounds
 where j.location_id=s.location_id and v.account_id=s.account_id and j.posted_at<hi and j.currency=s.currency
   and clinic_rescue_private.valid_attribution(src,v.appointment_at)
 ),
 period_visits as (
   select event_key,eden_event_key,channel,request_at,appointment_at,billable,sum(delta_minor) as amount_minor
   from receipts cross join bounds
   where posted_at>=lo and amount_minor is not null
   group by event_key,eden_event_key,channel,request_at,appointment_at,billable
 ),
 -- Allocate fee rounding across visit rows so they reconcile to the estimate.
 visit_fees as (
   select *, sum(case when billable then amount_minor else 0 end) over (order by appointment_at,event_key) as running_minor
   from period_visits
 ),
 totals as (
 select coalesce(sum(delta_minor) filter(where posted_at>=lo),0) collected,
 coalesce(sum(delta_minor) filter(where posted_at>=lo and billable),0) eligible,
 coalesce(sum(delta_minor) filter(where billable),0) lifetime
 from receipts cross join bounds
 ),
 prior_months as (
 select date_trunc('month',posted_at at time zone s.timezone) mon,sum(delta_minor) total
 from receipts,bounds where posted_at<lo and billable group by 1
 ),
 prior_balances as (select sum(total) over(order by mon) balance from prior_months),
 fee as (
 select round(lifetime*s.rate_bps/10000) - greatest(0,coalesce((select round(max(balance)*s.rate_bps/10000) from prior_balances),0)) balance from totals
 ),
 visits as (
 select v.event_key,j.amount_minor,j.currency,
   clinic_rescue_private.valid_attribution(src,v.appointment_at) as attributed from public.clinic_visit_completions v cross join bounds
 join lateral(select e.* from clinic_rescue_private.visit_entries e where e.event_key=v.event_key and e.location_id=v.location_id and e.posted_at<hi
 order by e.revision desc limit 1) j on true
 left join public.clinic_outcomes src
   on (src.event_key,src.account_id,src.location_id)=(j.eden_event_key,v.account_id,v.location_id)
 where v.location_id=s.location_id and v.account_id=s.account_id and v.completed_at>=lo and v.completed_at<hi
 )
 select jsonb_build_object(
 'currency',s.currency,'rate_bps',s.rate_bps,'free_through',s.pilot_start+6,
 'channels',coalesce((select jsonb_object_agg(channel,n) from
 (select channel,count(*) n from requests,bounds where occurred_at>=lo group by channel) c),'{}'::jsonb),
 'confirmed',(select count(*) from requests,bounds where occurred_at>=lo and (attended or (action in ('booked','rescheduled','restored') and (appointment_at is null or appointment_at>=occurred_at)))),
 'outstanding',(select count(*) from requests where not attended and (action is null or action in ('reopened','claimed'))),
 'completed',(select count(*) from visits),'attributed',(select count(*) from visits where attributed),
 'amount_pending',(select count(*) from visits where amount_minor is null),
 'other_currency',(select count(*) from visits where amount_minor is not null and currency<>s.currency),
 'collected_minor',collected,'eligible_minor',eligible,
 'share_minor',case when k='settlement' then greatest(0,balance) else 0 end,
 'credit_minor',case when k='settlement' then greatest(0,-balance) else 0 end,
 'estimated_share_minor', round(eligible*s.rate_bps/10000),
 'counted_visits',coalesce((select jsonb_agg(jsonb_build_object(
   'ref',left(encode(sha256(convert_to(eden_event_key,'UTF8')),'hex'),10),
   'channel',channel,'inquiry_at',request_at,'visit_at',appointment_at,
   'amount_minor',amount_minor,'free',not billable,
   'estimated_fee_minor',case when billable then
     round(running_minor*s.rate_bps/10000) - round((running_minor-amount_minor)*s.rate_bps/10000)
     else 0 end)
   order by appointment_at,event_key) from visit_fees),'[]'::jsonb),
 'entries',coalesce((select jsonb_agg(jsonb_build_object(
   'ref',coalesce(j.receipt_ref,left(encode(sha256(convert_to(j.event_key,'UTF8')),'hex'),10)),
   'channel',j.channel,'posted',j.posted_at,'delta_minor',j.delta_minor,'free',not j.billable)
   order by j.posted_at,j.event_key,j.revision)
   from receipts j cross join bounds where j.posted_at>=lo and j.amount_minor is not null),'[]'::jsonb)
 ) from totals,fee
$function$;

CREATE OR REPLACE FUNCTION public.current_rescue_period(p_location uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  settings public.clinic_rescue_settings;
  today date;
  paid_start date;
  period_start date;
  days_per_period integer;
  totals jsonb;
begin
  select s.* into settings from public.clinic_rescue_settings s
  join public.clinic_memberships m on m.account_id = s.account_id
  where s.location_id = p_location and m.user_id = auth.uid() and m.role in ('owner','admin');
  if not found then return null; end if;

  today := (now() at time zone settings.timezone)::date;
  if today < settings.pilot_start then return null; end if;
  paid_start := settings.pilot_start + 7;
  if today < paid_start then
    period_start := settings.pilot_start;
  elsif settings.cadence = 'monthly' then
    period_start := greatest(paid_start, date_trunc('month', today::timestamp)::date);
  else
    days_per_period := case when settings.cadence = 'fortnightly' then 14 else 7 end;
    period_start := today - ((today - paid_start) % days_per_period);
  end if;

  totals := clinic_rescue_private.summary(settings,'results',period_start,today+1);
  return jsonb_build_object('period_start',period_start,'through',today,'currency',settings.currency,
    'rate_bps',settings.rate_bps,'collected_minor',totals->'collected_minor','eligible_minor',totals->'eligible_minor',
    'estimated_share_minor',totals->'estimated_share_minor','counted_visits',totals->'counted_visits');
end;
$function$;
