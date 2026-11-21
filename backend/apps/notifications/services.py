from .models import Notification


def notify(recipient, actor, kind, text, target_type='', target_id=''):
    if recipient is None or (actor is not None and recipient.pk == actor.pk):
        return None
    return Notification.objects.create(
        recipient=recipient, actor=actor, kind=kind, text=text[:240],
        target_type=target_type, target_id=str(target_id),
    )