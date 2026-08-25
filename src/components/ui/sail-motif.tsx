// The Oman LNG sail motif — translucent triangles, drawn in SVG. Login page and empty states only.

export function SailMotif({
  className = "",
  opacity = 1,
}: {
  className?: string;
  opacity?: number;
}) {
  return (
    <svg
      viewBox="0 0 400 400"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={className}
      style={{ opacity }}
    >
      <polygon points="60,340 190,60 210,340" fill="var(--olng-sail)" fillOpacity="0.22" />
      <polygon points="150,340 260,110 300,340" fill="var(--olng-sail)" fillOpacity="0.16" />
      <polygon points="240,340 330,150 370,340" fill="var(--olng-sail)" fillOpacity="0.1" />
      <polygon points="20,340 110,190 140,340" fill="var(--olng-sail)" fillOpacity="0.12" />
    </svg>
  );
}
