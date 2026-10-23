import { redirect } from "next/navigation";
import { getOrgAccess } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { NewProjectForm } from "./new-project-form";

export const metadata = { title: "New project · Orchestr" };

export default async function NewProjectPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const access = await getOrgAccess(org);
  if (!access.can("projects.create")) redirect(access.base);
  return (
    <>
      <PageHeader title="New project" description="You'll lead it. Add teams and people from the project's People page afterwards." />
      <Card className="max-w-2xl">
        <NewProjectForm org={access.org.slug} orgTimezone={access.org.timezone} />
      </Card>
    </>
  );
}
