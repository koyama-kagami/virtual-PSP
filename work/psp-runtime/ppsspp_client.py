"""Bounded async client for PPSSPP a9175126's debugger protocol.

The owner must restrict the native debugger port before calling connect().
This module never starts/stops a process or changes firewall/config files.
Input axes use PPSSPP coordinates: positive X right, positive Y up.
After reconnect, callers must provide a fresh sessionEpoch.
"""
from __future__ import annotations

import asyncio
import contextlib
import math
from collections.abc import Awaitable, Callable, Mapping
from typing import Any, Protocol
from urllib.parse import urlsplit

import aiohttp

from vsh_navigation import DIRECTIONS, VshNavigation


BUTTONS = {
    "up": "up", "down": "down", "left": "left", "right": "right",
    "cross": "cross", "circle": "circle", "square": "square", "triangle": "triangle",
    "l": "ltrigger", "r": "rtrigger", "start": "start", "select": "select", "ps": "home",
}


class PpssppError(RuntimeError):
    """Transport/protocol failure; the requested operation is not confirmed."""


class PpssppBusyError(PpssppError):
    """Bounded work limit reached; owner should release/reconcile controller state."""


class Transport(Protocol):
    async def send(self, packet: dict[str, Any]) -> None: ...
    async def receive(self) -> dict[str, Any]: ...
    async def close(self) -> None: ...


class _AiohttpTransport:
    def __init__(self, session: aiohttp.ClientSession, socket: aiohttp.ClientWebSocketResponse):
        self.session, self.socket = session, socket

    @classmethod
    async def open(cls, url: str) -> "_AiohttpTransport":
        session = aiohttp.ClientSession(trust_env=False)
        try:
            socket = await session.ws_connect(
                url, protocols=("debugger.ppsspp.org",), heartbeat=10,
                max_msg_size=2 * 1024 * 1024,
            )
            if socket.protocol != "debugger.ppsspp.org":
                raise PpssppError("Debugger did not negotiate the required subprotocol")
            return cls(session, socket)
        except BaseException:
            await session.close()
            raise

    async def send(self, packet: dict[str, Any]) -> None:
        await self.socket.send_json(packet)

    async def receive(self) -> dict[str, Any]:
        message = await self.socket.receive()
        if message.type == aiohttp.WSMsgType.TEXT:
            value = message.json()
            if isinstance(value, dict):
                return value
            raise PpssppError("Debugger sent a non-object JSON message")
        raise PpssppError("Debugger connection closed")

    async def close(self) -> None:
        try:
            await self.socket.close()
        finally:
            await self.session.close()


def _snapshot(value: Mapping[str, Any]) -> tuple[int, str | int, set[str], float, float]:
    if not isinstance(value, Mapping):
        raise ValueError("snapshot must be an object")
    sequence = value.get("sequence")
    epoch = value.get("sessionEpoch")
    buttons = value.get("buttons")
    if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 0:
        raise ValueError("sequence must be a nonnegative integer")
    if isinstance(epoch, bool) or not isinstance(epoch, (str, int)) or epoch == "":
        raise ValueError("sessionEpoch must be a nonempty string or integer")
    if not isinstance(buttons, list) or any(not isinstance(name, str) or name not in BUTTONS for name in buttons):
        raise ValueError("buttons must contain supported PSP button names")
    axes = []
    for name in ("x", "y"):
        axis = value.get(name)
        if isinstance(axis, bool) or not isinstance(axis, (float, int)) or not math.isfinite(axis) or not -1 <= axis <= 1:
            raise ValueError(f"{name} must be finite and between -1 and 1")
        axes.append(float(axis))
    return sequence, epoch, {BUTTONS[name] for name in buttons}, axes[0], axes[1]


class PpssppClient:
    def __init__(
        self, ws_url: str = "http://127.0.0.1:4332/debugger", *,
        transport_factory: Callable[[str], Awaitable[Transport]] | None = None,
        timeout: float = 2.0, max_pending: int = 8, expected_pid: int | None = None,
    ):
        parsed = urlsplit(ws_url)
        if parsed.hostname not in ("127.0.0.1", "::1", "localhost") or parsed.scheme not in ("http", "https", "ws", "wss"):
            raise ValueError("Debugger connection must use a loopback URL")
        if not math.isfinite(timeout) or timeout <= 0 or isinstance(max_pending, bool) or max_pending < 1:
            raise ValueError("timeout and max_pending must be positive")
        self.ws_url = ws_url
        self.timeout = timeout
        self.max_pending = max_pending
        self.expected_pid = expected_pid
        self._factory = transport_factory or _AiohttpTransport.open
        self._transport: Transport | None = None
        self._reader: asyncio.Task | None = None
        self._pending: dict[int, tuple[str, asyncio.Future]] = {}
        self._ticket = 0
        self._lifecycle_lock = asyncio.Lock()
        self._input_lock = asyncio.Lock()
        self._pause_lock = asyncio.Lock()
        self._state_changed = asyncio.Event()
        self._input_waiting = 0
        self._epoch: str | int | None = None
        self._retired_epochs: set[str | int] = set()
        self._sequence = -1
        self._version: dict[str, Any] = {}
        self._ready = False
        self._closing = False
        self.last_error: str | None = None
        self._vsh = False
        self._navigation = VshNavigation(self._pulse_navigation, on_error=self._navigation_failed)

    @property
    def pending_count(self) -> int:
        return len(self._pending)

    @property
    def connected(self) -> bool:
        return self._ready and self._alive() and not self._closing

    def _alive(self) -> bool:
        return self._transport is not None and self._reader is not None and not self._reader.done()

    async def connect(self) -> dict[str, Any]:
        async with self._lifecycle_lock:
            if self.connected:
                return dict(self._version)
            await self._disconnect()
            self._closing = False
            self.last_error = None
            try:
                self._transport = await asyncio.wait_for(self._factory(self.ws_url), self.timeout)
                self._reader = asyncio.create_task(self._read_loop(), name="ppsspp-debugger-reader")
                self._version = await self._request("version", name="psp-studio-bridge", version="0.1")
                if self._version.get("name") != "PPSSPP" or not isinstance(self._version.get("pid"), int):
                    raise PpssppError("Unexpected debugger identity")
                if self.expected_pid is not None and self._version["pid"] != self.expected_pid:
                    raise PpssppError(f"Debugger PID {self._version['pid']} does not match expected PID {self.expected_pid}")
                await self._request("client.config.set", acknowledgeDeferred=True)
                await self._release()
                self._ready = True
                return dict(self._version)
            except BaseException as exc:
                self.last_error = str(exc)
                await self._disconnect()
                if isinstance(exc, asyncio.CancelledError):
                    raise
                raise PpssppError(f"Could not connect to PPSSPP: {exc}") from exc

    async def _read_loop(self) -> None:
        try:
            while self._transport is not None:
                packet = await self._transport.receive()
                event = packet.get("event")
                if event in ("cpu.stepping", "cpu.resume", "game.start", "game.quit", "game.pause", "game.resume"):
                    self._state_changed.set()
                if event in ("game.start", "game.quit", "game.pause", "cpu.stepping"):
                    self._navigation.cancel_pending()
                    if event in ("game.start", "game.quit"):
                        self._vsh = False
                ticket = packet.get("ticket")
                # JSON tickets are arbitrary; only our own integer tickets correlate.
                if isinstance(ticket, bool) or not isinstance(ticket, int):
                    continue
                pending = self._pending.get(ticket)
                if pending is None:
                    continue
                expected, future = pending
                if future.done():
                    continue
                if event == "error":
                    future.set_exception(PpssppError(str(packet.get("message", "Debugger error"))))
                elif event == expected or (event == "deferred" and packet.get("for") == expected):
                    future.set_result(packet)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.last_error = str(exc)
        finally:
            self._ready = False
            self._navigation.cancel_pending()
            self._state_changed.set()
            for _, future in self._pending.values():
                if not future.done():
                    future.set_exception(PpssppError(self.last_error or "Debugger disconnected"))

    async def _request(self, event: str, **fields: Any) -> dict[str, Any]:
        if not self._alive():
            raise PpssppError("Debugger is unavailable")
        if len(self._pending) >= self.max_pending:
            raise PpssppBusyError("Debugger pending request limit reached")
        self._ticket += 1
        ticket = self._ticket
        future = asyncio.get_running_loop().create_future()
        self._pending[ticket] = (event, future)
        try:
            async with asyncio.timeout(self.timeout):
                await self._transport.send({"event": event, "ticket": ticket, **fields})
                return await future
        except TimeoutError as exc:
            self.last_error = f"Timed out waiting for {event}"
            raise PpssppError(self.last_error) from exc
        except (aiohttp.ClientError, OSError) as exc:
            self.last_error = str(exc)
            raise PpssppError(f"Debugger transport failed: {exc}") from exc
        finally:
            self._pending.pop(ticket, None)
            if not future.done():
                future.cancel()

    async def _release(self) -> None:
        await self._navigation.clear()
        # Include every bridge-owned key; a missing field means "leave unchanged".
        failures = []
        for event, fields in (
            ("input.buttons.send", {"buttons": {name: False for name in BUTTONS.values()}}),
            ("input.analog.send", {"stick": "left", "x": 0.0, "y": 0.0}),
        ):
            try:
                await self._request(event, **fields)
            except PpssppError as exc:
                failures.append(str(exc))
        if failures:
            raise PpssppError("; ".join(failures))

    async def _pulse_navigation(self, name: str) -> None:
        if not self.connected:
            raise PpssppError("Debugger is unavailable")
        # Native vblank timing avoids stretching a click while transport ACKs wait.
        await self._request("input.buttons.press", button=name, duration=2)

    def _navigation_failed(self, error: Exception) -> None:
        self.last_error = f"XMB navigation failed: {error}"
        self._ready = False
        self._state_changed.set()

    async def _set_input_context(self, game: dict | None) -> None:
        vsh = bool(game and game.get("id") == "VSHM01150")
        if vsh != self._vsh:
            async with self._input_lock:
                await self._release()
                self._vsh = vsh

    async def input(self, snapshot: Mapping[str, Any]) -> bool:
        sequence, epoch, buttons, x, y = _snapshot(snapshot)
        if not self.connected:
            raise PpssppError("Debugger is unavailable")
        if self._input_waiting >= self.max_pending:
            raise PpssppBusyError("Controller queue limit reached; reconcile input state")
        self._input_waiting += 1
        try:
            async with asyncio.timeout(self.timeout * 3):
                async with self._input_lock:
                    if not self.connected:
                        raise PpssppError("Debugger is unavailable")
                    if epoch in self._retired_epochs or (epoch == self._epoch and sequence <= self._sequence):
                        return False
                    if epoch != self._epoch:
                        # Epochs are opaque. Remember retired ones so late old sessions cannot win.
                        if len(self._retired_epochs) >= 1024:
                            raise PpssppError("Epoch capacity reached; create a new client instance")
                        await self._release()
                        if self._epoch is not None:
                            self._retired_epochs.add(self._epoch)
                        self._epoch, self._sequence = epoch, -1
                    # Reserve before sending: a partial failure must not let older input win.
                    self._sequence = sequence
                    try:
                        # VSH directions use bounded pulses; games retain physical hold state.
                        # Omit pulsed keys so face/axis updates cannot cut a pulse short.
                        await self._request("input.buttons.send", buttons={
                            name: name in buttons for name in BUTTONS.values()
                            if not self._vsh or name not in DIRECTIONS
                        })
                        if self._vsh:
                            await self._navigation.set_buttons(buttons & DIRECTIONS)
                        await self._request("input.analog.send", stick="left", x=x, y=y)
                    except (PpssppError, asyncio.CancelledError):
                        with contextlib.suppress(PpssppError):
                            await self._release()
                        raise
                    return True
        except TimeoutError as exc:
            raise PpssppError("Controller operation timed out") from exc
        finally:
            self._input_waiting -= 1

    def _unavailable(self, error: str) -> dict[str, Any]:
        return {"state": "unavailable", "available": False, "running": False,
                "paused": None, "stepping": None, "game": None,
                "version": self._version.get("version"), "pid": self._version.get("pid"), "error": error}

    async def status(self) -> dict[str, Any]:
        if not self.connected:
            return self._unavailable(self.last_error or "Debugger is unavailable")
        try:
            game = await self._request("game.status")
            cpu = await self._request("cpu.status")
            await self._set_input_context(game.get("game"))
            if game.get("game") is None:
                return self._unavailable("No running PSP session")
            if not isinstance(cpu.get("stepping"), bool) or not isinstance(cpu.get("paused"), bool):
                return self._unavailable("Invalid CPU status response")
            paused = cpu["stepping"] or cpu["paused"] or bool(game.get("paused"))
            return {"state": "paused" if paused else "running", "available": True,
                    "running": not paused, "paused": paused, "stepping": cpu["stepping"],
                    "menuPaused": bool(game.get("paused")), "game": game["game"],
                    "version": self._version.get("version"), "pid": self._version.get("pid"),
                    "path": self._version.get("path"), "emulatedUs": cpu.get("us"), "error": None}
        except PpssppError as exc:
            return self._unavailable(str(exc))

    async def pause(self, paused: bool) -> dict[str, Any]:
        if not isinstance(paused, bool):
            raise ValueError("paused must be boolean")
        if self._pause_lock.locked():
            raise PpssppBusyError("A pause/resume operation is already in progress")
        async with self._pause_lock:
            state = await self.status()
            if not state["available"]:
                raise PpssppError(state["error"])
            if paused:
                async with self._input_lock:
                    await self._release()
            if state["paused"] == paused:
                return state
            if not paused and state.get("menuPaused"):
                raise PpssppError("The native pause menu must be closed before CPU resume")
            self._state_changed.clear()
            await self._request("cpu.stepping" if paused else "cpu.resume")
            deadline = asyncio.get_running_loop().time() + self.timeout
            while True:
                state = await self.status()
                if not state["available"]:
                    raise PpssppError(state["error"])
                if state["paused"] == paused:
                    return state
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    raise PpssppError("Pause/resume was accepted but its actual state was not confirmed")
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._state_changed.wait(), min(0.03, remaining))
                self._state_changed.clear()

    async def close(self) -> None:
        async with self._lifecycle_lock:
            self._closing = True
            try:
                async with asyncio.timeout(self.timeout * 3):
                    async with self._input_lock:
                        if self._alive():
                            await self._release()
            except (PpssppError, TimeoutError) as exc:
                # A dead transport cannot guarantee release. Keep this visible to the owner.
                self.last_error = f"Input release not confirmed: {exc}"
            finally:
                await self._disconnect()

    async def _disconnect(self) -> None:
        self._ready = False
        await self._navigation.clear()
        self._vsh = False
        if self._epoch is not None:
            self._retired_epochs.add(self._epoch)
        self._epoch, self._sequence = None, -1
        if self._reader is not None:
            self._reader.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reader
            self._reader = None
        if self._transport is not None:
            transport, self._transport = self._transport, None
            with contextlib.suppress(Exception):
                await asyncio.wait_for(transport.close(), self.timeout)
