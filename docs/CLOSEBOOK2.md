# CloseBook2: the rules

Set by Hashim, Nov 21, 2026 (piece CB2-0). Closebook is being rebuilt as CloseBook2: the engine stays, the shell is
replaced in later phases. CloseBook2 is built as if it were a product. Nothing in it may depend on how Concept works.

**This file wins.** Where docs/PHASE3-BATCH.md, the Step 5 decision log in docs/BRIEF.md, or any earlier piece disagrees
with this file, this file governs. Piece ST1 is cancelled; piece CB2-0 replaces it.

## The rules

1. **Basic tools, no code.** If a QBO or CaseWare user could handle a situation with basic tools, a CloseBook2 user
   handles it the same way. Code changes are only for bugs and new features, never for a client's unusual facts.
2. **Feel like QBO.** Wherever QBO has a feature, copy its name, place and behaviour.
3. **The model.** Books works like QBO. Workpapers works like CaseWare and organizes the same ledger. An adjustment made
   in Workpapers is an ordinary journal entry in the books and flows to every report. One ledger; everything reads it
   live. A copy is made only when something is filed or locked.
4. **Report what was coded, never assume.** CloseBook2 never decides what a transaction means.
5. **One checkbox on every entry: "Reclass entry"**, unticked by default. Unticked = adjusting (Adj's column). Ticked =
   Reclass column. No rule, permission or block depends on it.
6. **Trial balance by group columns:** Prelim, Adj's, Reclass, Final, Prior, $ change, % change. Journal footer: net
   income before entries, adjusting entries, reclass entries, adjusted net income.
7. **No thresholds anywhere.**
8. **Bank rules stay, QBO style:** suggest, user confirms, auto-confirm optional per rule.
9. **An entry dated in a filed sales tax period** shows on the next return in the Exceptions column (later phase).
10. **Clients who keep their own books:** trial balance imported once; CloseBook2 books the year-end entries; the entry
    list is exported after the T2 is filed. Never imported twice (later phase).
11. **CloseBook2 has its own Settings** for accounting and tax; Studio Settings keep users, roles, pricing, letters,
    signing, firm name and letterhead (later phase).
12. **Product-ready:** firm ID on every CloseBook2 table with row-level security; no Concept constant in code; provinces
    and tax rates as data; tax software as a setting; two-factor sign-in.
13. **Only four hard stops:** an unbalanced entry, posting to a total line, a locked period or file, and a compilation
    report dated before the MAL is signed. Everything else is a warning.
14. **Record everything, show only what the task needs** (Hashim, Nov 21, 2026; wins over anything earlier, including
    the first step 2 instruction).
    1. Record everything; show only what the user needs for the task in front of them. Logs, history and change trails
       live behind a menu (like QBO "Audit history"), never pushed onto the screen.
    2. Never force a step on the accountant: no blocking, no re-sign, no confirm prompts, no banners, tags or pop-ups
       about what changed. The accountant decides when to look.
    3. A sign-off is a person's act. Only that person can undo it. Software never stamps, clears or reopens it.
    4. Fewest clicks wins. Every change proposed states the clicks it adds for the preparer and the reviewer.
    5. When in doubt, cut.
    6. Report flows as clicks, not screenshots.
15. **Built from the end product backwards** (Hashim, Nov 21, 2026, CB2-0 version 7). The old ten-step shell (steps,
    step sign-offs, step screens, step texts) is frozen and is deleted at switch-over. No work on old screens, step wording,
    step sign-offs, redirects on old screens or old-screen UI findings. Only the engine carries over: ledger and postings,
    bank lines and coding, entries, schedule calculators, GIFI, GST/HST calculations, statements generation, History,
    answer keys. Frozen is not broken: the old screens keep loading so finished files can be read. If an engine change
    breaks an old screen, the smallest change that keeps it loading, nothing more.
16. **Agents** (Hashim, Nov 21, 2026, CB2-0 version 7). No agent runs on the builder's own initiative.
    1. Tests run in GitHub Actions on every PR. No agent runs tests.
    2. spec-checker: exactly one run per PR, just before Hashim merges, checking only against the piece message and this
       file. One round. Only defects against the piece message are fixed; everything else goes to docs/cb2/for-later.md.
    3. security-risk: once at the end of each phase, only when Hashim's message says "Run security audit".
    4. Tax update: January and July, only when Hashim says "Run tax update".
    5. Every other agent: only when Hashim names it in a message.
    6. Agents never add scope.

## Phases
- **Phase 0 (CB2-0): engine clean.** Answer-key tests; sign-offs never cleared; no gates or redirects; refusals become
  warnings; no thresholds; one "Reclass entry" checkbox; figures from the ledger only; type over any worked-out figure;
  firm ID and row-level security; inventory of Concept constants. No new screens.
- Later phases: new window, menu, logo, Books and Workpapers screens, Sales tax centre, schedules with an account per
  line, CloseBook2 Settings pages, trial balance import, Exceptions column.
