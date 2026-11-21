import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const {PGlite}=createRequire(import.meta.url)(process.env.EDEN_PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
const owner='10000000-0000-4000-8000-000000000001';
const admin='10000000-0000-4000-8000-000000000002';
const staff='10000000-0000-4000-8000-000000000003';
const account='20000000-0000-4000-8000-000000000001';
const other='20000000-0000-4000-8000-000000000002';
const location='30000000-0000-4000-8000-000000000001';
const otherLocation='30000000-0000-4000-8000-000000000002';
const previous={services:'Old services',language:'Cebuano',bookingMode:'request'};
const facts={services:'  Checkups  ',hours:'Weekdays',address:'Cebu',bookingRules:'Staff confirms appointments'};
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.clinic_locations(id uuid primary key, account_id uuid not null, messenger_facts jsonb);
    create table public.clinic_memberships(account_id uuid, user_id uuid, role text);
    insert into public.clinic_locations values
      ('${location}', '${account}', '${JSON.stringify(previous)}'), ('${otherLocation}', '${other}', null);
    insert into public.clinic_memberships values
      ('${account}', '${owner}', 'owner'), ('${account}', '${admin}', 'admin'), ('${account}', '${staff}', 'staff');
  `);
  const migration=await readFile(new URL('../supabase/migrations/20261121153000_approved_clinic_facts.sql',import.meta.url),'utf8');
  await db.exec(migration);
  const as=async id=>{
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)",[id]);
  };
  const read=async id=>(await db.query('select public.workspace_clinic_facts($1) as facts',[id])).rows[0].facts;
  const save=async (id,draft,version)=>(await db.query('select public.workspace_clinic_facts($1,$2::jsonb,$3::jsonb) as facts',[
    id, JSON.stringify(draft),JSON.stringify(version)
  ])).rows[0].facts;

  await as(owner);
  assert.deepEqual(await read(location),previous);
  await assert.rejects(read(otherLocation),{code:'42501'});
  await assert.rejects(save(otherLocation,facts,null),{code:'42501'});
  await assert.rejects(save(location,{...facts,hours:' '},previous),{code:'22023'});
  const published=await save(location,{...facts,bookingMode:'information'},previous);
  assert.equal(published.services,'Checkups');
  assert.equal(published.language,'Cebuano');
  assert.equal(published.bookingMode,'request');
  assert.ok(published.profileApprovedAt);
  await assert.rejects(save(location,facts,previous),{code:'40001'});
  await as(admin);
  assert.deepEqual(await read(location),published);
  assert.equal((await save(location,{...facts,hours:'Weekends'},published)).hours,'Weekends');
  await as(staff);
  await assert.rejects(read(location),{code:'42501'});
  await assert.rejects(save(location,facts,published),{code:'42501'});
  await db.exec('set role anon');
  await assert.rejects(read(location),{code:'42501'});
  console.log('PASS approved facts, owner/admin access, clinic isolation, and concurrent edits');
} finally {await db.close();}
