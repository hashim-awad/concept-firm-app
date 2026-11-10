// Business-hours clock (Phase 2 batch, section 3). Counts minutes only inside the business hours set
// in Settings, in Toronto time, so the My day timer and the 45-minute reminder pause overnight and on
// closed days. Daylight saving changes are handled through the Toronto time zone. If no day is open
// (hours not set yet), every minute counts, so alerts still go out. Pure: runs in the browser too.
export type BusinessHours = Record<string, [string, string] | null>;

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const TZ = "America/Toronto";
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function parts(ms: number) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
// Toronto clock minus UTC, in minutes, at a moment.
function offsetMinutes(ms: number) {
  const p = parts(ms);
  return (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ms / 60000) * 60000) / 60000;
}
// The moment a Toronto wall-clock time happens.
export function torontoTime(y: number, m: number, d: number, hh: number, mm: number): number {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const first = wall - offsetMinutes(wall) * 60000;
  return wall - offsetMinutes(first) * 60000;
}

const hm = (s: string) => s.split(":").map(Number) as [number, number];
const anyOpen = (h: BusinessHours | null | undefined) => !!h && WEEKDAYS.some((d) => h[d]);

export function businessMinutes(from: Date | string | number, to: Date | string | number, hours: BusinessHours | null | undefined): number {
  const a = +new Date(from), b = +new Date(to);
  if (!(b > a)) return 0;
  if (!anyOpen(hours)) return Math.floor((b - a) / 60000);
  const start = parts(a);
  let total = 0;
  for (let i = 0, day = Date.UTC(start.y, start.m - 1, start.d); i < 400; i++, day += 86400000) {
    const dt = new Date(day);
    const [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
    if (torontoTime(y, m, d, 0, 0) >= b) break;
    const w = hours![WEEKDAYS[dt.getUTCDay()]];
    if (!w) continue;
    const s = torontoTime(y, m, d, ...hm(w[0])), e = torontoTime(y, m, d, ...hm(w[1]));
    total += Math.max(0, Math.min(b, e) - Math.max(a, s));
  }
  return Math.floor(total / 60000);
}

// True when the firm is open at this moment (or when hours are not set).
export function isOpen(at: Date | string | number, hours: BusinessHours | null | undefined): boolean {
  if (!anyOpen(hours)) return true;
  const ms = +new Date(at), p = parts(ms);
  const w = hours![WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]];
  return !!w && ms >= torontoTime(p.y, p.m, p.d, ...hm(w[0])) && ms < torontoTime(p.y, p.m, p.d, ...hm(w[1]));
}

export function formatWaiting(minutes: number): string {
  if (minutes < 60) return `Waiting ${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `Waiting ${h} h${m ? ` ${m} min` : ""}`;
}

// The second email goes when the quote is not marked sent within this many business minutes.
export const REMINDER_MINUTES = 45;
// Leads still waiting for a quote to go out: New, or Quote ready but not sent. Call needed leads wait
// for a call, not a quote, so they get no reminder.
export const WAITING_STATUSES = ["new", "quoted"];
