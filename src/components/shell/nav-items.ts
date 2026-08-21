// The main navigation list, shared by the desktop sidebar and the mobile slide-over menu, so both
// always show exactly the same destinations.

import {
  BellIcon,
  DashboardIcon,
  DisciplinesIcon,
  PeopleIcon,
  ProjectsIcon,
  TasksIcon,
} from "@/components/shell/icons";
import type { RoleName } from "@/lib/zod-schemas";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
};

const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/projects", label: "Projects", icon: ProjectsIcon },
  { href: "/my-tasks", label: "My tasks", icon: TasksIcon },
  { href: "/notifications", label: "Notifications", icon: BellIcon },
];

// Administrators only — nobody else sees these two rows at all.
const ADMIN_NAV: NavItem[] = [
  { href: "/admin/users", label: "Users", icon: PeopleIcon },
  { href: "/admin/disciplines", label: "Disciplines", icon: DisciplinesIcon },
];

export function navItemsFor(role: RoleName): NavItem[] {
  return role === "ADMIN" ? [...MAIN_NAV, ...ADMIN_NAV] : MAIN_NAV;
}

/** True when this nav row is the page you're on (or somewhere below it). */
export function isCurrentNav(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
