import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { PGlite } = createRequire(import.meta.url)(process.env.EDEN_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const [owner,admin,agent,finance,otherOwner,account,otherAccount,cebu,manila,other] =
  Array.from({length:10},(_,i)=>uuid(i+1));
const baseFacts = {services:'Checkups',hours:'9–5',address:'Cebu',bookingRules:'Staff confirm'};
const after = {...baseFacts,hours:'10–5'};
const migrationDir = new URL('../supabase/migrations/',import.meta.url);
const get = async (sql,args=[]) => (await db.query(sql,args)).rows;
const value = async (sql,args=[]) => (await get(sql,args))[0].value;
const roles = async uid => {
  await db.exec('reset role');
  if (uid) {
    await db.query("select set_config('test.user_id',$1,false)",[uid]);
    await db.exec('set role authenticated');
  }
};
const proposal = (loc,kind,day,rate) =>
  value('select eden_propose_rescue_terms($1,$2,$3,$4) as value',[loc,kind,day,rate]);
const accept = (loc,id) => get('select eden_accept_rescue_terms($1,$2)',[loc,id]);
const open = (id,facts=null,expected=null) => value(
  'select eden_support_messenger_facts($1,$2,$3) as value',[id,facts,expected]);
const configure = (loc,day,rate) =>
  get("select configure_rescue_reports($1,$2,'monthly','PHP',$3,false)",[loc,day,rate]);
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0,10);

try {
  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.user_id',true),'')::uuid $$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create schema clinic_rescue_private;
    create table clinic_accounts(id uuid primary key,name text);
    create table clinic_locations(id uuid primary key,account_id uuid,name text,timezone text,
      messenger_facts jsonb,unique(id,account_id));
    create table clinic_memberships(account_id uuid,user_id uuid,role text);
    create table clinic_outcomes(event_key text primary key,account_id uuid,location_id uuid,
      channel text,kind text,occurred_at timestamptz,details jsonb default '{}');
    create table clinic_followup_actions(id bigint generated always as identity,event_key text,account_id uuid,
      location_id uuid,action text,created_at timestamptz default now(),appointment_at timestamptz);
    create view clinic_followup_states as select distinct on(event_key) * from clinic_followup_actions
      order by event_key,created_at desc,id desc;
    create table clinic_visit_completions(event_key text primary key,account_id uuid,location_id uuid,
      eden_event_key text unique,appointment_at timestamptz,completed_at timestamptz default now(),
      amount_minor bigint,currency text,receipt_ref text,revision int,recorded_by uuid);
    create table clinic_rescue_private.visit_entries(event_key text,revision int,location_id uuid,eden_event_key text,
      amount_minor bigint,delta_minor bigint,currency text,receipt_ref text,recorded_by uuid,posted_at timestamptz,
      primary key(event_key,revision));
    create function clinic_rescue_private.eligible(e clinic_outcomes) returns boolean
      language sql immutable as $$ select e.kind='booking.requested' and e.channel='website_chat' $$;
  `);
  for (const [uid,email] of [[owner,'owner'],[admin,'admin'],[agent,'agent'],[finance,'finance'],[otherOwner,'other']]) {
    await db.query('insert into auth.users values($1,$2,now())',[uid,email+'@example.test']);
  }
  await db.query("insert into clinic_accounts values ($1,'Test business'),($2,'Other business')",[account,otherAccount]);
  for (const [loc,tenant,name] of [[cebu,account,'Cebu'],[manila,account,'Manila'],[other,otherAccount,'Other clinic']]) {
    await db.query("insert into clinic_locations values($1,$2,$3,'UTC',$4)",[loc,tenant,name,{...baseFacts,language:'Cebuano'}]);
  }
  await db.query("insert into clinic_memberships values ($1,$2,'owner'),($1,$3,'admin'),($4,$5,'owner')",
    [account,owner,admin,otherAccount,otherOwner]);
  const legacyPath = process.env.EDEN_REPORTS_MIGRATION ||
    new URL('../../eden-webhook/supabase/migrations/20261118101000_rescue_reports.sql',import.meta.url);
  const legacy = await readFile(legacyPath,'utf8');
  await db.exec(legacy);
  for (const file of ['20261119180000_rescue_reliability.sql','20261122100000_eden_operations_pilot.sql']) {
    await db.exec(await readFile(new URL(file,migrationDir),'utf8'));
  }
  await db.query('insert into clinic_operations_private.operators(user_id) values ($1),($2)',[agent,finance]);
  await db.query('insert into clinic_operations_private.finance_locations values ($1,$2),($1,$3)',[finance,cebu,manila]);

  await roles(agent);
  assert.deepEqual(await get('select * from eden_support_locations()'),[]);
  assert.deepEqual(await get('select * from eden_finance_locations()'),[]);
  await roles(admin);
  await assert.rejects(get("select eden_grant_support($1,'agent@example.test','read',1)",[cebu]),{code:'42501'});
  await roles(owner);
  await assert.rejects(get("select eden_grant_support($1,'agent@example.test','read',1)",[other]),{code:'42501'});
  const grant = scope => value('select eden_grant_support($1,$2,$3,1) as value',[cebu,'agent@example.test',scope]);
  const read = await grant('read');
  const write = await grant('messenger_facts');
  await roles(agent);
  assert.deepEqual(new Set((await get('select * from eden_support_locations()')).map(row=>row.location_id)),new Set([cebu]));
  assert.deepEqual(await open(read),baseFacts);
  await assert.rejects(open(read,after,baseFacts),{code:'42501'});
  await assert.rejects(proposal(cebu,'initial',day(1),1400),{code:'42501'});
  await assert.rejects(open(write,{...after,language:'English'},baseFacts),{code:'22023'});
  assert.deepEqual(await open(write,after,baseFacts),after);
  await assert.rejects(open(write,baseFacts,baseFacts),{code:'40001'});
  await assert.rejects(get('select * from clinic_operations_private.operators'),{code:'42501'});
  await roles(otherOwner);
  await assert.rejects(open(write),{code:'42501'});
  await assert.rejects(get('select eden_revoke_support($1)',[write]),{code:'42501'});
  await roles(owner);
  await get('select eden_revoke_support($1)',[write]);
  const log = await get('select * from eden_support_activity($1)',[cebu]);
  const edit = log.find(row=>row.action==='messenger_facts_changed');
  assert.equal(edit.actor_id,agent);
  assert.deepEqual(edit.changed_fields,['hours']);
  assert.ok(log.some(row=>row.action==='revoked'));
  await roles();
  await db.query("update clinic_operations_private.support_grants set expires_at=now()-interval '1 minute' where id=$1",[read]);
  assert.equal(await value("select messenger_facts->>'language' as value from clinic_locations where id=$1",[cebu]),'Cebuano');
  await roles(agent);
  await assert.rejects(open(read),{code:'42501'});
  await assert.rejects(open(write),{code:'42501'});
  assert.deepEqual(await get('select * from eden_support_locations()'),[]);

  await roles(finance);
  assert.deepEqual(new Set((await get('select * from eden_finance_locations()')).map(row=>row.location_id)),new Set([cebu,manila]));
  await assert.rejects(proposal(other,'initial',day(1),1500),{code:'42501'});
  const stale = await proposal(cebu,'initial',day(1),1400);
  const initial = await proposal(cebu,'initial',day(1),1500);
  await roles(owner);
  await assert.rejects(configure(cebu,day(1),1500),{code:'22023'});
  await assert.rejects(accept(cebu,stale),{code:'42501'});
  await assert.rejects(accept(manila,initial),{code:'42501'});
  await accept(cebu,initial);
  await assert.rejects(configure(cebu,day(1),1000),{code:'22023'});
  await configure(cebu,day(1),1500);
  // Existing locations still work through the current activation path.
  await configure(manila,day(-40),1750);
  await roles(finance);
  await assert.rejects(proposal(cebu,'rate',day(-1),1000),{code:'22023'});
  const rate = await proposal(cebu,'rate',day(16),1000);
  const free = await proposal(cebu,'free_week',day(18),null);
  const pending = await proposal(cebu,'rate',day(24),2500);
  await assert.rejects(accept(cebu,rate),{code:'42501'});

  // Use future fixture visits to exercise the terms across dates without changing the system clock.
  await roles();
  async function visit(key,request,appointment,amount) {
    const time = (offset,hour) => day(offset)+'T'+hour+':00:00Z';
    await db.query("insert into clinic_outcomes values ($1,$2,$3,'website_chat','booking.requested',$4,'{}')",
      [key,account,cebu,time(request,'08')]);
    await db.query("insert into clinic_visit_completions values ($1,$2,$3,$1,$4,$5,$6,'PHP',null,1,$7)",
      [key,account,cebu,time(appointment,'10'),time(appointment,'13'),amount,owner]);
    await db.query("insert into clinic_rescue_private.visit_entries values ($1,1,$2,$1,$3,$3,'PHP',null,$4,$5)",
      [key,cebu,amount,owner,time(appointment,'13')]);
  }
  const summary = (start,end) => value(`select clinic_rescue_private.summary(s,'settlement',$2,$3) as value
    from clinic_rescue_settings s where location_id=$1`,[cebu,day(start),day(end)]);
  await visit('pilot',3,4,50000);
  await visit('before',12,13,100000);
  const historical = await summary(1,15);
  assert.equal(historical.share_minor,15000);
  await db.query("insert into clinic_rescue_reports(account_id,location_id,kind,period_start,period_end,snapshot,approved_at,approved_by) values($1,$2,'settlement',$3,$4,$5,now(),$6)",
    [account,cebu,day(1),day(15),historical,owner]);
  await roles(owner);
  await accept(cebu,rate);
  await accept(cebu,free);
  assert.equal((await get('select * from eden_review_rescue_terms($1)',[cebu])).find(row=>row.id===pending).accepted_at,null);
  await roles();
  await visit('new-rate',15,17,200000);
  await visit('extra-free',17,18,80000);
  await visit('paid-again',24,25,300000);
  const mixed = await summary(1,28);
  assert.equal(mixed.collected_minor,730000);
  assert.equal(mixed.eligible_minor,600000);
  assert.equal(mixed.estimated_share_minor,65000);
  assert.deepEqual(mixed.counted_visits.map(row=>row.rate_bps),[0,1500,1000,0,1000]);
  assert.equal(await value("select snapshot->>'share_minor' as value from clinic_rescue_reports where location_id=$1",[cebu]),'15000');
  assert.deepEqual(await summary(1,15),historical);
  await db.query("insert into clinic_rescue_private.visit_entries values ('before',2,$1,'before',50000,-50000,'PHP',null,$2,$3)",
    [cebu,owner,day(26)+'T10:00:00Z']);
  const refund = await summary(26,28);
  assert.equal(refund.estimated_share_minor,-7500);
  assert.equal(refund.counted_visits[0].rate_bps,1500);
  console.log('PASS scoped Eden support, owner consent, revocation, expiry, audit, initial terms, dated rates/free week, refunds and approved snapshots');
} finally { await db.close(); }
