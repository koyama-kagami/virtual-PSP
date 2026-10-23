"""Observe PPSSPP input broadcasts without clearing or changing core state.

The only application request is read-only `version` to verify the target PID.
Never calls PpssppClient.connect(), input.*, cpu.*, or game.* commands.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import time

import aiohttp


EVENTS = frozenset(("input.buttons", "input.analog"))


async def observe(pid: int, seconds: float, output: Path) -> int:
    started = time.monotonic()
    report = {"startedAt": datetime.now(timezone.utc).isoformat(), "expectedPid": pid,
              "readOnlyRequests": ["version"], "events": [], "error": None}

    def record(packet):
        item = {"elapsedMs": round((time.monotonic() - started) * 1000, 2), **packet}
        report["events"].append(item)
        print(json.dumps(item), flush=True)
        if len(report["events"]) >= 10000:
            raise RuntimeError("Observation event limit reached")

    try:
        async with aiohttp.ClientSession(trust_env=False, timeout=aiohttp.ClientTimeout(total=None, connect=3)) as session:
            async with session.ws_connect("http://127.0.0.1:4332/debugger",
                                          protocols=("debugger.ppsspp.org",), max_msg_size=2 * 1024 * 1024) as ws:
                if ws.protocol != "debugger.ppsspp.org":
                    raise RuntimeError("Required debugger subprotocol was not negotiated")
                await ws.send_json({"event": "version", "ticket": 1})
                pending = []
                async with asyncio.timeout(3):
                    while True:
                        message = await ws.receive()
                        if message.type != aiohttp.WSMsgType.TEXT:
                            raise RuntimeError("Debugger closed during identity check")
                        packet = message.json()
                        if packet.get("event") == "version" and packet.get("ticket") == 1:
                            if packet.get("name") != "PPSSPP" or packet.get("pid") != pid:
                                raise RuntimeError(f"Unexpected debugger identity: {packet}")
                            report["identity"] = packet
                            print(json.dumps({"observerReady": True, "pid": pid, "seconds": seconds}), flush=True)
                            break
                        if packet.get("event") in EVENTS:
                            pending.append(packet)
                for packet in pending:
                    record(packet)
                deadline = time.monotonic() + seconds
                while time.monotonic() < deadline:
                    try:
                        message = await asyncio.wait_for(ws.receive(), deadline - time.monotonic())
                    except TimeoutError:
                        break
                    if message.type != aiohttp.WSMsgType.TEXT:
                        raise RuntimeError("Debugger connection closed during observation")
                    packet = message.json()
                    if packet.get("event") in EVENTS:
                        record(packet)
        return 0
    except Exception as exc:
        report["error"] = str(exc)
        print(json.dumps({"observerError": str(exc)}), flush=True)
        return 1
    finally:
        report["endedAt"] = datetime.now(timezone.utc).isoformat()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({"saved": str(output.resolve()), "eventCount": len(report["events"])}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", required=True, type=int)
    parser.add_argument("--seconds", type=float, default=90)
    parser.add_argument("--output", type=Path, default=Path("evidence/browser-input-observer.json"))
    args = parser.parse_args()
    if args.pid <= 0 or not 0 < args.seconds <= 3600:
        parser.error("pid must be positive; seconds must be in (0, 3600]")
    raise SystemExit(asyncio.run(observe(args.pid, args.seconds, args.output)))


if __name__ == "__main__":
    main()
