import Link from "next/link";
import { AuthCard } from "@/components/ui";
import { requestReset } from "./actions";

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Reset your password">
      <p className="mb-4 text-sm text-muted">Enter your work email. We will send you a link to set a new password.</p>
      <form action={requestReset} className="space-y-4">
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="input" />
        </div>
        <button type="submit" className="btn w-full">Send reset link</button>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link href="/login" className="text-accent underline">Back to sign in</Link>
      </p>
    </AuthCard>
  );
}
