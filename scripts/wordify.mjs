// Moves the client-facing wording in Studio's engine code into editable text, without changing
// any output. Each piece of wording becomes a call: __W(key, original, [values]) (or __WH in
// code that builds HTML). With no edits, the call returns exactly the original text, so the
// engine's output is unchanged byte for byte (the parity tests prove it). With an approved
// wording version, the call returns the edited text.
//
// A "piece" is a sentence as the code builds it: the literal text with {1}, {2}... where the
// code inserts a value (client name, year end, fee). The key is a hash of the original piece,
// so the same sentence used in the PDF and in the preview is edited once.
import { createHash } from "node:crypto";
import * as walk from "acorn-walk";

// Functions and constants that hold letter, proposal and terms wording.
export const WORD_FUNCTIONS = new Set(["periodInfo", "statementsList", "svcList", "build", "appendixA", "sigBlock", "pdfDoc", "termsClient", "buildT1",
  "t1TdHtml", "t1TdText", "craAppSteps", "t1Html", "pBuild", "pHtml", "pPdf", "sigH", "render", "syncFees", "feeText"]);
export const WORD_CONSTANTS = new Set(["BASIS", "TYPES", "TERMS", "T1_TD", "PSVC", "FEE_SVC", "FEE_PRESETS"]);
const HTML_FUNCTIONS = new Set(["t1TdHtml", "t1Html", "pHtml", "sigH", "render"]);
// Text compared in the code: both sides go through the same editable piece, so they stay equal.
const COMPARED_WORDING = new Set(["Personal information", "Next steps"]);
// Property names whose values are layout or data, never wording.
const DATA_KEYS = new Set(["k", "lvl", "key", "tag", "kind", "type", "image", "style", "alignment", "pageSize", "pageOrientation", "color", "fillColor",
  "decoration", "font", "layout", "url", "prov", "mode", "id", "width", "fit", "headerRows", "widths"]);
const STRING_CALLS = new Set(["indexOf", "lastIndexOf", "includes", "startsWith", "endsWith", "split", "replace", "match", "test", "join",
  "localeCompare", "getElementById", "querySelector", "querySelectorAll", "setAttribute", "getAttribute", "createElement", "toggle", "add", "remove"]);

// A plain name for a fill-in, from the code that fills it (shown as [Company name]).
const FILL_NAMES = [
  [/__W\(|__WH\(|sameWay|later\?/, "Optional wording"], [/^TXc?$|\bTX\b/, "GST or HST"], [/P\.unit/, "year or period"], [/yeTxt/, "Year-end date"],
  [/P\.phrase/, "Period"], [/tense/, "ending or ended"], [/^Y\+1$/, "Next year"], [/^Y$/, "Year"], [/letter|^L$|T\.comp\?/, "Appendix letter"],
  [/^ow$/, "Owner names"], [/statementsList/, "Statements"], [/basisCustom/, "Agreed basis"], [/s\.corp/, "Company name"], [/pl\?"s"/, "Plural ending"],
  [/^det/, "Detail line"], [/b\.(confirm|add)\.join/, "Tax accounts"], [/EXL/, "Work not included"], [/^rt$/, "Rate"], [/^cur$/, "Current item"], [/^bt$/, "Bold text"],
  [/FIRM_ADDR/, "Firm address"], [/SIGNER_TITLE/, "Firm signer title"], [/\bSIGNER\b/, "Firm signer"], [/\bFIRM\b/, "Firm name"],
  [/EL_VERSION_DATE/, "Wording date"], [/EL_VERSION/, "Wording version"], [/CRA_GROUP/, "CRA Group ID"], [/CRA_REP/, "CRA RepID"],
  [/signerTitle/, "Signer title"], [/\bsigner\b|\.signer\b|\bwho\b/, "Signing officer"], [/salutation/, "Salutation"],
  [/letterDate/, "Letter date"], [/taxYear/, "Tax year"], [/periodStart|catchFrom/, "Start date"], [/catchTo/, "End date"], [/startMonth/, "Billing start"],
  [/pValidUntil|valid/, "Valid until"], [/\bye\b|\.ye\b|fye/, "Year end"], [/tpName|thirdParty/, "Third party"], [/extAcct/, "External accountant"],
  [/t1Owner|t1Name|t1Names|people|\bnames?\b/, "Taxpayer names"], [/contact/, "Contact name"], [/\bco\b|company|\.name\b/, "Client name"],
  [/province|prov|PROV/, "Province"], [/svcList|services|\bsvc\b/, "Services"], [/periodInfo|period/, "Period"],
  [/money\(|amt|fee|total|annual|price/, "Amount"], [/fmtD\(|fmtMonth\(|date/i, "Date"], [/\.length|count|qty|\bn\b|\bi\b|\bc\b|\bt\b/, "Number"],
];
export function fillName(src) { for (const [re, name] of FILL_NAMES) if (re.test(src)) return name; if (process.env.FILL_DEBUG) console.log("DETAIL:", src.slice(0, 160)); return "Detail"; }
const nameFills = (srcs) => { const seen = {}; return srcs.map((x) => { const n = fillName(x); seen[n] = (seen[n] || 0) + 1; return n; }).map((n, i, all) => (all.filter((m) => m === n).length > 1 ? `${n} ${all.slice(0, i + 1).filter((m) => m === n).length}` : n)); };

export const keyOf = (text) => "w" + createHash("sha1").update(text).digest("hex").slice(0, 10);
const isStr = (n) => n && n.type === "Literal" && typeof n.value === "string";
const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));

// Is this text wording a client reads (not a code value, colour, CSS or data key)?
export function isWording(t) {
  if (!/[A-Za-z]/.test(t) || /:\/\/|^#|^data:|^[\w-]+:[\w-]/.test(t.trim())) return false;
  const s = t.trim();
  if (/[A-Za-z]{2,}[^A-Za-z]+[A-Za-z]{2,}/.test(s) && /\s/.test(s)) return true; // two or more words
  return /^[A-Z][a-z]{2,}[.:]?$/.test(s); // one capitalised word: "Included", "None", "Fees"
}

// Context where a literal is a code value, not wording.
function excluded(anc) {
  for (let i = anc.length - 2; i >= 0; i--) {
    const p = anc[i], c = anc[i + 1];
    if (p.type === "BinaryExpression" && ["===", "!==", "==", "!=", "in"].includes(p.operator)) return "compare";
    if (p.type === "MemberExpression" && p.property === c && p.computed) return true;
    if (p.type === "Property" && p.key === c) return true;
    if (p.type === "Property" && p.value === c && !p.computed && DATA_KEYS.has(p.key.name ?? p.key.value)) return true;
    if (p.type === "SwitchCase" && p.test === c) return true;
    if (p.type === "CallExpression" && p.arguments.includes(c)) {
      const callee = p.callee;
      const name = callee.type === "MemberExpression" ? (callee.property.name ?? callee.property.value) : callee.name;
      if (STRING_CALLS.has(name) || name === "$") return true;
      return false;
    }
    if (p.type === "BinaryExpression" && p.operator === "+") continue; // part of a sentence: keep looking up
    if (["ArrayExpression", "Property", "VariableDeclarator", "ReturnStatement", "AssignmentExpression", "ConditionalExpression", "LogicalExpression", "CallExpression", "NewExpression", "ExpressionStatement", "SequenceExpression"].includes(p.type)) return false;
  }
  return false;
}

// Transform one top-level statement. Returns its new source and the wording pieces found.
export function wordifyStatement(code, node, name) {
  const html = HTML_FUNCTIONS.has(name);
  const units = []; // { start, end, build(emit) }
  const pieces = [];

  // Leaves of a left-associative + chain: "a" + x + "b" -> ["a", x, "b"]; also the sub-chain nodes.
  const leavesOf = (n) => {
    const out = [], nodes = [];
    let cur = n;
    const rights = [];
    while (cur.type === "BinaryExpression" && cur.operator === "+") { nodes.unshift(cur); rights.unshift(cur.right); cur = cur.left; }
    out.push(cur, ...rights);
    return { leaves: out, nodes }; // nodes[k] covers leaves[0..k+1]
  };
  const chainRoot = (n, anc) => {
    const p = anc[anc.length - 2];
    return n.type === "BinaryExpression" && n.operator === "+" && !(p && p.type === "BinaryExpression" && p.operator === "+" && p.left === n);
  };

  walk.ancestor(node, {
    BinaryExpression(n, _s, anc) {
      if (!chainRoot(n, anc)) return;
      const { leaves, nodes } = leavesOf(n);
      if (!leaves.some((l) => isStr(l))) return;
      const ctx = excluded(anc);
      if (ctx === true) return;
      if (ctx === "compare") return; // a sentence compared in code: none in the engine today
      planChain(n, leaves, nodes);
    },
    Literal(n, _s, anc) {
      if (!isStr(n)) return;
      const p = anc[anc.length - 2];
      if (p && p.type === "BinaryExpression" && p.operator === "+") return; // handled with its chain
      const ctx = excluded(anc);
      if (ctx === "compare" && COMPARED_WORDING.has(n.value)) { planChain(n, [n], []); return; }
      if (ctx) return;
      planChain(n, [n], []);
    },
  });

  function planChain(root, leaves, nodes) {
    // Group leading values before the first text, exactly as the code adds them.
    const first = leaves.findIndex(isStr);
    const items = [];
    if (first > 1) items.push({ expr: nodes[first - 2] });
    else if (first === 1) items.push({ expr: leaves[0] });
    for (const l of leaves.slice(first)) items.push(isStr(l) ? { text: l.value, raw: code.slice(l.start + 1, l.end - 1) } : { expr: l });

    if (!html) {
      const textParts = items.filter((x) => x.text != null);
      if (!textParts.some((x) => isWording(x.text))) return;
      units.push({ start: root.start, end: root.end, build: (emit) => {
        let t = "", args = [];
        for (const it of items) { if (it.text != null) t += it.text; else { args.push(emit(it.expr.start, it.expr.end)); t += "{" + args.length + "}"; } }
        pieces.push({ key: keyOf(t), text: t, fn: name, html: false, fills: nameFills(args) });
        return `__W(${JSON.stringify(keyOf(t))}, ${JSON.stringify(t)}, [${args.join(", ")}])`;
      } });
      return;
    }

    // HTML: split into tag code and text runs. Values inside a tag (attributes) stay with the tag.
    const segs = []; // { kind: "tag"|"text", parts: [{text,raw}|{expr}] }
    let inTag = false;
    const push = (kind, part) => { const last = segs[segs.length - 1]; if (last && last.kind === kind) last.parts.push(part); else segs.push({ kind, parts: [part] }); };
    for (const it of items) {
      if (it.expr) { push(inTag ? "tag" : "text", it); continue; }
      const v = it.text;
      let buf = "";
      for (let i = 0; i < v.length; i++) {
        const ch = v[i];
        if (!inTag && ch === "<" && /[A-Za-z/!]/.test(v[i + 1] ?? "")) { if (buf) push("text", { text: buf }); buf = ch; inTag = true; continue; }
        buf += ch;
        if (inTag && ch === ">") { push("tag", { text: buf }); buf = ""; inTag = false; }
      }
      if (buf) push(inTag ? "tag" : "text", { text: buf });
    }
    const hasWording = segs.some((s) => s.kind === "text" && isWording(s.parts.filter((p) => p.text != null).map((p) => p.text).join(" ")));
    if (!hasWording) return;
    units.push({ start: root.start, end: root.end, build: (emit) => {
      const out = [];
      for (const s of segs) {
        const words = s.parts.filter((p) => p.text != null).map((p) => p.text).join(" ");
        if (s.kind === "text" && isWording(words)) {
          let raw = "", args = [];
          for (const p of s.parts) { if (p.text != null) raw += p.text; else { args.push(emit(p.expr.start, p.expr.end)); raw += "{" + args.length + "}"; } }
          const plain = decode(raw);
          pieces.push({ key: keyOf(plain), text: plain, fn: name, html: true, fills: nameFills(args) });
          out.push(`__WH(${JSON.stringify(keyOf(plain))}, ${JSON.stringify(raw)}, [${args.join(", ")}])`);
        } else {
          for (const p of s.parts) out.push(p.text != null ? JSON.stringify(p.text) : "(" + emit(p.expr.start, p.expr.end) + ")");
        }
      }
      // Keep string concatenation from the first part on, as the original did.
      return out.length === 1 ? out[0] : "(" + out.join("+") + ")";
    } });
  }

  // Emit source for a range, applying the outermost units inside it (each unit emits its parts).
  units.sort((a, b) => a.start - b.start || b.end - a.end);
  const emit = (start, end) => {
    let s = "", pos = start;
    for (const u of units) {
      if (u.start < pos || u.end > end || u.start < start) continue;
      s += code.slice(pos, u.start) + u.build(emit);
      pos = u.end;
    }
    return s + code.slice(pos, end);
  };
  return { source: emit(node.start, node.end), pieces };
}

// Runtime helpers placed at the top of the engine factory.
export const RUNTIME = `
  // Approved wording edits: { key: text }. Missing keys use the original EL v3.31 wording.
  var __WO = env.WORDING || {};
  // Wording editor only: wrap each piece in invisible markers so the preview can show it as clickable.
  var __WM = !!env.WORDING_MARK;
  function __plain(x) { return String(x).replace(/\\uE000[^\\uE001]*\\uE001/g, "").replace(/\\uE002/g, ""); }
  function __mk(k, s, a) { return __WM ? "\\uE000" + k + "\\uE003" + encodeURIComponent(JSON.stringify(a.map(__plain))) + "\\uE001" + s + "\\uE002" : s; }
  function __fill(t, a) { return t.replace(/\\{(\\d+)\\}/g, function (m, i) { return i - 1 < a.length ? String(a[i - 1]) : m; }); }
  function __W(k, t, a) { var o = __WO[k]; return __mk(k, __fill(o == null ? t : o, a), a); }
  function __WH(k, t, a) { var o = __WO[k]; return __mk(k, __fill(o == null ? t : esc(o), a), a); }
`;
