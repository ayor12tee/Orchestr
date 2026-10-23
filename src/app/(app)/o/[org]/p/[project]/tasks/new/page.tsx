import { redirect } from "next/navigation";
import { getProjectAccess } from "@/lib/auth";
import { getProjectPeople, getProjectTeams } from "@/lib/projects/data";
import { TaskForm } from "@/components/task-form";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "New task · Orchestr" };

export default async function NewTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ team?: string }>;
}) {
  const { org, project } = await params;
  const { team } = await searchParams;
  const access = await getProjectAccess(org, project);
  const [teams, people] = await Promise.all([getProjectTeams(access), getProjectPeople(access)]);
  // Only offer teams where this user may create tasks; the database enforces it anyway.
  const creatable = teams.filter((t) => access.canInProject("tasks.create", t.id));
  const allowNoTeam = access.canInProject("tasks.create");
  if (!allowNoTeam && creatable.length === 0) redirect(`${access.projectBase}/tasks`);

  return (
    <>
      <PageHeader title="New task" description="Every active task needs one accountable owner, a due date and acceptance criteria. Missing details stay visibly flagged." />
      <Card className="max-w-3xl">
        <TaskForm
          teams={creatable}
          people={people}
          allowNoTeam={allowNoTeam}
          canAssign={access.canAnywhere("tasks.assign")}
          canApprovePlanning={access.canInProject("baseline.approve")}
          defaultTeamId={creatable.some((t) => t.id === team) ? team : undefined}
        />
      </Card>
    </>
  );
}
