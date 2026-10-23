"""VSH direction pulse timing, using a virtual clock rather than wall-clock sleeps."""
import asyncio
import unittest
from vsh_navigation import VshNavigation


class VirtualTime:
    def __init__(self):
        self.now = 0.0
        self.waiting = []

    async def sleep(self, seconds):
        future = asyncio.get_running_loop().create_future()
        entry = (self.now + seconds, future)
        self.waiting.append(entry)
        try:
            await future
        finally:
            self.waiting.remove(entry)

    async def advance(self, seconds):
        self.now += seconds
        for deadline, future in list(self.waiting):
            if deadline <= self.now + 1e-9 and not future.done():
                future.set_result(None)
        for _ in range(5):
            await asyncio.sleep(0)


class NavigationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.time = VirtualTime()
        self.calls = []
        self.errors = []

        async def pulse(name):
            self.calls.append((name, round(self.time.now, 3)))

        self.nav = VshNavigation(pulse, on_error=self.errors.append,
                                 clock=lambda: self.time.now, sleep=self.time.sleep)
        self.addAsyncCleanup(self.nav.clear)

    async def test_short_press_emits_once_and_release_stops_repeats(self):
        await self.nav.set_buttons({"right"})
        await self.time.advance(0.2)
        await self.nav.set_buttons(set())
        await self.time.advance(3)
        self.assertEqual(self.calls, [("right", 0)])

    async def test_hold_has_400ms_delay_90ms_interval_and_no_backlog(self):
        await self.nav.set_buttons({"up"})
        await self.time.advance(0.399)
        self.assertEqual(len(self.calls), 1)
        await self.time.advance(0.001)
        await self.time.advance(0.09)
        await self.time.advance(5)
        self.assertEqual(self.calls, [("up", 0), ("up", 0.4), ("up", 0.49), ("up", 5.49)])
        await self.time.advance(0.089)
        self.assertEqual(len(self.calls), 4)
        await self.time.advance(0.001)
        self.assertEqual(self.calls[-1], ("up", 5.58))

    async def test_same_held_set_does_not_restart_delay(self):
        await self.nav.set_buttons({"left"})
        await self.time.advance(0.2)
        await self.nav.set_buttons({"left"})
        await self.time.advance(0.2)
        self.assertEqual(self.calls, [("left", 0), ("left", 0.4)])

    async def test_directions_have_independent_lifetimes(self):
        await self.nav.set_buttons({"up"})
        await self.time.advance(0.2)
        await self.nav.set_buttons({"up", "right"})
        await self.time.advance(0.2)
        await self.nav.set_buttons({"right"})
        await self.time.advance(0.2)
        self.assertEqual(self.calls, [("up", 0), ("right", 0.2), ("up", 0.4), ("right", 0.6)])

    async def test_clear_waits_for_inflight_pulse_cancellation(self):
        started, stopped = asyncio.Event(), asyncio.Event()

        async def pulse(name):
            started.set()
            try:
                await asyncio.Future()
            finally:
                stopped.set()

        nav = VshNavigation(pulse)
        pending = asyncio.create_task(nav.set_buttons({"down"}))
        await started.wait()
        await nav.clear()
        self.assertTrue(stopped.is_set())
        await pending

    async def test_sync_cancel_stops_repeat_but_clear_waits_for_cleanup(self):
        started, cleanup_started, finish_cleanup = asyncio.Event(), asyncio.Event(), asyncio.Event()

        async def pulse(name):
            started.set()
            try:
                await asyncio.Future()
            finally:
                cleanup_started.set()
                await finish_cleanup.wait()

        nav = VshNavigation(pulse)
        pending = asyncio.create_task(nav.set_buttons({"left"}))
        await started.wait()
        nav.cancel_pending()
        await cleanup_started.wait()
        clearing = asyncio.create_task(nav.clear())
        await asyncio.sleep(0)
        self.assertFalse(clearing.done())
        finish_cleanup.set()
        await clearing
        await pending

    async def test_external_caller_cancellation_still_propagates(self):
        started, stopped = asyncio.Event(), asyncio.Event()

        async def pulse(name):
            started.set()
            try:
                await asyncio.Future()
            finally:
                stopped.set()

        nav = VshNavigation(pulse)
        pending = asyncio.create_task(nav.set_buttons({"right"}))
        await started.wait()
        pending.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await pending
        self.assertTrue(stopped.is_set())

    async def test_cancelling_before_pulse_task_starts_completes_the_input_consumer(self):
        pending = asyncio.create_task(self.nav.set_buttons({"down"}))
        await asyncio.sleep(0)
        self.nav.cancel_pending()
        await asyncio.wait_for(pending, .1)
        await self.nav.clear()
        self.assertEqual(self.calls, [])

    async def test_initial_failure_propagates_and_repeat_failure_reports_once(self):
        async def fail(name):
            raise RuntimeError("transport failed")

        nav = VshNavigation(fail, on_error=self.errors.append)
        with self.assertRaisesRegex(RuntimeError, "transport failed"):
            await nav.set_buttons({"up"})
        await nav.clear()
        self.assertEqual(self.errors, [])

        calls = 0

        async def fail_repeat(name):
            nonlocal calls
            calls += 1
            if calls > 1:
                raise RuntimeError("repeat failed")

        nav = VshNavigation(fail_repeat, on_error=self.errors.append,
                            clock=lambda: self.time.now, sleep=self.time.sleep)
        await nav.set_buttons({"down"})
        await self.time.advance(0.4)
        await self.time.advance(2)
        await nav.clear()
        self.assertEqual(calls, 2)
        self.assertEqual([str(error) for error in self.errors], ["repeat failed"])

    async def test_unsupported_buttons_are_rejected_without_changing_held_input(self):
        await self.nav.set_buttons({"left"})
        with self.assertRaises(ValueError):
            await self.nav.set_buttons({"circle"})
        await self.time.advance(0.4)
        self.assertEqual(self.calls, [("left", 0), ("left", 0.4)])


if __name__ == "__main__":
    unittest.main()
