import { indicatorLabel, indicatorTone, taskIndicators, type Indicator } from "@/lib/domain/indicators";
import type { TaskRow } from "@/lib/tasks/types";
import { Badge } from "./ui";

export function indicatorsFor(task: TaskRow, today: string, dueSoonDays: number): Indicator[] {
  return taskIndicators(task, today, { dueSoonDays });
}

export function TaskBadges({ task, today, dueSoonDays }: { task: TaskRow; today: string; dueSoonDays: number }) {
  const list = indicatorsFor(task, today, dueSoonDays);
  if (!list.length && !task.is_critical) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {task.is_critical && <Badge tone="red">Critical</Badge>}
      {list.map((i) => (
        <Badge key={i.kind} tone={indicatorTone(i, task.is_critical)}>
          {indicatorLabel(i)}
        </Badge>
      ))}
    </span>
  );
}
