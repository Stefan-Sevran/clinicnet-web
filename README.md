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
