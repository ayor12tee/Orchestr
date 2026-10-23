import type { AccessContext, Permission } from "@/lib/auth";

export interface NavItem {
  href: string;
  label: string;
  /** Shown if the user has any of these conference-wide, or any department permission when `departmentScoped`. */
  anyOf: Permission[];
  departmentScoped?: boolean;
  /** Not built yet. Listed so the roadmap is visible, never linked. */
  phase?: number;
}

// Brief §9.2 order.
export const NAV: NavItem[] = [
  { href: "/", label: "Control Room", anyOf: ["conference.view"] },
  { href: "/pace", label: "Pace Tracker", anyOf: ["pace.view"], phase: 3 },
  { href: "/tasks", label: "Tasks", anyOf: ["conference.view"] },
  { href: "/dependencies", label: "Dependency Map", anyOf: ["tasks.view"], departmentScoped: true },
  { href: "/timeline", label: "Timeline", anyOf: ["tasks.view"], departmentScoped: true },
  { href: "/departments", label: "Departments", anyOf: ["conference.view"] },
  { href: "/sponsors", label: "Sponsors & Exhibitors", anyOf: ["commercial.view"], phase: 4 },
  { href: "/programme", label: "Speakers & Programme", anyOf: ["conference.view_all"], phase: 4 },
  { href: "/content", label: "Design & Content", anyOf: ["conference.view_all"], phase: 4 },
  { href: "/marketing", label: "Marketing & Registration", anyOf: ["conference.view_all"], phase: 4 },
  { href: "/volunteers", label: "Volunteers", anyOf: ["volunteers.manage"], phase: 4 },
  { href: "/finance", label: "Finance", anyOf: ["finance.view"], phase: 4 },
  { href: "/operations", label: "Logistics & Operations", anyOf: ["conference.view_all"], phase: 4 },
  { href: "/governance", label: "Risks & Decisions", anyOf: ["conference.view_all"], phase: 4 },
  { href: "/reports", label: "Reports", anyOf: ["reports.view"], phase: 5 },
  { href: "/team", label: "Team & Permissions", anyOf: ["members.manage"] },
  { href: "/settings", label: "Settings", anyOf: ["conference.manage", "system.configure"] },
];

export function visibleNav(access: AccessContext): NavItem[] {
  return NAV.filter(
    (item) =>
      item.anyOf.some((p) => access.permissions.has(p)) ||
      (item.departmentScoped && [...access.departmentPermissions.values()].some((s) => item.anyOf.some((p) => s.has(p)))),
  );
}
