import re
from urllib.parse import urlsplit

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone


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
        'logo_url': safe_link(logo_url),
        'support': contact,
        'year': timezone.now().year,
    }
    html = render_to_string('emails/event.html', context)
    lines = ['EXPOSING', '', str(heading), '', str(message)]
    for row in rows:
        lines.append(f'{row["label"]}: {row["value"]}')
    if cta_url and cta_label:
        lines.extend(['', f'{cta_label}: {cta_url}'])
    if footnote:
        lines.extend(['', str(footnote)])
    lines.extend(['', 'Need help?'])
    if contact['email']:
        lines.append(f'Email: {contact["email"]}')
    if contact['phone']:
        lines.append(f'Phone: {contact["phone"]}')
    if contact['form']:
        lines.append(f'Support form: {contact["form"]}')
    lines.extend(['', 'This is an automated message from Exposing. Please do not reply to it.',
                  f'© {context["year"]} Exposing. All rights reserved.'])

    letter = EmailMultiAlternatives(
        subject, '\n'.join(lines), settings.DEFAULT_FROM_EMAIL, [to],
        reply_to=[contact['email']] if contact['email'] else None,
    )
    letter.attach_alternative(html, 'text/html')
    letter.send(fail_silently=False)
