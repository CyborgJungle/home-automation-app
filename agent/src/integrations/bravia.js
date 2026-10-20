// Sony BRAVIA (Android TV), through the TV's built-in IP control API on the
// local network. Plain HTTP, so no extra libraries.
//
// On the TV: Settings → Network & Internet → Home network → IP control:
// Authentication "Normal and Pre-Shared Key", set a Pre-Shared Key, and turn on
// Remote start so the TV can be switched on from standby.

// Often enough to notice the TV coming on (say via the Apple TV) within seconds.
const POLL_MS = 4000;
// While it starts up the TV may put its own volume back; check and set again.
const VOLUME_RECHECK_MS = 3000;
// After switching inputs, remember the previous one this long. So "the TV
// was on HDMI 2 until just now" still holds when a console going to sleep
// makes the TV jump to another input.
const INPUT_MEMORY_MS = 2 * 60_000;
const TIMEOUT_MS = 4000;
const ID = 'bravia:tv';

export function createBravia(cfg, hub, log) {
  let model = null;
  let pollTimer = null;
  let lastError = null;
  let input = null; // e.g. "HDMI 2", "Apple TV"
  let inputWas = null;
  let inputWasUntil = 0;
  // Every input name seen, e.g. "HDMI 2", and the names devices announce over
  // HDMI-CEC ("Apple TV", "Steam Machine"), for the automation builder.
  const inputNames = new Set();
  let inputsCheckedAt = 0;

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

  // What's on screen: an input or channel. Inside an app the TV answers with
  // "Illegal State" (code 7), so there's no input then.
  async function nowPlaying() {
    try {
      return (await rpc('avContent', 'getPlayingContentInfo')) ?? null;
    } catch (e) {
      if (e.code === 7) return null;
      throw e;
    }
  }

  async function learnInputs() {
    if (Date.now() - inputsCheckedAt < 60_000) return;
    inputsCheckedAt = Date.now();
    try {
      const list = await rpc('avContent', 'getCurrentExternalInputsStatus', [], '1.1');
      for (const i of list ?? []) if (i.connection && i.title) inputNames.add(i.title);
    } catch (e) {
      log.warn('reading inputs failed:', e.message);
    }
  }

  function trackInput(next) {
    if (next) inputNames.add(next);
    if (next === input) return;
    if (input) {
      inputWas = input;
      inputWasUntil = Date.now() + INPUT_MEMORY_MS;
    }
    input = next;
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
        await learnInputs();
        const info = await nowPlaying();
        state.playing = info?.title || info?.source || null;
        trackInput(info?.title ?? null);
      } else {
        trackInput(null);
      }
      state.input = input;
      state.input_was = Date.now() < inputWasUntil ? inputWas : null;
      state.inputs = [...inputNames].sort();
      hub.upsertDevice({ id: ID, integration: 'bravia', kind: 'tv', name: cfg.name || 'Sony TV', room: null, online: true, state });
      if (lastError) log.info('TV reachable again');
      lastError = null;
      hub.status('bravia', true);
    } catch (e) {
      const message = e.name === 'TimeoutError' || e.cause ? 'TV not reachable (unplugged, or Remote start is off?)' : e.message;
      if (message !== lastError) log.warn(message);
      lastError = message;
      // Unreachable usually means deep standby: count it as off, so switching
      // it on again is seen as "turns on".
      const row = hub.devices.get(ID);
      if (row?.online || row?.state?.on) hub.upsertDevice({ ...row, online: false, state: { ...row.state, on: false } });
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
    } else if (action === 'volume' && params.volume != null) {
      // An exact level, e.g. {"volume": 15}.
      const level = Math.max(0, Math.min(100, Math.round(Number(params.volume))));
      const set = () => rpc('audio', 'setAudioVolume', [{ target: 'speaker', volume: String(level) }]);
      // Right after switching on, the TV answers "Not Found" (404) or "Illegal
      // State" (7) until its audio is up; keep trying for about 10 seconds.
      for (let wait = 500; ; wait *= 2) {
        try {
          await set();
          break;
        } catch (e) {
          if (![404, 7, 40000].includes(e.code) || wait > 4000) throw e;
          await new Promise((r) => setTimeout(r, wait));
        }
      }
      setTimeout(async () => {
        try {
          const volumes = await rpc('audio', 'getVolumeInformation');
          const speaker = volumes?.find((v) => v.target === 'speaker') ?? volumes?.[0];
          if (speaker && speaker.volume !== level) {
            log.info(`TV went to volume ${speaker.volume} while starting; setting ${level} again`);
            await set();
            refresh();
          }
        } catch (e) {
          log.warn('volume re-check failed:', e.message);
        }
      }, VOLUME_RECHECK_MS);
    } else if (action === 'volume') {
      const delta = Math.round(Number(params.delta));
      if (!delta) throw new Error('volume needs a delta (e.g. {"delta": 2}) or a level (e.g. {"volume": 15})');
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
