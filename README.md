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
Vercel auto-deploys from it (see [PROJECT.md](PROJECT.md) §10).

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
npx supabase db push        # apply migrations — see caveat below
```

Migrations apply in filename order. Numbers are zero-padded so inserted
migrations sort correctly (`005` < `0095` < `010`). **`db push` is
currently broken for this project** — its migration ledger has diverged
from the remote; new migrations are applied directly with
`npx supabase db query --linked -f <file>` instead. See
[PROJECT.md](PROJECT.md) §9 for the full explanation.

## Read this before changing anything

**[CLAUDE.md](CLAUDE.md)** — AI-agent working rules and hard-won
"don't break this" warnings. **[PROJECT.md](PROJECT.md)** — the complete
stack, architecture, file map, and data model reference.
