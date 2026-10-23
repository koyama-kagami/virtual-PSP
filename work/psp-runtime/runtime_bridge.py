"""Local PSP video/control bridge. No desktop capture, game downloads, or LAN bind."""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import ctypes
from ctypes import wintypes
from datetime import datetime
import json
import math
from pathlib import Path
import secrets
import subprocess
import threading
import time

import aiohttp
from aiohttp import web
from aiortc import RTCPeerConnection, RTCConfiguration, RTCSessionDescription, VideoStreamTrack
from aiortc.mediastreams import MediaStreamError
import av
import cv2
import numpy as np
import psutil

from ppsspp_client import BUTTONS, PpssppClient

ROOT = Path(__file__).resolve().parent
ORIGINS = frozenset(('http://127.0.0.1:4330', 'http://localhost:4330'))
PAYLOAD = web.RequestKey('payload', dict)
CAPABILITIES = {
    'originalVsh': True, 'fullFirmwareBoot': False, 'launchGameFromVsh': False,
    'returnToVsh': False, 'nativeSleep': False, 'umdEject': False, 'wlan': False,
    'microphone': False, 'savestate': False, 'videoTransport': 'webrtc',
    'audioTransport': 'native-process', 'volume': True, 'mute': True,
    'frameWidth': 480, 'frameHeight': 272, 'targetFps': 30,
}


def client_crop(frame_size, window_rect, client_rect):
    """Convert physical screen client bounds to capture-local pixels; reject stale sizes."""
    fw, fh = frame_size
    wl, wt, wr, wb = window_rect
    cl, ct, cr, cb = client_rect
    if fw <= 0 or fh <= 0 or abs((wr - wl) - fw) > 2 or abs((wb - wt) - fh) > 2:
        raise ValueError('Capture size and window geometry are not synchronized')
    crop = (cl - wl, ct - wt, cr - wl, cb - wt)
    x1, y1, x2, y2 = crop
    if not (0 <= x1 < x2 <= fw and 0 <= y1 < y2 <= fh):
        raise ValueError('Client rectangle is outside the captured window')
    return crop


class LatestFrame:
    """One owned frame; replacement never queues old video frames."""
    def __init__(self):
        self._lock = threading.Lock()
        self._image = None
        self._sequence = 0
        self._time = 0.0

    def put(self, image, now=None):
        owned = np.ascontiguousarray(image).copy()
        with self._lock:
            self._image = owned
            self._sequence += 1
            self._time = time.monotonic() if now is None else now

    def get(self):
        with self._lock:
            return self._image, self._sequence, self._time


def _win32():
    user = ctypes.WinDLL('user32', use_last_error=True)
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
    user.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user.IsWindow.argtypes = [wintypes.HWND]
    user.IsIconic.argtypes = [wintypes.HWND]
    user.IsWindowVisible.argtypes = [wintypes.HWND]
    return user


def lower_native_window(target):
    """Keep rendering/taskbar access while moving only the verified window behind the page."""
    user = _win32()
    owner = wintypes.DWORD()
    user.GetWindowThreadProcessId(target['hwnd'], ctypes.byref(owner))
    if owner.value != target['pid']:
        raise RuntimeError('Window ownership changed before background placement')
    # HWND_BOTTOM; SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE. No minimize or hide.
    if not user.SetWindowPos(target['hwnd'], 1, 0, 0, 0, 0, 0x13):
        raise RuntimeError('Could not place the native window behind the page')


def read_native_state():
    return json.loads((ROOT / 'native-state.json').read_text(encoding='utf-8-sig'))


def native_windows(pid, *, main_only=True):
    user = _win32()
    found = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    @callback_type
    def inspect(hwnd, _):
        owner = wintypes.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        name = ctypes.create_unicode_buffer(128)
        user.GetClassNameW(hwnd, name, 128)
        if owner.value == pid and (name.value == 'PPSSPPWnd' or (not main_only and user.IsWindowVisible(hwnd))):
            found.append(int(hwnd))
        return True

    user.EnumWindows(inspect, 0)
    return found


class NativeWindowPending(RuntimeError):
    pass


def find_native():
    state = read_native_state()
    pid = int(state['pid'])
    expected = (ROOT / 'ppsspp/PPSSPPWindows64.exe').resolve()
    if Path(psutil.Process(pid).exe()).resolve() != expected:
        raise RuntimeError('Recorded PID does not belong to the isolated PPSSPP executable')
    found = native_windows(pid)
    if not found:
        raise NativeWindowPending('原生 PSP 窗口仍在准备中')
    if len(found) != 1:
        raise RuntimeError(f'Expected one isolated PPSSPP window, found {len(found)}')
    return {'pid': pid, 'hwnd': found[0], 'executable': str(expected)}


def inspect_managed_native(state):
    """Fail closed on PID reuse/foreign instances before any recovery termination."""
    process = psutil.Process(int(state['pid']))
    expected = (ROOT / 'ppsspp/PPSSPPWindows64.exe').resolve()
    if Path(process.exe()).resolve() != expected or '--debugger=4332' not in process.cmdline():
        raise RuntimeError('Recorded native process identity changed; no process was stopped')
    created = process.create_time()
    if state.get('processCreatedAt'):
        identity_matches = abs(created - datetime.fromisoformat(state['processCreatedAt']).timestamp()) < 0.1
    else:
        # Legacy state records readiness time, a few seconds after process creation.
        age_at_ready = datetime.fromisoformat(state['startedAt']).timestamp() - created
        identity_matches = 0 <= age_at_ready <= 30
    if not identity_matches:
        raise RuntimeError('Recorded native PID was reused; no process was stopped')
    listening = any(c.status == psutil.CONN_LISTEN and c.laddr.port == 4332 for c in process.net_connections(kind='tcp'))
    return {'process':process, 'windows':native_windows(process.pid, main_only=False), 'listening':listening}


async def recover_closed_native(*, grace=2.0, interval=0.1):
    """Reap only our previously-ready process after its window and server are gone."""
    try:
        state = read_native_state()
        deadline = None
        while True:
            status = await asyncio.to_thread(inspect_managed_native, state)
            if status['windows'] or status['listening']:
                return
            if deadline is None:
                # Count the grace period after observing a closed instance, not
                # before a potentially slow first process/window inspection.
                deadline = time.monotonic() + grace
            elif time.monotonic() >= deadline:
                # Last probe revalidated identity, windows and port after the grace period.
                status['process'].terminate()
                await asyncio.to_thread(status['process'].wait, 3)
                return
            await asyncio.sleep(interval)
    except (FileNotFoundError, psutil.NoSuchProcess):
        return
    except (psutil.AccessDenied, psutil.TimeoutExpired) as exc:
        raise RuntimeError('无法确认旧 PSP 进程已退出，请稍后点击电源重试') from exc


async def wait_native_window(*, timeout=10, interval=0.1):
    deadline = time.monotonic() + timeout
    while True:
        try:
            return await asyncio.to_thread(find_native)
        except NativeWindowPending as exc:
            if time.monotonic() >= deadline:
                raise RuntimeError('原生 PSP 窗口未能在启动期限内准备好，请点击电源重试') from exc
            await asyncio.sleep(interval)


async def wait_native_session(client, *, timeout=15, interval=0.1):
    """A ready window/debugger can precede the VSH CPU by several seconds."""
    last_error = 'No running PSP session'
    try:
        async with asyncio.timeout(timeout):
            while True:
                state = await client.status()
                if state['available']:
                    return state
                last_error = state.get('error') or 'PSP core unavailable'
                if not client.connected:
                    raise RuntimeError(last_error)
                await asyncio.sleep(interval)
    except TimeoutError as exc:
        raise RuntimeError(f'原版 XMB 未能在启动期限内就绪：{last_error}') from exc


async def launch_native():
    """The launcher owns firewall checks and any permitted native attach/start."""
    await recover_closed_native()
    process = await asyncio.create_subprocess_exec(
        'pwsh', '-NoProfile', '-File', str(ROOT / 'start-native.ps1'), '-EnableDebugger',
        cwd=str(ROOT), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), 40)
    except TimeoutError:
        # Only this short-lived launcher is owned here, never the PPSSPP process.
        process.kill()
        await process.wait()
        raise RuntimeError('Native launcher timed out')
    if process.returncode:
        raise RuntimeError((stderr or stdout).decode('utf-8', errors='replace')[-2000:])
    return await wait_native_window()


class WindowCapture:
    def __init__(self, target, frames):
        self.target, self.frames = target, frames
        self.control = None
        self.capture = None
        self.last_error = None
        self.closed = False
        self.fatal_error = None
        self.received = 0

    def health(self):
        """Frame age is diagnostic only: WGC can legitimately suppress unchanged frames."""
        user = _win32()
        hwnd = self.target['hwnd']
        owner = wintypes.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if self.fatal_error:
            return {'state': 'error', 'error': self.fatal_error}
        if self.closed or not user.IsWindow(hwnd) or owner.value != self.target['pid']:
            return {'state': 'closed', 'error': 'PPSSPP capture window closed or changed owner'}
        if self.control is not None and self.control.is_finished():
            return {'state': 'error', 'error': 'PPSSPP capture thread stopped unexpectedly'}
        if user.IsIconic(hwnd):
            return {'state': 'minimized', 'error': 'Restore the PPSSPP window from the taskbar, then reconnect video'}
        return {'state': 'alive', 'error': None}

    def _crop(self, width, height):
        user = _win32()
        hwnd = self.target['hwnd']
        owner = wintypes.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value != self.target['pid']:
            raise RuntimeError('Capture HWND no longer belongs to the verified process')
        client = wintypes.RECT()
        top = wintypes.POINT(0, 0)
        full = wintypes.RECT()
        if not user.GetClientRect(hwnd, ctypes.byref(client)) or not user.ClientToScreen(hwnd, ctypes.byref(top)):
            raise RuntimeError('PPSSPP client rectangle is unavailable')
        actual_client = (top.x, top.y, top.x + client.right, top.y + client.bottom)
        candidates = []
        extended = wintypes.RECT()
        dwm = ctypes.WinDLL('dwmapi')
        dwm.DwmGetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
        if dwm.DwmGetWindowAttribute(hwnd, 9, ctypes.byref(extended), ctypes.sizeof(extended)) == 0:
            candidates.append((extended.left, extended.top, extended.right, extended.bottom))
        if user.GetWindowRect(hwnd, ctypes.byref(full)):
            candidates.append((full.left, full.top, full.right, full.bottom))
        for bounds in candidates:
            try:
                return client_crop((width, height), bounds, actual_client)
            except ValueError:
                continue
        raise ValueError('Waiting for a capture frame matching current client geometry')

    def start(self):
        from windows_capture import WindowsCapture
        # WGC chooses exactly this verified HWND; no monitor or desktop fallback.
        self.capture = WindowsCapture(window_hwnd=self.target['hwnd'], cursor_capture=False,
                                      minimum_update_interval=33, draw_border=False)

        @self.capture.event
        def on_frame_arrived(frame, control):
            try:
                x1, y1, x2, y2 = self._crop(frame.width, frame.height)
                crop = frame.frame_buffer[y1:y2, x1:x2, :3]
                resized = cv2.resize(crop, (480, 272), interpolation=cv2.INTER_AREA)
                self.frames.put(resized)
                self.received += 1
                self.last_error = None
            except ValueError as exc:
                # Resizing can temporarily put WGC and Win32 geometry out of sync.
                self.last_error = str(exc)
            except Exception as exc:
                self.fatal_error = self.last_error = str(exc)
                control.stop()

        @self.capture.event
        def on_closed():
            self.closed = True
            self.last_error = 'PPSSPP capture window closed'

        self.control = self.capture.start_free_threaded()

    def stop(self):
        if self.control is not None:
            self.control.stop()
            self.control = None


class CapturedVideo(VideoStreamTrack):
    def __init__(self, frames):
        super().__init__()
        self.frames = frames

    async def recv(self):
        pts, time_base = await self.next_timestamp()
        deadline = time.monotonic() + 3
        while True:
            image, _, timestamp = self.frames.get()
            if image is not None:
                # WGC may emit no new frames while paused or on a static screen.
                # Repeat the last actual frame; status owns process/transport health.
                frame = av.VideoFrame.from_ndarray(image, format='bgr24')
                frame.pts, frame.time_base = pts, time_base
                return frame
            if time.monotonic() > deadline:
                raise MediaStreamError('Native video capture did not produce a frame')
            await asyncio.sleep(0.02)


def set_process_audio(pid, command):
    import comtypes
    from pycaw.pycaw import AudioUtilities
    comtypes.CoInitialize()
    try:
        sessions = [session for session in AudioUtilities.GetAllSessions() if session.ProcessId == pid]
        if not sessions:
            raise RuntimeError('PPSSPP has no active audio session')
        for session in sessions:
            volume = session.SimpleAudioVolume
            if command['type'] == 'volume':
                volume.SetMasterVolume(float(command['value']), None)
            else:
                volume.SetMute(bool(command['value']), None)
    finally:
        comtypes.CoUninitialize()


def validate_command(command):
    if not isinstance(command, dict) or command.get('type') not in ('volume', 'mute'):
        raise ValueError('Unsupported command')
    value = command.get('value')
    if command['type'] == 'mute':
        if not isinstance(value, bool):
            raise ValueError('mute value must be boolean')
    elif isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError('volume must be finite and between 0 and 1')
    return {'type': command['type'], 'value': value}


class RuntimeBridge:
    def __init__(self, *, client_factory=None, launcher=launch_native, capture_factory=WindowCapture,
                 clock=time.monotonic, audio=set_process_audio, window_placement=lower_native_window):
        self.token = secrets.token_urlsafe(32)
        self.client_factory, self.launcher, self.capture_factory = client_factory, launcher, capture_factory
        self.clock, self.audio = clock, audio
        self.window_placement = window_placement
        self.client = None
        self.capture = None
        self.frames = LatestFrame()
        self.target = None
        self.peer = None
        self.peer_id = None
        self.peer_connected = False
        self.channel = None
        self.last_heartbeat = None
        self._boot_wait_started = None
        self._generation = 0
        self.status = {'status': 'off', 'error': None, 'capabilities': CAPABILITIES}
        self._lock = asyncio.Lock()
        self._input_lock = asyncio.Lock()
        self._queue = asyncio.Queue(maxsize=32)
        self._worker = None
        self._watchdog = None
        self._fail_task = None
        self._fail_generation = None
        self._transport_epoch = secrets.token_hex(12)
        self._transport_sequence = 0
        self._frontend_epoch = None
        self._frontend_sequence = -1
        self._retired_epochs = set()

    def _reset_input(self):
        self._transport_epoch = secrets.token_hex(12)
        self._transport_sequence = 0
        self._frontend_epoch, self._frontend_sequence = None, -1
        self._retired_epochs.clear()
        while not self._queue.empty():
            self._queue.get_nowait()

    async def boot(self):
        async with self._lock:
            self._generation += 1
            self._boot_wait_started = None
            self.status.update(status='starting', error=None)
            try:
                try:
                    await self._clear()
                except Exception:
                    # A lost transport must not consume the user's first retry.
                    # Keep rejecting release failures while the old session is live.
                    if self.client is None or self.client.connected:
                        raise
                await self._close_peer()
                self._reset_input()
                if self.client and not self.client.connected:
                    await self.client.close()
                    self.client = None
                target = await self.launcher()
                if self.client is None or not self.client.connected:
                    self.client = self.client_factory() if self.client_factory else PpssppClient(expected_pid=target['pid'])
                    identity = await self.client.connect()
                    if identity.get('pid') != target['pid']:
                        raise RuntimeError('Debugger PID does not match the isolated native process')
                elif self.target and self.target['pid'] != target['pid']:
                    raise RuntimeError('Native process changed; stop the old bridge session first')
                await wait_native_session(self.client)
                if self.capture and (
                    self.capture.target['pid'] != target['pid']
                    or self.capture.target['hwnd'] != target['hwnd']
                    or self.capture.health()['state'] in ('closed', 'error')
                ):
                    await asyncio.to_thread(self.capture.stop)
                    self.capture = None
                self.target = target
                if self.capture is None:
                    self.frames = LatestFrame()
                    self.capture = self.capture_factory(target, self.frames)
                    await asyncio.to_thread(self.capture.start)
                await self.client.pause(False)
                await asyncio.to_thread(self.window_placement, target)
                self._boot_wait_started = self.clock()
                self.status.update(status='running', pid=target['pid'], error=None, capture=self.capture.health())
                return dict(self.status)
            except Exception as exc:
                self.status.update(status='error', error=str(exc))
                if self.client:
                    if self.client.connected:
                        with contextlib.suppress(Exception):
                            await self._clear()
                        with contextlib.suppress(Exception):
                            await self.client.pause(True)
                    await self.client.close()
                    self.client = None
                if self.capture:
                    await asyncio.to_thread(self.capture.stop)
                    self.capture = None
                raise

    async def _clear(self):
        async with self._input_lock:
            while not self._queue.empty():
                self._queue.get_nowait()
            if self.client and self.client.connected:
                self._transport_sequence += 1
                await self.client.input({'sessionEpoch': self._transport_epoch, 'sequence': self._transport_sequence,
                                         'buttons': [], 'x': 0, 'y': 0})

    async def pause(self, paused):
        if not isinstance(paused, bool):
            raise ValueError('paused must be boolean')
        async with self._lock:
            if not self.client or not self.client.connected:
                raise RuntimeError('Native session is not connected')
            try:
                if paused:
                    self.status['status'] = 'pausing'
                    await self._clear()
                result = await self.client.pause(paused)
                self.status.update(status='paused' if paused else 'running', error=None, native=result)
                return dict(self.status)
            except Exception as exc:
                self.status.update(status='error', error=str(exc))
                raise

    async def accept_input(self, snapshot):
        if not isinstance(snapshot, dict):
            raise ValueError('snapshot must be an object')
        sequence, epoch = snapshot.get('sequence'), snapshot.get('sessionEpoch')
        buttons = snapshot.get('buttons')
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 0:
            raise ValueError('sequence must be a nonnegative integer')
        if isinstance(epoch, bool) or not isinstance(epoch, (str, int)) or epoch == '':
            raise ValueError('sessionEpoch must be a nonempty string or integer')
        if not isinstance(buttons, list) or len(buttons) > len(BUTTONS) or any(b not in BUTTONS for b in buttons):
            raise ValueError('Unsupported controller buttons')
        for axis in ('x', 'y'):
            value = snapshot.get(axis)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not -1 <= value <= 1:
                raise ValueError('Axes must be finite between -1 and 1')
        async with self._input_lock:
            if self.status['status'] != 'running' or not self.client or not self.client.connected:
                return False
            if epoch in self._retired_epochs or (epoch == self._frontend_epoch and sequence <= self._frontend_sequence):
                return False
            if epoch != self._frontend_epoch:
                if len(self._retired_epochs) > 100:
                    raise ValueError('Too many controller epochs in this peer')
                if self._frontend_epoch is not None:
                    self._retired_epochs.add(self._frontend_epoch)
                self._frontend_epoch, self._frontend_sequence = epoch, -1
            self._frontend_sequence = sequence
            self._transport_sequence += 1
            # Transport epoch/sequence remain fresh after page reloads and bridge-generated releases.
            mapped = {**snapshot, 'sessionEpoch': self._transport_epoch, 'sequence': self._transport_sequence}
            return await self.client.input(mapped)

    async def _close_peer(self):
        peer, self.peer = self.peer, None
        self.peer_id, self.channel, self.last_heartbeat = None, None, None
        self.peer_connected = False
        if peer:
            await peer.close()

    async def stop(self, *, reason=None, fault=False, expected_generation=None):
        async with self._lock:
            # Deferred failures must never tear down a newer boot/offer session.
            if expected_generation is not None and expected_generation != self._generation:
                return dict(self.status)
            self._generation += 1
            self._boot_wait_started = None
            self.status['status'] = 'stopping'
            errors = []
            if self.client and not self.client.connected:
                errors.append('Native debugger disconnected; controller release and pause could not be confirmed')
            try:
                await self._clear()
            except Exception as exc:
                errors.append(str(exc))
            try:
                if self.client and self.client.connected:
                    await self.client.pause(True)
            except Exception as exc:
                errors.append(str(exc))
            await self._close_peer()
            if self.client:
                await self.client.close()
                self.client = None
            if self.capture:
                await asyncio.to_thread(self.capture.stop)
                self.capture = None
            self._reset_input()
            self.status.update(status='error' if errors or fault else ('paused' if reason else 'off'),
                               error='; '.join(([reason] if reason else []) + errors) if errors else reason)
            return dict(self.status)

    async def command(self, command):
        command = validate_command(command)
        if not self.target:
            raise RuntimeError('Native session is not connected')
        await asyncio.to_thread(self.audio, self.target['pid'], command)
        self.status[command['type']] = command['value']
        return dict(self.status)

    async def offer(self, sdp, description_type):
        if not isinstance(sdp, str) or len(sdp) > 128000 or description_type != 'offer':
            raise ValueError('Expected a bounded RTC offer')
        async with self._lock:
            if not self.client or not self.client.connected or not self.capture:
                raise RuntimeError('Boot the runtime before negotiating video')
            self._generation += 1
            generation = self._generation
            self._boot_wait_started = None
            await self._clear()
            await self._close_peer()
            self._reset_input()
            peer_id = secrets.token_hex(12)
            peer = RTCPeerConnection(RTCConfiguration(iceServers=[]))
            self.peer, self.peer_id = peer, peer_id
            self.peer_connected = False
            self.last_heartbeat = self.clock()
            peer.addTrack(CapturedVideo(self.frames))

            @peer.on('datachannel')
            def datachannel(channel):
                if channel.label != 'input' or self.peer_id != peer_id or self.channel is not None:
                    channel.close()
                    return
                self.channel = channel

                @channel.on('message')
                def message(raw):
                    if self.peer_id != peer_id:
                        return
                    try:
                        if not isinstance(raw, str) or len(raw) > 8192:
                            raise ValueError('Invalid input packet size')
                        packet = json.loads(raw)
                        if not isinstance(packet, dict):
                            raise ValueError('Input packet must be an object')
                        if packet.get('type') == 'heartbeat':
                            self.last_heartbeat = self.clock()
                        elif packet.get('type') == 'input':
                            self.last_heartbeat = self.clock()
                            self._queue.put_nowait((peer_id, packet.get('snapshot')))
                        else:
                            raise ValueError('Unknown datachannel message')
                    except Exception as exc:
                        self._fail_safe(str(exc), generation=generation)

            @peer.on('connectionstatechange')
            async def statechange():
                if self.peer_id == peer_id and peer.connectionState == 'connected':
                    self.peer_connected = True
                    self.last_heartbeat = self.clock()
                if self.peer_id == peer_id and peer.connectionState in ('failed', 'closed', 'disconnected'):
                    self._fail_safe('Browser media connection lost', generation=generation)

            try:
                await peer.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=description_type))
                answer = await peer.createAnswer()
                await peer.setLocalDescription(answer)
                return {'type': peer.localDescription.type, 'sdp': peer.localDescription.sdp}
            except Exception:
                await self._close_peer()
                self._boot_wait_started = self.clock()
                raise

    def _fail_safe(self, reason, *, generation=None):
        generation = self._generation if generation is None else generation
        if generation != self._generation:
            return
        if not self._fail_task or self._fail_task.done() or self._fail_generation != generation:
            if self._fail_task and not self._fail_task.done():
                self._fail_task.cancel()
            self._fail_generation = generation
            self._fail_task = asyncio.create_task(self.stop(reason=reason, expected_generation=generation))

    async def _check_capture_health(self):
        if self.capture is not None and self.status['status'] in ('running', 'paused'):
            generation = self._generation
            health = self.capture.health()
            self.status['capture'] = health
            if health['state'] != 'alive':
                await self.stop(reason=health['error'], fault=True, expected_generation=generation)

    async def check_watchdog(self):
        await self._check_capture_health()
        generation = self._generation
        timeout = 4 if self.peer_connected else 15
        if self.peer_id and self.last_heartbeat is not None and self.clock() - self.last_heartbeat > timeout:
            await self.stop(reason='Browser heartbeat timed out; controller released and native paused',
                            expected_generation=generation)
        elif not self.peer_id and self._boot_wait_started is not None and self.clock() - self._boot_wait_started > 15:
            await self.stop(reason='Browser did not connect after boot; controller released and native paused',
                            expected_generation=generation)

    async def _watch(self):
        while True:
            await asyncio.sleep(0.25)
            await self.check_watchdog()

    async def _consume(self):
        while True:
            peer_id, snapshot = await self._queue.get()
            if peer_id != self.peer_id:
                continue
            generation = self._generation
            try:
                await self.accept_input(snapshot)
            except Exception as exc:
                self._fail_safe(str(exc), generation=generation)

    async def start(self):
        self._worker = asyncio.create_task(self._consume())
        self._watchdog = asyncio.create_task(self._watch())

    async def close(self):
        for task in (self._worker, self._watchdog, self._fail_task):
            if task and task is not asyncio.current_task():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        await self.stop()

    async def get_status(self):
        await self._check_capture_health()
        if self.client is not None and not self.client.connected and self.status['status'] in ('running', 'paused'):
            message = 'Native debugger disconnected; controller release and pause could not be confirmed'
            await self.stop(reason=message, fault=True, expected_generation=self._generation)
        if self.client and self.client.connected:
            generation = self._generation
            try:
                native = await self.client.status()
                if generation == self._generation:
                    self.status['native'] = native
                    if not native.get('available'):
                        await self.stop(reason='Native emulator is unavailable', fault=True, expected_generation=generation)
                    elif self.status['status'] in ('running', 'paused'):
                        self.status['status'] = 'paused' if native.get('paused') else 'running'
            except Exception as exc:
                await self.stop(reason=str(exc), fault=True, expected_generation=generation)
        _, sequence, stamp = self.frames.get()
        result = dict(self.status)
        result['video'] = {'width': 480, 'height': 272, 'targetFps': 30, 'frameSequence': sequence,
                           'frameAgeMs': round(max(0, time.monotonic() - stamp) * 1000) if stamp else None,
                           'error': getattr(self.capture, 'last_error', None)}
        result['peerState'] = self.peer.connectionState if self.peer else None
        return result


def create_app(bridge):
    @web.middleware
    async def authorize(request, handler):
        if request.headers.get('Host', '').lower() not in ('127.0.0.1:4331', 'localhost:4331'):
            raise web.HTTPForbidden(text='Host is not allowed')
        origin = request.headers.get('Origin')
        if origin is not None and origin not in ORIGINS:
            raise web.HTTPForbidden(text='Origin is not allowed')
        if request.method == 'POST':
            if request.content_type != 'application/json':
                raise web.HTTPUnsupportedMediaType(text='JSON is required')
            try:
                payload = await request.json()
            except (ValueError, json.JSONDecodeError):
                raise web.HTTPBadRequest(text='Invalid JSON')
            if not isinstance(payload, dict) or not isinstance(payload.get('token'), str) or not secrets.compare_digest(payload['token'], bridge.token):
                raise web.HTTPForbidden(text='Invalid session token')
            request[PAYLOAD] = payload
        try:
            response = await handler(request)
        except ValueError as exc:
            response = web.json_response({'error': str(exc)}, status=400)
        except (RuntimeError, OSError, aiohttp.ClientError) as exc:
            response = web.json_response({'error': str(exc), 'status': bridge.status['status']}, status=503)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    app = web.Application(middlewares=[authorize], client_max_size=256 * 1024)

    async def bootstrap(_):
        return web.json_response({'token': bridge.token, **await bridge.get_status()})

    async def status(_):
        return web.json_response(await bridge.get_status())

    async def boot(_):
        return web.json_response(await bridge.boot())

    async def offer(request):
        payload = request[PAYLOAD]
        return web.json_response(await bridge.offer(payload.get('sdp'), payload.get('type')))

    async def pause(request):
        return web.json_response(await bridge.pause(request[PAYLOAD].get('paused')))

    async def command(request):
        return web.json_response(await bridge.command(request[PAYLOAD].get('command')))

    async def stop(_):
        return web.json_response(await bridge.stop())

    app.router.add_get('/bootstrap', bootstrap)
    app.router.add_get('/status', status)
    for route, handler in (('/boot', boot), ('/offer', offer), ('/pause', pause), ('/command', command), ('/stop', stop)):
        app.router.add_post(route, handler)
    app.on_startup.append(lambda _: bridge.start())
    app.on_cleanup.append(lambda _: bridge.close())
    return app


async def capture_smoke(path):
    target = find_native()
    frames = LatestFrame()
    capture = WindowCapture(target, frames)
    await asyncio.to_thread(capture.start)
    try:
        for _ in range(100):
            await asyncio.sleep(0.1)
            frame, sequence, _ = frames.get()
            if frame is not None and sequence >= 2:
                path.parent.mkdir(parents=True, exist_ok=True)
                cv2.imwrite(str(path), frame)
                return {'target': target, 'width': frame.shape[1], 'height': frame.shape[0], 'frames': sequence, 'path': str(path)}
        raise RuntimeError(capture.last_error or 'Capture produced no frames within 10 seconds')
    finally:
        await asyncio.to_thread(capture.stop)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--capture-smoke', type=Path)
    args = parser.parse_args()
    # Coordinates used to crop WGC are physical pixels on per-monitor-DPI desktops.
    with contextlib.suppress(Exception):
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    if args.capture_smoke:
        print(json.dumps(asyncio.run(capture_smoke(args.capture_smoke)), indent=2))
    else:
        web.run_app(create_app(RuntimeBridge()), host='127.0.0.1', port=4331, access_log=None)


if __name__ == '__main__':
    main()
