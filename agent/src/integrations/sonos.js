// Sonos speakers, through their local UPnP API (HTTP on port 1400). No Sonos
// account or key needed, and no extra libraries: plain fetch and UDP.
//
// Each room is a device. Play/pause/next go to the room's group coordinator
// (so a grouped room controls the whole group); volume and mute are per room.

import dgram from 'node:dgram';

const POLL_MS = 4000;
const DISCOVER_MS = 10 * 60_000;
const TIMEOUT_MS = 4000;
const SSDP_WAIT_MS = 2500;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s = '') =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml, name) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml ?? '')?.[1];
const attr = (xml, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(xml ?? '')?.[1];

const SERVICES = {
  AVTransport: '/MediaRenderer/AVTransport/Control',
  RenderingControl: '/MediaRenderer/RenderingControl/Control',
  ZoneGroupTopology: '/ZoneGroupTopology/Control',
  ContentDirectory: '/MediaServer/ContentDirectory/Control',
};

// Common UPnP errors, in words.
const UPNP_ERRORS = {
  701: 'Nothing to play. Start something in the Sonos or Spotify app first.',
  714: 'That favourite can’t be played on this speaker.',
  800: 'The speaker is busy, try again in a moment.',
};

async function soap(ip, service, action, args = {}) {
  const params = Object.entries(args)
    .map(([k, v]) => `<${k}>${esc(v)}</${k}>`)
    .join('');
  const body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:${service}:1">${params}</u:${action}></s:Body></s:Envelope>`;
  const res = await fetch(`http://${ip}:1400${SERVICES[service]}`, {
    method: 'POST',
    headers: {
      'content-type': 'text/xml; charset="utf-8"',
      soapaction: `"urn:schemas-upnp-org:service:${service}:1#${action}"`,
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const xml = await res.text();
  if (!res.ok) {
    const code = Number(tag(xml, 'errorCode'));
    throw new Error(UPNP_ERRORS[code] ?? `Sonos error ${code || res.status} (${action})`);
  }
  return xml;
}

// Finds speakers with an SSDP search; returns their IP addresses.
function ssdpSearch() {
  return new Promise((resolve) => {
    const ips = new Set();
    const socket = dgram.createSocket('udp4');
    socket.on('message', (msg, from) => {
      if (/Sonos/i.test(msg.toString())) ips.add(from.address);
    });
    socket.bind(() => {
      const search =
        'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\n' +
        'ST: urn:schemas-upnp-org:device:ZonePlayer:1\r\n\r\n';
      for (let i = 0; i < 3; i++) setTimeout(() => socket.send(search, 1900, '239.255.255.250'), i * 400);
    });
    setTimeout(() => {
      socket.close();
      resolve([...ips]);
    }, SSDP_WAIT_MS);
  });
}

// What's playing, in a few words: "Song — Artist", a radio show, or the source.
function describeTrack(positionXml, mediaXml) {
  const track = unesc(tag(positionXml, 'TrackMetaData'));
  const media = unesc(tag(mediaXml, 'CurrentURIMetaData'));
  const uri = unesc(tag(mediaXml, 'CurrentURI')) || unesc(tag(positionXml, 'TrackURI'));
  const title = unesc(tag(track, 'dc:title'));
  const artist = unesc(tag(track, 'dc:creator'));
  const stream = unesc(tag(track, 'r:streamContent'));
  let source = unesc(tag(media, 'dc:title')) || null;
  if (uri?.startsWith('x-sonos-htastream:')) source = 'TV';
  else if (uri?.startsWith('x-rincon-stream:')) source = 'Line-in';
  else if (uri?.includes('spotify')) source = source ?? 'Spotify';
  const usable = (s) => s && !/^x-sonos|^x-rincon|^http/.test(s);
  return {
    title: usable(stream) ? stream : usable(title) ? title : null,
    artist: usable(artist) ? artist : null,
    source,
  };
}

export function createSonos(cfg, hub, log) {
  const speakers = new Map(); // uuid -> { uuid, ip, name, coordinator, online }
  let favorites = []; // { id, title, uri, meta, container }
  let pollTimer = null;
  let discoverTimer = null;
  let polling = false;

  const idOf = (uuid) => `sonos:${uuid}`;

  async function loadTopology(ip) {
    const xml = unesc(tag(await soap(ip, 'ZoneGroupTopology', 'GetZoneGroupState'), 'ZoneGroupState'));
    const seen = new Set();
    for (const group of xml.matchAll(/<ZoneGroup\s[^>]*>[\s\S]*?<\/ZoneGroup>/g)) {
      const coordinator = attr(group[0], 'Coordinator');
      for (const m of group[0].matchAll(/<ZoneGroupMember\s[^>]*>/g)) {
        // Surrounds and subs are "invisible" members of a room; skip them.
        if (attr(m[0], 'Invisible') === '1') continue;
        const uuid = attr(m[0], 'UUID');
        const ip = /\/\/([\d.]+):1400/.exec(attr(m[0], 'Location') ?? '')?.[1];
        if (!uuid || !ip) continue;
        seen.add(uuid);
        speakers.set(uuid, { ...speakers.get(uuid), uuid, ip, name: attr(m[0], 'ZoneName') ?? 'Sonos', coordinator });
      }
    }
    for (const uuid of speakers.keys()) if (!seen.has(uuid)) speakers.delete(uuid);
  }

  async function loadFavorites(ip) {
    try {
      const xml = await soap(ip, 'ContentDirectory', 'Browse', {
        ObjectID: 'FV:2',
        BrowseFlag: 'BrowseDirectChildren',
        Filter: 'dc:title,res,upnp:class,r:resMD',
        StartingIndex: 0,
        RequestedCount: 100,
        SortCriteria: '',
      });
      const didl = unesc(tag(xml, 'Result'));
      favorites = [...didl.matchAll(/<item\s[^>]*>[\s\S]*?<\/item>/g)].map((m) => {
        const meta = unesc(tag(m[0], 'r:resMD'));
        const uri = unesc(/<res[^>]*>([\s\S]*?)<\/res>/.exec(m[0])?.[1] ?? '');
        return {
          id: attr(m[0], 'id'),
          title: unesc(tag(m[0], 'dc:title')) || 'Favourite',
          uri,
          meta,
          // Playlists and albums go through the queue; stations play directly.
          container: /object\.container/.test(tag(meta, 'upnp:class') ?? '') || uri.startsWith('x-rincon-cpcontainer:'),
        };
      });
    } catch (e) {
      log.warn('loading favourites failed:', e.message);
    }
  }

  async function discover() {
    const ips = new Set([...(cfg.host ? [cfg.host] : []), ...[...speakers.values()].map((s) => s.ip), ...(await ssdpSearch())]);
    let lastError = null;
    for (const ip of ips) {
      try {
        await loadTopology(ip);
        await loadFavorites(ip);
        return;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError ?? new Error('No Sonos speakers found on the network');
  }

  async function pollSpeaker(sp, groupCache) {
    const coordinator = speakers.get(sp.coordinator) ?? sp;
    try {
      // One transport/track lookup per group, shared by its rooms.
      if (!groupCache.has(coordinator.uuid)) {
        groupCache.set(
          coordinator.uuid,
          Promise.all([
            soap(coordinator.ip, 'AVTransport', 'GetTransportInfo', { InstanceID: 0 }),
            soap(coordinator.ip, 'AVTransport', 'GetPositionInfo', { InstanceID: 0 }),
            soap(coordinator.ip, 'AVTransport', 'GetMediaInfo', { InstanceID: 0 }),
          ]),
        );
      }
      const [[transport, position, media], volume, mute] = await Promise.all([
        groupCache.get(coordinator.uuid),
        soap(sp.ip, 'RenderingControl', 'GetVolume', { InstanceID: 0, Channel: 'Master' }),
        soap(sp.ip, 'RenderingControl', 'GetMute', { InstanceID: 0, Channel: 'Master' }),
      ]);
      const status = tag(transport, 'CurrentTransportState');
      const others = [...speakers.values()].filter((x) => x.coordinator === sp.coordinator && x.uuid !== sp.uuid).map((x) => x.name);
      sp.online = true;
      hub.upsertDevice({
        id: idOf(sp.uuid),
        integration: 'sonos',
        kind: 'speaker',
        name: sp.name,
        room: sp.name,
        online: true,
        state: {
          playing: status === 'PLAYING' || status === 'TRANSITIONING',
          status: status?.toLowerCase() ?? null,
          volume: Number(tag(volume, 'CurrentVolume')),
          muted: tag(mute, 'CurrentMute') === '1',
          ...describeTrack(position, media),
          grouped_with: others.length ? others : null,
          favorites: favorites.map(({ id, title }) => ({ id, title })),
        },
      });
    } catch (e) {
      if (sp.online !== false) log.warn(`${sp.name} not reachable:`, e.message);
      sp.online = false;
      const row = hub.devices.get(idOf(sp.uuid));
      if (row?.online) hub.upsertDevice({ ...row, online: false });
    }
  }

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const groupCache = new Map();
      await Promise.all([...speakers.values()].map((sp) => pollSpeaker(sp, groupCache)));
      const anyOnline = [...speakers.values()].some((s) => s.online);
      hub.status('sonos', anyOnline, anyOnline ? null : 'No Sonos speaker answered');
    } finally {
      polling = false;
    }
  }

  async function rediscover() {
    try {
      await discover();
    } catch (e) {
      log.warn('discovery failed:', e.message);
    }
  }

  async function start() {
    log.info(cfg.host ? `looking for speakers (starting at ${cfg.host})` : 'looking for speakers');
    await discover();
    log.info(`found ${[...speakers.values()].map((s) => s.name).join(', ')}; ${favorites.length} favourite(s)`);
    await poll();
    pollTimer = setInterval(poll, POLL_MS);
    discoverTimer = setInterval(rediscover, DISCOVER_MS);
  }

  async function execute(deviceId, action, params) {
    const sp = speakers.get(deviceId.slice('sonos:'.length));
    if (!sp) throw new Error('Speaker not found');
    const coordinator = speakers.get(sp.coordinator) ?? sp;
    const transport = (name, extra = {}) => soap(coordinator.ip, 'AVTransport', name, { InstanceID: 0, ...extra });

    switch (action) {
      case 'play':
        await transport('Play', { Speed: 1 });
        break;
      case 'pause':
        await transport('Pause');
        break;
      case 'next':
        await transport('Next');
        break;
      case 'previous':
        await transport('Previous');
        break;
      case 'volume': {
        if (params.delta != null) {
          await soap(sp.ip, 'RenderingControl', 'SetRelativeVolume', { InstanceID: 0, Channel: 'Master', Adjustment: Math.round(params.delta) });
        } else {
          const volume = Math.max(0, Math.min(100, Math.round(Number(params.volume))));
          await soap(sp.ip, 'RenderingControl', 'SetVolume', { InstanceID: 0, Channel: 'Master', DesiredVolume: volume });
        }
        break;
      }
      case 'mute':
        await soap(sp.ip, 'RenderingControl', 'SetMute', { InstanceID: 0, Channel: 'Master', DesiredMute: params.on ? 1 : 0 });
        break;
      case 'favorite': {
        const fav = favorites.find((f) => f.id === params.id) ?? favorites.find((f) => f.title === params.title);
        if (!fav) throw new Error('That Sonos favourite no longer exists');
        if (fav.container) {
          await transport('RemoveAllTracksFromQueue');
          await transport('AddURIToQueue', { EnqueuedURI: fav.uri, EnqueuedURIMetaData: fav.meta, DesiredFirstTrackNumberEnqueued: 0, EnqueueAsNext: 0 });
          await transport('SetAVTransportURI', { CurrentURI: `x-rincon-queue:${coordinator.uuid}#0`, CurrentURIMetaData: '' });
        } else {
          await transport('SetAVTransportURI', { CurrentURI: fav.uri, CurrentURIMetaData: fav.meta });
        }
        await transport('Play', { Speed: 1 });
        break;
      }
      default:
        throw new Error(`Unknown Sonos action "${action}"`);
    }
    // Show the result without waiting for the next poll.
    setTimeout(poll, 400);
  }

  function stop() {
    clearInterval(pollTimer);
    clearInterval(discoverTimer);
  }

  return { name: 'sonos', start, execute, stop };
}
