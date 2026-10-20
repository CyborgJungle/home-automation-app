// Picks up commands queued in Supabase (by the web app) and runs them.
// Realtime delivers new commands instantly; a slow poll covers missed messages.

import { AGENT_INTEGRATIONS } from './integrations/index.js';

const POLL_MS = 15_000;
// Don't replay old taps after the Pi was offline for a while.
const MAX_AGE_MS = 2 * 60_000;

const prefixOf = (cmd) => cmd.device_id.split(':')[0];

export function startCommandLoop(supabase, integrations, log) {

  async function finish(id, status, error = null) {
    await supabase
      .from('commands')
      .update({ status, error, completed_at: new Date().toISOString() })
      .eq('id', id);
  }

  async function run(cmd) {
    // Claim it atomically so a restart can't run the same command twice.
    const { data: claimed, error } = await supabase
      .from('commands')
      .update({ status: 'running' })
      .eq('id', cmd.id)
      .eq('status', 'pending')
      .select('id');
    if (error || !claimed?.length) return;

    if (Date.now() - Date.parse(cmd.created_at) > MAX_AGE_MS) {
      await finish(cmd.id, 'failed', 'Expired: the agent was offline when this was sent');
      return;
    }

    const integration = integrations.get(prefixOf(cmd));
    if (!integration) {
      await finish(cmd.id, 'failed', 'That integration is not enabled on the agent');
      return;
    }

    log.info(`#${cmd.id} ${cmd.action} ${cmd.device_id}`, JSON.stringify(cmd.params));
    try {
      await integration.execute(cmd.device_id, cmd.action, cmd.params ?? {});
      await finish(cmd.id, 'done');
    } catch (e) {
      log.warn(`#${cmd.id} failed:`, e.message);
      await finish(cmd.id, 'failed', e.message);
    }
  }

  // evohome commands are handled by the Supabase function, not the Pi.
  // IKEA lamps are switched in parallel (a scene lands at once); each device
  // keeps its own order, and other integrations run one by one. Lanes don't
  // wait for each other, so a slow TV or vacuum never holds up a lamp.
  const lanes = new Map();
  const queued = new Set();

  function enqueue(cmd) {
    if (cmd.status !== 'pending' || queued.has(cmd.id) || !AGENT_INTEGRATIONS.includes(prefixOf(cmd))) return;
    queued.add(cmd.id);
    const lane = prefixOf(cmd) === 'dirigera' ? cmd.device_id : prefixOf(cmd);
    const next = (lanes.get(lane) ?? Promise.resolve())
      .then(() => run(cmd))
      .catch((e) => log.warn(`#${cmd.id} failed:`, e.message))
      .finally(() => {
        queued.delete(cmd.id);
        if (lanes.get(lane) === next) lanes.delete(lane);
      });
    lanes.set(lane, next);
  }

  // Catches anything realtime missed (e.g. while reconnecting).
  async function drain() {
    const { data, error } = await supabase
      .from('commands')
      .select('*')
      .eq('status', 'pending')
      .order('created_at')
      .limit(20);
    if (error) log.warn('fetching commands failed:', error.message);
    else data.forEach(enqueue);
  }

  supabase
    .channel('agent-commands')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commands' }, (msg) =>
      // The new row comes with the message: run it without asking for it again.
      msg.new?.id ? enqueue(msg.new) : drain(),
    )
    .subscribe((status) => log.info('realtime:', status));

  setInterval(drain, POLL_MS);
  drain();
}
