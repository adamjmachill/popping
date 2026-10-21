"""Parsing in a thread that a caller can wait out.

CPU-bound parsing (feedparser, lxml, trafilatura) runs in asyncio's
default thread pool so it never stalls the event loop. A timeout or a
cancel stops only the ``await``, never the thread: the parse keeps
running to its end. Most callers don't care. The Add preview does: it
holds one of two concurrency slots until its work is really done, a
parse that outlives its timeout included (``app.source_preview``).

So the parsing calls the preview reaches go through ``run_in_thread``.
Outside ``tracked()`` it is ``asyncio.to_thread``. Inside, each thread's
future is recorded, and ``drain()`` waits for every one still running.
The record is a context variable, so the tasks a tracked coroutine
starts (``asyncio.gather``) record into the same list.
"""

from __future__ import annotations

import asyncio
import contextvars
import functools
from collections.abc import Callable
from contextlib import contextmanager
from typing import Any, Iterator, TypeVar

T = TypeVar("T")

_running: contextvars.ContextVar[list[asyncio.Future] | None] = contextvars.ContextVar(
    "thread_work_running", default=None
)


async def run_in_thread(fn: Callable[..., T], /, *args: Any) -> T:
    """``asyncio.to_thread(fn, *args)``, recorded when tracked. A
    cancelled caller leaves the thread running; ``drain`` still waits
    for it."""
    running = _running.get()
    if running is None:
        return await asyncio.to_thread(fn, *args)
    loop = asyncio.get_running_loop()
    ctx = contextvars.copy_context()
    future = loop.run_in_executor(None, functools.partial(ctx.run, fn, *args))
    running.append(future)
    # Shielded, so cancelling the caller doesn't mark the future
    # cancelled while its thread is still running.
    return await asyncio.shield(future)


@contextmanager
def tracked() -> Iterator[list[asyncio.Future]]:
    """Record the threads ``run_in_thread`` starts in this context
    (and in tasks started from it) until the block ends."""
    running: list[asyncio.Future] = []
    token = _running.set(running)
    try:
        yield running
    finally:
        _running.reset(token)


async def drain(running: list[asyncio.Future]) -> None:
    """Wait until every recorded thread has ended. Their results and
    errors are consumed here: the callers that wanted them have had
    them, or stopped waiting."""
    while running:
        batch = list(running)
        running.clear()
        await asyncio.gather(*batch, return_exceptions=True)
