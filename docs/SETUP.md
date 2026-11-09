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
- "Supabase – Concept Firm App – Live – database" (reset 2026-11-08)

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
- Live deploys: `.github/workflows/db-deploy-live.yml` (written 2026-11-08). Runs only from main,
  waits for approval in the GitHub environment "production" (Hashim as required reviewer, main
  only), shows the changes, then applies them. Secret: SUPABASE_DB_PASSWORD in "production" (the
  LIVE database password). First run Nov 9, 2026: all 12 migrations applied.

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
- Production environment variables (2026-11-08): NEXT_PUBLIC_SUPABASE_URL (Live), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  (Live), SITE_URL https://studio.conceptaccounting.ca (Config); SUPABASE_SECRET_KEY (Secret, Supabase Live key
  "vercel_production"); MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_FROM shared with Preview.
  SEND_EMAIL_HOOK_SECRET for Production comes with the live email hook.
- Plan is a 14-day Pro trial from 2026-11-08: upgrade before 2026-11-22.

## Microsoft 365 email (staff login emails)

Route: Supabase Auth "Send Email" hook -> app route /api/hooks/send-email -> Microsoft Graph
(OAuth client credentials) -> sent from the shared mailbox. No mailbox password is used.

- Shared mailbox: app@conceptaccounting.ca, created 2026-11-08. No licence. Display name to be "Concept Studio" (the name staff see as the sender; renamed by Hashim in Microsoft 365 admin, decision 31).
- Entra app registration: "Concept Firm App - email", single tenant, created 2026-11-08.
  - Application (client) ID: e841a588-c156-4569-a759-ca34b93b0181
  - Directory (tenant) ID: 96888d59-12fe-454f-9988-c7292bb5c710
  - No API permissions granted in Entra on purpose. Sending is allowed only for
    app@conceptaccounting.ca through Exchange "RBAC for Applications" (see below).
  - Client secret "Vercel - concept-firm-app": created 2026-11-08, expires 2027-11-08 (12 months).
    Stored only in Vercel as MS_CLIENT_SECRET (Production and Preview). Outlook reminder set for
    2027-10-25 with renewal steps.
  - Enterprise application (service principal) Object ID: b7c7a738-5524-4238-a6bc-2139854da921
  - Vercel settings (Production and Preview): MS_TENANT_ID, MS_CLIENT_ID, MAIL_FROM (Config),
    MS_CLIENT_SECRET (Secret).

### Lock: the app may send only as app@conceptaccounting.ca (Exchange RBAC for Applications)

Run once in PowerShell by an Exchange admin:

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Connect-ExchangeOnline -UserPrincipalName hashim@conceptaccounting.ca
New-ServicePrincipal -AppId e841a588-c156-4569-a759-ca34b93b0181 -ObjectId b7c7a738-5524-4238-a6bc-2139854da921 -DisplayName "Concept Firm App - email"
New-ManagementScope -Name "Concept Firm App mailbox only" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'app@conceptaccounting.ca'"
New-ManagementRoleAssignment -App e841a588-c156-4569-a759-ca34b93b0181 -Role "Application Mail.Send" -CustomResourceScope "Concept Firm App mailbox only"
# Checks: first should be InScope True, second False
Test-ServicePrincipalAuthorization -Identity e841a588-c156-4569-a759-ca34b93b0181 -Resource app@conceptaccounting.ca
Test-ServicePrincipalAuthorization -Identity e841a588-c156-4569-a759-ca34b93b0181 -Resource hashim@conceptaccounting.ca
```

Never add Mail.Send under "API permissions" in Entra for this app: that permission would apply
to every mailbox and override the lock.

Lock applied 2026-11-08 and checked with Test-ServicePrincipalAuthorization:
app@conceptaccounting.ca InScope True; hashim@conceptaccounting.ca InScope False.

### Move the lock to studio@conceptaccounting.ca (decision 35, run 2026-11-08)

The lock matches the mailbox's primary address. As soon as the primary address changes to
studio@, the old filter no longer matches and the app cannot send (password resets fail) until
the three steps below are done. Do them in one sitting.

1. Hashim, Microsoft 365 admin: on the shared mailbox, make studio@conceptaccounting.ca the
   primary address, keep app@conceptaccounting.ca as an alias, display name "Concept Studio".
2. Exchange admin, PowerShell (changes the existing scope; nothing new is created):

```powershell
Connect-ExchangeOnline -UserPrincipalName hashim@conceptaccounting.ca
# Confirm the switch took: PrimarySmtpAddress should be studio@, EmailAddresses should still list app@
Get-Mailbox app@conceptaccounting.ca | Format-List DisplayName,PrimarySmtpAddress,EmailAddresses
Set-ManagementScope -Identity "Concept Firm App mailbox only" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'studio@conceptaccounting.ca'"
# Checks: first should be InScope True, second False
Test-ServicePrincipalAuthorization -Identity e841a588-c156-4569-a759-ca34b93b0181 -Resource studio@conceptaccounting.ca
Test-ServicePrincipalAuthorization -Identity e841a588-c156-4569-a759-ca34b93b0181 -Resource hashim@conceptaccounting.ca
```

   Exchange can take up to about 2 hours to apply a scope change; the test command shows the
   new result at once, but sending may lag.
3. Vercel: set MAIL_FROM to studio@conceptaccounting.ca in Production and Preview, then redeploy
   the preview.
   Done 2026-11-08 by Hashim: mailbox "Concept Studio", primary SMTP:studio@conceptaccounting.ca,
   aliases app@conceptaccounting.ca and app@xceedcpas.onmicrosoft.com. Scope changed;
   Test-ServicePrincipalAuthorization: studio@ InScope True, hashim@ InScope False.
4. Test: request a password reset on the preview. The email must arrive from "Concept Studio"
   <studio@conceptaccounting.ca>. If it fails with 403, wait and retry (step 2 delay).

### Supabase Send Email hook (Test project)

- Branch preview address (stable for branch claude/modest-euler-ldxydw):
  https://concept-firm-app-git-claude-modest-eu-014c3b-concept-accounting.vercel.app
- Current work branch claude/affectionate-davinci-bfls2w (from 2026-11-08), stable address:
  https://concept-firm-app-git-claude-affection-694391-concept-accounting.vercel.app
  Each push also makes a one-off deployment link; use the stable branch address instead.
  The Send Email hook still points at the modest-euler preview, so links in staff emails open there.
- Vercel Deployment Protection: Vercel Authentication on (previews private to the team).
  A "Protection Bypass for Automation" secret (note: "Supabase email hook") lets Supabase reach
  the hook. It is part of the hook URL saved in Supabase, and nowhere else.
- Supabase Test > Authentication > Auth Hooks > Send Email hook (HTTPS):
  <branch preview address>/api/hooks/send-email?x-vercel-protection-bypass=<bypass secret>
- Hook signing secret: Vercel Preview variable SEND_EMAIL_HOOK_SECRET (Secret).
- Live: needs its own hook (on the live Supabase project) pointing at studio.conceptaccounting.ca,
  with its own signing secret in the Vercel Production environment. No bypass needed there.
- Verified 2026-11-07 23:24 (Toronto): password reset email delivered from app@conceptaccounting.ca and reset completed on the preview.

## Go-live checklist (decision 35)

One step at a time, each confirmed with a screenshot.

1. Done 2026-11-08: live database password reset and saved in the password manager as
   "Supabase – Concept Firm App – Live – database"; GitHub environment "production" with required
   reviewer hashim-awad (self-review allowed), deployment branch main only, secret
   SUPABASE_DB_PASSWORD.
2. Done 2026-11-08: Supabase organization on the Pro plan (US$25/month charged today; Supabase
   estimated US$35/month with both projects). Spend cap on. Micro compute for one project is
   included: Live set to Micro (no extra cost), 2026-11-08.
3. Done 2026-11-08: Vercel Production environment variables (before merging, so the first production build works):
   live Supabase URL and keys, MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_FROM (studio@).
   SEND_EMAIL_HOOK_SECRET follows in step 6.
4. Done Nov 9, 2026: pull request #1 merged into main by Hashim; "Database deploy - Live" approved by
   Hashim and applied all 12 migrations (20261108000000 to 20261108110000) to the live project; Vercel
   production build succeeded. Note: the workflow warns that supabase/setup-cli@v1 runs on a deprecated
   Node version; update the action version at the next workflow change.
5. Domain studio.conceptaccounting.ca on Vercel production (DNS record at the domain host).
6. Supabase Live auth. Done Nov 9, 2026: sign-ups off (manual linking and anonymous sign-ins off, Email
   provider only); login hashim@conceptaccounting.ca created in Authentication > Users (auto-confirmed,
   password in the password manager as "Concept Studio – Live – Hashim"); first owner set with
   private.bootstrap_owner (Hashim Awad, role Owner). Still to do: Site URL and redirect URLs,
   Send Email hook to https://studio.conceptaccounting.ca/api/hooks/send-email.
7. Setup redone in Live: Studio import, signature, GST/HST rates, price book clean-up.
8. Done Nov 9, 2026 (moved before the merge, at Hashim's request): real client data cleared from Test with
   `scripts/test-only/clear-real-client-data.sql`, run by Hashim in the Test SQL editor. Before: 8 clients,
   0 client links, 5 engagements, 0 proposals, 1 document with 1 version, 43 price book items, 9 packages and
   floors. After: 0 clients, engagements, proposals, documents, versions and import runs; price book (43) and
   packages (9) kept. The 1 stored PDF deleted from the Test "documents" bucket. Test now holds no real client data.
9. Vercel Pro paid before Nov 22, 2026; 2FA on Vercel, Supabase and GitHub.
