"""Queue the platform's branded transactional mail after the business write."""

import logging
import re
from decimal import Decimal, InvalidOperation
from urllib.parse import urljoin

from django.conf import settings
from django.utils import timezone

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
    if not getattr(settings, 'CELERY_TASK_ALWAYS_EAGER', True):
        return ('Mail is handed to the Celery queue, and nothing on this deployment consumes it, '
                'so every letter is dropped without an error. Set CELERY_ALWAYS_EAGER=1, or run a '
                'worker that reads that queue.')
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


def queue_report_email(report):
    """Tell the address the Client chose in the console that a complaint arrived.

    The inbox is a setting rather than a constant because the person who reads
    reports changes without a deploy. An empty or unparseable box says nothing:
    then the console queue is the only place a report is meant to be seen, and a
    settings screen must not be able to mail a stranger's complaint to a typo.
    """
    try:
        from apps.adminpanel.settings_store import get

        inbox = str(get('report_inbox') or '').strip()
    except Exception:
        logger.exception('Could not read the complaints inbox setting')
        return None
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]{2,}', inbox):
        return None
    reporter = report.reporter
    return queue_event_email(
        inbox,
        'A complaint was filed on Exposing',
        'Someone reported content',
        f'@{reporter.username} reported the {report.target_type} below. It is open in the '
        'console review queue, where the decision is written.',
        details=(
            ('Reported by', f'@{reporter.username}'),
            ('Their email', reporter.email or ''),
            ('Target', f'{report.target_type} #{report.target_id}'),
            ('Reason', report.reason),
            ('Their words', report.details),
            ('Filed at', timezone.localtime(report.created_at).strftime('%d %b %Y at %H:%M')),
        ),
        footnote='This address is set under Console → First-load wording, and can be changed there at any time.',
    )


_INBOX = re.compile(r'[^\s@]+@[^\s@]+\.[^\s@]{2,}')


def _inbox(*keys):
    """The first of these settings that holds a whole address.

    A request letter has one fallback, the complaints box: a deployment that told
    the platform where complaints go has already named the person who reads the
    queue, and a letter that goes nowhere because a second box was never filled is
    a silent missed payment.
    """
    try:
        from apps.adminpanel.settings_store import get

        for key in keys:
            value = str(get(key) or '').strip()
            if _INBOX.fullmatch(value):
                return value
    except Exception:
        logger.exception('Could not read the request inbox settings')
    return ''


def console_link(path):
    """A link into the console, or the member site when no console address is written."""
    try:
        from apps.adminpanel.settings_store import get

        door = str(get('console_url') or '').strip().rstrip('/')
    except Exception:
        logger.exception('Could not read the console address setting')
        door = ''
    return f'{door}{path}' if door else path


def queue_coin_request_email(coin_request):
    """Tell the desk money was ordered, while the proof is still fresh.

    A request that sits unread is a member who paid and got nothing, and the coins
    desk only gets read when somebody remembers it is there.
    """
    inbox = _inbox('request_inbox', 'report_inbox')
    if not inbox:
        return None
    buyer = coin_request.user
    return queue_event_email(
        inbox,
        'A coin purchase is waiting on Exposing',
        'Someone paid for coins',
        f'@{buyer.username} filed a coin purchase for {coin_request.coins} coins. It is open in '
        'the coins desk, where the payment proof is checked and the coins are credited.',
        details=(
            ('Member', f'@{buyer.username}'),
            ('Their email', buyer.email or ''),
            ('Coins asked for', f'{coin_request.coins} coins'),
            ('Amount', f'NPR {coin_request.amount}'),
            ('Paid by', 'bank transfer' if coin_request.method == 'bank' else 'QR / wallet'),
            ('Their reference', coin_request.reference or 'not given'),
            ('Payment proof', 'attached' if coin_request.screenshot_url else 'none attached'),
            ('Filed at', timezone.localtime(coin_request.created_at).strftime('%d %b %Y at %H:%M')),
        ),
        cta_label='Open the coins desk',
        cta_path=console_link('/coins'),
        footnote='This address is set under Console → First-load wording, beside the complaints inbox.',
    )


def queue_promotion_request_email(promo):
    """The same courtesy for the reach somebody has bought with their coins."""
    inbox = _inbox('request_inbox', 'report_inbox')
    if not inbox:
        return None
    owner = promo.owner
    return queue_event_email(
        inbox,
        'A promotion order is waiting on Exposing',
        'Someone bought reach',
        f'@{owner.username} ordered a promotion for {promo.budget} coins. Until a seat approves '
        'it the campaign runs nowhere and the coins are not yet spent.',
        details=(
            ('Member', f'@{owner.username}'),
            ('Their email', owner.email or ''),
            ('Package', str(promo.package or 'not named')),
            ('Coins', f'{promo.budget} coins'),
            ('Promoting', f'{promo.target_type} #{promo.target_id}'),
            ('Category', promo.category or 'whole city'),
            ('Filed at', timezone.localtime(promo.created_at).strftime('%d %b %Y at %H:%M')),
        ),
        cta_label='Open the promotions desk',
        cta_path=console_link('/promotions'),
        footnote='This address is set under Console → First-load wording, beside the complaints inbox.',
    )


def queue_staff_created_email(user, *, password, role, permissions=(), by=''):
    """Hand a new seat what it needs to walk in once: address, password, role, screens, link.

    The password travels in the letter because the console cannot show it again
    after the write closes: the row is flagged so the door refuses that password a
    second time and makes the person choose their own, which makes this letter a
    bridge rather than a place a secret is kept. The screens are spelled out by
    their own names so nobody has to discover their access by finding a locked door.
    """
    from apps.adminpanel.rbac import LABELS, ROLE_LABELS

    names = [LABELS.get(key, key) for key in permissions]
    return queue_event_email(
        user.email,
        'Your Exposing staff seat is ready',
        'You have access to the Exposing console',
        f'{by or "The platform"} gave you a {ROLE_LABELS.get(role, role)} seat on the Exposing '
        'admin console. Sign in with the address and temporary password below. The door makes you '
        'choose your own password first, then set up an authenticator, before any screen opens.',
        details=(
            ('Sign in with', user.email or ''),
            ('Your username', f'@{user.username}'),
            ('Temporary password', password),
            ('Your role', ROLE_LABELS.get(role, role)),
            ('Screens you can open', ', '.join(names) if names else 'None yet'),
        ),
        cta_label='Open the staff sign-in',
        cta_path=console_link('/login'),
        footnote='This password stops working the moment you replace it, and it is not sent out '
                 'again. If this letter reached the wrong person, tell Exposing staff rather than '
                 'signing in.',
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
    elif action == 'paid':
        subject = 'Your Exposing refund was approved'
        heading = 'Your refund was approved'
        message = (f'The refund on your {coins} coin purchase was approved and the coins were taken back off your '
                   f'wallet. The money is transferred to the payment details you sent with the request.')
        details.insert(2, ('Wallet balance', f'{balance} coins'))
        footnote = 'Refunds are paid by hand by the Exposing desk and can take a working day to reach your account. ' \
                   'Reply to this email with your reference if the money has not arrived.'
    elif action == 'refused':
        subject = 'Your Exposing refund request was refused'
        heading = 'The refund was not approved'
        message = (f'The desk looked at your refund request on the {coins} coin purchase and turned it down. '
                   f'Reason: {reason or "not stated"}')
        details.insert(2, ('Wallet balance', f'{balance} coins'))
        footnote = 'The coins stayed in your wallet and are spendable again. If you have proof that changes this, ' \
                   'reply to this email with it attached.'
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


def queue_refund_request_email(coin_request, *, locked=None):
    """Acknowledge a refund the moment it is filed, in three short paragraphs.

    The wallet screen can only say the ask was received, so the letter carries the
    wait and the rules. It is read on a phone between other things: a numbered
    process and a page of conditions land as a document nobody opens, so the body
    says what happens and when, the table says which purchase, and the rules stay
    to the six that can actually change what the member does next.
    """
    user = coin_request.user
    try:
        paid = f'{Decimal(str(coin_request.amount)):,.2f}'
    except InvalidOperation:
        paid = str(coin_request.amount)
    filed = coin_request.refund_requested_at or timezone.now()
    details = [
        ('Purchase', f'#{coin_request.pk}'),
        ('Coins', f'{coin_request.coins} coins'),
        ('Amount paid', f'NPR {paid}'),
        ('Paid by', 'bank transfer' if coin_request.method == 'bank' else 'QR / wallet'),
        ('Coins locked', f'{locked} coins' if locked else ''),
        ('Filed at', timezone.localtime(filed).strftime('%d %b %Y at %H:%M')),
    ]
    message = (
        f'Purchase #{coin_request.pk} is with the coins desk. The {coin_request.coins} coins it bought are '
        'locked until the desk answers, so they cannot be spent or put into a promotion.\n'
        '\n'
        'Requests are settled in the order they arrive. It may take up to 3 business days to handle yours, '
        'and a weekend or a holiday does not count towards that.\n'
        '\n'
        'If the refund is approved, the coins come off your wallet and the money is sent by hand to the '
        'details you gave. That transfer can take one more working day. Either way the answer reaches you '
        'here and in your Exposing notifications.'
    )
    footnote = (
        'The refund rules, short:\n'
        '- Only an approved purchase can be refunded.\n'
        '- If even one coin of that batch was spent, the purchase can no longer be refunded.\n'
        '- The whole purchase or nothing. There is no partial refund.\n'
        '- One open refund per account, and none while a promotion request is pending.\n'
        '- Locked coins are released the moment the desk answers, whichever way it goes.\n'
        '- A paid refund is not asked twice. A refused ask closes that purchase for good.\n'
        '\n'
        'Something wrong above, or 3 business days gone with no answer? Reply to this email.'
    )
    return queue_event_email(
        user.email,
        'Your Exposing refund request is being reviewed',
        'Your refund request is with the desk',
        message,
        details=details,
        cta_label='Open your wallet',
        cta_path='/wallet/requests',
        footnote=footnote,
    )
