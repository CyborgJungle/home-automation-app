// Small stroke icons (24×24), drawn to match the chunky type.

// An eight-tooth cog with flat-topped, slightly tapered teeth.
function cog(teeth: number, outer: number, inner: number) {
  const pt = (angle: number, r: number) => `${(12 + r * Math.sin(angle)).toFixed(2)} ${(12 - r * Math.cos(angle)).toFixed(2)}`;
  const step = (Math.PI * 2) / teeth;
  let d = "";
  for (let i = 0; i < teeth; i++) {
    const c = i * step;
    d += `${i ? "L" : "M"}${pt(c - step * 0.36, inner)}L${pt(c - step * 0.2, outer)}L${pt(c + step * 0.2, outer)}L${pt(c + step * 0.36, inner)}`;
  }
  return d + "Z";
}

const COG = cog(8, 9.6, 7.2);

const PATHS: Record<string, React.ReactNode> = {
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  cloud: <path d="M7 18h11a4 4 0 0 0 .4-8A6.5 6.5 0 0 0 6 9a4.5 4.5 0 0 0 1 9Z" />,
  home: <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />,
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />,
  sparkle: (
    <>
      <path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z" />
      <path d="M19 15.5c.3 1.9 1 2.6 2.5 2.9-1.5.3-2.2 1-2.5 2.9-.3-1.9-1-2.6-2.5-2.9 1.5-.3 2.2-1 2.5-2.9z" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4L19.5 8.5a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  pulse: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  settings: (
    <>
      <path d={COG} />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
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
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
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
  pause: <path d="M8 5.5v13M16 5.5v13" />,
  next: (
    <>
      <path d="M6 6v12l8.5-6z" />
      <path d="M18 6v12" />
    </>
  ),
  prev: (
    <>
      <path d="M18 6v12l-8.5-6z" />
      <path d="M6 6v12" />
    </>
  ),
  speaker: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="3" />
      <circle cx="12" cy="14" r="3.2" />
      <circle cx="12" cy="7.5" r="1" />
    </>
  ),
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

// The house mascot: a soft house shape with two eyes. With `idle`, the eyes
// slowly look around and blink now and then (see .blob-eyes in globals.css).
export function Blob({
  size = 64,
  tone = "var(--pink)",
  look = "right",
  idle = false,
}: {
  size?: number;
  tone?: string;
  look?: "left" | "right" | "up";
  idle?: boolean;
}) {
  const dx = look === "left" ? -2.2 : look === "right" ? 2.2 : 0;
  const dy = look === "up" ? -2.2 : 0.6;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M8 30.5 30 9.6a3 3 0 0 1 4 0l22 20.9c1.3 1.2 2 2.9 2 4.7V52a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6V35.2c0-1.8.7-3.5 2-4.7z" fill={tone} />
      <g className={idle ? "blob-eyes idle" : "blob-eyes"}>
        <circle cx="24" cy="38" r="7" fill="#fff" />
        <circle cx="40" cy="38" r="7" fill="#fff" />
        <g className="blob-pupils">
          <circle cx={24 + dx} cy={38 + dy} r="3.6" fill="var(--on-tone)" />
          <circle cx={40 + dx} cy={38 + dy} r="3.6" fill="var(--on-tone)" />
        </g>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Scene characters: a shape with a face. Asleep when the scene isn't on,
// awake and smiling when it is.

function wavy(points: number, base: number, depth: number) {
  const steps = 120;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r = base + depth * Math.cos(points * t);
    d += `${i ? "L" : "M"}${(50 + r * Math.sin(t)).toFixed(2)} ${(52 - r * Math.cos(t)).toFixed(2)}`;
  }
  return d + "Z";
}

function star(points: number, outer: number, inner: number) {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const t = (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 ? inner : outer;
    d += `${i ? "L" : "M"}${(50 + r * Math.sin(t)).toFixed(2)} ${(54 - r * Math.cos(t)).toFixed(2)}`;
  }
  return d + "Z";
}

const FLOWER = wavy(9, 40, 6);
const STAR = star(5, 46, 26);

function Body({ shape }: { shape: string }) {
  switch (shape) {
    case "flower":
      return <path d={FLOWER} />;
    case "circle":
      return <circle cx="50" cy="52" r="42" />;
    case "star":
      return <path d={STAR} strokeWidth="12" strokeLinejoin="round" stroke="currentColor" />;
    case "squircle":
      return <rect x="10" y="12" width="80" height="80" rx="30" />;
    case "cloud":
      return (
        <>
          <circle cx="34" cy="56" r="24" />
          <circle cx="56" cy="40" r="28" />
          <circle cx="72" cy="60" r="20" />
          <rect x="14" y="56" width="74" height="28" rx="14" />
        </>
      );
    default:
      return <path d="M12 47.7 46.9 14.5a4.7 4.7 0 0 1 6.2 0L88 47.7c2 1.9 3.1 4.5 3.1 7.3v26.2a9.4 9.4 0 0 1-9.4 9.4H18.3a9.4 9.4 0 0 1-9.4-9.4V55c0-2.8 1.1-5.4 3.1-7.3z" />;
  }
}

export function SceneArt({ shape, tone, awake, size = 84 }: { shape: string; tone: string; awake: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="scene-art" style={{ color: `var(--${tone})` }}>
      <g fill="currentColor">
        <Body shape={shape} />
      </g>
      {awake ? (
        <>
          <circle cx="38" cy="54" r="9" fill="#fff" />
          <circle cx="62" cy="54" r="9" fill="#fff" />
          <circle cx="39.5" cy="51.5" r="4.6" fill="var(--on-tone)" />
          <circle cx="63.5" cy="51.5" r="4.6" fill="var(--on-tone)" />
          <path d="M42 68q8 7 16 0" fill="none" stroke="var(--on-tone)" strokeWidth="4" strokeLinecap="round" />
        </>
      ) : (
        <g fill="none" stroke="var(--on-tone)" strokeWidth="4" strokeLinecap="round">
          <path d="M31 55q7 6 14 0" />
          <path d="M55 55q7 6 14 0" />
        </g>
      )}
    </svg>
  );
}
