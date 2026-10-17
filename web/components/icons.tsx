// Small stroke icons (24×24), drawn to match the chunky type.

const PATHS: Record<string, React.ReactNode> = {
  home: <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />,
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />,
  pulse: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  bulb: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.8.6 1.1 1.4 1.1 2.2h5c0-.8.3-1.6 1.1-2.2A6 6 0 0 0 12 3z" />
    </>
  ),
  group: (
    <>
      <path d="M7 15h3M7.5 18h2" />
      <path d="M8.5 5a4 4 0 0 0-2.4 7.2c.5.4.7.9.7 1.4h3.4c0-.5.2-1 .7-1.4A4 4 0 0 0 8.5 5z" />
      <path d="M14.5 15h3M15 18h2" />
      <path d="M16 5a4 4 0 0 0-2.4 7.2c.5.4.7.9.7 1.4h3.4c0-.5.2-1 .7-1.4A4 4 0 0 0 16 5z" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v4M15 3v4" />
      <path d="M6 7h12v4a6 6 0 0 1-12 0z" />
      <path d="M12 17v4" />
    </>
  ),
  blind: (
    <>
      <path d="M4 4h16" />
      <path d="M6 4v10h12V4" />
      <path d="M6 8h12M6 11h12" />
      <path d="M12 14v4" />
      <circle cx="12" cy="19.5" r="1.5" />
    </>
  ),
  thermo: (
    <>
      <path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0z" />
      <path d="M12 9v7" />
    </>
  ),
  flame: <path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.2 2.3-5.4 3.9-7.6.4 1.6 1.2 2.7 2.2 3.3.2-2.7 1.2-5.2 3-7.5.7 3.4 4 6 4 10.2 0 4.6-2.8 7.8-6.6 7.8z" />,
  tv: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2.5" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  sensor: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" />
    </>
  ),
  remote: (
    <>
      <rect x="8" y="3" width="8" height="18" rx="3" />
      <circle cx="12" cy="8" r="1.5" />
      <path d="M10.5 13h3M10.5 16h3" />
    </>
  ),
  power: (
    <>
      <path d="M12 3v8" />
      <path d="M6.3 6.8a8 8 0 1 0 11.4 0" />
    </>
  ),
  chevron: <path d="m9 5 7 7-7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  volUp: (
    <>
      <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  volDown: (
    <>
      <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4.5h6V7" />
      <path d="M6 7l1 13h10l1-13" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
};

export type IconKey = keyof typeof PATHS;

export function Icon({ name, size = 22, stroke = 2.2 }: { name: IconKey; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

// The house mascot: a soft house shape with two eyes that look around.
export function Blob({ size = 64, tone = "var(--pink)", look = "right" }: { size?: number; tone?: string; look?: "left" | "right" | "up" }) {
  const dx = look === "left" ? -2.2 : look === "right" ? 2.2 : 0;
  const dy = look === "up" ? -2.2 : 0.6;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M8 30.5 30 9.6a3 3 0 0 1 4 0l22 20.9c1.3 1.2 2 2.9 2 4.7V52a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6V35.2c0-1.8.7-3.5 2-4.7z" fill={tone} />
      <circle cx="24" cy="38" r="7" fill="#fff" />
      <circle cx="40" cy="38" r="7" fill="#fff" />
      <circle cx={24 + dx} cy={38 + dy} r="3.6" fill="var(--ink)" />
      <circle cx={40 + dx} cy={38 + dy} r="3.6" fill="var(--ink)" />
    </svg>
  );
}
