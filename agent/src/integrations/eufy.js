// Eufy doorbell, through the community eufy-security-client library (Eufy has no official API).
// Tip: create a second Eufy account and share the doorbell with it, then use that
// account here, so the agent doesn't sign your phone out.

import fs from 'node:fs/promises';
import path from 'node:path';
import { EufySecurity, PropertyName } from 'eufy-security-client';

const RING_DEDUPE_MS = 10_000;

export function createEufy(cfg, hub, log) {
  let eufy = null;
  const lastRing = new Map(); // device id -> timestamp

  const idOf = (device) => `eufy:${device.getSerial()}`;

  function pushDevice(device) {
    if (!device.isDoorbell()) return;
    hub.upsertDevice({
      id: idOf(device),
      integration: 'eufy',
      kind: 'doorbell',
      name: device.getName(),
      room: null,
      online: true,
      state: {
        model: device.getModel(),
        battery: device.hasBattery() ? (device.getPropertyValue(PropertyName.DeviceBattery) ?? null) : null,
        last_ring_at: hub.devices.get(idOf(device))?.state?.last_ring_at ?? null,
      },
    });
  }

  async function onCaptcha(id, captcha) {
    // `captcha` is a data URL of the image to solve.
    await fs.mkdir(cfg.dataDir, { recursive: true });
    const file = path.join(cfg.dataDir, 'captcha.png');
    await fs.writeFile(file, Buffer.from(captcha.split(',').pop(), 'base64'));
    const msg = `Eufy wants a captcha. Open ${file}, then set EUFY_CAPTCHA_ID=${id} and EUFY_CAPTCHA_CODE=<the text> in .env and restart.`;
    log.warn(msg);
    hub.status('eufy', false, 'Needs a captcha (see agent log)');
  }

  async function start() {
    await fs.mkdir(cfg.dataDir, { recursive: true });

    eufy = await EufySecurity.initialize({
      username: cfg.username,
      password: cfg.password,
      country: cfg.country,
      language: 'en',
      trustedDeviceName: 'home-agent',
      persistentDir: cfg.dataDir, // keeps the login, so codes are only needed once
      p2pConnectionSetup: 2, // QUICKEST
      pollingIntervalMinutes: 10,
      eventDurationSeconds: 10,
      acceptInvitations: true,
    });

    eufy
      .on('connect', () => {
        log.info('logged in');
        hub.status('eufy', true);
      })
      .on('close', () => hub.status('eufy', false, 'Disconnected from Eufy cloud'))
      .on('connection error', (e) => {
        log.warn('connection error:', e.message);
        hub.status('eufy', false, e.message);
      })
      .on('tfa request', () => {
        log.warn('Eufy sent a verification code (email/SMS). Put it in EUFY_VERIFY_CODE in .env and restart.');
        hub.status('eufy', false, 'Needs the verification code Eufy just sent (see agent log)');
      })
      .on('captcha request', onCaptcha)
      .on('push connect', () => log.info('listening for doorbell rings'))
      .on('push close', () => log.warn('push connection closed; rings will not arrive until it reconnects'))
      .on('station added', (station) => log.info(`station: ${station.getName()} (${station.getModel()})`))
      .on('device added', (device) => {
        log.info(`device: ${device.getName()} (${device.getModel()}, doorbell: ${device.isDoorbell()})`);
        pushDevice(device);
      })
      .on('device property changed', (device, name) => {
        if (name === PropertyName.DeviceBattery) pushDevice(device);
      })
      .on('device rings', (device, ringing) => {
        if (!ringing) return;
        const id = idOf(device);
        const now = Date.now();
        if (now - (lastRing.get(id) ?? 0) < RING_DEDUPE_MS) return;
        lastRing.set(id, now);

        log.info(`ding dong: ${device.getName()}`);
        const at = new Date(now).toISOString();
        hub.event('doorbell.ring', id, { at });
        hub.patchState(id, { last_ring_at: at });
      });

    const loginOptions = { force: false };
    if (cfg.verifyCode) loginOptions.verifyCode = cfg.verifyCode;
    if (cfg.captchaId && cfg.captchaCode) {
      loginOptions.captcha = { captchaId: cfg.captchaId, captchaCode: cfg.captchaCode };
    }
    await eufy.connect(loginOptions);

    const devices = await eufy.getDevices();
    log.info(`account sees ${devices.length} device(s)${devices.length ? '' : ': is the doorbell shared with this account, and the invitation accepted?'}`);
    for (const device of devices) pushDevice(device);
  }

  async function execute() {
    throw new Error('The doorbell has no controls yet');
  }

  function stop() {
    eufy?.close();
  }

  return { name: 'eufy', start, execute, stop };
}
