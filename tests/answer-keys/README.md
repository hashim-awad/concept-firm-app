# Answer keys (CloseBook2, piece CB2-0 step 1)

Each folder is one dummy client with all its Closebook files. `tables/` holds the client's rows exactly as saved
(client setup, opening balances, bank and card lines with their coding, entries, schedule inputs and the rest).
`answer.json` holds what the engine must say about each file: the trial balance by account (Prior, Prelim, Adj's,
Reclass, Final), net income, every GIFI line and every GST/HST return line.

- Run: `npm run answer-keys` (local database and app setup only; it refuses any other host). Every folder must pass.
- Add a file: build it on the local app with dummy data, then
  `node --import ./scripts/answer-keys/register.mjs scripts/answer-keys/export.ts <client id> <folder>` and
  `npm run answer-keys -- <folder> --write`. One new folder, no code.
- Change an expected figure: only with a written reason in the PR (`--write` rewrites the answer key).
- Dummy data only. No real client names or figures.

## Answer keys given as CSV files (`source/`)
Some keys are written by hand (a disguised real file, tests only). `scripts/answer-keys/build-from-csv.ts <csv folder>
<folder>` builds the client through the app's own save functions (file, setup, step 2, bank accounts, CSV import,
coding with splits, entries), saves it as a normal folder and copies the CSV files to `source/`. Every run also checks
the engine against `source/answer_key.json`; `known-differences.json` lists any expected difference with its reason.
`tests/closebook-answer-key-schedules.test.ts` checks the schedule calculators against `source/schedule_inputs.json`.
Never copy a figure, name or description from `source/` into code, docs, screens or other tests.
