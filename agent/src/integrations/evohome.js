// Honeywell evohome, through Honeywell/Resideo's Total Connect Comfort (EMEA) cloud API.
// This is the API the evohome app itself uses; it isn't officially documented,
// but it has been stable for years (Home Assistant uses it too).

// Public application credentials shared by every client of this API (not your account).
const APP_AUTH =
  'Basic ' +
  Buffer.from('4a231089-d2b6-41bd-a5eb-16a0a422b999:1a15cdb8-42de-407b-add0-059f92c530cb').toString('base64');
const SCOPE = 'EMEA-V1-Basic EMEA-V1-Anonymous EMEA-V1-Get-Current-User-Account';

// The API wants second precision: 2026-10-17T12:00:00Z
export function formatUntil(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Turns one location's status response into device rows.
export function statusToDevices(locationName, status) {
  const rows = [];
  for (const gateway of status.gateways ?? []) {
    for (const tcs of gateway.temperatureControlSystems ?? []) {
      rows.push({
        id: `evohome:system:${tcs.systemId}`,
        integration: 'evohome',
        kind: 'heating',
        name: locationName,
        room: null,
        online: true,
        state: {
          mode: tcs.systemModeStatus?.mode ?? null,
          faults: tcs.activeFaults?.length ?? 0,
        },
      });

      for (const zone of tcs.zones ?? []) {
        const available = zone.temperatureStatus?.isAvailable !== false;
        rows.push({
          id: `evohome:zone:${zone.zoneId}`,
          integration: 'evohome',
          kind: 'zone',
          name: zone.name,
          room: zone.name,
          online: available,
          state: {
            temperature: available ? (zone.temperatureStatus?.temperature ?? null) : null,
            setpoint: zone.setpointStatus?.targetHeatTemperature ?? null,
            mode: zone.setpointStatus?.setpointMode ?? null,
            until: zone.setpointStatus?.until ?? null,
            faults: zone.activeFaults?.length ?? 0,
          },
        });
      }
    }
  }
  return rows;
}

export function createEvohome(cfg, hub, log) {
  let accessToken = null;
  let refreshToken = null;
  let expiresAt = 0;
  let locations = [];
  let pollTimer = null;
  let refreshSoonTimer = null;

  async function requestToken(fields) {
    const res = await fetch(`${cfg.host}/Auth/OAuth/Token`, {
      method: 'POST',
      headers: {
        Authorization: APP_AUTH,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: new URLSearchParams(fields),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Login failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
    const token = JSON.parse(text);
    accessToken = token.access_token;
    refreshToken = token.refresh_token ?? refreshToken;
    expiresAt = Date.now() + (token.expires_in ?? 1800) * 1000;
  }

  async function login() {
    if (refreshToken) {
      try {
        await requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPE });
        return;
      } catch (e) {
        log.warn('token refresh failed, logging in again:', e.message);
        refreshToken = null;
      }
    }
    await requestToken({
      grant_type: 'password',
      scope: SCOPE,
      Username: cfg.username,
      Password: cfg.password,
    });
  }

  async function api(path, { method = 'GET', body } = {}, retried = false) {
    if (!accessToken || Date.now() > expiresAt - 60_000) await login();

    const res = await fetch(`${cfg.host}/WebAPI/emea/api/v1/${path}`, {
      method,
      headers: {
        Authorization: `bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();

    if (res.status === 401 && !retried) {
      accessToken = null;
      return api(path, { method, body }, true);
    }
    if (!res.ok) throw new Error(`Honeywell API ${method} ${path} failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }

  async function poll() {
    try {
      for (const location of locations) {
        const status = await api(`location/${location.id}/status?includeTemperatureControlSystems=True`);
        for (const row of statusToDevices(location.name, status)) await hub.upsertDevice(row);
      }
      hub.status('evohome', true);
    } catch (e) {
      log.warn('poll failed:', e.message);
      hub.status('evohome', false, e.message);
    }
  }

  async function start() {
    log.info(`logging in to ${cfg.host}`);
    const user = await api('userAccount');
    const installations = await api(
      `location/installationInfo?userId=${user.userId}&includeTemperatureControlSystems=True`,
    );
    locations = installations.map((i) => ({ id: i.locationInfo.locationId, name: i.locationInfo.name }));
    log.info(`found ${locations.length} location(s): ${locations.map((l) => l.name).join(', ')}`);

    await poll();
    pollTimer = setInterval(poll, cfg.pollSeconds * 1000);
  }

  // Changes take a few seconds to show up in the status, so re-read shortly after.
  function refreshSoon() {
    clearTimeout(refreshSoonTimer);
    refreshSoonTimer = setTimeout(poll, 5_000);
  }

  async function execute(deviceId, action, params) {
    const [, type, id] = deviceId.split(':');

    if (type === 'zone' && action === 'set_temperature') {
      const setpoint = Number(params.setpoint);
      if (!Number.isFinite(setpoint) || setpoint < 5 || setpoint > 35) {
        throw new Error('Setpoint must be between 5 and 35 °C');
      }
      const body = params.minutes
        ? {
            SetpointMode: 'TemporaryOverride',
            HeatSetpointValue: setpoint,
            TimeUntil: formatUntil(new Date(Date.now() + Number(params.minutes) * 60_000)),
          }
        : { SetpointMode: 'PermanentOverride', HeatSetpointValue: setpoint, TimeUntil: null };
      await api(`temperatureZone/${id}/heatSetpoint`, { method: 'PUT', body });
    } else if (type === 'zone' && action === 'follow_schedule') {
      await api(`temperatureZone/${id}/heatSetpoint`, {
        method: 'PUT',
        body: { SetpointMode: 'FollowSchedule', HeatSetpointValue: 0.0, TimeUntil: null },
      });
    } else if (type === 'system' && action === 'set_mode') {
      await api(`temperatureControlSystem/${id}/mode`, {
        method: 'PUT',
        body: { SystemMode: params.mode, TimeUntil: null, Permanent: true },
      });
    } else {
      throw new Error(`Unknown evohome action "${action}"`);
    }
    refreshSoon();
  }

  function stop() {
    clearInterval(pollTimer);
    clearTimeout(refreshSoonTimer);
  }

  return { name: 'evohome', start, execute, stop };
}
