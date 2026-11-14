// Round 15: the year-end package on screen. The PDF's own pdfmake definitions (fs-pdf.ts) rendered as
// HTML, so the screen and the PDF say exactly the same thing: the same wording, rows, totals and rules.
// Only what the package uses is handled: text runs, stacks, columns, tables, lists, the letterhead
// image, rules and page breaks. Amounts in the statements carry a link to their account details.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from "react";

const PT = 1.3;   // CSS pixels per point on screen
const style = (n: any): React.CSSProperties => {
  const m = Array.isArray(n?.margin) ? n.margin : typeof n?.margin === "number" ? [n.margin, n.margin, n.margin, n.margin] : null;
  return {
    fontWeight: n?.bold ? 700 : undefined, fontStyle: n?.italics ? "italic" : undefined, fontSize: n?.fontSize ? n.fontSize * PT : undefined,
    textAlign: n?.alignment, color: n?.color, lineHeight: n?.lineHeight ? n.lineHeight * 1.2 : undefined,
    ...(m ? { margin: `${m[1] * PT}px ${m[2] * PT}px ${m[3] * PT}px ${m[0] * PT}px` } : {}),
  };
};

export function renderNode(n: any, images: Record<string, string>, key: string | number = 0): ReactNode {
  if (n === null || n === undefined || n === "") return null;
  if (typeof n === "string" || typeof n === "number") return n;
  if (Array.isArray(n)) return n.map((x, i) => <span key={i}>{renderNode(x, images, i)}</span>);
  if (n.pageBreak) return null;
  // eslint-disable-next-line @next/next/no-img-element -- the letterhead is an inline data URL
  if (n.image) return <img key={key} src={images[n.image] ?? n.image} alt="" style={{ width: n.width ? n.width * PT : undefined, display: "block", ...style(n) }} />;
  if (n.canvas) return <hr key={key} className="border-0 border-t border-ink" style={style(n)} />;
  if (n.stack) return <div key={key} style={style(n)}>{n.stack.map((x: any, i: number) => <div key={i}>{renderNode(x, images, i)}</div>)}</div>;
  if (n.columns) return <div key={key} className="flex gap-2" style={style(n)}>{n.columns.map((x: any, i: number) => <div key={i} className={x.width ? "" : "flex-1"} style={{ width: typeof x.width === "number" ? x.width * PT : undefined }}>{renderNode(x, images, i)}</div>)}</div>;
  if (n.ul) return <ul key={key} className="list-disc" style={{ ...style(n), paddingLeft: 18 }}>{n.ul.map((x: any, i: number) => <li key={i}>{renderNode(x, images, i)}</li>)}</ul>;
  if (n.table) return <PdfTable key={key} n={n} images={images} />;
  if (n.text !== undefined) {
    const inner = Array.isArray(n.text) ? n.text.map((r: any, i: number) => typeof r === "string" ? <span key={i}>{r}</span> : <span key={i} style={style(r)}>{renderNode(r.text, images, i)}</span>) : renderNode(n.text, images);
    const content = n.link ? <a href={n.link} className="text-navy-700 underline decoration-dotted underline-offset-2 hover:decoration-solid">{inner}</a> : inner;
    return <div key={key} style={style(n)}>{content === "" || content === " " ? " " : content}</div>;
  }
  return null;
}

function PdfTable({ n, images }: { n: any; images: Record<string, string> }) {
  const widths: number[] = n.table.widths ?? [];
  const grid = !!n.layout?.hLineColor;   // the minute book letter's ruled tables
  return (
    <table className="w-full border-collapse" style={{ ...style(n), fontSize: n.fontSize ? n.fontSize * PT : undefined }}>
      <colgroup>{widths.map((w, i) => <col key={i} style={{ width: typeof w === "number" ? w * PT : undefined }} />)}</colgroup>
      <tbody>{n.table.body.map((row: any[], i: number) => (
        <tr key={i}>{row.map((c: any, j: number) => {
          const b = Array.isArray(c?.border) ? c.border : [false, false, false, false];
          const dbl = !!c?.stack && c.stack.some((x: any) => x?.canvas);
          return (
            <td key={j} className="align-top" style={{ padding: grid ? "3px 6px" : "1px 4px", textAlign: c?.alignment, fontWeight: c?.bold ? 700 : undefined, background: c?.fillColor,
              border: grid ? "0.5px solid #999" : undefined, borderTop: !grid && b[1] ? "1px solid #000" : undefined, borderBottom: !grid && b[3] ? "1px solid #000" : undefined }}>
              {dbl ? <div className="text-right font-bold"><span className="inline-block border-b-[3px] border-double border-ink">{c.stack[0].link ? <a href={c.stack[0].link} className="text-navy-700 underline decoration-dotted underline-offset-2">{c.stack[0].text}</a> : c.stack[0].text}</span></div>
                : renderNode(typeof c === "object" ? { ...c, margin: c.margin, alignment: undefined, border: undefined } : c, images, j)}
            </td>
          );
        })}</tr>
      ))}</tbody>
    </table>
  );
}

// The content of a pdfmake definition, split into pages at each page break.
export function pages(content: any[]): any[][] {
  const out: any[][] = [[]];
  for (const n of content) { if (n?.pageBreak) out.push([]); else out[out.length - 1].push(n); }
  return out.filter((p) => p.length);
}
