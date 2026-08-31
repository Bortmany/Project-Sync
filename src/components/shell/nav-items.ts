// The main navigation list, shared by the desktop sidebar and the mobile slide-over menu, so both
// always show exactly the same destinations.

import {
  BellIcon,
  DashboardIcon,
  DisciplinesIcon,
  IntegrationsIcon,
  PeopleIcon,
  ProjectsIcon,
  TasksIcon,
} from "@/components/shell/icons";
import { SIDEBAR_FAVORITES_LIMIT } from "@/components/hooks/use-favorites";
import type { FavoriteDTO, RoleName } from "@/lib/zod-schemas";

/** A destination beneath a nav row — a filtered or alternative view of the same area. */
export type NavChild = { href: string; label: string };

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  /** Shown as a drop-down beneath the row on the wide sidebar and in the phone menu. */
  children?: NavChild[];
};

const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  // The Projects children are filled in by the sidebar from this person's starred projects.
  { href: "/projects", label: "Projects", icon: ProjectsIcon },
  {
    href: "/my-tasks",
    label: "My tasks",
    icon: TasksIcon,
    children: [
      { href: "/my-tasks?due=today", label: "Due today" },
      { href: "/my-tasks?due=week", label: "This week" },
      { href: "/my-tasks?due=overdue", label: "Overdue" },
      { href: "/my-tasks?status=AWAITING_REVIEW", label: "Awaiting review" },
      { href: "/my-tasks/brief", label: "Your day" },
      { href: "/my-tasks?view=timeline", label: "Timeline" },
      { href: "/my-tasks/personal", label: "Personal list" },
    ],
  },
  { href: "/notifications", label: "Notifications", icon: BellIcon },
  // The company noticeboard. Named "Messages" deliberately: a project already has a "Team" tab of
  // its own (its roster), and two different things called Team in one app is one too many.
  { href: "/messages", label: "Messages", icon: PeopleIcon },
];

// Administrators only — nobody else sees these three rows at all.
const ADMIN_NAV: NavItem[] = [
  { href: "/admin/users", label: "Users", icon: PeopleIcon },
  { href: "/admin/disciplines", label: "Disciplines", icon: DisciplinesIcon },
  { href: "/admin/integrations", label: "Integrations", icon: IntegrationsIcon },
];

/**
 * A contractor's menu is trimmed to the four things they actually have: their dashboard, the
 * projects they hold work on, their own tasks and their notifications. The people directory, the
 * project team, the noticeboard and the whole Admin section are not rows they are given and not
 * pages they can read — the server answers "not found" either way.
 */
const EXTERNAL_NAV: NavItem[] = MAIN_NAV.filter((item) => item.href !== "/messages").map((item) =>
  item.href === "/my-tasks"
    ? {
        ...item,
        children: (item.children ?? []).filter((child) => child.href !== "/my-tasks/personal"),
      }
    : item,
);

export function navItemsFor(role: RoleName): NavItem[] {
  if (role === "EXTERNAL") return EXTERNAL_NAV;
  return role === "ADMIN" ? [...MAIN_NAV, ...ADMIN_NAV] : MAIN_NAV;
}

/**
 * The shortcuts the Favorites section shows: starred tasks only. Starred *projects* already appear
 * as the Projects drop-down (see childrenFor), and showing them in both places listed the same
 * project twice in one menu. One star, one place. When somebody has only starred projects this
 * comes back empty and the Favorites section disappears — their stars are still there, under
 * Projects.
 */
export function favoriteShortcuts(favorites: FavoriteDTO[]): FavoriteDTO[] {
  return favorites
    .filter((favorite) => favorite.targetType !== "PROJECT")
    .slice(0, SIDEBAR_FAVORITES_LIMIT);
}

/**
 * The links shown beneath a nav row. Projects is the special one: its drop-down is this person's
 * starred projects, with "All projects" at the bottom, so the shortcuts they actually use are one
 * press away. Everything else uses the fixed list above.
 */
export function childrenFor(item: NavItem, favorites: FavoriteDTO[]): NavChild[] {
  if (item.href !== "/projects") return item.children ?? [];

  const starred = favorites
    .filter((favorite) => favorite.targetType === "PROJECT")
    .slice(0, SIDEBAR_FAVORITES_LIMIT)
    .map((favorite) => ({
      href: `/projects/${favorite.targetId}`,
      label: favorite.title,
    }));

  return [...starred, { href: "/projects", label: "All projects" }];
}

/** True when this nav row is the page you're on (or somewhere below it). */
export function isCurrentNav(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * True when a sub-item is the exact view being shown. A sub-item carries a query
 * (`/my-tasks?due=today`), so the path alone is not enough: every value in the link's query has to
 * match what the address bar actually says, otherwise "Due today" would light up on plain /my-tasks.
 */
export function isCurrentChild(
  pathname: string,
  search: URLSearchParams,
  href: string,
): boolean {
  const [path, query = ""] = href.split("?");
  if (pathname !== path) return false;
  const wanted = new URLSearchParams(query);
  const keys = [...wanted.keys()];
  for (const key of keys) {
    if (search.get(key) !== wanted.get(key)) return false;
  }
  // A link with no query of its own (Personal list) matches its page; one with a query must not
  // also match a page showing a different view of the same path.
  if (keys.length === 0 && (search.get("due") || search.get("view"))) return false;
  return true;
}

/** True when the current page sits inside this group — either the row itself or one of its links. */
export function isGroupCurrent(
  pathname: string,
  search: URLSearchParams,
  item: NavItem,
  children: NavChild[],
): boolean {
  if (isCurrentNav(pathname, item.href)) return true;
  return children.some((child) => isCurrentChild(pathname, search, child.href));
}
