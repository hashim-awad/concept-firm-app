"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Picker, type PickOpt } from "./picker";
import { addClient } from "./actions";

const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];

// Add a client: one of Studio's clients, or by hand (a firm without Studio).
export function AddClient({ studio }: { studio: PickOpt[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const [province, setProvince] = useState("ON");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)} data-add-client><Plus className="h-4 w-4" />Add client</button>;
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 bg-navy-950/30" />
      <aside role="dialog" aria-modal="true" aria-label="Add client" className="absolute inset-y-0 right-0 w-[min(26rem,100vw)] bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-[16px] font-bold">Add client</h2><button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 hover:bg-sand-100"><X className="h-5 w-5" /></button></div>
        <form className="grid gap-3.5" onSubmit={(e) => { e.preventDefault(); start(async () => {
          setError(null);
          const r = await addClient(name, province, pick || null);
          if (!r.ok) { setError(r.error); return; }
          router.push(`/cb/${r.id}/overview`);
        }); }}>
          {studio.length > 0 && <div className="grid gap-1"><span className="label">From Studio&rsquo;s clients</span><Picker ariaLabel="Studio client" value={pick} onChange={setPick} options={studio} allowEmpty emptyLabel="None: type the name below" placeholder="Choose" /></div>}
          {!pick && <>
            <label className="grid gap-1"><span className="label">Client name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label className="grid gap-1"><span className="label">Province</span><select className="input" value={province} onChange={(e) => setProvince(e.target.value)}>{PROVINCES.map((p) => <option key={p}>{p}</option>)}</select></label>
          </>}
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="btn" disabled={pending}>Save</button></div>
        </form>
      </aside>
    </div>
  );
}
