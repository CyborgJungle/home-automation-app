// Keeps the TV on the HDMI input of the device that's on (BRAVIA_HDMI_<port>
// in .env, e.g. BRAVIA_HDMI_2=presence:… for the Steam machine). When something
// goes wrong, like a console going to sleep, the TV can jump to an empty input.
//
// It switches when a source device has just come on, when the TV has just come
// on, or when the TV is on an input nothing is plugged into. Otherwise it leaves
// your own choice alone: another source's input, or an app on the TV itself.

export const JUST_ON_MS = 60_000; // "just came on": switch while this is true
export const COOLDOWN_MS = 15_000; // never switch more often than this

// The HDMI port in an input's address: "extInput:hdmi?port=2" and the HDMI-CEC
// name for it, "extInput:cec?type=player&port=2&logicalAddr=8", are both 2.
// Other inputs (composite) are "other"; inside an app there's no input (null).
export function portOf(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('extInput:')) return null;
  const port = uri.match(/[?&]port=(\d+)/)?.[1];
  return /^extInput:(hdmi|cec)/.test(uri) && port ? Number(port) : 'other';
}

// sources: [{ port, on, onSince }], current: what portOf() gave for the TV now.
// Returns the port to switch to, or null.
export function inputToSwitch({ sources, current, tvOnSince, lastSwitchAt, now }) {
  const lit = sources.filter((s) => s.on).sort((a, b) => b.onSince - a.onSince);
  if (!lit.length) return null;
  const target = lit[0].port;
  if (current === target || now - lastSwitchAt < COOLDOWN_MS) return null;
  const justOn = now - lit[0].onSince < JUST_ON_MS || now - tvOnSince < JUST_ON_MS;
  const unused = current !== null && !sources.some((s) => s.port === current);
  return justOn || unused ? target : null;
}
