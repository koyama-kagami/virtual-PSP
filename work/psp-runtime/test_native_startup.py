from datetime import datetime, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

import runtime_bridge as runtime


class Process:
    def __init__(self): self.terminated = False
    def terminate(self): self.terminated = True
    def wait(self, timeout): return 0


class ManagedIdentityTests(unittest.TestCase):
    def setUp(self):
        self.created = 1792691200.0
        self.process = Mock(pid=7)
        self.process.exe.return_value = str(runtime.ROOT / 'ppsspp/PPSSPPWindows64.exe')
        self.process.cmdline.return_value = [self.process.exe(), '--vsh', '--debugger=4332']
        self.process.create_time.return_value = self.created
        self.process.net_connections.return_value = []
        self.state = {'pid': 7, 'processCreatedAt': datetime.fromtimestamp(self.created, timezone.utc).isoformat()}

    def inspect(self):
        with patch.object(runtime.psutil, 'Process', return_value=self.process), patch.object(runtime, 'native_windows', return_value=[]) as windows:
            result = runtime.inspect_managed_native(self.state)
            windows.assert_called_once_with(7, main_only=False)
            return result

    def test_matching_process_checks_owned_listener_and_all_visible_windows(self):
        self.process.net_connections.return_value = [SimpleNamespace(status=runtime.psutil.CONN_LISTEN, laddr=SimpleNamespace(port=4332))]
        self.assertTrue(self.inspect()['listening'])

    def test_legacy_readiness_time_is_not_mistaken_for_creation_time(self):
        self.state = {'pid': 7, 'startedAt': datetime.fromtimestamp(self.created + 3, timezone.utc).isoformat()}
        self.assertFalse(self.inspect()['listening'])

    def test_foreign_executable_is_never_eligible_for_recovery(self):
        self.process.exe.return_value = 'C:/Other/PPSSPPWindows64.exe'
        with self.assertRaisesRegex(RuntimeError, 'identity changed'):
            self.inspect()

    def test_reused_pid_is_never_eligible_for_recovery(self):
        self.process.create_time.return_value = self.created + 60
        with self.assertRaisesRegex(RuntimeError, 'PID was reused'):
            self.inspect()

    def test_unmanaged_command_line_is_never_eligible_for_recovery(self):
        self.process.cmdline.return_value = [self.process.exe(), '--vsh']
        with self.assertRaisesRegex(RuntimeError, 'identity changed'):
            self.inspect()


class StartupTests(unittest.IsolatedAsyncioTestCase):
    async def test_closed_managed_instance_is_reaped_only_after_grace_and_recheck(self):
        process = Process()
        closed = {'process': process, 'windows': [], 'listening': False}
        with patch.object(runtime, 'read_native_state', return_value={'pid': 7}), patch.object(runtime, 'inspect_managed_native', return_value=closed) as inspect:
            await runtime.recover_closed_native(grace=0.01, interval=0.002)
        self.assertTrue(process.terminated)
        self.assertGreaterEqual(inspect.call_count, 2)

    async def test_window_appearing_during_grace_is_preserved(self):
        process = Process()
        statuses = [{'process': process, 'windows': [], 'listening': False}, {'process': process, 'windows': [99], 'listening': False}]
        with patch.object(runtime, 'read_native_state', return_value={'pid': 7}), patch.object(runtime, 'inspect_managed_native', side_effect=statuses):
            await runtime.recover_closed_native(grace=0.02, interval=0.002)
        self.assertFalse(process.terminated)

    async def test_listening_instance_without_window_is_not_terminated(self):
        process = Process()
        with patch.object(runtime, 'read_native_state', return_value={'pid': 7}), patch.object(runtime, 'inspect_managed_native', return_value={'process':process, 'windows':[], 'listening':True}):
            await runtime.recover_closed_native(grace=0.01)
        self.assertFalse(process.terminated)

    async def test_identity_failure_is_not_treated_as_closed_instance(self):
        with patch.object(runtime, 'read_native_state', return_value={'pid': 7}), patch.object(runtime, 'inspect_managed_native', side_effect=RuntimeError('identity mismatch')):
            with self.assertRaisesRegex(RuntimeError, 'identity mismatch'):
                await runtime.recover_closed_native(grace=0.01)

    async def test_cold_start_waits_for_window_without_retrying_launcher(self):
        target = {'pid':7,'hwnd':99}
        with patch.object(runtime, 'find_native', side_effect=[runtime.NativeWindowPending('waiting'), runtime.NativeWindowPending('waiting'), target]) as find:
            self.assertEqual(await runtime.wait_native_window(timeout=0.1, interval=0.002), target)
        self.assertEqual(find.call_count, 3)

    async def test_window_wait_is_bounded_and_does_not_retry_identity_errors(self):
        with patch.object(runtime, 'find_native', side_effect=runtime.NativeWindowPending('waiting')):
            with self.assertRaisesRegex(RuntimeError, '窗口'):
                await runtime.wait_native_window(timeout=0.01, interval=0.002)
        with patch.object(runtime, 'find_native', side_effect=RuntimeError('wrong executable')) as find:
            with self.assertRaisesRegex(RuntimeError, 'wrong executable'):
                await runtime.wait_native_window(timeout=0.1)
            self.assertEqual(find.call_count, 1)

    async def test_native_session_waits_for_core_after_window_is_ready(self):
        ready = {'available': True, 'state': 'running'}
        client = SimpleNamespace(connected=True, status=AsyncMock(side_effect=[
            {'available': False, 'error': 'No running PSP session'}, ready]))
        self.assertEqual(await runtime.wait_native_session(client, timeout=0.1, interval=0.002), ready)
        self.assertEqual(client.status.await_count, 2)

    async def test_native_session_wait_stops_immediately_on_disconnect(self):
        client = SimpleNamespace(connected=False, status=AsyncMock(return_value={
            'available': False, 'error': 'Debugger disconnected'}))
        with self.assertRaisesRegex(RuntimeError, 'Debugger disconnected'):
            await runtime.wait_native_session(client, timeout=0.1)
        self.assertEqual(client.status.await_count, 1)

    async def test_native_session_wait_has_a_deadline(self):
        client = SimpleNamespace(connected=True, status=AsyncMock(return_value={
            'available': False, 'error': 'No running PSP session'}))
        with self.assertRaisesRegex(RuntimeError, 'XMB'):
            await runtime.wait_native_session(client, timeout=0.01, interval=0.002)


if __name__ == '__main__': unittest.main()
