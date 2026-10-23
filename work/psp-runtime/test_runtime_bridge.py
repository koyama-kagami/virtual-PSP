import asyncio
import unittest
from unittest.mock import patch

import numpy as np
from aiohttp.test_utils import TestClient, TestServer
from aiortc import RTCPeerConnection, RTCConfiguration, RTCSessionDescription

from runtime_bridge import CapturedVideo, LatestFrame, RuntimeBridge, WindowCapture, client_crop, create_app, lower_native_window


class Frames(unittest.TestCase):
    def test_window_crop_removes_menu_in_physical_pixels(self):
        self.assertEqual(client_crop((1168, 720), (100, 80, 1268, 800),
                                     (108, 130, 1260, 784)), (8, 50, 1160, 704))

    def test_window_crop_rejects_outside_or_stale_geometry(self):
        with self.assertRaises(ValueError):
            client_crop((1168, 720), (100, 80, 1268, 800), (0, 0, 1260, 784))
        with self.assertRaises(ValueError):
            client_crop((100, 100), (100, 80, 1268, 800), (108, 130, 1260, 784))

    def test_frame_slot_replaces_and_owns_the_source_memory(self):
        slot = LatestFrame()
        frame = np.zeros((2, 3, 3), dtype=np.uint8)
        slot.put(frame, now=10)
        frame[:] = 255
        self.assertEqual(int(slot.get()[0][0, 0, 0]), 0)
        slot.put(np.full((2, 3, 3), 9, dtype=np.uint8), now=11)
        image, sequence, timestamp = slot.get()
        self.assertEqual((int(image[0, 0, 0]), sequence, timestamp), (9, 2, 11))

    def test_background_placement_uses_only_verified_hwnd_without_move_size_or_activation(self):
        calls = []
        class NativeApi:
            def GetWindowThreadProcessId(self, hwnd, owner):
                owner._obj.value = 7
            def SetWindowPos(self, *args):
                calls.append(args)
                return 1
        with patch('runtime_bridge._win32', return_value=NativeApi()):
            lower_native_window({'pid': 7, 'hwnd': 8})
        self.assertEqual(calls, [(8, 1, 0, 0, 0, 0, 0x13)])

    def test_changed_window_owner_cannot_be_reordered(self):
        class NativeApi:
            def GetWindowThreadProcessId(self, hwnd, owner):
                owner._obj.value = 99
            def SetWindowPos(self, *args):
                raise AssertionError('A foreign window must not be touched')
        with patch('runtime_bridge._win32', return_value=NativeApi()):
            with self.assertRaises(RuntimeError):
                lower_native_window({'pid': 7, 'hwnd': 8})

    def test_capture_health_distinguishes_closed_minimized_and_failed_thread(self):
        class NativeApi:
            minimized = False
            def GetWindowThreadProcessId(self, hwnd, owner):
                owner._obj.value = 7
            def IsWindow(self, hwnd):
                return True
            def IsIconic(self, hwnd):
                return self.minimized
        class FinishedControl:
            def is_finished(self):
                return True
        native_api = NativeApi()
        capture = WindowCapture({'pid': 7, 'hwnd': 8}, LatestFrame())
        with patch('runtime_bridge._win32', return_value=native_api):
            self.assertEqual(capture.health()['state'], 'alive')
            native_api.minimized = True
            self.assertEqual(capture.health()['state'], 'minimized')
            self.assertIn('Restore', capture.health()['error'])
            native_api.minimized = False
            capture.control = FinishedControl()
            self.assertEqual(capture.health()['state'], 'error')
            capture.control = None
            capture.closed = True
            self.assertEqual(capture.health()['state'], 'closed')
            capture.fatal_error = 'capture device lost'
            self.assertEqual(capture.health()['error'], 'capture device lost')


class FakeClient:
    def __init__(self, pid=7):
        self.pid = pid
        self.connected = False
        self.closed = False
        self.paused = True
        self.inputs = []

    async def connect(self):
        self.connected = True
        self.closed = False
        return {"name": "PPSSPP", "pid": self.pid}

    async def status(self):
        return {"available": self.connected, "running": not self.paused,
                "paused": self.paused, "state": "paused" if self.paused else "running", "pid": self.pid}

    async def pause(self, paused):
        self.paused = paused
        return await self.status()

    async def input(self, snapshot):
        self.inputs.append(snapshot)
        return True

    async def close(self):
        self.connected = False
        self.closed = True


class FakeCapture:
    def __init__(self, target, frames):
        self.target = target
        self.frames = frames
        self.started = False
        self.closed = False
        self.minimized = False
        self.fatal_error = None

    def health(self):
        state = 'closed' if self.closed else ('error' if self.fatal_error else ('minimized' if self.minimized else 'alive'))
        return {'state': state, 'error': self.fatal_error or (f'Capture {state}' if state != 'alive' else None)}

    def start(self):
        self.started = True
        self.frames.put(np.zeros((272, 480, 3), np.uint8))

    def stop(self):
        self.started = False


async def native():
    return {"pid": 7, "hwnd": 8, "executable": "isolated/PPSSPPWindows64.exe"}


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.native_client = FakeClient()
        self.now = 1.0
        self.bridge = RuntimeBridge(client_factory=lambda: self.native_client, launcher=native,
                                    capture_factory=FakeCapture, clock=lambda: self.now,
                                    window_placement=lambda target: None)

    async def asyncTearDown(self):
        await self.bridge.close()

    async def test_stop_clears_controller_and_pauses_without_exiting_native(self):
        await self.bridge.boot()
        await self.bridge.accept_input({"sequence": 1, "sessionEpoch": 1,
                                       "buttons": ["cross"], "x": 0.5, "y": -0.5})
        await self.bridge.stop()
        self.assertEqual(self.bridge.status["status"], "off")
        self.assertTrue(self.native_client.paused)
        self.assertEqual(self.native_client.inputs[-1]["buttons"], [])
        self.assertEqual(self.native_client.inputs[-1]["x"], 0)

    async def test_boot_places_confirmed_native_in_background_after_resume(self):
        placements = []
        self.bridge.window_placement = lambda target: placements.append((target['pid'], self.native_client.paused))
        await self.bridge.boot()
        self.assertEqual(placements, [(7, False)])

    async def test_boot_replaces_old_capture_when_native_pid_or_hwnd_changes(self):
        await self.bridge.boot()
        for target in ({'pid': 99, 'hwnd': 8}, {'pid': 99, 'hwnd': 18}):
            with self.subTest(target=target):
                old_client, old_capture = self.bridge.client, self.bridge.capture
                old_frames = self.bridge.frames
                old_client.connected = False
                new_client = FakeClient(pid=target['pid'])
                self.bridge.client_factory = lambda: new_client
                async def replaced_native():
                    return target
                self.bridge.launcher = replaced_native

                result = await self.bridge.boot()

                self.assertEqual(result['status'], 'running')
                self.assertEqual(self.bridge.capture.target, target)
                self.assertIsNot(self.bridge.frames, old_frames)
                self.assertFalse(old_capture.started)
                self.assertTrue(old_client.closed)

    async def test_boot_rebuilds_closed_or_failed_capture_for_same_native(self):
        await self.bridge.boot()
        for field, value in (('closed', True), ('fatal_error', 'capture device lost')):
            with self.subTest(field=field):
                old_capture = self.bridge.capture
                setattr(old_capture, field, value)

                result = await self.bridge.boot()

                self.assertEqual(result['capture']['state'], 'alive')
                self.assertIsNot(self.bridge.capture, old_capture)
                self.assertFalse(old_capture.started)

    async def test_boot_recovers_disconnect_during_previous_controller_release(self):
        await self.bridge.boot()
        old_client = self.bridge.client
        async def disconnected_input(_):
            old_client.connected = False
            raise RuntimeError('debugger connection closed')
        old_client.input = disconnected_input
        new_client = FakeClient()
        self.bridge.client_factory = lambda: new_client

        result = await self.bridge.boot()

        self.assertEqual(result['status'], 'running')
        self.assertIs(self.bridge.client, new_client)
        self.assertTrue(old_client.closed)
        self.assertFalse(new_client.paused)

    async def test_boot_keeps_healthy_same_native_client_and_capture(self):
        await self.bridge.boot()
        old_client, old_capture, old_frames = self.bridge.client, self.bridge.capture, self.bridge.frames

        result = await self.bridge.boot()

        self.assertEqual(result['status'], 'running')
        self.assertIs(self.bridge.client, old_client)
        self.assertIs(self.bridge.capture, old_capture)
        self.assertIs(self.bridge.frames, old_frames)
        self.assertFalse(old_client.closed)
        self.assertTrue(old_capture.started)

    async def test_boot_does_not_ignore_release_failure_on_still_connected_client(self):
        await self.bridge.boot()
        async def rejected_input(_):
            raise RuntimeError('controller release rejected')
        self.native_client.input = rejected_input

        with self.assertRaisesRegex(RuntimeError, 'controller release rejected'):
            await self.bridge.boot()

        self.assertEqual(self.bridge.status['status'], 'error')
        self.assertTrue(self.native_client.paused)
        self.assertIsNone(self.bridge.capture)

    async def test_pause_releases_and_resume_accepts_next_user_sequence(self):
        await self.bridge.boot()
        await self.bridge.accept_input({"sequence": 1, "sessionEpoch": 1,
                                       "buttons": ["cross"], "x": 0, "y": 1})
        await self.bridge.pause(True)
        self.assertEqual(self.native_client.inputs[-1]["buttons"], [])
        await self.bridge.pause(False)
        await self.bridge.accept_input({"sequence": 2, "sessionEpoch": 1,
                                       "buttons": ["right"], "x": 1, "y": 0})
        self.assertEqual(self.native_client.inputs[-1]["buttons"], ["right"])

    async def test_outdated_snapshot_cannot_repress_released_key(self):
        await self.bridge.boot()
        await self.bridge.accept_input({"sequence": 2, "sessionEpoch": 1,
                                       "buttons": [], "x": 0, "y": 0})
        accepted = await self.bridge.accept_input({"sequence": 1, "sessionEpoch": 1,
                                                 "buttons": ["cross"], "x": 0, "y": 0})
        self.assertFalse(accepted)
        self.assertEqual(self.native_client.inputs[-1]["buttons"], [])

    async def test_heartbeat_expiry_pauses_before_client_can_keep_holding(self):
        await self.bridge.boot()
        self.bridge.peer_id = "test-peer"
        self.bridge.peer_connected = True
        self.bridge.last_heartbeat = self.now
        await self.bridge.accept_input({"sequence": 1, "sessionEpoch": 1,
                                       "buttons": ["cross"], "x": 0, "y": 0})
        self.now = 6
        await self.bridge.check_watchdog()
        self.assertEqual(self.bridge.status["status"], "paused")
        self.assertTrue(self.native_client.paused)
        self.assertEqual(self.native_client.inputs[-1]["buttons"], [])

    async def test_connecting_peer_has_grace_period_before_heartbeat_is_required(self):
        await self.bridge.boot()
        self.bridge.peer_id = 'connecting-peer'
        self.bridge.last_heartbeat = self.now
        self.now = 7
        await self.bridge.check_watchdog()
        self.assertEqual(self.bridge.status['status'], 'running')
        self.now = 17
        await self.bridge.check_watchdog()
        self.assertEqual(self.bridge.status['status'], 'paused')

    async def test_boot_without_offer_expires_and_releases_native(self):
        await self.bridge.boot()
        self.now = 15
        await self.bridge.check_watchdog()
        self.assertEqual(self.bridge.status['status'], 'running')
        self.now = 17
        await self.bridge.check_watchdog()
        self.assertEqual(self.bridge.status['status'], 'paused')
        self.assertTrue(self.native_client.paused)
        self.assertIsNone(self.bridge.capture)

    async def test_stale_watchdog_cannot_stop_boot_that_won_the_lock(self):
        await self.bridge.boot()
        self.bridge.peer_id = 'old-peer'
        self.bridge.peer_connected = True
        self.bridge.last_heartbeat = self.now
        self.now = 9
        await self.bridge._lock.acquire()
        new_boot = asyncio.create_task(self.bridge.boot())
        await asyncio.sleep(0)
        stale_watchdog = asyncio.create_task(self.bridge.check_watchdog())
        await asyncio.sleep(0)
        self.bridge._lock.release()
        await new_boot
        await stale_watchdog
        self.assertEqual(self.bridge.status['status'], 'running')
        self.assertFalse(self.native_client.paused)

    async def test_delayed_old_peer_failure_cannot_stop_new_boot(self):
        await self.bridge.boot()
        old_generation = self.bridge._generation
        await self.bridge.boot()
        self.bridge._fail_safe('Old peer disconnected', generation=old_generation)
        await asyncio.sleep(0)
        self.assertEqual(self.bridge.status['status'], 'running')
        self.assertFalse(self.native_client.paused)

    async def test_boot_placement_failure_still_releases_and_pauses_native(self):
        def fail_placement(_):
            raise RuntimeError('window owner changed')
        self.bridge.window_placement = fail_placement
        with self.assertRaises(RuntimeError):
            await self.bridge.boot()
        self.assertTrue(self.native_client.paused)
        self.assertEqual(self.native_client.inputs[-1]['buttons'], [])

    async def test_capture_closed_releases_pauses_and_reports_error(self):
        await self.bridge.boot()
        await self.bridge.accept_input({'sequence': 1, 'sessionEpoch': 1, 'buttons': ['cross'], 'x': 0, 'y': 0})
        self.bridge.capture.closed = True
        status = await self.bridge.get_status()
        self.assertEqual(status['status'], 'error')
        self.assertEqual(status['capture']['state'], 'closed')
        self.assertEqual(self.native_client.inputs[-1]['buttons'], [])
        self.assertTrue(self.native_client.paused)
        self.assertIsNone(self.bridge.capture)

    async def test_capture_fatal_and_minimized_states_do_not_repeat_stale_frames_forever(self):
        for field, value, expected in [('fatal_error', 'WGC device lost', 'error'), ('minimized', True, 'minimized')]:
            await self.bridge.boot()
            setattr(self.bridge.capture, field, value)
            status = await self.bridge.get_status()
            self.assertEqual(status['status'], 'error')
            self.assertEqual(status['capture']['state'], expected)
            self.assertTrue(self.native_client.paused)

    async def test_old_frame_alone_does_not_mark_live_capture_as_failed(self):
        await self.bridge.boot()
        self.bridge.frames.put(np.zeros((272, 480, 3), np.uint8), now=1)
        status = await self.bridge.get_status()
        self.assertEqual(status['status'], 'running')
        self.assertEqual(status['capture']['state'], 'alive')

    async def test_watchdog_checks_capture_health_without_status_poll(self):
        await self.bridge.boot()
        self.bridge.capture.closed = True
        await self.bridge.check_watchdog()
        self.assertEqual(self.bridge.status['status'], 'error')
        self.assertTrue(self.native_client.paused)

    async def test_explicit_stop_cannot_claim_success_after_native_disconnect(self):
        await self.bridge.boot()
        self.native_client.connected = False
        result = await self.bridge.stop()
        self.assertEqual(result['status'], 'error')
        self.assertIn('confirmed', result['error'])

    async def test_paused_capture_repeats_last_frame_instead_of_killing_video_sender(self):
        slot = LatestFrame()
        slot.put(np.zeros((272, 480, 3), np.uint8), now=1)
        track = CapturedVideo(slot)
        try:
            frame = await track.recv()
            self.assertEqual((frame.width, frame.height), (480, 272))
        finally:
            track.stop()

    async def test_disconnected_native_cannot_continue_reporting_running(self):
        await self.bridge.boot()
        self.native_client.connected = False
        status = await self.bridge.get_status()
        self.assertEqual(status['status'], 'error')
        self.assertIsNone(self.bridge.capture)

    async def test_debugger_pid_mismatch_never_captures_or_reports_running(self):
        async def other_native():
            return {"pid": 99, "hwnd": 8}
        self.bridge.launcher = other_native
        with self.assertRaises(RuntimeError):
            await self.bridge.boot()
        self.assertEqual(self.bridge.status["status"], "error")
        self.assertIsNone(self.bridge.capture)

    async def test_pause_failure_reports_error_instead_of_remaining_pausing(self):
        await self.bridge.boot()
        async def fail_pause(_):
            raise RuntimeError('native did not acknowledge pause')
        self.native_client.pause = fail_pause
        with self.assertRaises(RuntimeError):
            await self.bridge.pause(True)
        self.assertEqual(self.bridge.status['status'], 'error')

    async def test_real_webrtc_delivers_cropped_video_dimensions(self):
        await self.bridge.boot()
        viewer = RTCPeerConnection(RTCConfiguration(iceServers=[]))
        viewer.addTransceiver('video', direction='recvonly')
        viewer.createDataChannel('input', ordered=True)
        received = asyncio.get_running_loop().create_future()

        @viewer.on('track')
        async def track(track):
            try:
                frame = await track.recv()
                if not received.done():
                    received.set_result((frame.width, frame.height))
            except Exception as exc:
                if not received.done():
                    received.set_exception(exc)

        try:
            await viewer.setLocalDescription(await viewer.createOffer())
            answer = await self.bridge.offer(viewer.localDescription.sdp, 'offer')
            await viewer.setRemoteDescription(RTCSessionDescription(**answer))
            self.assertEqual(await asyncio.wait_for(received, 8), (480, 272))
        finally:
            await viewer.close()


class HttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.bridge = RuntimeBridge(client_factory=FakeClient, launcher=native,
                                    capture_factory=FakeCapture, window_placement=lambda target: None)
        self.http = TestClient(TestServer(create_app(self.bridge)), headers={'Host': '127.0.0.1:4331'})
        await self.http.start_server()

    async def asyncTearDown(self):
        await self.http.close()

    async def test_foreign_origin_cannot_read_bootstrap_token(self):
        response = await self.http.get('/bootstrap', headers={'Origin': 'https://evil.example'})
        self.assertEqual(response.status, 403)
        self.assertNotIn(self.bridge.token, await response.text())

    async def test_rebinding_hostname_cannot_read_token_even_without_origin(self):
        response = await self.http.get('/bootstrap', headers={'Host': 'attacker.example:4331'})
        self.assertEqual(response.status, 403)
        self.assertNotIn(self.bridge.token, await response.text())

    async def test_post_needs_token_even_without_origin(self):
        response = await self.http.post('/boot', json={})
        self.assertEqual(response.status, 403)
        self.assertEqual(self.bridge.status['status'], 'off')

    async def test_allowed_origin_can_boot_and_stop_with_token(self):
        headers = {'Origin': 'http://127.0.0.1:4330'}
        response = await self.http.get('/bootstrap', headers=headers)
        payload = await response.json()
        self.assertEqual(response.status, 200)
        response = await self.http.post('/boot', json={'token': payload['token']}, headers=headers)
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())['status'], 'running')
        response = await self.http.post('/stop', json={'token': payload['token']}, headers=headers)
        self.assertEqual((await response.json())['status'], 'off')

    async def test_command_rejects_unknown_action_and_nonfinite_volume(self):
        for command in ({'type': 'shell', 'value': 'cmd'}, {'type': 'volume', 'value': 2},
                        {'type': 'volume', 'value': True}, {'type': 'mute', 'value': 'yes'}):
            response = await self.http.post('/command', json={'token': self.bridge.token, 'command': command})
            self.assertEqual(response.status, 400)


if __name__ == '__main__':
    unittest.main()
