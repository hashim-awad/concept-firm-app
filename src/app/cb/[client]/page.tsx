import { redirect } from "next/navigation";

export default async function ClientHome({ params }: { params: Promise<{ client: string }> }) {
  const { client } = await params;
  redirect(`/cb/${client}/overview`);
}
