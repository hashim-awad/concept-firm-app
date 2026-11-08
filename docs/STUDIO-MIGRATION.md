# Phase 1: Concept Studio into the app — migration plan

Status: built, 2026-11-08. Waiting for Hashim's import and sign-off (see the end). Source of truth for what Studio does: `reference/studio/` (EL v3.31).

## What Studio is today

One HTML page on claude.ai (about 2,700 lines of JavaScript). It reads and writes Notion through
Claude's Notion connector. PDFs are made in the browser with pdfmake 0.2.7 and pdf-lib 1.17.1.
Studio does not store PDFs: it builds them when someone presses Download.

### Notion databases Studio uses

| Studio name | Notion data source | Holds | Phase 1 | How it moves in |
|---|---|---|---|---|
| Clients | 4aba89ff… | Client records (names, signers, addresses) | Yes | Owner import screen (client data) |
| Engagements | 0de2dbc7… | One row per letter, incl. "Letter data" JSON (corporate) | Yes | Owner import screen (client data) |
| Proposals | 703dc73f… | Proposals sent, incl. "Options data" JSON | Yes | Owner import screen (client data) |
| Price Floors | 3448ec94… | 9 packages/offers with floors + 25 T1 price book rows | Yes | Owner import screen |
| Service Catalog | 113b1186… | 39 services, codes, income accounts, QBO/TaxDome mapping | Yes | Owner import screen |
| Quality log | 267e634a… | Quality management log (staff, inspection items) | No (Phase 3) | Not read |
| CFO clients, CFO months | 9b490aea…, 6c0af462… | Monthly CFO reports | No (later) | Not read |

Read so far (allowed by Hashim, read only): structure of all five Phase 1 databases; full
contents of Price Floors and Service Catalog only. No client names found in either.

### Wording and rules that live in Studio's code (not Notion)

- Corporate master letter with service schedules: `build()`, `appendixA()`, `TERMS`, `checks()`.
- T1 letter: `buildT1()`, `T1_TD`, `t1Checks()`, CRA authorization steps.
- Proposals: `pBuild()`, `pChecks()`, `floorFor()` (price floor check), `pTotals()`.
- T1 pricing calculator: `T1C_ITEMS`, `t1cCalc()`.
- Template library: `TEMPLATES`, approval flow (`tplApproval`).
- PDF layout: `pdfDoc()`, `runsToPdf()`, `sigBlock()`; letterhead and signature images.
- Version: `EL_VERSION = "EL v3.31"`, approved 2026-10-29.

## How the app reaches parity

1. **Same engine.** The document builders are ported to TypeScript almost line for line, in
   `src/lib/studio/`. The wording becomes versioned data (template library, EL v3.31) with
   owner approval, but the text is copied exactly.
2. **Same PDF library.** The app uses pdfmake with the same document definitions, so layout,
   fonts and page breaks match.
3. **Automatic parity test.** A test loads Studio's original functions from
   `reference/studio/` in a sandbox and runs them side by side with the app's port on the same
   inputs. The document text and the PDF definitions must be identical. Every case in the test
   suite uses dummy data.
4. **Hashim's five cases.** The five PDFs Hashim makes in Studio (dummy names) are rebuilt in the
   app and shown side by side before Phase 1 is called done.

## What the app adds

- Records in the app's own database (Canada), not Notion. Staff logins, roles and the activity log.
- Every generated letter and proposal is stored in the document vault as a PDF, with versions.
  A revised letter is a new version. Nothing is overwritten.
- GST/HST rate table (decision 22) for proposals and quotes.
- Hashim's signature image stored privately in Supabase Storage, uploaded once by an owner.
- Owner-only import screen: upload Notion CSV exports; the app reads them directly into the
  database. Client data never passes through the repo or this chat.

## Build order

1. Data model: clients and links, catalogue (extended with codes, income accounts, QBO/TaxDome
   mapping), offers and floors, template library, engagements, proposals, documents and versions,
   tax rates. Row level security and activity log as before.
2. Import screen (owner only) with a dry run that shows counts and problems before saving.
3. Price book, floors and packages, template library screens.
4. Letter engines (corporate, T1) and proposal engine, ported, with the automatic parity test.
5. Letter and proposal screens (stepper and live preview, like Studio), PDF output, vault.
6. Tax rates screen and approval.
7. Side-by-side parity review with Hashim's five cases. Then Hashim invites the team.

## How parity is proven (all automatic, every push, dummy data only)

| Test | What it compares | File |
|---|---|---|
| Engine copy | The app's engine file must equal what the extractor copies from Studio's page today | CI step "Engine copy matches" |
| Engine parity | Studio's own functions vs the app's copy: checks, letter blocks, PDF definitions, T1 calculator | `tests/studio/parity.test.mjs` |
| Screen logic | The app's screen rules (defaults, fee lines, billing rules, packages, accepted proposal to letter) vs Studio's forms | `tests/studio/parity.test.mjs` |
| Screens | One list of typing and clicks is played on Studio's page and on the app's real screens. Required equal: letter inputs, checks shown on screen, document text, PDF definition, file name, preview HTML | `tests/studio/screens.test.mjs` |
| Server | The server rebuilds each document from the screen's inputs and gets the same result; Final rules hold on the server; each case renders a real PDF, also in the production build | `tests/studio-build.test.ts`, `screens.test.mjs` |
| Import | Notion CSV reading and mapping; a past proposal regenerates with the same text | `tests/import.test.ts` |

A one-field difference on the app side fails every screen case (checked by hand once, on purpose).
The only wording allowed to differ on screen: Studio's button "Save client to Concept Studio" is
"Save client" in the app.

The screen test runs the app with `STUDIO_HARNESS=1`, which opens the test-only page
`/studio-harness/...`. Never set `STUDIO_HARNESS` on Vercel; without it the page is "not found".

## Differences from Studio, on purpose

- Download also files the PDF in the vault as a new version. A Final letter records the
  engagement (EL sent) in the same step; Studio needed a second click.
- Final proposals need an approved GST/HST rate for the client's province (decision 22). Shown
  above the checks, so Studio's checks list stays the same.
- Template approvals are stored in the app (Studio kept them in the Quality log, Phase 3).
  Trial templates approved in Studio show "Awaiting approval" until approved again here.
- Regenerated past documents carry no signature image, only the label on every page.
- Studio did not save a proposal's "What we heard" lines or the price-book offer per option,
  so regenerated proposals leave those blank.

## What Hashim does before the team is invited

1. Settings: check the signer names; upload the signature image (PNG).
2. Admin, Import from Studio: export each Studio database from Notion as CSV; for each file
   press Check, read it, then Import. Order: Price Floors, Service Catalog, Clients,
   Engagements, Proposals. Then regenerate past letters and apply the floor corrections.
3. GST/HST rates: enter the rates for ON, AB and BC after checking the CRA page, then approve.
4. Template library: approve the trial templates you approved in Studio.
5. Side-by-side review with your five cases (dummy names): make each in Studio and in the app.

## After the switch (decision 30, from 2026-11-09)

The app is the only source of truth; Studio is retired. Studio parity is now a baseline check:
with no wording edits, the app must still produce exactly EL v3.31 (the tests above keep
running for that). Wording is edited in the app:

- `scripts/wordify.mjs` turns each piece of client-facing wording in the copied engine into
  an editable piece (`__W`/`__WH`), keyed by a hash of the original text. The list of pieces is
  `src/lib/studio/wording.generated.json`.
- Database: `wording_versions` (draft, approved, one current) and `wording_texts` (only the
  pieces that differ from EL v3.31). Owners approve; an earlier version can be made current
  again with a reason. Approved versions never change.
- Screens: Template library, Wording versions. Click wording in the sample documents, edit,
  save in the draft, approve. New letters use the current version; each PDF records which.
- Not editable yet: the order of sections, adding or removing a clause, and which section a
  service adds. Those are structure, still in code; ask for them as a change.
