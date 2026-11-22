"""Put the four coin requests the 6.7 walkthrough needs where it expects them.

`admin/qa/console.mjs` proves the coin desk end to end, so the seed gives each
corner of the screen something real to show: a request with a payment screenshot
that can be credited, one that has been waiting past the threshold and has already
been asked for better proof, one with no screenshot at all, and one that was
decided days ago so the row names the seat that decided it.

The receipts are drawn here rather than committed — a PNG of a bank slip is the
only proof the desk has to open, and the desk only ever opens it through a
two-minute link. Re-running resets exactly these four accounts' requests and
leaves every other purchase standing.

Two things this file cannot do, both on purpose. It never deletes a ledger row:
the wallet table refuses deletes in the database itself, so the sample movements
are written once and the run is judged on a growing table, which is what the
product promises — which is also why the walkthrough's own payer starts each run
at a balance of zero rather than at whatever the last run left. And it never writes
a payment screenshot outside `media/`, the folder the retention sweep deletes from.

    backend/.venv/Scripts/python.exe admin/qa/coins_seed.py
"""

import os
import struct
import sys
import zlib
from datetime import timedelta
from decimal import Decimal

import django

BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))
sys.path.insert(0, BACKEND)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'exposing.settings')
django.setup()

from django.conf import settings  # noqa: E402
from django.core.files.base import ContentFile  # noqa: E402
from django.core.files.storage import storages  # noqa: E402
from django.utils import timezone  # noqa: E402

from apps.accounts.models import User  # noqa: E402
from apps.wallet.models import CoinRequest, Transaction, Wallet  # noqa: E402
from apps.wallet.models import apply as wallet_apply  # noqa: E402

from apps.adminpanel.models import CoinReview  # noqa: E402

PASSWORD = 'exposing-demo-1'
ONE = 'qa_coin_one'
TWO = 'qa_coin_two'
THREE = 'qa_coin_three'
FOUR = 'qa_coin_four'
PAYERS = (ONE, TWO, THREE, FOUR)
MARK = 'console QA sample - coin desk'
MAIL = 'pay.test'
RECEIPT_DIR = 'proofs'


def account(username):
    """The payer, back to its start state whichever verbs the last run used."""
    user = User.objects.filter(username=username).first()
    if user is None:
        user = User.objects.create_user(username=username, password=PASSWORD, email=f'{username}@{MAIL}')
    # Its own domain, deliberately: the directory section of the walkthrough counts
    # the accounts on `example.test` and a page only holds ten, so payers parked
    # there would push a member off the screen the check is reading.
    user.email = f'{username}@{MAIL}'
    user.is_active = True
    user.suspended_until = None
    user.save()
    profile = getattr(user, 'profile', None)
    if profile is not None:
        profile.display_name = profile.display_name or username.replace('qa_', 'QA ')
        profile.save(update_fields=['display_name'])
    Wallet.objects.get_or_create(user=user)
    return user


def receipt_png(width=340, height=210, seed=1):
    """A bank slip drawn as pixels: paper, a header bar and lines of fake ink.

    The desk is judged on opening a real picture through a real short-lived link,
    so the sample has to be a file a browser can decode — not a text blob with a
    `.png` on the end.
    """
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            paper = y > 34 or x < 8 or x > width - 9
            heading = y <= 34
            ink = paper and 26 < y < height - 18 and 22 < x < width - 40 and (y % 26) < 11 and ((x + seed * 7) % 17) < 11
            if heading:
                rgb = (28, 42, 63)
            elif ink:
                rgb = (58, 62, 70)
            elif paper:
                rgb = (248, 249, 251)
            else:
                rgb = (228, 232, 238)
            rows.extend(rgb)
    return _png(width, height, bytes(rows))


def _png(width, height, raw):
    def chunk(tag, body):
        head = struct.pack('>I', len(body)) + tag + body
        return head + struct.pack('>I', zlib.crc32(tag + body) & 0xFFFFFFFF)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 6))
            + chunk(b'IEND', b''))


def qr_png(size=180, modules=21):
    """A payment QR drawn as pixels, for the desk’s upload step to hand over.

    The walkthrough uploads a real file and reads the picture back out of the
    pricing door, so the sample has to be decodable — and it lives in the gitignored
    shots folder the suite already writes into, not in the repository.
    """
    step = size / modules
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            col, row = int(x / step), int(y / step)
            corner = ((col < 7 and row < 7) or (col >= modules - 7 and row < 7)
                      or (col < 7 and row >= modules - 7))
            ring = corner and min(col % 7 if col < 7 else modules - 1 - col,
                                  row % 7 if row < 7 else modules - 1 - row) in (0, 3)
            eye = corner and min(col if col < 7 else modules - 1 - col,
                                 row if row < 7 else modules - 1 - row) in (0, 1, 5, 6)
            scatter = (not corner) and ((col * 7 + row * 13 + col * row) % 5) < 2
            dark = ring or eye or scatter
            rows.extend((26, 30, 38) if dark else (252, 252, 253))
    return _png(size, size, bytes(rows))


def put_receipt(request, seed):
    name = f'{RECEIPT_DIR}/{request.pk}.png'
    if storages['default'].exists(name):
        storages['default'].delete(name)
    storages['default'].save(name, ContentFile(receipt_png(seed=seed)))
    request.screenshot_url = f'http://127.0.0.1:8003/media/{name}'
    request.save(update_fields=['screenshot_url'])


def purchase(user, coins, rupees, reference, status, hours_ago, proof, reviewed_hours_ago=None):
    request = CoinRequest.objects.create(
        user=user, coins=coins, amount=Decimal(rupees), method='bank',
        reference=reference, status=status,
    )
    request.created_at = timezone.now() - timedelta(hours=hours_ago)
    if reviewed_hours_ago is not None:
        request.reviewed_at = timezone.now() - timedelta(hours=reviewed_hours_ago)
    request.save(update_fields=['created_at', 'reviewed_at'])
    if proof:
        put_receipt(request, seed=coins // 100)
    return request


def main():
    now = timezone.now()
    users = {username: account(username) for username in PAYERS}

    # Only this file's own purchases are rebuilt; a re-run must not undo a decision
    # somebody made from the console against real money.
    CoinReview.objects.filter(request__user__in=users.values()).delete()
    CoinRequest.objects.filter(user__in=users.values()).delete()

    one = purchase(users[ONE], 500, '5000.00', 'TRX-8801', CoinRequest.Status.PENDING,
                   hours_ago=3, proof=True)
    two = purchase(users[TWO], 120, '1200.00', 'TRX-8802', CoinRequest.Status.PENDING,
                   hours_ago=31, proof=True)
    three = purchase(users[THREE], 250, '2500.00', 'TRX-8803', CoinRequest.Status.PENDING,
                     hours_ago=1, proof=False)
    four = purchase(users[FOUR], 300, '3000.00', 'TRX-8804', CoinRequest.Status.APPROVED,
                    hours_ago=96, proof=True, reviewed_hours_ago=48)

    actor = User.objects.filter(username='sita').first() or User.objects.filter(is_staff=True).first()

    # `auto_now_add` stamps the insert with the current clock, so the age a decision
    # claims is written after it lands. The desk sorts and times by that column.
    asked = CoinReview.objects.create(
        request=two, actor=actor, action=CoinReview.Action.PROOF,
        reason='the right-hand edge of the slip is cut off — send the whole page',
    )
    CoinReview.objects.filter(pk=asked.pk).update(created_at=now - timedelta(hours=20))
    settled = CoinReview.objects.create(request=four, actor=actor, action=CoinReview.Action.APPROVE,
                                        coins_credited=four.coins)
    CoinReview.objects.filter(pk=settled.pk).update(created_at=now - timedelta(hours=48))

    # The wallet refuses deletes, so the two sample movements are written once and
    # never again. Nothing in the console can take them back.
    if not Transaction.objects.filter(note__startswith=MARK).exists():
        wallet = Wallet.objects.get(user=users[FOUR])
        wallet_apply(wallet.pk, Transaction.Kind.CREDIT, Decimal('300'), f'{MARK}: purchase {four.pk} approved')
        wallet_apply(wallet.pk, Transaction.Kind.DEBIT, Decimal('150'), f'{MARK}: a week of Prime bought')

    qr_here = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')
    os.makedirs(qr_here, exist_ok=True)

    with open(os.path.join(qr_here, 'coin-qr.png'), 'wb') as handle:
        handle.write(qr_png())

    # The desk credits `one` and then hand-writes a row for it, so the ledger
    # numbers on screen only repeat if the wallet starts at nothing. Rows an earlier
    # run wrote cannot be taken back — the table refuses deletes — so the reset lands
    # on the balance, which is exactly why that column is called "Wallet now".
    Wallet.objects.filter(user__in=[users[ONE], users[TWO], users[THREE]]).update(balance=Decimal('0.00'))

    print(f'{one.pk} waiting 3 h with a receipt | {two.pk} waiting 31 h and already asked for better proof')
    print(f'{three.pk} waiting with no receipt at all | {four.pk} approved 2 days ago, 300 coins in')
    print(f'Receipts live under {os.path.join("media", RECEIPT_DIR)}; the retention sweep deletes from there.')
    print(f'{users[FOUR].username} holds a credit and a debit in the ledger, which is what the wallet-now column is for.')
    print(f'A payment QR for the desk to upload: {os.path.join(qr_here, "coin-qr.png")}')


if __name__ == '__main__':
    main()
