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

export function SearchIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13 13l4 4" />
    </svg>
  );
}
