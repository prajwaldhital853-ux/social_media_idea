from django.db import transaction

from apps.moderation.models import AuditLog


def record(actor, action, target='', detail=''):
    """Append one staff action to the audit log.

    The console writes here rather than to its own table so the log stays the
    single story of what was done to this platform, a moderator cannot be
    audited through one screen and the coin desk through another.
    """
    row = AuditLog.objects.create(
        actor=actor if getattr(actor, 'pk', None) else None,
        action=action[:60], target=str(target)[:80], detail=detail[:240],
    )
    transaction.on_commit(lambda: _pulse(row.pk))
    return row


def _pulse(pk):
    from apps.common import pulse
    pulse.to_staff('audit', id=pk)
