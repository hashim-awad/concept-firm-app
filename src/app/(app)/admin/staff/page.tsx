import { redirect } from "next/navigation";

// Staff moved to Team and roles.
export default function StaffPage() {
  redirect("/admin/team?tab=people");
}
