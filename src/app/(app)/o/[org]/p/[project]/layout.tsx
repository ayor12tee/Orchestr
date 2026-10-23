import { getProjectAccess } from "@/lib/auth";
import { NavLink } from "@/components/nav-link";
import { ProjectProvider } from "@/components/project-context";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string; project: string }> }) {
  const { org, project } = await params;
  const access = await getProjectAccess(org, project);
  const base = access.projectBase;

  return (
    <ProjectProvider value={{ org: access.org.slug, project: access.project.slug, orgId: access.org.id, projectId: access.project.id, base }}>
      <div className="-mx-4 -mt-6 mb-6 border-b border-line bg-surface px-4 pt-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <p className="text-xs text-ink-muted">{access.org.name}</p>
        <p className="text-lg font-semibold text-ink">{access.project.name}</p>
        <nav aria-label="Project" className="mt-2 flex gap-1 overflow-x-auto">
          <NavLink tab exact href={base}>Overview</NavLink>
          <NavLink tab href={`${base}/tasks`}>Tasks</NavLink>
          <NavLink tab href={`${base}/board`}>Board</NavLink>
          <NavLink tab href={`${base}/timeline`}>Timeline</NavLink>
          <NavLink tab href={`${base}/dependencies`}>Dependency Map</NavLink>
          <NavLink tab href={`${base}/people`}>People &amp; teams</NavLink>
          {access.canInProject("project.manage") && <NavLink tab href={`${base}/settings`}>Settings</NavLink>}
        </nav>
      </div>
      {children}
    </ProjectProvider>
  );
}
