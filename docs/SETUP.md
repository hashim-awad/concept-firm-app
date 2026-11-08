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
- Note: this token was pasted into a Claude chat on 2026-11-08. Hashim chose to keep it.
  It must be replaced with a new token before any real client data is in the live project
  (go-live checklist item).
