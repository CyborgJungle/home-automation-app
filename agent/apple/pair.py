"""One-time pairing with an Apple TV or HomePod.

Usage (on the Pi):  ~/.local/pyatv/bin/python apple/pair.py "Woonkamer"

Pairs every protocol the device asks for (Companion for power and apps,
AirPlay for playback and volume). For an Apple TV a 4-digit code appears on
the TV; type it here. The keys are saved in ~/.pyatv.conf, where the bridge
finds them.
"""

import asyncio
import sys

import pyatv
from pyatv.const import PairingRequirement, Protocol
from pyatv.storage.file_storage import FileStorage

PROTOCOLS = [Protocol.Companion, Protocol.AirPlay]


async def main(name):
    loop = asyncio.get_running_loop()
    storage = FileStorage.default_storage(loop)
    await storage.load()

    print(f"Looking for {name}…")
    confs = [c for c in await pyatv.scan(loop, timeout=6, storage=storage) if c.name.lower() == name.lower()]
    if not confs:
        print(f'No device called "{name}" found. Check the name in the Home app and that it is switched on.')
        return 1
    conf = confs[0]
    print(f"Found {conf.name} ({conf.device_info.raw_model}) at {conf.address}")

    for protocol in PROTOCOLS:
        service = conf.get_service(protocol)
        if not service:
            continue
        need = service.pairing
        if need in (PairingRequirement.NotNeeded, PairingRequirement.Unsupported):
            print(f"{protocol.name}: no pairing needed")
            continue
        if need == PairingRequirement.Disabled:
            print(f"{protocol.name}: pairing is switched off on the device (Home app → Home Settings → Speakers & TV → allow access).")
            continue
        if service.credentials:
            print(f"{protocol.name}: already paired")
            continue

        pairing = await pyatv.pair(conf, protocol, loop, storage=storage, name="Home Automation")
        try:
            await pairing.begin()
            if pairing.device_provides_pin:
                pin = input(f"{protocol.name}: enter the code shown on the TV: ").strip()
                pairing.pin(int(pin))
            else:
                # The device asks us for a code; show it there and accept it.
                pairing.pin(1234)
                input(f"{protocol.name}: if the device asks for a code, enter 1234 there, then press Enter here… ")
            await pairing.finish()
            print(f"{protocol.name}: {'paired' if pairing.has_paired else 'pairing failed'}")
        finally:
            await pairing.close()

    await storage.save()
    print("Done. Saved to ~/.pyatv.conf")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    sys.exit(asyncio.run(main(sys.argv[1])))
