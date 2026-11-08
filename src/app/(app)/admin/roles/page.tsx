import { redirect } from "next/navigation";

// Roles and permissions moved to Team and roles.
export default function RolesPage() {
  redirect("/admin/team?tab=roles");
}
