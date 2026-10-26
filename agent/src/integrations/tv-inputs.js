// Keeps the TV with the device that's on (BRAVIA_HDMI_<port> in .env, e.g.
// BRAVIA_HDMI_2=presence:… for the Steam machine).
//
// Switching inputs: when a source device has just come on, when the TV has
// just come on, or when the TV is on an input nothing is plugged into, it goes
// to the input of the device that's on. Otherwise your own choice is left
// alone: another source's input, or an app on the TV itself.
//
// Switching off: when the device you were watching goes away, the TV goes off
// too. "Goes away" is the device turning off, its input losing its signal (a
// console going to sleep: at once, while its network stays up for minutes),
// or the TV jumping from its input to an empty one on its own. Not when you've
// just turned the other device on or gone to its input, and not when you
// turned the TV back on later.

export const JUST_ON_MS = 60_000; // "just came on": switch inputs while this is true
export const COOLDOWN_MS = 15_000; // never switch inputs more often than this
export const AWAY_GRACE_MS = 3_000; // gone this long (not a hiccup, like a resolution change) before switching off
export const OTHER_RECENT_MS = 2 * 60_000; // the other device came on this recently: you moved to it
export const OFF_COOLDOWN_MS = 60_000; // one switch-off attempt per minute

// The HDMI port in an input's address: "extInput:hdmi?port=2" and the HDMI-CEC
// name for it, "extInput:cec?type=player&port=2&logicalAddr=8", are both 2.
// Other inputs (composite) are "other"; inside an app there's no input (null).
export function portOf(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('extInput:')) return null;
  const port = uri.match(/[?&]port=(\d+)/)?.[1];
  return /^extInput:(hdmi|cec)/.test(uri) && port ? Number(port) : 'other';
}

// A source counts as on when its device is on and the TV hasn't seen it leave.
const present = (s) => s.on && !(s.goneAt > s.onSince);

// sources: [{ port, on, onSince, offSince, goneAt }]
// shown: { port, since } — the source input the TV was last on, and since when.
// Returns { off: true }, { port } to switch to, or null.
export function decide({ sources, current, shown, tvOnSince, lastSwitchAt, lastOffAt, now }) {
  const watched = shown && sources.find((s) => s.port === shown.port);
  if (watched && now - lastOffAt >= OFF_COOLDOWN_MS) {
    const awayAt = Math.max(watched.on ? 0 : watched.offSince, watched.goneAt);
    const away =
      awayAt >= shown.since && awayAt > tvOnSince && now - awayAt >= AWAY_GRACE_MS && !present(watched);
    // (Going to the other device's input makes that the watched one instead.)
    const movedOn = sources.some((s) => s !== watched && present(s) && now - s.onSince < OTHER_RECENT_MS);
    if (away && !movedOn) return { off: true };
  }

  const lit = sources.filter(present).sort((a, b) => b.onSince - a.onSince);
  if (!lit.length) return null;
  const target = lit[0].port;
  if (current === target || now - lastSwitchAt < COOLDOWN_MS) return null;
  const justOn = now - lit[0].onSince < JUST_ON_MS || now - tvOnSince < JUST_ON_MS;
  const unused = current !== null && !sources.some((s) => s.port === current);
  return justOn || unused ? { port: target } : null;
}
