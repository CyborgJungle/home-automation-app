"""Terminal entry point for home automation."""

import argparse
import asyncio
import getpass
import json
import os
import sys
from dataclasses import asdict

from home_automation.evohome import (
    ConnectionProblem,
    HomeSnapshot,
    demo_snapshot,
    fetch_status,
)


def credentials(no_input: bool) -> tuple[str, str]:
    username = os.environ.get("EVOHOME_USERNAME", "").strip()
    password = os.environ.get("EVOHOME_PASSWORD", "")
    if not no_input and sys.stdin.isatty():
        if not username:
            username = input("Total Connect Comfort email: ").strip()
        if not password:
            password = getpass.getpass("Total Connect Comfort password: ")
    if not username or not password:
        raise ConnectionProblem(
            "Set EVOHOME_USERNAME and EVOHOME_PASSWORD in secure environment "
            "settings, or run in an interactive terminal to sign in."
        )
    return username, password


def render(snapshot: HomeSnapshot) -> str:
    lines = [
        "DEMO — sample data" if snapshot.source == "demo" else "Evohome — live status",
        f"Observed: {snapshot.observed_at}",
    ]
    for location in snapshot.locations:
        lines.append(f"\n{location.name} ({location.id})")
        for system in location.systems:
            lines.append(
                f"  System {system.id} / gateway {system.gateway_id}: {system.mode}"
            )
            for zone in system.zones:
                current = (
                    f"{zone.temperature_c:g} °C" if zone.available else "unavailable"
                )
                lines.append(
                    f"    {zone.name}: {current} | target {zone.target_c:g} °C"
                    f" | {zone.mode}"
                )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Personal home automation")
    integrations = parser.add_subparsers(dest="integration", required=True)
    evohome = integrations.add_parser("evohome", help="Total Connect Comfort Europe/UK")
    commands = evohome.add_subparsers(dest="command", required=True)
    status = commands.add_parser("status", help="Read heating zones and temperatures")
    status.add_argument("--demo", action="store_true", help="Use offline sample data")
    status.add_argument("--json", action="store_true", help="Print structured JSON")
    status.add_argument(
        "--no-input", action="store_true", help="Never prompt for login"
    )
    args = parser.parse_args(argv)
    try:
        if args.demo:
            snapshot = demo_snapshot()
        else:
            username, password = credentials(args.no_input)
            snapshot = asyncio.run(fetch_status(username, password))
    except ConnectionProblem as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("Cancelled.", file=sys.stderr)
        return 130
    if args.json:
        data = asdict(snapshot)
        for location in data["locations"]:
            for system in location["systems"]:
                for zone in system["zones"]:
                    zone["available"] = zone["temperature_c"] is not None
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        print(render(snapshot))
    return 0
