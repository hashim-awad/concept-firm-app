# Change log additions for piece UI1 (draft for the builder)

The app's change log is `src/lib/changelog.ts` (Settings, Change log). Its Nov 20, 2026 entry, "New look for staff
screens", is already in main (PR #109, e5b3ead). The docs keeper writes only in docs/, so these are suggested additions
for the builder to paste into that entry's `points`, in a later small PR. Each is a change staff will notice that the
entry does not yet say.

1. Change the sign-off point's last sentence from "Click a tag to sign or take back, as before." to:

```ts
      "Sign-offs are tags: blue Prepared and green Reviewed with initials and date; grey Not prepared or Not reviewed. A Sign button sits beside a grey tag if you have the right. Click a tag to open the sign-off box, as before. Banking shows In progress until 3.1, 3.2 and 3.3 are all signed, and names everyone who signed them.",
```

2. Add after the File tabs point:

```ts
      "Reports open from the Reports tab only. The Trial balance tab's left panel now holds the views (Groups, Accounts).",
      "On windows narrower than 1440 px, the header shows an amber dot and Not final when accounts are not yet assigned, and People shows initials only.",
```

3. Add after the Trial balance point:

```ts
      "The trial balance scrolls in its own box, so the headings and the footer stay on screen. The group path is in the toolbar. A hint to scroll sideways shows only when there are more columns to see.",
```

4. Add to the end of the Quotes point, or as its own point:

```ts
      "The Letters tab uses the same status words as Quotes: Sent, Viewed, Withdrawn.",
```
