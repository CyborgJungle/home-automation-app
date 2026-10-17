// The hub is what integrations report to. It writes devices, events and
// integration health to Supabase, skipping writes when nothing changed
// (TRÅDFRI in particular repeats identical updates often).

export function createHub(supabase, log, version) {
  const lastWritten = new Map(); // device id -> JSON of last written row
  const devices = new Map(); // device id -> last row
  const integrations = {};
  const startedAt = new Date().toISOString();

  async function upsertDevice(row) {
    const key = JSON.stringify(row);
    if (lastWritten.get(row.id) === key) return;
    lastWritten.set(row.id, key);
    devices.set(row.id, row);

    const { error } = await supabase
      .from('devices')
      .upsert({ ...row, updated_at: new Date().toISOString() });
    if (error) {
      lastWritten.delete(row.id);
      log.error(`saving ${row.id} failed:`, error.message);
    }
  }

  async function patchState(id, patch) {
    const row = devices.get(id);
    if (row) await upsertDevice({ ...row, state: { ...row.state, ...patch } });
  }

  async function event(type, deviceId, data = {}) {
    const { error } = await supabase.from('events').insert({ type, device_id: deviceId, data });
    if (error) log.error(`saving event ${type} failed:`, error.message);
  }

  async function heartbeat() {
    const { error } = await supabase.from('agent_status').upsert({
      id: 1,
      version,
      started_at: startedAt,
      last_seen: new Date().toISOString(),
      integrations,
    });
    if (error) log.error('heartbeat failed:', error.message);
  }

  function status(name, ok, error = null) {
    const prev = integrations[name];
    integrations[name] = { ok, error };
    if (prev?.ok !== ok || prev?.error !== error) heartbeat();
  }

  return { upsertDevice, patchState, event, status, heartbeat, devices };
}
