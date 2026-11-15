"use client";
// New year-end file, the year (Hashim, Nov 15, 2026; benchmark ProFile's tax year dates): one line worked
// out from the previous year end, "Year: Sep 1, 2025 to Aug 31, 2026 · 12 months", with Change. Only
// Change shows the start and end dates. The reason is asked only when the year is not 12 months.
import { useState } from "react";
import { formatDate } from "@/lib/dates";
import { yearPeriod } from "@/lib/closebook/files";

export function YearLine({ defaultStart, defaultEnd }: { defaultStart: string; defaultEnd: string }) {
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [editing, setEditing] = useState(!defaultEnd);
  const p = yearPeriod(start, end);
  return (
    <div className="grid gap-3">
      <input type="hidden" name="year_start" value={start} />
      <input type="hidden" name="year_end" value={end} />
      <div>
        <span className="label">2. Year</span>
        {!editing ? (
          <p className="text-sm">
            Year: <b className="font-semibold">{formatDate(start)} to {formatDate(end)}</b> · {p.text}{" "}
            <button type="button" onClick={() => setEditing(true)} className="ml-1 text-navy-700 underline">Change</button>
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="ye_start" className="label">Start</label>
              <input id="ye_start" type="date" value={start} onChange={(e) => setStart(e.target.value)} required className="input" /></div>
            <div><label htmlFor="ye_end" className="label">End (the year-end)</label>
              <input id="ye_end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} required className="input" /></div>
            <p className="text-sm text-ink-2 sm:col-span-2">{start && end ? <>{formatDate(start)} to {formatDate(end)} · {p.text}</> : "Enter both dates."}</p>
          </div>
        )}
      </div>
      {start && end && !p.full && (
        <div><label htmlFor="reason" className="label">Reason the year is not 12 months</label>
          <input id="reason" name="reason" required maxLength={300} placeholder="For example: short first year, incorporated May 15" className="input" /></div>
      )}
    </div>
  );
}
