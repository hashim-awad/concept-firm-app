# Concept Studio

The staff app of Concept Accounting & Advisory. Internal developer name: Concept Firm App (repository, Supabase and Vercel projects keep that name).

The firm web app for Concept Accounting & Advisory Professional Corporation.
Owned by the firm. Built to keep running and be maintainable by any web developer.

- What the app must do: [docs/BRIEF.md](docs/BRIEF.md)
- What is set up where (Supabase, GitHub, Vercel): [docs/SETUP.md](docs/SETUP.md)

## Technology

| Part | What | Where |
|---|---|---|
| Web app | Next.js (App Router, TypeScript), Tailwind CSS | Vercel, functions in Montréal (yul1) |
| Database, logins, files | Supabase (Postgres, Auth, Storage) | Canada (Central), ca-central-1 |
| Code and automation | GitHub, GitHub Actions | This private repo |

## How access works

- Staff sign in with email and password (Supabase Auth). Clients never log in.
- Each staff member has one role. A role sets No access, View or Edit per area.
  Owners manage roles in the app (Admin > Roles and permissions).
- The database enforces every rule (row level security plus checked functions in
  `supabase/migrations`). The app's own checks only decide what is shown.
- The app reads tables directly with the signed-in user's session. All changes go
  through database functions (`supabase.rpc(...)`), which check permissions and are
  recorded in the activity log by the database.
- The Supabase secret key is used in one place only: creating staff logins
  (`src/app/(app)/admin/staff/actions.ts`), after the permission check.

## Folders

```
src/app/                 pages (App Router)
  (app)/                 pages that need a signed-in, active staff member
  login, forgot-password, set-password, auth/confirm, no-access
src/lib/                 Supabase clients, access helpers
src/proxy.ts             refreshes the login session; sends signed-out visitors to /login
supabase/migrations/     database changes, applied in order
supabase/tests/          database tests (run on a plain local Postgres)
.github/workflows/       checks on every push; database deploy to Test
docs/                    brief and setup record
```

## Database changes

1. Add a new file in `supabase/migrations/` named `YYYYMMDDHHMMSS_description.sql`.
   Never edit a migration that has already been applied.
2. Add or update tests in `supabase/tests/*_test.sql`.
3. Run the tests locally (needs a local Postgres):
   `PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run_local.sh`
4. Push to a branch. GitHub runs the tests, then applies the migration to the **Test**
   project. Live is updated only from `main` (set up before go-live).

Rules for every new table: it gets row level security automatically and is not readable
by the app until a migration grants it on purpose and adds policies.

## Running the app locally

1. `npm ci`
2. Copy `.env.example` to `.env.local` and fill in the **Test** project's values.
   Never use the live project for local work.
3. `npm run dev` and open http://localhost:3000

Use dummy data only. Never real client data outside the live project.

## First owner (once per Supabase project)

No person's name is in the code. To set the first owner:
1. Supabase > Authentication > Users > Add user (email and password, auto confirm).
2. Supabase > SQL editor: `select private.bootstrap_owner('email', 'Full Name');`
It refuses to run once an owner exists. Further staff are invited in the app.
