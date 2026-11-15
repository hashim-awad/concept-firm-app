import { redirectKeep } from "../redirect-keep";

// Round 17: Import from Studio was a one-time job and is done. The address opens the change log.
export default async function Old({ searchParams }: PageProps<"/admin/import">) {
  return redirectKeep("/admin/changelog", searchParams);
}
