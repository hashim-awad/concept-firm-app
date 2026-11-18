import { STUDIO_ICONS } from "@/components/ds/brand";
import { AuthCard } from "@/components/ui";
import { signOut } from "../login/actions";

// Round 37: staff screens show the C Studio tab icon (client pages keep the Concept icon).
export const metadata = { icons: STUDIO_ICONS };

export default function NoAccessPage() {
  return (
    <AuthCard title="No access">
      <p className="mb-4 text-sm text-muted">
        Your login works, but your account is not set up as active staff in this app. Ask an owner to check your account.
      </p>
      <form action={signOut}>
        <button type="submit" className="btn-secondary w-full">Sign out</button>
      </form>
    </AuthCard>
  );
}
