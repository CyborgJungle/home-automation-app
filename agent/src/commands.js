// Picks up commands queued in Supabase (by the web app) and runs them.
// Realtime delivers new commands instantly; a slow poll covers missed messages.

const POLL_MS = 15_000;
// Don't replay old taps after the Pi was offline for a while.
const MAX_AGE_MS = 2 * 60_000;

export function startCommandLoop(supabase, integrations, log) {
  let draining = false;
  let again = false;

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

    const integration = integrations.get(cmd.device_id.split(':')[0]);
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

  async function drain() {
    if (draining) {
      again = true;
      return;
    }
    draining = true;
    try {
      do {
        again = false;
        const { data, error } = await supabase
          .from('commands')
          .select('*')
          .eq('status', 'pending')
          .order('created_at')
          .limit(20);
        if (error) {
          log.warn('fetching commands failed:', error.message);
          break;
        }
        for (const cmd of data) await run(cmd);
      } while (again);
    } finally {
      draining = false;
    }
  }

  supabase
    .channel('agent-commands')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commands' }, drain)
    .subscribe((status) => log.info('realtime:', status));

  setInterval(drain, POLL_MS);
  drain();
}
