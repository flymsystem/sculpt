# D Sculpt Fitness

Gym management app and public website for D Sculpt Fitness.

Plain JavaScript + Vite on the front, Supabase (Postgres, Auth, RLS, Edge
Functions) on the back. Installable as a phone app.

## Quick start

```bash
npm install
npm run dev          # development server
```

`.env.local` must hold `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
These are baked into the build, which is intended — the anon key is public
and protected by row-level security.

## Build and deploy

```bash
npm run build        # writes dist/
npm run preview      # serve the built output on :4173
```

Hard-refresh a deep route such as `/dashboard/finance` in the preview
before shipping, then push to the `sculpt-whitelabel` branch on GitHub —
Vercel auto-deploys from it (see [HANDOVER.md](HANDOVER.md) §3).

## Checks

```bash
npm run lint
npx playwright test                 # public-page checks
node scripts/verify-schema.mjs      # database matches the code
```

Logged-in tests need credentials and must run single-threaded:

```bash
SCULPT_TEST_EMAIL=... SCULPT_TEST_PASSWORD=... npx playwright test --workers=1
```

## Database

```bash
npx supabase db push        # apply migrations
```

Migrations apply in filename order. Numbers are zero-padded so inserted
migrations sort correctly (`005` < `0095` < `010`).

## Read this before changing anything

**[HANDOVER.md](HANDOVER.md)** — deployment, outstanding content, and the
list of changes that silently break production.
