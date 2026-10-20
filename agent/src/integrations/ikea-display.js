// The custom ESP32 OBEGRÄNSAD firmware's LAN API. The Pi is the only network
// client: web users send ordinary light commands through the existing queue.
import fs from 'node:fs/promises';
import path from 'node:path';

const ID = 'ikeadisplay:screen';
const POLL_MS = 10_000;
const TIMEOUT_MS = 4000;
const validBrightness = (value) => Number.isInteger(value) && value >= 0 && value <= 255;

export function createIkeaDisplay(cfg, hub, log, { fetchImpl = fetch } = {}) {
  const origin = new URL(`http://${cfg.host}`);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('IKEA_DISPLAY_HOST must be a LAN hostname or IP address, optionally with a port');
  }
  let timer = null;
  let stopped = false;
  let loaded = false;
  let restoreBrightness = 255;
  let lastError = null;
  let queue = Promise.resolve();
  // The last status the wall reported, so a command doesn't have to ask first.
  let latest = null;
  let latestAt = 0;

  // Keep polls and commands in order, including an Off followed quickly by On.
  function serial(task) {
    const next = queue.then(task);
    queue = next.catch(() => {});
    return next;
  }

  async function remember(value) {
    if (value === 0 || value === restoreBrightness) return;
    if (cfg.stateFile) {
      await fs.mkdir(path.dirname(cfg.stateFile), { recursive: true });
      await fs.writeFile(`${cfg.stateFile}.tmp`, JSON.stringify({ restoreBrightness: value }) + '\n', { mode: 0o600 });
      await fs.rename(`${cfg.stateFile}.tmp`, cfg.stateFile);
    }
    restoreBrightness = value;
  }

  async function request(endpoint, method = 'GET') {
    const response = await fetchImpl(new URL(endpoint, origin), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Display API returned HTTP ${response.status}`);
    return response.json();
  }

  async function info() {
    const body = await request('/api/info');
    if (!validBrightness(body?.brightness) || !validBrightness(body?.baseBrightness ?? body?.brightness)) {
      throw new Error('Display API did not return a valid brightness; check its firmware and host');
    }
    return body;
  }

  async function report(body) {
    latest = body;
    latestAt = Date.now();
    const base = body.baseBrightness ?? body.brightness;
    await remember(base);
    await hub.upsertDevice({
      id: ID, integration: 'ikeadisplay', kind: 'light',
      name: cfg.name || 'IKEA display', room: cfg.room || null, online: true,
      state: {
        on: body.brightness > 0,
        brightness: Math.round(body.brightness * 100 / 255),
        baseBrightness: base,
        plugin: body.plugin ?? null,
        plugin_name: body.plugins?.find((p) => p.id === body.plugin)?.name ?? null,
        // What it can show, for the app's mode picker and automations.
        plugins: Array.isArray(body.plugins) ? body.plugins.map(({ id, name }) => ({ id, name })) : [],
        brightnessScheduleEnabled: body.brightnessSchedule?.enabled === true,
      },
    });
    if (lastError) log.info('IKEA display reachable again');
    lastError = null;
    await hub.status('ikeadisplay', true);
  }

  async function failed(error) {
    const message = error.name === 'TimeoutError' || error.cause
      ? 'IKEA display not reachable; check its power, Wi-Fi and IKEA_DISPLAY_HOST'
      : error.message;
    if (message !== lastError) log.warn(message);
    lastError = message;
    const row = hub.devices.get(ID);
    latest = null;
    if (row?.online) await hub.upsertDevice({ ...row, online: false });
    await hub.status('ikeadisplay', false, message);
  }

  async function refresh() {
    try {
      await report(await info());
    } catch (error) {
      await failed(error);
      throw error;
    }
  }

  async function start() {
    stopped = false;
    if (!loaded && cfg.stateFile) {
      try {
        const saved = JSON.parse(await fs.readFile(cfg.stateFile, 'utf8'));
        if (!validBrightness(saved.restoreBrightness) || saved.restoreBrightness === 0) {
          throw new Error('Invalid saved IKEA display brightness');
        }
        restoreBrightness = saved.restoreBrightness;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      loaded = true;
    }
    await serial(refresh);
    clearInterval(timer);
    if (!stopped) timer = setInterval(() => serial(refresh).catch(() => {}), POLL_MS);
  }

  // Switch what the wall shows (a plugin: Big Clock, Weather, Snake, ...).
  async function showPlugin(id) {
    if (!Number.isInteger(id) || id < 1) throw new Error('Choose a mode for the display');
    return serial(async () => {
      try {
        const result = await request(`/api/plugin?id=${id}`, 'PATCH');
        if (result?.success === false || result?.error) throw new Error('Display rejected the mode');
        await report(await info());
      } catch (error) {
        await failed(error);
        throw error;
      }
    });
  }

  // A message that scrolls across once, then the wall goes back to its mode.
  async function showMessage(text, repeat = 1) {
    const clean = String(text ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
    if (!clean) throw new Error('Type a message to show');
    const query = new URLSearchParams({ text: clean, repeat: String(Math.max(1, Math.min(10, Math.round(repeat)))) });
    return serial(async () => {
      try {
        await request(`/api/message?${query}`);
      } catch (error) {
        await failed(error);
        throw error;
      }
    });
  }

  async function execute(deviceId, action, params = {}) {
    if (deviceId !== ID) throw new Error('Unknown IKEA display');
    if (action === 'plugin') return showPlugin(Number(params.id));
    if (action === 'message') return showMessage(params.text, params.repeat ?? 1);
    if (action !== 'set') throw new Error(`Unknown IKEA display action "${action}"`);
    if (Object.keys(params).some((key) => !['on', 'brightness'].includes(key)) ||
        (params.on === undefined && params.brightness === undefined) ||
        (params.on !== undefined && typeof params.on !== 'boolean') ||
        (params.brightness !== undefined && (!Number.isFinite(params.brightness) || params.brightness < 0 || params.brightness > 100))) {
      throw new Error('Display set needs on (boolean) and/or brightness (0–100 percent)');
    }
    return serial(async () => {
      let current = Date.now() - latestAt < POLL_MS * 1.5 ? latest : null;
      try {
        current ??= await info();
      } catch (error) {
        await failed(error);
        throw error;
      }
      // Its built-in schedule overrides baseBrightness, including zero. Never
      // claim Off worked or silently change the user's schedule.
      if (current.brightnessSchedule?.enabled) {
        throw new Error('Disable Scheduled brightness in the IKEA display app before controlling it here; use home automations for its schedule');
      }
      await remember(current.baseBrightness ?? current.brightness);
      const requested = params.brightness === undefined ? restoreBrightness : Math.round(params.brightness * 255 / 100);
      const target = params.on === false ? 0 : requested;
      if (params.brightness !== undefined) await remember(requested);
      try {
        const result = await request(`/api/brightness?value=${target}`, 'PATCH');
        if (result?.success === false || result?.error) throw new Error('Display rejected the brightness command');
        const updated = await info();
        if (updated.brightness !== target) throw new Error('Display did not confirm the requested brightness');
        await report(updated);
      } catch (error) {
        await failed(error);
        throw error;
      }
    });
  }

  function stop() {
    stopped = true;
    clearInterval(timer);
  }

  return { name: 'ikeadisplay', start, execute, stop };
}
