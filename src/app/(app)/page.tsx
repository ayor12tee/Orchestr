import { redirect } from "next/navigation";
import { getMyOrganizations } from "@/lib/auth";

/** Sends people to their organization, or to create one if they have none. */
export default async function Home() {
  const orgs = await getMyOrganizations();
  redirect(orgs.length ? `/o/${orgs[0].slug}` : "/onboarding");
}
