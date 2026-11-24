"""Queue the platform's branded transactional mail after the business write."""

import logging
from decimal import Decimal, InvalidOperation
from urllib.parse import urljoin

from django.conf import settings

from apps.common.mail import send_off_request
from apps.common.tasks import safe_link, send_branded_email

logger = logging.getLogger(__name__)


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


def queue_coin_credit_email(user, *, coins, amount, balance, request_id, reference=''):
    """The receipt sent after either staff approval path credits a coin purchase."""
    try:
        paid = f'{Decimal(str(amount)):,.2f}'
    except InvalidOperation:
        paid = str(amount)
    details = [
        ('Coins added', f'{coins} coins'),
        ('Amount paid', f'NPR {paid}'),
        ('Wallet balance', f'{balance} coins'),
        ('Purchase reference', f'#{request_id}'),
    ]
    if reference:
        details.append(('Bank reference', reference))
    return queue_event_email(
        user.email,
        'Your Exposing coin purchase is confirmed',
        'Coins added to your wallet',
        f'Your purchase of {coins} coins has been approved and credited to your Exposing wallet.',
        details=details,
        cta_label='Open your wallet',
        cta_path='/wallet',
        footnote='Keep this email as your purchase receipt. Contact Exposing if any detail is incorrect.',
    )
