import re
from email.mime.image import MIMEImage
from pathlib import Path
from urllib.parse import urlsplit

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone

LOGO_FILE = Path(__file__).with_name('email_assets') / 'exposing-logo.png'
LOGO_CID = 'exposing-logo'


def safe_link(value):
    """Only web links the mail can safely put in an href."""
    raw = str(value or '').strip()
    if not raw:
        return ''
    try:
        parsed = urlsplit(raw)
    except ValueError:
        return ''
    if parsed.scheme:
        return raw if parsed.scheme.lower() in ('http', 'https') else ''
    return raw if raw.startswith('/') and not raw.startswith('//') else ''


def _support(support):
    values = support or {}
    email = str(values.get('email') or '').strip()
    phone = str(values.get('phone') or '').strip()
    return {
        'email': email if re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email) else '',
        'phone': phone if re.fullmatch(r'[+()\d\s.-]{3,40}', phone) else '',
        'form': safe_link(values.get('form')),
    }


def _logo(logo_url):
    """Where the header mark comes from, and the part to put in the message.

    A link to the site's own icon is what made the logo render as a grey box:
    most mail clients fetch remote pictures only after the reader agrees to, and
    a code email is read before that question is even asked. The file travels
    inside the message instead, and the setting stays as the fallback.
    """
    try:
        data = LOGO_FILE.read_bytes()
    except OSError:
        data = b''
    if not data:
        return safe_link(logo_url), None
    image = MIMEImage(data, 'png')
    image.add_header('Content-ID', f'<{LOGO_CID}>')
    image.add_header('Content-Disposition', 'inline', filename=f'{LOGO_CID}.png')
    return f'cid:{LOGO_CID}', image


def _send(subject, to, template, context, text_lines, support, logo_url=''):
    """One letter: HTML, a plain-text twin, the brand mark, and the support block."""
    contact = _support(support)
    logo_src, image = _logo(logo_url)
    context = {
        **context,
        'logo_src': logo_src,
        'support': contact,
        'recipient': to,
        'year': timezone.now().year,
    }
    letter = EmailMultiAlternatives(
        subject, '\n'.join(text_lines), settings.DEFAULT_FROM_EMAIL, [to],
        reply_to=[contact['email']] if contact['email'] else None,
    )
    if image is not None:
        letter.attach(image)
    letter.attach_alternative(render_to_string(template, context), 'text/html')
    letter.send(fail_silently=False)


def _support_lines(contact):
    lines = ['', 'Need help?']
    if contact['email']:
        lines.append(f'Email: {contact["email"]}')
    if contact['phone']:
        lines.append(f'Phone: {contact["phone"]}')
    if contact['form']:
        lines.append(f'Support form: {contact["form"]}')
    return lines


@shared_task
def send_branded_email(to, subject, heading, message, details=(), cta_label='', cta_url='',
                       footnote='', logo_url='', support=None):
    """Render one transactional message as HTML and a readable plain-text fallback."""
    contact = _support(support)
    rows = [
        {'label': str(label), 'value': str(value)}
        for label, value in (details or ())
        if str(label).strip() and str(value).strip()
    ]
    cta_url = safe_link(cta_url)
    context = {
        'heading': heading,
        'message': message,
        'details': rows,
        'cta_label': cta_label if cta_url else '',
        'cta_url': cta_url,
        'footnote': footnote,
    }
    lines = ['EXPOSING', '', str(heading), '', str(message)]
    for row in rows:
        lines.append(f'{row["label"]}: {row["value"]}')
    if cta_url and cta_label:
        lines.extend(['', f'{cta_label}: {cta_url}'])
    if footnote:
        lines.extend(['', str(footnote)])
    lines.extend(_support_lines(contact))
    lines.extend(['', f'Sent to {to}. This is an automated message, so please do not reply.',
                  f'(c) {timezone.now().year} Exposing. All rights reserved.'])
    _send(subject, to, 'emails/event.html', context, lines, support, logo_url)


@shared_task
def send_code_email(to, subject, heading, intro, code, minutes, support=None):
    """A one-time code, set in the same letter as the rest of the mail."""
    contact = _support(support)
    context = {'heading': heading, 'intro': intro, 'code': code, 'minutes': minutes}
    lines = [
        'EXPOSING', '', str(heading), '', str(intro), '',
        f'Your code: {code}',
        f'It works once and stops working after {minutes} minutes.', '',
        'If you did not ask for this code, you can ignore this email. Nothing changes '
        'on your account unless the code is used.',
        'Exposing staff will never ask you for this code.',
    ]
    lines.extend(_support_lines(contact))
    lines.extend(['', f'Sent to {to}. This is an automated message, so please do not reply.',
                  f'(c) {timezone.now().year} Exposing. All rights reserved.'])
    _send(subject, to, 'emails/otp.html', context, lines, support)


@shared_task
def send_welcome_email(to, subject, name, username, cta_url, verified=True, support=None):
    """The first letter a new account gets: what to do, in the order it is worth doing."""
    contact = _support(support)
    cta_url = safe_link(cta_url)
    steps = [
        {'title': 'Set up your profile',
         'body': 'A photo and one line about yourself. It is what people judge a '
                 'stranger on before they follow.'},
        {'title': 'Post something',
         'body': 'One photo or reel. Empty profiles get skipped in every feed.'},
        {'title': 'Follow a few people',
         'body': 'Start with accounts you already know. The home feed fills in from there.'},
    ]
    context = {
        'heading': 'Your Exposing account is ready',
        'name': name,
        'username': username,
        'steps': steps,
        'verified': verified,
        'cta_label': 'Open Exposing' if cta_url else '',
        'cta_url': cta_url,
    }
    lines = ['EXPOSING', '', 'Your Exposing account is ready.', '']
    lines.append(f'Hi {name},' if name else 'Hello,')
    lines.extend(['', f'Your account @{username} is open. Three things are worth doing first:', ''])
    for number, step in enumerate(steps, start=1):
        lines.append(f'{number}. {step["title"]} - {step["body"]}')
    if cta_url:
        lines.extend(['', f'Open Exposing: {cta_url}'])
    if not verified:
        lines.extend(['', 'One step is still outstanding: we have emailed a six-digit code to '
                          f'{to}. Enter it to finish confirming this address. Until you do, the '
                          'account stays signed out.'])
    lines.extend(['', 'You can change any of this later in Settings. If you did not open '
                      'this account, reply to the support address below and we will sort it out.'])
    lines.extend(_support_lines(contact))
    lines.extend(['', f'Sent to {to}. This is an automated message, so please do not reply.',
                  f'(c) {timezone.now().year} Exposing. All rights reserved.'])
    _send(subject, to, 'emails/welcome.html', context, lines, support)
