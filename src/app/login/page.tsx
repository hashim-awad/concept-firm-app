import Link from "next/link";
import { AuthCard, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { signIn } from "./actions";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  return (
    <AuthCard title="Sign in">
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={signIn} className="space-y-4">
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="input" />
        </div>
        <div>
          <label htmlFor="password" className="label">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
        </div>
        <button type="submit" className="btn w-full">Sign in</button>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link href="/forgot-password" className="text-accent underline">Forgot your password?</Link>
      </p>
    </AuthCard>
  );
}
