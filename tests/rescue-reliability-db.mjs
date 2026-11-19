import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const { PGlite } = createRequire(import.meta.url)(process.env.EDEN_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const a = '10000000-0000-4000-8000-000000000001';
const b = '10000000-0000-4000-8000-000000000002';
const owner = '30000000-0000-4000-8000-000000000001';
const staff = '30000000-0000-4000-8000-000000000002';
const locationA = a.replace(/^1/,'2');
const locationB = b.replace(/^1/,'2');

try {
  // Minimal schema matching the production columns used by these routines.
  await db.exec(`
    create schema auth;
    create schema clinic_rescue_private;
    create role authenticated;
    create role anon;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.user_id',true),'')::uuid
    $$;
    create table clinic_memberships(account_id uuid,user_id uuid,role text);
    create table clinic_locations(id uuid,account_id uuid);
    create table clinic_outcomes(event_key text primary key,account_id uuid,location_id uuid,
      channel text,kind text,occurred_at timestamptz,details jsonb default '{}');
    create table clinic_followup_actions(id bigint generated always as identity,event_key text,account_id uuid,
      location_id uuid,action text,created_at timestamptz default now(),appointment_at timestamptz);
    create view clinic_followup_states as select distinct on(event_key) * from clinic_followup_actions
      order by event_key,created_at desc,id desc;
    create table clinic_visit_completions(event_key text primary key,account_id uuid,location_id uuid,
      eden_event_key text unique,appointment_at timestamptz,completed_at timestamptz default now(),
      amount_minor bigint,currency text,receipt_ref text,revision int,recorded_by uuid);
    create table clinic_rescue_private.visit_entries(event_key text,revision int,location_id uuid,
      eden_event_key text,amount_minor bigint,delta_minor bigint,currency text,receipt_ref text,
      recorded_by uuid,posted_at timestamptz default now(),primary key(event_key,revision));
    create table clinic_rescue_settings(location_id uuid primary key,account_id uuid,timezone text,
      pilot_start date,cadence text,currency text,rate_bps int);
    create table clinic_rescue_reports(id integer primary key,approved_at timestamptz,snapshot jsonb);
    create function clinic_rescue_private.eligible(e clinic_outcomes) returns boolean
    language sql immutable set search_path = '' as $$
      select e.channel in ('website_chat','facebook_messenger','ai_phone')
        and e.kind in ('booking.requested','inquiry.followup_needed','call.followup_needed')
        and coalesce(e.details->>'demo','false') <> 'true'
        and not (e.details ?| array['messengerSetupTestId','messengerRequestAction','relatedRequestKey'])
    $$;
    insert into clinic_memberships values ('${a}','${owner}','owner'),
      ('${a}','${staff}','staff');
    insert into clinic_locations values ('${locationA}','${a}'),('${locationB}','${b}');
    insert into clinic_rescue_settings values
      ('${locationA}','${a}','Asia/Manila','2026-11-12','monthly','PHP',1500),
      ('${locationB}','${b}','Asia/Bangkok','2026-11-12','monthly','THB',2200);
    insert into clinic_rescue_reports values (1,'2026-11-19','{"share_minor":123}');
  `);
  async function inquiry(key, channel, occurred, account = a, location = locationA, details = {}) {
    const kind = channel === 'ai_phone' ? 'call.followup_needed' : 'booking.requested';
    await db.query('insert into clinic_outcomes values ($1,$2,$3,$4,$5,$6,$7)',[key,account,location,channel,kind,occurred,details]);
  }
  async function visit(key, source, appointment, posted, amount, account = a, location = locationA, currency = 'PHP') {
    await db.query('insert into clinic_visit_completions values ($1,$2,$3,$4,$5,$6,$7,$8,null,1,null)',
      [key,account,location,source,appointment,posted,amount,currency]);
    await db.query('insert into clinic_rescue_private.visit_entries values ($1,1,$2,$3,$4,$5,$6,null,null,$7)',
      [key,location,source,amount,amount ?? 0,currency,posted]);
  }
  const nov = (day,hour=0) => `2026-11-${day}T${String(hour).padStart(2,'0')}:00:00+08:00`;
  await inquiry('phone','ai_phone',nov(19,8));
  await inquiry('messenger','facebook_messenger',nov(19,9));
  await inquiry('web-free','website_chat',nov(15,8));
  await inquiry('late-free','facebook_messenger',nov(16,8));
  await inquiry('late-paid','website_chat',nov(19,11));
  await inquiry('walk-in','staff_booking',nov(19,11));
  await inquiry('zero','ai_phone',nov(19,8));
  await inquiry('unknown','website_chat',nov(19,8));
  await inquiry('foreign','website_chat',nov(19,8),b,locationB);
  await inquiry('foreign-other','website_chat',nov(19,8),b,locationB);
  await inquiry('demo','website_chat',nov(19,8),a,locationA,{demo:true});
  await visit('phone','phone',nov(19,10),nov(19,14),500000);
  await visit('messenger','messenger',nov(19,11),nov(19,15),800000);
  await visit('web-free','web-free',nov(15,10),nov(19,14),500000);
  await visit('late-free','late-free',nov(15,10),nov(19,14),5000000);
  await visit('late-paid','late-paid',nov(19,10),nov(19,14),5000000);
  await visit('zero','zero',nov(19,10),nov(19,14),0);
  await visit('unknown','unknown',nov(19,10),nov(19,14),null);
  await visit('foreign','foreign',nov(19,10),nov(19,14),10000,b,locationB,'THB');
  await visit('demo','demo',nov(19,10),nov(19,14),5000000);
  // Simulate a legacy cross-location link and verify it cannot contribute a payment.
  await visit('walk-in','foreign-other',nov(19,10),nov(19,14),5000000);
  await inquiry('legacy-link','website_chat','2001-01-03');
  await visit('legacy-link','legacy-link','2001-01-02','2001-01-02',1000);
  await db.query(`insert into clinic_followup_actions(event_key,account_id,location_id,action,appointment_at)
    values ('legacy-link',$1,$2,'booked','2001-01-02')`,[a,locationA]);
  const migration = await readFile(new URL('../supabase/migrations/20261119180000_rescue_reliability.sql',import.meta.url),'utf8');
  await db.exec(migration);

  async function report(location, kind = 'results') {
    const { rows: [{ summary }] } = await db.query(`
      select clinic_rescue_private.summary(s,$2,'2026-11-19','2026-11-20') summary
      from clinic_rescue_settings s where s.location_id=$1
    `,[location,kind]);
    return summary;
  }
  const result = await report(locationA);
  assert.equal(result.collected_minor,1800000);
  assert.equal(result.eligible_minor,1300000);
  assert.equal(result.estimated_share_minor,195000);
  assert.equal(result.attributed,5);
  assert.equal(result.completed,9);
  assert.equal(result.amount_pending,1);
  assert.deepEqual(result.counted_visits.filter(v=>!v.free).map(v=>v.estimated_fee_minor),[75000,0,120000]);
  assert.equal(result.counted_visits.find(v=>v.free).amount_minor,500000);
  assert.ok(result.counted_visits.every(v=>Date.parse(v.visit_at)>=Date.parse(v.inquiry_at)));
  assert.equal((await report(locationA,'settlement')).share_minor,195000);
  assert.equal((await report(locationB,'settlement')).share_minor,2200);
  assert.deepEqual((await db.query('select snapshot from clinic_rescue_reports')).rows[0].snapshot,{share_minor:123});
  assert.equal((await db.query("select amount_minor from clinic_visit_completions where event_key='late-free'")).rows[0].amount_minor,5000000);

  async function appointment(key, at, action = 'booked') {
    await db.query(`insert into clinic_followup_actions(event_key,account_id,location_id,action,appointment_at)
      values ($1,$2,$3,$4,$5)`,[key,a,locationA,action,at]);
  }
  for (const key of ['phone','messenger','late-paid']) {
    for (const action of ['booked','rescheduled','restored']) {
      await assert.rejects(appointment(key,nov(19,7),action),/at or after the original inquiry/);
    }
  }
  // A new staff booking can record a walk-in without an Eden link.
  await inquiry('new-walk-in','staff_booking','2000-01-01');
  await inquiry('new-late','facebook_messenger','2000-01-03');
  await inquiry('new-early','website_chat','2000-01-01');
  await appointment('new-walk-in','2000-01-02');
  await appointment('new-early','2000-01-01');
  await db.query("select set_config('test.user_id',$1,false)",[staff]);
  await db.exec('set role authenticated');
  const rpc = async (sql,args) => (await db.query(sql,args)).rows[0]?.value;
  const currency = location => rpc('select clinic_visit_currency($1) value',[location]);
  assert.equal(await currency(locationA),'PHP');
  assert.equal(await currency(locationB),null);
  const review = location => db.query('select * from clinic_visit_attribution_reviews($1,0)',[location]);
  assert.equal((await review(locationA)).rows.length,3);
  assert.equal((await review(locationB)).rows.length,0);
  const current = location => rpc('select current_rescue_period($1) value',[location]);
  assert.equal(await current(locationA),null);
  const record = (location, key, at, source, amount = 0, revision = 0) =>
    db.query("select record_clinic_visit($1,$2,$3,$4,$5,'PHP',$6)",[location,key,at,revision,amount,source]);
  await assert.rejects(record(locationA,'new-walk-in','2000-01-02','new-late'),/inquiry came after the visit/);
  await assert.rejects(record(locationA,'new-walk-in','2000-01-02','foreign'),/request from this location/);
  await assert.rejects(record(locationB,'foreign','2000-01-02',null),/Location unavailable/);
  await record(locationA,'new-walk-in','2000-01-02',null);
  await record(locationA,'new-walk-in','2000-01-02','new-early',1000,1);
  await record(locationA,'new-walk-in','2000-01-02','new-early',1000,1); // Retry.
  await db.query("select set_config('test.user_id',$1,false)",[owner]);
  assert.equal(await current(locationB),null);
  await db.exec('reset role');

  // Preserve the existing source and allow payment corrections on a historical link.
  await record(locationA,'legacy-link','2001-01-02','legacy-link',500,1);
  assert.deepEqual((await db.query("select amount_minor,eden_event_key from clinic_visit_completions where event_key='legacy-link'")).rows[0],
    {amount_minor:500,eden_event_key:'legacy-link'});

  // Check visit totals with multiple payment entries, refunds and fractional fees.
  await db.exec(`insert into clinic_rescue_private.visit_entries values
    ('phone',2,'${locationA}','phone',400001,-99999,'PHP',null,null,'${nov(19,16)}'),
    ('messenger',2,'${locationA}','messenger',800003,3,'PHP',null,null,'${nov(19,16)}')`);
  const adjusted = await report(locationA);
  const sum = key => adjusted.counted_visits.filter(v=>!v.free).reduce((total,v)=>total+v[key],0);
  assert.equal(sum('amount_minor'),1200004);
  assert.equal(sum('estimated_fee_minor'),adjusted.estimated_share_minor);
  assert.equal(adjusted.estimated_share_minor,180001);

  await db.query(`
    update clinic_rescue_settings set pilot_start=(now() at time zone timezone)::date-7
    where location_id=$1
  `,[locationA]);
  await db.exec('set role authenticated');
  const ownerPeriod = await current(locationA);
  assert.equal(ownerPeriod.currency,'PHP');
  assert.equal(ownerPeriod.rate_bps,1500);
  assert.ok(Array.isArray(ownerPeriod.counted_visits));
  await db.exec('set role anon');
  await assert.rejects(currency(locationA),/permission denied/);
  await assert.rejects(review(locationA),/permission denied/);
  console.log('Revenue Rescue database tests passed');
} catch (error) {
  console.error(error.message);
  if (error.query) console.error(error.query.split('\n').find(line => line.trim()));
  process.exitCode = 1;
} finally {
  await db.close();
}
