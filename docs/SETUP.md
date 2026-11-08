# Setup record

What exists, where, and how it was set up. No passwords or keys in this file.

## Supabase (organization: Concept Accounting & Advisory Professional Corporation)

| Project | Purpose | Region | Project ID | Plan |
|---|---|---|---|---|
| Concept Firm App | Live. Real client data only after go-live. | Canada (Central), ca-central-1 | owysxewnrnvrcpjutxcw | Free (Pro before go-live) |
| Concept Firm App - Test | Testing and previews. Dummy data only. | Canada (Central), ca-central-1 | wtivdpwyoarpcbgohgnr | Free |

Test project created 2026-11-08 with:
- Data API on
- "Automatically expose new tables" off
- Automatic RLS on

The live project was created with Supabase defaults. The first database migration applies the
same protections to both projects in code (new tables not exposed by default, RLS forced on
every table), so both behave the same whatever the dashboard settings are.

Database passwords are kept in the firm's password manager only:
- "Supabase – Concept Firm App – Test – database"

## Supabase access token (for GitHub deploys)

- Name: "GitHub - concept-firm-app deploy"
- Created 2026-11-08, expires 2027-02-06 (90 days). Renew before expiry.
- Limited to: Concept Firm App, Concept Firm App - Test.
- Permissions: Project Settings = Read, Migrations = Read and write. Everything else none.
- Stored in: firm password manager ("Supabase – access token – GitHub deploy") and GitHub repository secret SUPABASE_ACCESS_TOKEN.
- Not used by the deploy workflow (it connects with the database password instead). Recommended: delete it.
- Note: this token was pasted into a Claude chat on 2026-11-08. Hashim chose to keep it.
  It must be replaced with a new token before any real client data is in the live project
  (go-live checklist item).

## How database changes are deployed

- Every change is a file in `supabase/migrations/`.
- `.github/workflows/db-deploy-test.yml` applies new migrations to the Test project on every
  push to a branch other than main. It connects through Supabase's session pooler
  (aws-1-ca-central-1.pooler.supabase.com, port 5432), because GitHub's machines cannot reach
  the direct database address (IPv6 only).
- Secret used: SUPABASE_DB_PASSWORD in the GitHub environment "test".
- First successful run: 2026-11-08, applied 20261108000000_foundation_security.sql to Test.
- Live deploys: not set up yet. Plan: a "production" GitHub environment with Hashim as required
  reviewer, running only from main.
