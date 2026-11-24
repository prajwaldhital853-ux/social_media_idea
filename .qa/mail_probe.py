"""Does each event actually hand a letter to the mail provider?

Runs the real service functions with Django's in-memory backend, so the answer is
the outbox: a letter that never reaches it was never queued, and a letter that
reaches it but never arrives is the provider's answer, not our code. Everything
is written inside one transaction that is rolled back.
"""

import os
import uuid
from decimal import Decimal

os.environ['DJANGO_SETTINGS_MODULE'] = 'exposing.settings'
os.environ['EMAIL_BACKEND'] = 'django.core.mail.backends.locmem.EmailBackend'

import django  # noqa: E402

django.setup()

from django.core import mail as djmail  # noqa: E402
from django.db import connection, transaction  # noqa: E402

import apps.common.emails as emails  # noqa: E402
from apps.accounts.models import User  # noqa: E402
from apps.adminpanel import coins, people, promotions, review  # noqa: E402
from apps.posts.models import Post  # noqa: E402
from apps.promotions.models import Promotion  # noqa: E402
from apps.wallet.models import CoinRequest, Wallet  # noqa: E402


def inline(task, *args):
    """Skip the mail thread: the probe reads the outbox before the interpreter exits."""
    task(*args)
    return None


emails.send_off_request = inline

REPORT = []


def report(label, status, detail=''):
    letters = list(djmail.outbox)
    djmail.outbox.clear()
    heads = [f'{m.to[0]} | {m.subject}' for m in letters]
    REPORT.append((label, status, len(letters), heads, detail))


def main():
    from django.conf import settings as s

    print(f'db={connection.settings_dict["NAME"]}')
    print(f'backend class={djmail.get_connection().__class__.__module__}')
    print(f'from={s.DEFAULT_FROM_EMAIL} site={s.SITE_URL}')
    print(f'mail problem: {emails.mail_delivery_problem() or "(none)"}')

    seat = User.objects.filter(is_superuser=True).order_by('id').first()
    if seat is None:
        raise SystemExit('No superuser seat in this database — the probe needs one to decide with.')

    with transaction.atomic():
        tag = uuid.uuid4().hex[:6]
        member = User.objects.create_user(
            username=f'mailprobe{tag}', email=f'mailprobe.{tag}@gmail.com', password='probe-pass-1',
        )
        wallet, _ = Wallet.objects.get_or_create(user=member, defaults={'balance': Decimal('500')})
        Wallet.objects.filter(pk=wallet.pk).update(balance=Decimal('500'))
        post = Post.objects.create(author=member, text='probe post for mail')

        report('setup', 'ok')

        emails.queue_welcome_email(member, name='Probe Member', username=member.username)
        report('welcome (first login)', 'check', f'user email={member.email}')

        req = CoinRequest.objects.create(
            user=member, coins=100, amount=Decimal('1000'), reference='PROOF-REF-1',
        )
        code, body = coins.decide(req, seat, 'approve')
        report('coin approved', f'{code} {body.get("mail") or ""}', body.get('detail', ''))

        code, body = coins.decide(
            CoinRequest.objects.create(user=member, coins=50, amount=Decimal('500')),
            seat, 'reject', reason='The receipt does not match the amount.',
        )
        report('coin rejected', f'{code} {body.get("mail") or ""}', body.get('detail', ''))

        promo = Promotion.objects.create(
            owner=member, target_type='post', target_id=str(post.pk),
            budget=Decimal('40'), status=Promotion.Status.PENDING,
        )
        code, body = promotions.decide(promo, seat, 'approve')
        report('promotion approved', f'{code} {body.get("mail") or ""}', body.get('detail', ''))

        promo2 = Promotion.objects.create(
            owner=member, target_type='post', target_id=str(post.pk),
            budget=Decimal('40'), status=Promotion.Status.ACTIVE, starts_at=django.utils.timezone.now(),
        )
        code, body = promotions.decide(promo2, seat, 'reject', reason='The creative breaks the rules.')
        report('promotion refused', f'{code} {body.get("mail") or ""}', body.get('detail', ''))

        out = people.warn(member, seat, text='This is a warning about your account.', reason='probe')
        report('account warning', 'ok', str(out.get('emailed')))

        note = review.attach('post', post.pk, seat, 'probe reason', 'This claim is false.', email=True)
        report('notice on content', 'ok', str(note.get('emailed')))

        print('\n--- letters handed to the provider ---')
        for label, status, count, heads, detail in REPORT:
            print(f'{label:24} {count}  [{status}] {heads}')
            if detail:
                print(f'{"":24}     {detail[:150]}')
        # Nothing here belongs to the platform: the probe's accounts, ledger and
        # decisions are all thrown away so the next run starts from an empty name.
        transaction.set_rollback(True)


main()
