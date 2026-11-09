"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { EmptyState } from "./primitives";

export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  align?: "left" | "right";
  width?: string;
};

// Sortable table. Click a header to sort; click again to reverse. Empty state when no rows.
export function DataTable<T extends { id: string }>({ columns, rows, empty, caption }: {
  columns: Column<T>[]; rows: T[]; empty?: { title: string; description?: string; action?: ReactNode }; caption?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const x = col.sortValue!(a), y = col.sortValue!(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort, columns]);

  if (rows.length === 0) return <EmptyState title={empty?.title ?? "Nothing here yet"} description={empty?.description} action={empty?.action} />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-sand-200">
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const Icon = !active ? ChevronsUpDown : sort!.dir === 1 ? ChevronUp : ChevronDown;
              return (
                <th key={c.key} scope="col" style={{ width: c.width }} aria-sort={active ? (sort!.dir === 1 ? "ascending" : "descending") : undefined}
                  className={`px-4 py-2.5 text-[11px] font-semibold tracking-wider text-ink-3 uppercase ${c.align === "right" ? "text-right" : ""}`}>
                  {c.sortValue ? (
                    <button type="button" onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}
                      className={`inline-flex items-center gap-1 uppercase hover:text-ink ${active ? "text-ink" : ""}`}>
                      {c.header}<Icon className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : c.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.id} className="border-b border-sand-100 transition-colors last:border-0 hover:bg-sand-50">
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 align-middle ${c.align === "right" ? "text-right tabular-nums" : ""}`}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
