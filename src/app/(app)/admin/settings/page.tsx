import { redirect } from "next/navigation";

// The Settings landing page went with the gear menu (round 17). Old links land on My day.
export default function SettingsHome() {
  redirect("/");
}
