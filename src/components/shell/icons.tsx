// Inline SVG icons — small and hand-written, so the app carries no icon library.

type IconProps = { size?: number; className?: string };

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };
}

/** A closed padlock — the stage gate marker on a locked phase. */
export function LockIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="4.5" y="8.5" width="11" height="8" rx="1.5" />
      <path d="M7 8.5V6a3 3 0 0 1 6 0v2.5" />
    </svg>
  );
}

export function DashboardIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="2.5" y="2.5" width="6" height="6" rx="1" />
      <rect x="11.5" y="2.5" width="6" height="4" rx="1" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1" />
      <rect x="11.5" y="9.5" width="6" height="8" rx="1" />
    </svg>
  );
}

export function ProjectsIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3.5l1.5 2H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" />
    </svg>
  );
}

export function TasksIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M7 4h9M7 10h9M7 16h9" />
      <path d="M3 4l1 1 1.5-2M3 10l1 1 1.5-2M3 16l1 1 1.5-2" />
    </svg>
  );
}

export function BellIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M10 3a4 4 0 0 0-4 4c0 3-1.5 4.5-1.5 4.5h11S14 10 14 7a4 4 0 0 0-4-4z" />
      <path d="M8.5 14.5a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}

export function AdminIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" />
    </svg>
  );
}

export function PeopleIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="8" cy="7" r="2.6" />
      <path d="M3.5 16c0-2.3 2-3.8 4.5-3.8s4.5 1.5 4.5 3.8" />
      <path d="M13.5 6.2a2.4 2.4 0 0 1 0 4.6M14.5 12.6c1.3.5 2.2 1.7 2.2 3.4" />
    </svg>
  );
}

export function DisciplinesIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="14" cy="6" r="2.5" />
      <circle cx="6" cy="14" r="2.5" />
      <circle cx="14" cy="14" r="2.5" />
    </svg>
  );
}

/** A chat bubble with a link through it — the Slack and Teams connections. */
export function IntegrationsIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M16.5 11.5a2 2 0 0 1-2 2H8l-3.5 2.5v-2.5a2 2 0 0 1-1-1.7V6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2z" />
      <path d="M7.5 8.8h5M7.5 11h3" />
    </svg>
  );
}

/** A shield with a tick — Admin → Data & privacy: the workspace's own data, looked after. */
export function ShieldIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M10 2.5l6 2.2v4.6c0 3.4-2.4 6.4-6 8.2-3.6-1.8-6-4.8-6-8.2V4.7z" />
      <path d="M7.4 9.9l1.9 1.9 3.4-3.6" />
    </svg>
  );
}

/** A payment card — the Billing row in the admin menu. */
export function BillingIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
      <path d="M2.5 8.5h15" />
      <path d="M5.5 12.5h3" />
    </svg>
  );
}

export function SearchIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13 13l4 4" />
    </svg>
  );
}

export function MenuIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M3 6h14M3 10h14M3 14h14" />
    </svg>
  );
}

export function CloseIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M8 5l5 5-5 5" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}

/** The favorite star: an outline when it is off, the same shape filled in when it is on. */
export function StarIcon({ size = 18, className, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(size, className)} fill={filled ? "currentColor" : "none"}>
      <path d="M10 2.8l2.2 4.5 5 .7-3.6 3.5.9 4.9-4.5-2.3-4.5 2.3.9-4.9L2.8 8l5-.7z" />
    </svg>
  );
}
