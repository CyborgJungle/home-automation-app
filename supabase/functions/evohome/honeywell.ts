// Honeywell evohome through Honeywell/Resideo's Total Connect Comfort (EMEA) cloud API.
// This is the API the evohome app itself uses; it isn't officially documented,
// but it has been stable for years (Home Assistant uses it too).
// No Deno- or Node-specific APIs here, so the tests can run under Node.

// Public application credentials shared by every client of this API (not your account).
const APP_AUTH = "Basic " + btoa("4a231089-d2b6-41bd-a5eb-16a0a422b999:1a15cdb8-42de-407b-add0-059f92c530cb");
const SCOPE = "EMEA-V1-Basic EMEA-V1-Anonymous EMEA-V1-Get-Current-User-Account";
export const DEFAULT_HOST = "https://tccna.resideo.com";

export type Token = { accessToken: string; refreshToken: string | null; expiresAt: number };
// How a zone heats (from the installation setup), e.g. "RadiatorZone",
// "UnderfloorHeating", "ZoneValves", "ElectricHeating", "MixingValve".
export type ZoneConfig = { zoneType: string | null; modelType: string | null };
export type Location = {
  id: string;
  name: string;
  zones?: Record<string, ZoneConfig>;
  systemType?: string | null;
  hotWater?: boolean;
};
export type DeviceRow = {
  id: string;
  integration: "evohome";
  kind: "heating" | "zone";
  name: string;
  room: string | null;
  online: boolean;
  state: Record<string, unknown>;
};

export class AuthError extends Error {}

// The API wants second precision: 2026-10-17T12:00:00Z
export function formatUntil(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// deno-lint-ignore no-explicit-any
type Json = any;

const faultTypes = (faults: Json) => (faults ?? []).map((f: Json) => f.faultType).filter(Boolean);

// Turns one location's status response into device rows.
export function statusToDevices(locationName: string, status: Json, location?: Location): DeviceRow[] {
  const rows: DeviceRow[] = [];
  for (const gateway of status.gateways ?? []) {
    for (const tcs of gateway.temperatureControlSystems ?? []) {
      rows.push({
        id: `evohome:system:${tcs.systemId}`,
        integration: "evohome",
        kind: "heating",
        name: locationName,
        room: null,
        online: true,
        state: {
          mode: tcs.systemModeStatus?.mode ?? null,
          faults: tcs.activeFaults?.length ?? 0,
          fault_types: faultTypes(tcs.activeFaults),
          system_type: location?.systemType ?? null,
          hot_water: location?.hotWater ?? null,
        },
      });

      for (const zone of tcs.zones ?? []) {
        const available = zone.temperatureStatus?.isAvailable !== false;
        rows.push({
          id: `evohome:zone:${zone.zoneId}`,
          integration: "evohome",
          kind: "zone",
          name: zone.name,
          room: zone.name,
          online: available,
          state: {
            temperature: available ? (zone.temperatureStatus?.temperature ?? null) : null,
            setpoint: zone.setpointStatus?.targetHeatTemperature ?? null,
            mode: zone.setpointStatus?.setpointMode ?? null,
            until: zone.setpointStatus?.until ?? null,
            faults: zone.activeFaults?.length ?? 0,
            fault_types: faultTypes(zone.activeFaults),
            zone_type: location?.zones?.[zone.zoneId]?.zoneType ?? null,
            model_type: location?.zones?.[zone.zoneId]?.modelType ?? null,
          },
        });
      }
    }
  }
  return rows;
}

// Request body for a zone or system command from the web app.
export function commandRequest(deviceId: string, action: string, params: Json, now = new Date()) {
  const [, type, id] = deviceId.split(":");

  if (type === "zone" && action === "set_temperature") {
    const setpoint = Number(params.setpoint);
    if (!Number.isFinite(setpoint) || setpoint < 5 || setpoint > 35) {
      throw new Error("Setpoint must be between 5 and 35 °C");
    }
    const body = params.minutes
      ? {
          SetpointMode: "TemporaryOverride",
          HeatSetpointValue: setpoint,
          TimeUntil: formatUntil(new Date(now.getTime() + Number(params.minutes) * 60_000)),
        }
      : { SetpointMode: "PermanentOverride", HeatSetpointValue: setpoint, TimeUntil: null };
    return { path: `temperatureZone/${id}/heatSetpoint`, body };
  }
  if (type === "zone" && action === "follow_schedule") {
    return {
      path: `temperatureZone/${id}/heatSetpoint`,
      body: { SetpointMode: "FollowSchedule", HeatSetpointValue: 0.0, TimeUntil: null },
    };
  }
  if (type === "system" && action === "set_mode") {
    return {
      path: `temperatureControlSystem/${id}/mode`,
      body: { SystemMode: params.mode, TimeUntil: null, Permanent: true },
    };
  }
  throw new Error(`Unknown evohome action "${action}"`);
}

export class Honeywell {
  token: Token | null;
  private username: string;
  private password: string;
  private host: string;

  constructor(username: string, password: string, host = DEFAULT_HOST, token: Token | null = null) {
    this.username = username;
    this.password = password;
    this.host = host;
    this.token = token;
  }

  private async requestToken(fields: Record<string, string>) {
    const res = await fetch(`${this.host}/Auth/OAuth/Token`, {
      method: "POST",
      headers: {
        Authorization: APP_AUTH,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body: new URLSearchParams(fields),
    });
    const text = await res.text();
    if (!res.ok) {
      const message = `Honeywell login failed (HTTP ${res.status}): ${text.slice(0, 200)}`;
      throw res.status === 400 || res.status === 401 ? new AuthError(message) : new Error(message);
    }
    const t = JSON.parse(text);
    this.token = {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? this.token?.refreshToken ?? null,
      expiresAt: Date.now() + (t.expires_in ?? 1800) * 1000,
    };
  }

  private async login() {
    if (this.token?.refreshToken) {
      try {
        await this.requestToken({ grant_type: "refresh_token", refresh_token: this.token.refreshToken, scope: SCOPE });
        return;
      } catch {
        this.token = null; // refresh token expired; fall back to the password
      }
    }
    await this.requestToken({ grant_type: "password", scope: SCOPE, Username: this.username, Password: this.password });
  }

  async api(path: string, method = "GET", body?: unknown, retried = false): Promise<Json> {
    if (!this.token || Date.now() > this.token.expiresAt - 60_000) await this.login();

    const res = await fetch(`${this.host}/WebAPI/emea/api/v1/${path}`, {
      method,
      headers: {
        Authorization: `bearer ${this.token!.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();

    if (res.status === 401 && !retried) {
      this.token = { ...this.token!, expiresAt: 0 };
      return this.api(path, method, body, true);
    }
    if (!res.ok) throw new Error(`Honeywell API ${method} ${path} failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }

  async locations(): Promise<Location[]> {
    const user = await this.api("userAccount");
    const installations = await this.api(
      `location/installationInfo?userId=${user.userId}&includeTemperatureControlSystems=True`,
    );
    return installations.map((i: Json) => {
      const systems = (i.gateways ?? []).flatMap((g: Json) => g.temperatureControlSystems ?? []);
      const zones: Record<string, ZoneConfig> = {};
      for (const z of systems.flatMap((s: Json) => s.zones ?? [])) {
        zones[z.zoneId] = { zoneType: z.zoneType ?? null, modelType: z.modelType ?? null };
      }
      return {
        id: i.locationInfo.locationId,
        name: i.locationInfo.name,
        zones,
        systemType: systems[0]?.modelType ?? null,
        hotWater: systems.some((s: Json) => Boolean(s.dhw)),
      };
    });
  }

  async devices(locations: Location[]): Promise<DeviceRow[]> {
    const rows: DeviceRow[] = [];
    for (const location of locations) {
      const status = await this.api(`location/${location.id}/status?includeTemperatureControlSystems=True`);
      rows.push(...statusToDevices(location.name, status, location));
    }
    return rows;
  }

  async execute(deviceId: string, action: string, params: Json) {
    const { path, body } = commandRequest(deviceId, action, params);
    await this.api(path, "PUT", body);
  }
}
