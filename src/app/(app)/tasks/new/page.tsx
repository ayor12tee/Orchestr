import { getAccess } from "@/lib/auth";
import { getPickerOptions } from "@/lib/tasks/options";
import { TaskForm } from "@/components/task-form";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "New task · ConTech Command Centre" };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const { dept } = await searchParams;
  const access = await getAccess();
  const { departments, people } = await getPickerOptions();
  // Only offer departments where this user may create tasks; the database enforces it anyway.
  const creatable = departments.filter((d) => access.can("tasks.create", d.id));
  const preset = departments.find((d) => d.slug === dept)?.id;

  return (
    <>
      <PageHeader title="New task" description="Every active task needs one accountable owner, a due date and acceptance criteria. Missing details stay visibly flagged." />
      <Card className="max-w-3xl">
        <TaskForm
          departments={creatable}
          people={people}
          canAssign={access.can("tasks.assign") || creatable.some((d) => access.can("tasks.assign", d.id))}
          canApprovePlanning={access.can("baseline.approve")}
          defaultDepartmentId={preset}
        />
      </Card>
    </>
  );
}
