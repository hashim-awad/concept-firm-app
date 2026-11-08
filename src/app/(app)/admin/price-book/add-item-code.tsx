"use client";

import { useState } from "react";

// Service line and code fields for "Add an item": the code follows the chosen line.
export function LineAndCode({ lines }: { lines: { id: string; name: string; suggestion: string }[] }) {
  const [code, setCode] = useState(lines[0]?.suggestion ?? "");
  return (
    <>
      <div>
        <label htmlFor="service_line_id" className="label">Service line</label>
        <select id="service_line_id" name="service_line_id" className="input" required
          onChange={(e) => setCode(lines.find((l) => l.id === e.target.value)?.suggestion ?? "")}>
          {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="code" className="label">Code</label>
        <input id="code" name="code" required pattern="[A-Za-z0-9][A-Za-z0-9_\-]{1,39}" value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())} className="input uppercase" />
        <p className="mt-1 text-xs text-muted">Suggested from the service line. Short ID used by rules. Cannot be changed later.</p>
      </div>
    </>
  );
}
