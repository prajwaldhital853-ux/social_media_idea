from celery import shared_task

from apps.common.tasks import send_branded_email


@shared_task
def send_activity_email(to, subject, body, link, support=None):
    """Keep the old activity-mail task while giving it the shared branded renderer."""
    if support is None:
        from apps.common.emails import support_context

        support = support_context()
    send_branded_email(
        to, subject, subject, body,
        cta_label='Open Exposing', cta_url=link, support=support,
    )
