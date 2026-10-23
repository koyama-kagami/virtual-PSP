"""Normalize VSH navigation only; games retain their physical held-button state."""
import asyncio
import time

DIRECTIONS = frozenset(("up", "down", "left", "right"))


class VshNavigation:
    def __init__(self, pulse, on_error=None, *, clock=time.monotonic, sleep=asyncio.sleep):
        self._pulse, self._on_error = pulse, on_error
        self._clock, self._sleep = clock, sleep
        self._tasks = {}
        self._cancelling = set()

    async def set_buttons(self, names):
        """Wait for new directions' first pulses; unchanged directions keep their timers."""
        names = set(names)
        if names - DIRECTIONS:
            raise ValueError("VSH navigation only accepts up, down, left and right")
        await self._cancel([(name, task) for name, task in self._tasks.items() if name not in names])
        created, ready = [], []
        for name in sorted(names - self._tasks.keys()):
            first = asyncio.get_running_loop().create_future()
            task = asyncio.create_task(self._run(name, first), name=f"vsh-navigation-{name}")
            self._tasks[name] = task
            task.add_done_callback(lambda done, name=name, first=first: self._finished(name, first, done))
            created.append((name, task))
            ready.append(first)
        try:
            await asyncio.gather(*ready)
        except BaseException:
            await self._cancel(created)
            raise

    async def clear(self):
        """Cancel all repeat/in-flight pulse tasks and wait for their cleanup."""
        self.cancel_pending()
        await asyncio.gather(*self._cancelling, return_exceptions=True)

    def cancel_pending(self):
        """Stop scheduling immediately; safe inside the socket reader without awaiting IO."""
        self._begin_cancel(list(self._tasks.items()))

    def _begin_cancel(self, tasks):
        for name, task in tasks:
            if self._tasks.get(name) is task:
                del self._tasks[name]
            if not task.done() and task not in self._cancelling:
                self._cancelling.add(task)
                task.cancel()

    async def _cancel(self, tasks):
        self._begin_cancel(tasks)
        await asyncio.gather(*(task for _, task in tasks), return_exceptions=True)

    def _finished(self, name, first, task):
        # A task cancelled before its coroutine starts never reaches _run's handler.
        if task.cancelled() and not first.done():
            first.set_result(None)
        self._cancelling.discard(task)
        if self._tasks.get(name) is task:
            del self._tasks[name]

    async def _run(self, name, first):
        deadline = self._clock() + 0.4
        try:
            await self._pulse(name)
            first.set_result(None)
            while True:
                await self._sleep(max(0, deadline - self._clock()))
                await self._pulse(name)
                deadline = self._clock() + 0.09  # Never replay missed repeats after a stall.
        except asyncio.CancelledError:
            if not first.done():
                # A lifecycle stop consumes this press without cancelling the input consumer.
                first.set_result(None)
            raise
        except Exception as error:
            if not first.done():
                first.set_exception(error)
            elif self._on_error is not None:
                self._on_error(error)
            else:
                asyncio.get_running_loop().call_exception_handler({
                    "message": "VSH navigation repeat failed", "exception": error,
                })
