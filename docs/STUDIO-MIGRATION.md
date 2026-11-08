# Phase 1: Concept Studio into the app — migration plan

Status: plan, 2026-11-08. Source of truth for what Studio does: `reference/studio/` (EL v3.31).

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

## Open questions for Hashim

See the latest message in the build conversation; answers are recorded in `docs/BRIEF.md`.
