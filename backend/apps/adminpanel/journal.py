from apps.moderation.models import AuditLog


def record(actor, action, target='', detail=''):
    """Append one staff action to the audit log.

    The console writes here rather than to its own table so the log stays the
    single story of what was done to this platform — a moderator cannot be
    audited through one screen and the coin desk through another.
    """
    return AuditLog.objects.create(
        actor=actor if getattr(actor, 'pk', None) else None,
        action=action[:60], target=str(target)[:80], detail=detail[:240],
    )
