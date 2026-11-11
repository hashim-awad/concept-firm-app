"use client";
// A proposal by private link (front office batch, section 5, item 2): the client reads the proposal,
// picks an option, reads the engagement letter that option becomes, and signs once.
import { useState } from "react";
import { SignDock } from "./sign-dock";
import { SignForm } from "./sign-form";

export function ProposalSign({ token, partA, options, recommended, who, labels }: {
  token: string; partA: string; options: { name: string; letter: string }[]; recommended: number; who: string;
  labels: { fullName: string; typed: string; agree: string; sign: string; title?: string };
}) {
  const single = options.length === 1;
  const [pick, setPick] = useState<number | null>(single ? 0 : null);
  const chosen = pick === null ? null : options[pick];
  return (
    <div className="mx-auto grid max-w-6xl gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:pb-0">
      <div className="grid gap-6">
        <article className="overflow-hidden rounded-lg border border-sand-200 bg-white px-5 py-7 shadow-sm sm:px-12 sm:py-12">
          <div dangerouslySetInnerHTML={{ __html: partA }} />
        </article>
        {!single && (
          <section className="rounded-lg border border-sand-200 bg-white p-5 shadow-sm sm:p-8" aria-labelledby="choose">
            <h2 id="choose" className="text-xl font-semibold">Choose your option</h2>
            <p className="mt-1 text-sm text-ink-2">Your engagement letter shows below once you choose. You sign it in the same step.</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {options.map((o, i) => (
                <label key={i} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 ${pick === i ? "border-navy-700 bg-navy-50" : "border-sand-200 hover:border-navy-300"}`}>
                  <input type="radio" name="option" checked={pick === i} onChange={() => setPick(i)} className="h-4 w-4 accent-navy-700" />
                  <span className="font-medium">{o.name}{i === recommended && <span className="ml-2 rounded bg-success-soft px-1.5 py-0.5 text-xs font-semibold text-success">Recommended</span>}</span>
                </label>
              ))}
            </div>
          </section>
        )}
        {chosen && (
          <article className="overflow-hidden rounded-lg border border-sand-200 bg-white px-5 py-7 shadow-sm sm:px-12 sm:py-12" aria-label={`Engagement letter for ${chosen.name}`}>
            <p className="mb-6 rounded-md bg-navy-50 px-4 py-2 text-sm font-medium text-navy-800">Engagement letter for {chosen.name}</p>
            <div dangerouslySetInnerHTML={{ __html: chosen.letter }} />
          </article>
        )}
      </div>
      <SignDock barText={chosen ? `Ready to sign ${chosen.name}?` : "Choose an option to sign"} barButton={labels.sign}>
        {chosen ? (
          <div className="grid gap-4">
            <p className="font-medium">You are signing: {chosen.name}</p>
            <SignForm token={token} forOther={false} who={who} labels={labels} option={pick} />
          </div>
        ) : <p className="text-ink-2">Choose your option under the proposal. Its engagement letter opens, and you sign it here.</p>}
      </SignDock>
    </div>
  );
}
