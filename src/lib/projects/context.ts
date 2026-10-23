import { revalidatePath } from "next/cache";
import { getProjectAccess, type ProjectAccess } from "@/lib/auth";

const SLUG = /^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$/;

/**
 * Server actions receive the organization and project as slugs in hidden
 * fields. They're only used to look the project up again through the
 * user's RLS client, so a tampered value can at most name a project the
 * user can already see.
 */
export async function projectFromForm(formData: FormData): Promise<ProjectAccess | null> {
  const org = formData.get("org");
  const project = formData.get("project");
  if (typeof org !== "string" || typeof project !== "string" || !SLUG.test(org) || !SLUG.test(project)) return null;
  try {
    return await getProjectAccess(org, project);
  } catch {
    return null;
  }
}

/** Every page in the project shows forecasts, so a change refreshes them all. */
export function revalidateProject(access: ProjectAccess) {
  revalidatePath(`${access.projectBase}`, "layout");
  revalidatePath(access.base);
}
