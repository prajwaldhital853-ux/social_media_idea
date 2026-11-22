"""Mail that never spends the request's clock.

Nothing in this deployment runs a Celery worker, so `.delay()` on a task is a
synchronous SMTP conversation inside the view. Every screen that sends one — the
sign-up code, the new-device code, a follower notice — then waits on a mail
provider, and a provider that stops answering looked exactly like a sign-up that
never finished.
"""

import logging
import threading

from django.conf import settings
from django.db import connections

logger = logging.getLogger(__name__)


def send_off_request(task, *args):
    """Hand a mail task to the queue, or to a thread when no one consumes it."""
    if not getattr(settings, 'CELERY_TASK_ALWAYS_EAGER', True):
        return task.delay(*args)
    thread = threading.Thread(target=_run, args=(task, args), daemon=True)
    thread.start()
    return None


def _run(task, args):
    try:
        # A thread must not inherit the request's connection: the request returns
        # and puts it back in the pool while this is still holding it.
        connections.close_all()
        task(*args)
    except Exception:
        logger.exception('Could not run the mail task %s', getattr(task, 'name', task))
