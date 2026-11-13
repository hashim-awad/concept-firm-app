import { notFound } from "next/navigation";

// Any address that matches no page shows the not-found page inside Studio's frame (round 4 item 8).
export default function Missing() {
  notFound();
}
