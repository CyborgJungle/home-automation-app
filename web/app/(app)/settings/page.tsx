"use client";

import { INTEGRATION_NAMES } from "@/components/devices";
import { Blob, Icon } from "@/components/icons";
import { PageHeader, Switch, timeAgo } from "@/components/ui";
import { describe } from "@/lib/devices";
import { useHome } from "@/lib/home";
import type { Device } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";

// Health checks run on the Pi except evohome, which runs in Supabase.
const WHERE: Record<Device["integration"], string> = {
  presence: "Pi",
  ikeadisplay: "Pi",
  roborock: "Pi",
  app: "Pi",
  dirigera: "Pi",
  tradfri: "Pi",
  brel: "Pi",
  bravia: "Pi",
  sonos: "Pi",
  apple: "Pi",
  evohome: "Cloud",
};

// A tiny Home screen drawn in the given scheme, like iOS Display & Brightness.
function ThemePreview({ scheme }: { scheme: "light" | "dark" }) {
  return (
    <span className={`theme-preview ${scheme}`} aria-hidden="true">
      <span className="tp-top">
        <Blob size={16} tone="var(--pink)" />
        <span className="tp-line short" />
      </span>
      <span className="tp-line" />
      <span className="tp-line mid" />
      <span className="tp-tiles">
        <span className="tp-tile on tone-yellow" />
        <span className="tp-tile" />
        <span className="tp-tile" />
        <span className="tp-tile on tone-lavender" />
      </span>
      <span className="tp-bar">
        <span />
      </span>
    </span>
  );
}

function Appearance() {
  const { pref, setPref, dark } = useTheme();
  const automatic = pref === "system";
  const shown = dark ? "dark" : "light";

  return (
    <section className="section">
      <h2 className="section-title">Appearance</h2>
      <div className="list-card appearance">
        <div className="theme-options" role="radiogroup" aria-label="Appearance">
          {(["light", "dark"] as const).map((scheme) => (
            <button
              key={scheme}
              role="radio"
              aria-checked={shown === scheme}
              className={shown === scheme ? "theme-option selected" : "theme-option"}
              onClick={() => setPref(scheme)}
            >
              <span className="theme-frame">
                <ThemePreview scheme={scheme} />
              </span>
              {scheme === "light" ? "Light" : "Dark"}
              <span className="theme-radio">
                <Icon name="check" size={15} stroke={3.2} />
              </span>
            </button>
          ))}
        </div>
        <div className="list-row">
          <span className="grow">
            <strong>Match iPhone</strong>
            <span className="muted small sub">
              {automatic
                ? `Follows your iPhone's Light and Dark setting, including Automatic at sunset. Now ${shown}.`
                : `Always ${shown}, whatever your iPhone is set to.`}
            </span>
          </span>
          <Switch on={automatic} label="Match iPhone appearance" onChange={(on) => setPref(on ? "system" : shown)} />
        </div>
      </div>
    </section>
  );
}

// The timeline is gone from the app; every command and event is still kept in
// Supabase (the commands and events tables).
export default function SettingsPage() {
  const { agent, agentOnline, statuses, devices, userEmail, signOut } = useHome();

  // Devices the Pi only pings (like the Steam machine) each get their own row,
  // named after the device rather than "Seen on the network".
  const watched = devices.filter((d) => d.integration === "presence").sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="page">
      <PageHeader title="Settings" subtitle="Your Pi, looks and connections" />

      <section className="section">
        <div className={`hero-card ${agentOnline ? "tone-sage" : "tone-peach"}`}>
          <Blob size={56} tone={agentOnline ? "var(--ink)" : "var(--red)"} look={agentOnline ? "right" : "up"} />
          <div>
            <strong>Raspberry Pi {agentOnline ? "is online" : "is offline"}</strong>
            <p>
              Last check-in {timeAgo(agent?.last_seen)}
              {agent?.version ? ` · agent v${agent.version}` : ""}
            </p>
          </div>
        </div>
      </section>

      <Appearance />

      <section className="section">
        <h2 className="section-title">Connections</h2>
        <div className="list-card">
          {statuses
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .flatMap((s) => {
              const ok = s.ok && (WHERE[s.name] === "Cloud" || agentOnline);
              const rows =
                s.name === "presence" && ok && watched.length
                  ? watched.map((d) => ({
                      key: d.id,
                      title: d.name,
                      sub: `${describe(d, d.state)} · seen on the network`,
                      at: d.updated_at,
                    }))
                  : [
                      {
                        key: s.name,
                        title: INTEGRATION_NAMES[s.name] ?? s.name,
                        sub: ok ? `Connected · runs on ${WHERE[s.name] === "Cloud" ? "Supabase" : "the Pi"}` : s.error ?? "Not connected",
                        at: s.updated_at,
                      },
                    ];
              return rows.map((r) => (
                <div key={r.key} className="list-row">
                  <span className={ok ? "dot ok" : "dot bad"} />
                  <span className="grow">
                    <strong>{r.title}</strong>
                    <span className="muted small sub">{r.sub}</span>
                  </span>
                  <span className="muted small">{timeAgo(r.at)}</span>
                </div>
              ));
            })}
        </div>
      </section>

      <section className="section">
        <div className="list-card">
          <div className="list-row">
            <span className="grow">
              <span className="muted small sub">Signed in as</span>
              <strong>{userEmail}</strong>
            </span>
            <button className="pill light small" onClick={signOut}>
              <Icon name="logout" size={16} /> Sign out
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
