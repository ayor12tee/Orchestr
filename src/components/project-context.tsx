"use client";

import { createContext, useContext } from "react";

export interface ProjectRef {
  org: string;
  project: string;
  orgId: string;
  projectId: string;
  /** /o/<org>/p/<project> */
  base: string;
}

const Ctx = createContext<ProjectRef | null>(null);

export function ProjectProvider({ value, children }: { value: ProjectRef; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProject(): ProjectRef {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProject must be used inside a project page");
  return v;
}

/** Hidden fields every project form sends, so its server action can re-resolve access. */
export function ProjectFields() {
  const { org, project } = useProject();
  return (
    <>
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="project" value={project} />
    </>
  );
}
