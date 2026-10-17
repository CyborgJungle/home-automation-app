"""Apple TV and HomePod bridge for the home agent, built on pyatv.

Runs as a child process of the Node agent (src/integrations/apple.js) and
talks JSON lines: commands come in on stdin, device states, command results
and log lines go out on stdout. Credentials from pairing (see pair.py) live in
pyatv's own file storage (~/.pyatv.conf).

stdin:  {"req": 1, "device": "<identifier>", "action": "play", "params": {}}
stdout: {"type": "device", "id": ..., "name": ..., "kind": "tv"|"speaker", "online": true, "state": {...}}
        {"type": "result", "req": 1, "ok": true} / {"type": "result", "req": 1, "ok": false, "error": "..."}
        {"type": "log", "level": "info"|"warn", "msg": "..."}
"""

import asyncio
import json
import sys

import pyatv
from pyatv.const import DeviceState, FeatureName, FeatureState, PowerState
from pyatv.interface import AudioListener, DeviceListener, PowerListener, PushListener
from pyatv.storage.file_storage import FileStorage

POLL_S = 30  # fallback refresh; most changes arrive as push updates
APPS_REFRESH_S = 30 * 60
RECONNECT_S = 20
SCAN_TIMEOUT_S = 6

# Only these get a tile: Apple TVs and HomePods (not Macs or iPads).
MODELS = {"AppleTV": "tv", "AudioAccessory": "speaker"}


def emit(**msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def log(msg, level="info"):
    emit(type="log", level=level, msg=msg)


def kind_of(conf):
    raw = conf.device_info.raw_model or ""
    return next((kind for prefix, kind in MODELS.items() if raw.startswith(prefix)), None)


class Device(PushListener, PowerListener, AudioListener, DeviceListener):
    """One Apple TV or HomePod: keeps a connection open and reports its state."""

    def __init__(self, bridge, conf):
        self.bridge = bridge
        self.conf = conf
        self.id = conf.identifier
        self.name = conf.name
        self.kind = kind_of(conf)
        self.atv = None
        self.state = {"model": conf.device_info.raw_model}
        self.apps = []
        self.apps_loaded_at = 0
        self.saved_volume = None  # for mute, which pyatv doesn't have
        self.lock = asyncio.Lock()

    # --- connection -------------------------------------------------------

    async def connect(self):
        async with self.lock:
            if self.atv:
                return
            self.atv = await pyatv.connect(self.conf, asyncio.get_running_loop(), storage=self.bridge.storage)
            self.atv.listener = self
            self.atv.push_updater.listener = self
            self.atv.push_updater.start()
            if self.kind == "tv":
                self.atv.power.listener = self
            self.atv.audio.listener = self
            log(f"connected to {self.name}")
        await self.refresh()

    def connection_lost(self, exception):
        log(f"lost connection to {self.name}: {exception}", "warn")
        self._drop()

    def connection_closed(self):
        self._drop()

    def _drop(self):
        self.atv = None
        self.publish(online=False)

    def available(self, feature):
        try:
            return self.atv.features.in_state(FeatureState.Available, feature)
        except Exception:
            return False

    # --- state ------------------------------------------------------------

    def publish(self, online=True):
        emit(type="device", id=self.id, name=self.name, kind=self.kind, online=online, state=self.state)

    async def refresh(self):
        atv = self.atv
        if not atv:
            return
        try:
            playing = await atv.metadata.playing()
            self.state["playing"] = playing.device_state in (DeviceState.Playing, DeviceState.Loading)
            self.state["title"] = playing.title or None
            self.state["artist"] = playing.artist or None
        except Exception as e:
            log(f"{self.name}: reading what's playing failed: {e}", "warn")
        try:
            app = atv.metadata.app
            self.state["app"] = app.name if app else None
        except Exception:
            self.state["app"] = None
        if self.kind == "tv":
            try:
                self.state["on"] = atv.power.power_state == PowerState.On
            except Exception:
                # Needs Companion pairing (apple/pair.py); until then power is unknown.
                self.state["on"] = None
                self.state["needs_pairing"] = True
        if self.available(FeatureName.Volume):
            self.state["volume"] = round(atv.audio.volume)
            self.state["muted"] = self.saved_volume is not None
        loop = asyncio.get_running_loop()
        if self.kind == "tv" and self.available(FeatureName.AppList) and loop.time() - self.apps_loaded_at > APPS_REFRESH_S:
            try:
                apps = await atv.apps.app_list()
                self.apps = sorted(({"id": a.identifier, "name": a.name} for a in apps), key=lambda a: a["name"].lower())
                self.apps_loaded_at = loop.time()
            except Exception as e:
                log(f"{self.name}: reading the app list failed: {e}", "warn")
        if self.kind == "tv":
            self.state["apps"] = self.apps
        self.publish()

    # Push updates from pyatv.
    def playstatus_update(self, updater, playstatus):
        self.state["playing"] = playstatus.device_state in (DeviceState.Playing, DeviceState.Loading)
        self.state["title"] = playstatus.title or None
        self.state["artist"] = playstatus.artist or None
        self.publish()

    def playstatus_error(self, updater, exception):
        log(f"{self.name}: push update error: {exception}", "warn")

    def powerstate_update(self, old_state, new_state):
        self.state["on"] = new_state == PowerState.On
        self.publish()

    def volume_update(self, old_level, new_level):
        self.state["volume"] = round(new_level)
        self.publish()

    def volume_device_update(self, output_device, old_level, new_level):
        pass  # per-speaker volume in a group; the overall level is enough here

    def outputdevices_update(self, old_devices, new_devices):
        pass

    # --- commands ---------------------------------------------------------

    async def execute(self, action, params):
        if not self.atv:
            await self.connect()
        atv = self.atv
        rc = atv.remote_control
        if action == "power":
            await (atv.power.turn_on() if params.get("on") else atv.power.turn_off())
        elif action == "play":
            await rc.play()
        elif action == "pause":
            await rc.pause()
        elif action == "next":
            await rc.next()
        elif action == "previous":
            await rc.previous()
        elif action == "volume":
            if params.get("delta") is not None:
                await (atv.audio.volume_up() if params["delta"] > 0 else atv.audio.volume_down())
            else:
                await atv.audio.set_volume(max(0, min(100, float(params["volume"]))))
        elif action == "mute":
            if params.get("on"):
                if self.saved_volume is None:
                    self.saved_volume = atv.audio.volume
                await atv.audio.set_volume(0)
            elif self.saved_volume is not None:
                await atv.audio.set_volume(self.saved_volume)
                self.saved_volume = None
        elif action == "app":
            await atv.apps.launch_app(params["id"])
        else:
            raise ValueError(f'Unknown Apple action "{action}"')
        await asyncio.sleep(0.5)
        await self.refresh()


class Bridge:
    def __init__(self, names):
        self.names = {n.strip().lower() for n in names if n.strip()}
        self.devices = {}
        self.storage = None

    async def scan(self):
        loop = asyncio.get_running_loop()
        for conf in await pyatv.scan(loop, timeout=SCAN_TIMEOUT_S, storage=self.storage):
            if not kind_of(conf):
                continue
            if self.names and conf.name.lower() not in self.names:
                continue
            if conf.identifier not in self.devices:
                self.devices[conf.identifier] = Device(self, conf)
                log(f"found {conf.name} ({conf.device_info.raw_model})")
            else:
                self.devices[conf.identifier].conf = conf  # address may have changed

    async def keep_connected(self):
        while True:
            try:
                await self.scan()
            except Exception as e:
                log(f"scan failed: {e}", "warn")
            for device in self.devices.values():
                try:
                    if device.atv:
                        await device.refresh()
                    else:
                        await device.connect()
                except Exception as e:
                    log(f"{device.name}: {e}", "warn")
                    device.publish(online=False)
            await asyncio.sleep(POLL_S if all(d.atv for d in self.devices.values()) else RECONNECT_S)

    async def handle(self, line):
        try:
            msg = json.loads(line)
        except ValueError:
            return
        req = msg.get("req")
        device = self.devices.get(msg.get("device"))
        try:
            if not device:
                raise ValueError("Device not found; is it on and on the network?")
            await device.execute(msg.get("action"), msg.get("params") or {})
            emit(type="result", req=req, ok=True)
        except Exception as e:
            emit(type="result", req=req, ok=False, error=str(e) or e.__class__.__name__)

    async def read_commands(self):
        loop = asyncio.get_running_loop()
        reader = asyncio.StreamReader()
        await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
        while line := await reader.readline():
            asyncio.create_task(self.handle(line))

    async def run(self):
        self.storage = FileStorage.default_storage(asyncio.get_running_loop())
        await self.storage.load()
        log("bridge started")
        await asyncio.gather(self.keep_connected(), self.read_commands())


if __name__ == "__main__":
    asyncio.run(Bridge(sys.argv[1].split(",") if len(sys.argv) > 1 else []).run())
