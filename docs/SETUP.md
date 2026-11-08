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

## Supabase access token (deleted)

- A token "GitHub - concept-firm-app deploy" was created on 2026-11-08 and pasted into a Claude chat.
- It turned out not to be needed (deploys use the database password). Hashim deleted it from
  Supabase, from GitHub secrets and from the password manager on 2026-11-08.
- No Supabase access token is in use. If one is needed later, create a new one limited to the
  two projects and the minimum permissions, and never paste it into a chat.

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

## Test project: auth setup (2026-11-08)

- Public sign-up switched off (Authentication > Sign In / Providers > Allow new users to sign up = off).
- First owner set: hashim@conceptaccounting.ca, via `private.bootstrap_owner` in the SQL editor.
- Still to do on Test: invite and recovery email templates, Microsoft 365 SMTP, Site URL and redirect URLs.
- Live project: none of the above done yet (go-live checklist).
