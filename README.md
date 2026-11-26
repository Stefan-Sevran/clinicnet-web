# ClinicNet Web

Cloudflare Pages frontend for Eden Clinic Network.

The first production slice is the public Clinic Revenue Audit with Mia. The existing Render service remains the API backend during migration.

## Cloudflare Pages settings

- Framework preset: None
- Build command: leave blank
- Build output directory: `/`
- Production branch: `main`

No API keys or private tokens belong in this repository.

## Clinic workspace preview

`/clinic/` is an unlinked early-access route. It uses the Render backend at
`https://eden-webhook-ixdd.onrender.com` for the tenant API, and reads the
Supabase project URL and public publishable key from `/clinic/public-config`.
The backend must have both environment variables and the tenant SQL migration
before sign-in and onboarding work. Add `https://clinicnet.live/clinic/` to
Supabase Auth's redirect allowlist for email sign-in.

The page creates a business account and first location, requests channels, and
reads account-scoped activity and booking queues. A request is never a live
connection. The backend's live two-account isolation test is required before
inviting clinics. No service key belongs in this frontend.

## Ask Eden feedback pilot

Bind a private Cloudflare D1 database as `EDEN_FEEDBACK` on the Pages preview
environment and apply `db/ask-eden-feedback/0001_feedback.sql` before releasing
the preview. Apply the SQL through D1 migrations or the database console.
The feedback API is write-only and restricted to the existing Ask Eden preview
hostname. Set a Pages rate-limit rule for POSTs to `/api/ask-eden-feedback`
before opening the pilot to external testers. Existing local and staging
feedback remains in its original storage.

Use `ask_eden_feedback_summary` in D1 for counts by surface, topic, and answer
source. Issue status and handoff need are optional, self-reported per answer.
A reopened flag remains counted if the same answer is later marked resolved.
There are no transcript, patient, clinic, account, or user-ID columns.
Keep optional comments private and clear comments older than 30 days during
pilot review using the following query.

```sql
update ask_eden_feedback set comment = ''
where comment <> '' and updated_at < datetime('now', '-30 days');
```

Run `node tests/ask-eden-cebu.mjs` before promotion. The suite checks routing,
workspace dispatch and permission handling with fixtures, and feedback
validation. Verify browser delivery from both surfaces against the bound
database when deploying the preview.
