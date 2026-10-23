"""Contract tests; the in-memory peer follows the pinned PPSSPP event protocol."""
import asyncio
import importlib.util
import math
import unittest
from aiohttp import web


class ModuleContractTests(unittest.TestCase):
    def test_runtime_client_module_exists(self):
        self.assertIsNotNone(importlib.util.find_spec("ppsspp_client"), "runtime client has not been implemented")


try:
    from ppsspp_client import PpssppClient, PpssppError
except ImportError:
    PpssppClient = None
    PpssppError = RuntimeError


class Peer:
    """Only substitutes the external socket; assertions exercise the client API."""
    def __init__(self):
        self.incoming = asyncio.Queue()
        self.sent = []
        self.buttons = {"cross": True}
        self.axes = (1, 1)
        self.stepping = False
        self.menu_paused = False
        self.booted = True
        self.game_id = ""
        self.closed = False
        self.ignore = set()
        self.drop_reply = set()
        self.pause_requested = asyncio.Event()

    async def send(self, packet):
        self.sent.append(packet.copy())
        event = packet["event"]
        if event in self.ignore:
            return
        reply = {"event": event, "ticket": packet.get("ticket")}
        if event == "version":
            reply.update(name="PPSSPP", version="v1.20.4-a9175126", pid=1234, path="flash0/vsh/module/vshmain.prx")
        elif event == "input.buttons.send":
            self.buttons.update(packet["buttons"])
        elif event == "input.analog.send":
            self.axes = (packet["x"], packet["y"])
        elif event == "game.status":
            reply.update(game={"id": self.game_id, "version": "", "title": "XMB"} if self.booted else None, paused=self.menu_paused)
        elif event == "cpu.status":
            reply.update(stepping=self.stepping, paused=self.menu_paused or not self.booted, pc=123, ticks=456, us=789, clockHz=222000000)
        elif event in ("cpu.stepping", "cpu.resume"):
            reply = {"event": "deferred", "for": event, "ticket": packet["ticket"]}
            self.pause_requested.set()
        if event not in self.drop_reply:
            await self.incoming.put(reply)

    async def complete_pause(self, paused):
        self.stepping = paused
        await self.incoming.put({"event": "cpu.stepping" if paused else "cpu.resume"})

    async def receive(self):
        packet = await self.incoming.get()
        if isinstance(packet, Exception):
            raise packet
        return packet

    async def close(self):
        self.closed = True


@unittest.skipIf(PpssppClient is None, "client module missing; existence assertion is the RED gate")
class ClientTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.peers = []
        async def factory(url):
            peer = Peer()
            self.peers.append(peer)
            return peer
        self.client = PpssppClient(transport_factory=factory, timeout=0.15, max_pending=3)
        self.addAsyncCleanup(self.client.close)
        await self.client.connect()
        self.peer = self.peers[-1]

    def snapshot(self, sequence=1, epoch="a", buttons=None, x=0, y=0):
        return dict(sequence=sequence, sessionEpoch=epoch, buttons=buttons or [], x=x, y=y)

    async def test_connect_clears_existing_input_and_reports_process_identity(self):
        self.assertFalse(any(self.peer.buttons.values()))
        self.assertEqual(self.peer.axes, (0, 0))
        result = await self.client.status()
        self.assertTrue(result["running"])
        self.assertEqual(result["pid"], 1234)

    async def test_snapshots_preserve_down_up_combinations_and_continuous_axes(self):
        await self.client.input(self.snapshot(buttons=["cross", "l", "ps"], x=0.25, y=-0.75))
        self.assertTrue(self.peer.buttons["cross"])
        self.assertTrue(self.peer.buttons["ltrigger"])
        self.assertTrue(self.peer.buttons["home"])
        self.assertEqual(self.peer.axes, (0.25, -0.75))
        await self.client.input(self.snapshot(sequence=2, buttons=["r"]))
        self.assertFalse(self.peer.buttons["cross"])
        self.assertFalse(self.peer.buttons["ltrigger"])
        self.assertFalse(self.peer.buttons["home"])
        self.assertTrue(self.peer.buttons["rtrigger"])
        self.assertEqual(self.peer.axes, (0, 0))

    async def test_each_face_button_preserves_its_native_identity_and_down_up_edges(self):
        # These are physical PSP buttons, regardless of the game's confirm/cancel convention.
        face_buttons = (
            ("triangle", "triangle"),
            ("circle", "circle"),
            ("cross", "cross"),
            ("square", "square"),
        )
        await self.client.input(self.snapshot(sequence=0))
        for index, (physical, native) in enumerate(face_buttons):
            with self.subTest(button=physical):
                self.peer.sent.clear()
                await self.client.input(self.snapshot(sequence=index * 2 + 1, buttons=[physical]))
                self.assertEqual({name for name, held in self.peer.buttons.items() if held}, {native})
                await self.client.input(self.snapshot(sequence=index * 2 + 2))
                self.assertFalse(any(self.peer.buttons.values()))
                packets = [packet["buttons"] for packet in self.peer.sent
                           if packet["event"] == "input.buttons.send"]
                self.assertEqual(len(packets), 2)
                self.assertEqual([packet[native] for packet in packets], [True, False])
                self.assertEqual({name for name, held in packets[0].items() if held}, {native})
                self.assertFalse(any(packets[1].values()))
                self.assertEqual(self.peer.axes, (0, 0))

    async def test_stale_sequences_and_retired_epochs_never_reapply_input(self):
        await self.client.input(self.snapshot(sequence=5, buttons=["cross"]))
        sent = len(self.peer.sent)
        self.assertFalse(await self.client.input(self.snapshot(sequence=4)))
        self.assertEqual(len(self.peer.sent), sent)
        await self.client.input(self.snapshot(epoch="b", buttons=["circle"]))
        self.assertFalse(await self.client.input(self.snapshot(sequence=99, buttons=["cross"])))
        self.assertFalse(self.peer.buttons["cross"])
        self.assertTrue(self.peer.buttons["circle"])

    async def test_vsh_short_direction_press_is_one_frame_bounded_pulse(self):
        self.peer.game_id = "VSHM01150"
        await self.client.status()
        await self.client.input(self.snapshot(buttons=["right"]))
        await self.client.input(self.snapshot(sequence=2))
        pulses = [p for p in self.peer.sent if p["event"] == "input.buttons.press"]
        self.assertEqual([(p["button"], p["duration"]) for p in pulses], [("right", 2)])
        self.assertFalse(any(p.get("buttons", {}).get("right") for p in self.peer.sent))

    async def test_vsh_face_and_analog_updates_do_not_repress_a_held_direction(self):
        self.peer.game_id = "VSHM01150"
        await self.client.status()
        await self.client.input(self.snapshot(buttons=["left"]))
        await self.client.input(self.snapshot(sequence=2, buttons=["left", "cross"], x=.4))
        self.assertTrue(self.peer.buttons["cross"])
        self.assertEqual(self.peer.axes, (.4, 0))
        await self.client.input(self.snapshot(sequence=3, buttons=["left"]))
        await self.client.input(self.snapshot(sequence=4))
        pulses = [p for p in self.peer.sent if p["event"] == "input.buttons.press"]
        self.assertEqual([p["button"] for p in pulses], ["left"])
        self.assertFalse(self.peer.buttons["cross"])

    async def test_game_directions_remain_continuously_held_until_physical_release(self):
        self.peer.game_id = "ULES00000"
        await self.client.status()
        await self.client.input(self.snapshot(buttons=["down", "cross"]))
        self.assertTrue(self.peer.buttons["down"])
        self.assertTrue(self.peer.buttons["cross"])
        await self.client.input(self.snapshot(sequence=2))
        self.assertFalse(self.peer.buttons["down"])
        self.assertFalse(any(p["event"] == "input.buttons.press" for p in self.peer.sent))

    async def test_pausing_vsh_cancels_navigation_before_the_cpu_stops(self):
        self.peer.game_id = "VSHM01150"
        await self.client.status()
        await self.client.input(self.snapshot(buttons=["right"]))
        pausing = asyncio.create_task(self.client.pause(True))
        await self.peer.pause_requested.wait()
        await self.peer.complete_pause(True)
        await pausing
        await asyncio.sleep(.43)
        self.assertEqual(sum(p["event"] == "input.buttons.press" for p in self.peer.sent), 1)

    async def test_leaving_vsh_cancels_repeat_and_restores_game_hold_input(self):
        self.peer.game_id = "VSHM01150"
        await self.client.status()
        await self.client.input(self.snapshot(buttons=["left"]))
        self.peer.game_id = "ULES00000"
        await self.client.status()
        await self.client.input(self.snapshot(sequence=2, buttons=["right", "circle"]))
        await asyncio.sleep(.43)
        self.assertTrue(self.peer.buttons["right"])
        self.assertTrue(self.peer.buttons["circle"])
        self.assertEqual(sum(p["event"] == "input.buttons.press" for p in self.peer.sent), 1)

    async def test_lifecycle_events_stop_vsh_repeat_before_next_status_poll(self):
        for index, event in enumerate(("game.start", "game.quit", "game.pause", "cpu.stepping")):
            with self.subTest(event=event):
                self.peer.game_id = "VSHM01150"
                await self.client.status()
                self.peer.sent.clear()
                await self.client.input(self.snapshot(sequence=index * 2 + 1, buttons=["right"]))
                await self.peer.incoming.put({"event": event})
                await asyncio.sleep(.43)
                self.assertEqual(sum(p["event"] == "input.buttons.press" for p in self.peer.sent), 1)
                if event in ("game.start", "game.quit"):
                    self.assertFalse(self.client._vsh)
                await self.client.input(self.snapshot(sequence=index * 2 + 2))

    async def test_lifecycle_cancel_of_first_pulse_does_not_cancel_input_consumer(self):
        self.peer.game_id = "VSHM01150"
        await self.client.status()
        self.peer.drop_reply.add("input.buttons.press")
        operation = asyncio.create_task(self.client.input(self.snapshot(buttons=["down", "cross"])))
        async with asyncio.timeout(.5):
            while not any(p["event"] == "input.buttons.press" for p in self.peer.sent):
                await asyncio.sleep(0)
        await self.peer.incoming.put({"event": "game.start"})
        self.assertTrue(await operation)
        self.assertTrue(self.peer.buttons["cross"])
        self.assertFalse(self.client._vsh)

    async def test_reconnect_releases_inputs_and_requires_new_epoch(self):
        await self.client.input(self.snapshot(buttons=["cross"]))
        await self.client.close()
        self.assertFalse(any(self.peer.buttons.values()))
        await self.client.connect()
        newer = self.peers[-1]
        self.assertFalse(await self.client.input(self.snapshot(sequence=500, buttons=["cross"])))
        self.assertTrue(await self.client.input(self.snapshot(epoch="b", buttons=["circle"])))
        self.assertFalse(newer.buttons["cross"])
        self.assertTrue(newer.buttons["circle"])

    async def test_close_releases_without_stopping_or_resuming_the_emulator(self):
        await self.client.input(self.snapshot(buttons=["cross"], x=1))
        await self.client.close()
        self.assertFalse(any(self.peer.buttons.values()))
        self.assertEqual(self.peer.axes, (0, 0))
        self.assertTrue(self.peer.closed)
        self.assertFalse(any(p["event"] in ("game.stop", "game.reset", "cpu.resume") for p in self.peer.sent))

    async def test_invalid_snapshot_does_not_mutate_controller(self):
        sent = len(self.peer.sent)
        for fields in ({"buttons": ["unknown"]}, {"x": math.nan}, {"y": 1.1}, {"sequence": True}, {"sessionEpoch": ""}):
            packet = self.snapshot()
            packet.update(fields)
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                await self.client.input(packet)
        self.assertEqual(len(self.peer.sent), sent)

    async def test_status_distinguishes_cpu_pause_menu_and_unavailable(self):
        self.peer.stepping = True
        self.assertTrue((await self.client.status())["paused"])
        self.peer.stepping = False
        self.peer.menu_paused = True
        self.assertFalse((await self.client.status())["running"])
        self.peer.booted = False
        self.assertFalse((await self.client.status())["available"])
        await self.client.close()
        self.assertFalse((await self.client.status())["available"])

    async def test_pause_waits_for_actual_state_and_does_not_repeat_when_already_paused(self):
        task = asyncio.create_task(self.client.pause(True))
        await self.peer.pause_requested.wait()
        await asyncio.sleep(0)
        self.assertFalse(task.done(), "deferred is not a completed pause")
        await self.peer.complete_pause(True)
        self.assertTrue((await task)["paused"])
        count = sum(p["event"] == "cpu.stepping" for p in self.peer.sent)
        self.assertTrue((await self.client.pause(True))["paused"])
        self.assertEqual(sum(p["event"] == "cpu.stepping" for p in self.peer.sent), count)
        self.peer.pause_requested.clear()
        task = asyncio.create_task(self.client.pause(False))
        await self.peer.pause_requested.wait()
        await self.peer.complete_pause(False)
        self.assertTrue((await task)["running"])

    async def test_pause_timeout_does_not_report_success_or_keep_pending_requests(self):
        with self.assertRaises(PpssppError):
            await self.client.pause(True)
        self.assertTrue((await self.client.status())["running"])
        self.assertEqual(self.client.pending_count, 0)

    async def test_unresponsive_peer_is_bounded_and_status_is_unavailable(self):
        self.peer.ignore.add("game.status")
        results = await asyncio.gather(*(self.client.status() for _ in range(10)))
        self.assertTrue(all(not result["available"] for result in results))
        self.assertLessEqual(sum(p["event"] == "game.status" for p in self.peer.sent), 3)
        self.assertEqual(self.client.pending_count, 0)

    async def test_failed_input_releases_partial_press_and_keeps_sequence_watermark(self):
        await self.client.input(self.snapshot())
        self.peer.ignore.add("input.analog.send")
        with self.assertRaises(PpssppError):
            await self.client.input(self.snapshot(sequence=5, buttons=["cross"]))
        self.assertFalse(self.peer.buttons["cross"], "failed transaction must not leave its applied button held")
        self.peer.ignore.clear()
        self.assertFalse(await self.client.input(self.snapshot(sequence=4, buttons=["circle"])))

    async def test_close_still_centers_analog_when_button_release_ack_is_lost(self):
        await self.client.input(self.snapshot(buttons=["cross"], x=1))
        self.peer.drop_reply.add("input.buttons.send")
        await self.client.close()
        self.assertEqual(self.peer.axes, (0, 0))
        self.assertIn("not confirmed", self.client.last_error)

    async def test_wrong_process_identity_is_rejected_before_input_mutation(self):
        peer = Peer()
        async def factory(url):
            return peer
        client = PpssppClient(transport_factory=factory, expected_pid=9999, timeout=0.15)
        self.addAsyncCleanup(client.close)
        with self.assertRaises(PpssppError):
            await client.connect()
        self.assertTrue(peer.buttons["cross"], "do not release keys in the wrong native process")
        self.assertTrue(peer.closed)

    async def test_real_aiohttp_transport_negotiates_and_releases_over_loopback(self):
        peer = Peer()
        async def handler(request):
            socket = web.WebSocketResponse(protocols=("debugger.ppsspp.org",))
            await socket.prepare(request)
            async for message in socket:
                await peer.send(message.json())
                await socket.send_json(await peer.receive())
            return socket
        app = web.Application()
        app.router.add_get("/debugger", handler)
        runner = web.AppRunner(app)
        await runner.setup()
        self.addAsyncCleanup(runner.cleanup)
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        client = PpssppClient(f"http://127.0.0.1:{port}/debugger", expected_pid=1234)
        self.addAsyncCleanup(client.close)
        await client.connect()
        await client.input(self.snapshot(buttons=["square"], x=0.5))
        self.assertTrue(peer.buttons["square"])
        self.assertEqual(peer.axes, (0.5, 0))
        await client.close()
        self.assertFalse(any(peer.buttons.values()))
        self.assertEqual(peer.axes, (0, 0))


if __name__ == "__main__":
    unittest.main()
