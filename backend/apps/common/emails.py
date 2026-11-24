"""Queue the platform's branded transactional mail after the business write."""

import logging
from decimal import Decimal, InvalidOperation
from urllib.parse import urljoin

from django.conf import settings

from apps.common.mail import send_off_request
from apps.common.tasks import safe_link, send_branded_email, send_welcome_email

logger = logging.getLogger(__name__)


def _queue(task, *args):
    """Post one letter without letting the mail broker fail the business write."""
    try:
        return send_off_request(task, *args)
    except Exception:
        logger.exception('Could not queue an email for %s', args[0])
        return None


def _absolute(value):
    link = safe_link(value)
    if not link.startswith('/'):
        return link
    try:
        return urljoin(settings.SITE_URL.rstrip('/') + '/', link)
    except ValueError:
        return ''


def support_context():
    """Read the Client's contact settings before a mail thread loses the transaction."""
    values = {'email': 'support@exposing.app', 'phone': '', 'form': ''}
    try:
        from apps.adminpanel.settings_store import get

        values.update({
            'email': str(get('contact_email') or '').strip() or values['email'],
            'phone': str(get('contact_phone') or '').strip(),
            'form': str(get('contact_form') or '').strip(),
        })
    except Exception:
        # A mailbox must still be renderable while the settings table is unavailable.
        logger.exception('Could not read the email support settings; using defaults')
    values['form'] = _absolute(values['form'])
    return values


def mail_delivery_problem():
    """Why a letter would never leave this box, said in a sentence a seat can act on.

    A queued letter that the provider refuses dies on its own thread with a line in
    the service log, which is how a deployment ran for weeks convinced its members
    were being emailed. This reads the settings only — it never opens the provider —
    so a screen can say out loud that the mail will not go out.
    """
    from django.core import mail as django_mail

    try:
        connection = django_mail.get_connection()
    except Exception:
        return 'The mail settings on this deployment do not load, so no letter can be posted.'
    name = f'{connection.__class__.__module__}.{connection.__class__.__name__}'
    if name.startswith('django.core.mail.backends.console') or name.startswith('django.core.mail.backends.locmem'):
        return ('No mail provider is configured: EMAIL_BACKEND is still Django\'s log-only backend, '
                'so the letter is written to the server log instead of sent. Set EMAIL_BACKEND to '
                'apps.common.email.EmailBackend with a RESEND_API_KEY.')
    if 'apps.common.email' in name and not (getattr(settings, 'RESEND_API_KEY', '') or '').strip():
        return 'The Resend backend is selected but RESEND_API_KEY is empty, so nothing was posted.'
    if name.startswith('django.core.mail.backends.smtp') and (getattr(settings, 'EMAIL_HOST', '') or 'localhost') == 'localhost':
        return 'SMTP is selected but EMAIL_HOST still points at localhost, so the letter has nowhere to go.'
    return ''


def queue_event_email(to, subject, heading, message, details=(), cta_label='', cta_path='',
                      footnote=''):
    """Hand one finished event to the mail queue without putting its provider on the request."""
    if not to:
        return None
    try:
        logo = _absolute(getattr(settings, 'EMAIL_LOGO_URL', '') or '/exposing-icon.png')
        cta = _absolute(cta_path) if cta_label and cta_path else ''
        return send_off_request(
            send_branded_email, to, subject, heading, message, tuple(details),
            cta_label, cta, footnote, logo, support_context(),
        )
    except Exception:
        logger.exception('Could not queue the %s email for %s', subject, to)
        return None


def queue_welcome_email(user, *, name='', username='', verified=True):
    """The first letter, sent once the account row and its profile exist."""
    return _queue(
        send_welcome_email, user.email, 'Welcome to Exposing', name, username,
        _absolute('/login'), verified, support_context(),
    )


def queue_coin_decision_email(user, *, action, coins, amount, balance=None, request_id,
                              reference='', reason=''):
    """The letter that answers a coin purchase, whichever way the seat decided it."""
    try:
        paid = f'{Decimal(str(amount)):,.2f}'
    except InvalidOperation:
        paid = str(amount)
    details = [
        ('Coins asked for', f'{coins} coins'),
        ('Amount paid', f'NPR {paid}'),
        ('Purchase reference', f'#{request_id}'),
    ]
    if reference:
        details.append(('Bank reference', reference))
    if action == 'approve':
        subject = 'Your Exposing coin purchase is confirmed'
        heading = 'Coins added to your wallet'
        message = f'Your purchase of {coins} coins has been approved and credited to your Exposing wallet.'
        details.insert(2, ('Wallet balance', f'{balance} coins'))
        footnote = 'Keep this email as your purchase receipt. Contact Exposing if any detail is incorrect.'
    elif action == 'reject':
        subject = 'Your Exposing coin purchase was refused'
        heading = 'The coins were not added'
        message = f'Your purchase of {coins} coins was not approved. Reason: {reason or "not stated"}'
        footnote = 'Nothing was credited. If the reason looks wrong, reply with your bank receipt and we will look again.'
    else:
        subject = 'Exposing needs a better payment proof'
        heading = 'One more look at your receipt'
        message = f'The platform needs more proof before the {coins} coins can be credited. What is needed: {reason}'
        footnote = 'Your request stays open. Upload the new picture from the wallet screen.'
    return queue_event_email(
        user.email, subject, heading, message,
        details=details,
        cta_label='Open your wallet',
        cta_path='/wallet',
        footnote=footnote,
    )
