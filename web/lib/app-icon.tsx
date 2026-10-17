import { ImageResponse } from "next/og";

// The app icon: the pink house mascot on cream. iOS rounds the corners itself.
export function appIcon(size: number) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#f4eee3" }}>
        <svg width={size * 0.78} height={size * 0.78} viewBox="0 0 64 64">
          <path d="M8 30.5 30 9.6a3 3 0 0 1 4 0l22 20.9c1.3 1.2 2 2.9 2 4.7V52a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6V35.2c0-1.8.7-3.5 2-4.7z" fill="#f59ac9" />
          <circle cx="24" cy="38" r="7" fill="#fff" />
          <circle cx="40" cy="38" r="7" fill="#fff" />
          <circle cx="26.2" cy="38.6" r="3.6" fill="#151515" />
          <circle cx="42.2" cy="38.6" r="3.6" fill="#151515" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
