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

## Vercel

- Team "Concept Accounting", Pro plan (US$20/month, 1 seat: Hashim). Signed up 2026-11-08.
- Vercel GitHub app installed on hashim-awad with access to concept-firm-app only.
- Server code region: Montréal (yul1), set in `vercel.json` so it is part of the code.
- Project concept-firm-app imported 2026-11-08. Framework preset: Next.js. Production branch: main.
- Preview environment variables (Test project): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  (Config type), SUPABASE_SECRET_KEY (Secret type). System environment variables exposed.
- Production environment variables: none yet (go-live).
- Plan is a 14-day Pro trial from 2026-11-08: upgrade before 2026-11-22.

## Microsoft 365 email (staff login emails)

Route: Supabase Auth "Send Email" hook -> app route /api/hooks/send-email -> Microsoft Graph
(OAuth client credentials) -> sent from the shared mailbox. No mailbox password is used.

- Shared mailbox: app@conceptaccounting.ca ("Concept Firm App"), created 2026-11-08. No licence.
- Entra app registration: "Concept Firm App - email", single tenant, created 2026-11-08.
  - Application (client) ID: e841a588-c156-4569-a759-ca34b93b0181
  - Directory (tenant) ID: 96888d59-12fe-454f-9988-c7292bb5c710
  - No API permissions granted in Entra on purpose. Sending is allowed only for
    app@conceptaccounting.ca through Exchange "RBAC for Applications" (see below).
  - Client secret "Vercel - concept-firm-app": created 2026-11-08, expires 2027-11-08 (12 months).
    Stored only in Vercel as MS_CLIENT_SECRET (Production and Preview). Outlook reminder set for
    2027-10-25 with renewal steps.
