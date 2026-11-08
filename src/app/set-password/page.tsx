import { AuthCard, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { setPassword } from "./actions";

export default async function SetPasswordPage({ searchParams }: PageProps<"/set-password">) {
  const sp = await searchParams;
  return (
    <AuthCard title="Set your password">
      <Notice error={messageFrom(sp.error)} />
      <p className="mb-4 text-sm text-muted">Use at least 12 characters. A short sentence is easy to remember and hard to guess.</p>
      <form action={setPassword} className="space-y-4">
        <div>
          <label htmlFor="password" className="label">New password</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required className="input" />
        </div>
        <div>
          <label htmlFor="confirm" className="label">Type it again</label>
          <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required className="input" />
        </div>
        <button type="submit" className="btn w-full">Save password</button>
      </form>
    </AuthCard>
  );
}
