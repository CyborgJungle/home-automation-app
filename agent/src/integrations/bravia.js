// Sony BRAVIA (Android TV), through the TV's built-in IP control API on the
// local network. Plain HTTP, so no extra libraries.
//
// On the TV: Settings → Network & Internet → Home network → IP control:
// Authentication "Normal and Pre-Shared Key", set a Pre-Shared Key, and turn on
// Remote start so the TV can be switched on from standby.

const POLL_MS = 10_000;
const TIMEOUT_MS = 4000;
const ID = 'bravia:tv';

export function createBravia(cfg, hub, log) {
  let model = null;
  let pollTimer = null;
  let lastError = null;

  async function rpc(service, method, params = [], version = '1.0') {
    const res = await fetch(`http://${cfg.host}/sony/${service}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-auth-psk': cfg.psk },
      body: JSON.stringify({ method, id: 1, params, version }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 403) {
      throw new Error("The TV rejected the pre-shared key. Check BRAVIA_PSK and the TV's IP control settings.");
    }
    const body = await res.json();
    if (body.error) {
      const error = new Error(`TV error ${body.error[0]}: ${body.error[1]}`);
      error.code = body.error[0];
      throw error;
    }
    return body.result?.[0];
  }

  // What's on screen: an input or channel name. Inside an app the TV answers
  // with "Illegal State" (code 7), so show nothing then.
  async function nowPlaying() {
    try {
      const info = await rpc('avContent', 'getPlayingContentInfo');
      return info?.title || info?.source || null;
    } catch (e) {
      if (e.code === 7) return null;
      throw e;
    }
  }

  async function refresh() {
    try {
      const power = await rpc('system', 'getPowerStatus');
      const state = { on: power?.status === 'active', model };
      if (state.on) {
        const volumes = await rpc('audio', 'getVolumeInformation');
        const speaker = volumes?.find((v) => v.target === 'speaker') ?? volumes?.[0];
        if (speaker) {
          state.volume = speaker.volume;
          state.muted = Boolean(speaker.mute);
        }
        state.playing = await nowPlaying();
      }
      hub.upsertDevice({ id: ID, integration: 'bravia', kind: 'tv', name: 'TV', room: null, online: true, state });
      if (lastError) log.info('TV reachable again');
      lastError = null;
      hub.status('bravia', true);
    } catch (e) {
      const message = e.name === 'TimeoutError' || e.cause ? 'TV not reachable (unplugged, or Remote start is off?)' : e.message;
      if (message !== lastError) log.warn(message);
      lastError = message;
      const row = hub.devices.get(ID);
      if (row?.online) hub.upsertDevice({ ...row, online: false });
      hub.status('bravia', false, message);
    }
  }

  async function start() {
    log.info(`connecting to TV at ${cfg.host}`);
    // A call that needs the key, so a wrong key shows up right away.
    await rpc('system', 'getSystemInformation');
    model = (await rpc('system', 'getInterfaceInformation'))?.modelName ?? null;
    log.info(`connected to ${model ?? 'TV'}`);
    await refresh();
    pollTimer = setInterval(refresh, POLL_MS);
  }

  async function execute(deviceId, action, params) {
    if (action === 'power') {
      await rpc('system', 'setPowerStatus', [{ status: Boolean(params.on) }]);
    } else if (action === 'volume') {
      const delta = Math.round(Number(params.delta));
      if (!delta) throw new Error('volume needs a delta, e.g. {"delta": 2}');
      await rpc('audio', 'setAudioVolume', [{ target: 'speaker', volume: `${delta > 0 ? '+' : ''}${delta}` }]);
    } else if (action === 'mute') {
      await rpc('audio', 'setAudioMute', [{ status: Boolean(params.on) }]);
    } else {
      throw new Error(`Unknown TV action "${action}"`);
    }
    // Show the result without waiting for the next poll.
    setTimeout(refresh, 300);
  }

  function stop() {
    clearInterval(pollTimer);
  }

  return { name: 'bravia', start, execute, stop };
}
