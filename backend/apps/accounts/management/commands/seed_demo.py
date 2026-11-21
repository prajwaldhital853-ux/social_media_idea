"""Build (or rebuild) the demo dataset the shipped app opens on.

    manage.py seed_demo --purge          wipe the junk and lay a fresh showcase
    manage.py seed_demo                  only seeds when the showcase is missing

The showcase is ~35 named Nepali members, 500 photo posts (single and multi
image), 110 reels whose clips are cached first-party, and the follow, comment,
reaction, message, listing, wallet and moderation rows that put those posts
inside a real network. One ``random.Random`` drives every choice, so a rebuild
produces the same demo instead of a new one to re-test.
"""

import random
import urllib.request
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.accounts.demo_content import (
    BIOS, CHAT_CLOSERS, CHAT_OPENERS, CHAT_SCRIPTS, CLIPS, COMMENT_LINES, CORE_PEOPLE,
    COUNTS, CATEGORIES, LISTINGS, MIXED_POST_TEXT, MOODS, PEOPLE, PHOTO_ASIDES,
    PHOTO_LINES, PLACES, REELS_ASIDES, REEL_LINES, REPLY_LINES,
)
from apps.comments.models import Comment
from apps.follows.models import Follow
from apps.marketplace.models import Listing, ListingImage
from apps.messages.models import Conversation, Message
from apps.moderation.models import AuditLog, Report
from apps.notifications.models import Notification
from apps.posts.models import Post, PostMedia
from apps.profiles.models import Profile
from apps.promotions.models import Promotion
from apps.reactions.models import Reaction
from apps.saved.models import SavedListing, SavedPost
from apps.wallet.models import CoinRequest, Transaction as Ledger, Wallet

User = get_user_model()

SEED = 20261121
DEMO_PASSWORD = 'exposing-demo-1'
# Members whose accounts survive a purge: the browser suites sign in as them.
KEEP = {'sita', 'maya', 'arjun', 'priya'}
WINDOW_DAYS = 120
# Activity younger than this still shows in the bell, so it has to be real.
RECENT_DAYS = 25


def mp4_duration(path):
    """Seconds from an mp4's mvhd box; the reels feed shows a duration."""
    data = Path(path).read_bytes()
    start = data.find(b'mvhd')
    if start < 0:
        return None
    start += 4
    if data[start] == 1:
        timescale = int.from_bytes(data[start + 20:start + 24], 'big')
        duration = int.from_bytes(data[start + 24:start + 32], 'big')
    else:
        timescale = int.from_bytes(data[start + 12:start + 16], 'big')
        duration = int.from_bytes(data[start + 16:start + 20], 'big')
    return round(duration / timescale, 1) if timescale else None


class Command(BaseCommand):
    help = 'Seed a full believable Nepali demo network (idempotent; --purge to rebuild).'

    def add_arguments(self, parser):
        parser.add_argument('--purge', action='store_true', help='Delete all content and re-seed.')
        parser.add_argument('--photos', type=int, default=500, help='Photo posts to write.')
        parser.add_argument('--reels', type=int, default=110, help='Reels to write.')

    def handle(self, *args, **options):
        self.photos = options['photos']
        self.reels = options['reels']
        self.rng = random.Random(SEED)
        self.now = timezone.now().replace(microsecond=0)
        self.decks = {}

        if options['purge'] or Post.objects.count() < self.photos:
            self.purge()
        else:
            self.stdout.write('Showcase already present — pass --purge to rebuild it.')
            return self.report()

        with transaction.atomic():
            self.people()
            self.follows()
            self.posts()
            self.comments()
            self.reactions()
            self.saves()
            self.listings()
            self.wallets()
            self.messages()
            self.promotions()
            self.reports()
            self.audit()
            self.notifications()
        self.report()

    # ------------------------------ helpers -------------------------------
    def fill(self, line):
        return line.replace('{place}', self.rng.choice(PLACES)).replace('{count}', str(self.rng.choice(COUNTS)))

    def deck(self, key, lines, asides=()):
        """Walk a shuffled deck, then recycle it with a distinct second line.

        Captions repeat far less often than the bank is long, which is what
        keeps 500 posts from reading like one template.
        """
        state = self.decks.setdefault(key, {'order': None, 'i': 0})
        if state['order'] is None:
            state['order'] = list(lines)
            self.rng.shuffle(state['order'])
        i = state['i']
        state['i'] += 1
        base = state['order'][i % len(lines)]
        if i >= len(lines) and asides:
            base = f'{base} {asides[(i * 7) % len(asides)]}'
        return self.fill(base)

    def age(self, index, total):
        """Recent-weighted timestamp so page one looks like today, not stock months old."""
        share = (index + self.rng.random()) / total
        days = (share ** 2.2) * WINDOW_DAYS + self.rng.random() * 0.4
        return self.now - timedelta(days=days, hours=self.rng.random() * 6)

    def later(self, ts, limit_hours=72):
        """A reply/reaction timestamp somewhere after ``ts`` but never in the future."""
        delta = timedelta(hours=self.rng.random() * limit_hours) * self.rng.random()
        return min(ts + delta, self.now - timedelta(minutes=self.rng.randint(1, 90)))

    def others(self, user):
        return [u for u in self.users if u.id != user.id]

    def weighted_authors(self):
        pool = []
        for user in self.users:
            verified = self.profiles[user.id].verified
            pool.extend([user] * (3 if verified else 1))
        return pool

    # ------------------------------- purge --------------------------------
    def purge(self):
        """Drop every generated row and every test member.

        There is no production data to protect: this database is the demo. The
        four members the browser suites sign in as are kept, reset clean.
        """
        for model in (SavedListing, SavedPost, ListingImage, Listing, CoinRequest, Ledger,
                      Promotion, Report, AuditLog, Notification, Message, Conversation,
                      Reaction, Comment, PostMedia, Post, Follow, Wallet):
            model.objects.all().delete()
        junk = User.objects.exclude(username__in=KEEP)
        self.stdout.write(f'Purged {junk.count()} test members and all generated content.')
        junk.delete()
        Profile.objects.all().delete()
        for user in User.objects.all():
            user.failed_attempts = 0
            user.locked_until = None
            user.suspended_until = None
            user.suspend_reason = ''
            user.save()

    # ------------------------------- people -------------------------------
    def people(self):
        roster = [(u, f, l, c, p, av, v, pr, True) for u, f, l, c, p, av, v, pr in CORE_PEOPLE]
        roster += [(u, f, l, c, p, av, v, pr, False) for u, f, l, c, p, av, v, pr in PEOPLE]
        self.users, self.profiles, self.by_username = [], {}, {}
        for index, (username, first, last, city, province, portrait, verified, private, core) in enumerate(roster):
            email = f'{username}@demo.test'
            user = User.objects.filter(username=username).first() or User(username=username)
            user.first_name, user.last_name = first, last
            user.city, user.country = city, 'Nepal'
            user.provider, user.email_verified, user.email = 'email', True, email
            user.date_of_birth = datetime(1980 + (index * 7) % 22, (index % 12) + 1, (index % 27) + 1).date()
            if not user.password:
                user.set_password(DEMO_PASSWORD)
            user.save()
            profile = Profile.objects.create(
                user=user, display_name=f'{first} {last}', bio=BIOS[index % len(BIOS)],
                avatar_url=f'https://randomuser.me/api/portraits/{portrait}.jpg',
                cover_url=f'https://picsum.photos/seed/expo-{username}-cover/1600/500',
                location=city, province=province, verified=verified, is_private=private,
                two_step=not core,
            )
            self.users.append(user)
            self.profiles[user.id] = profile
            self.by_username[username] = user
        self.sita = self.by_username['sita']
        self.stdout.write(f'Seeded {len(self.users)} members.')

    def name_of(self, user):
        return self.profiles[user.id].display_name or user.username

    # ------------------------------- graph --------------------------------
    def follows(self):
        pairs, pending = set(), 0
        popular = self.users + [u for u in self.users if self.profiles[u.id].verified]
        rows = []
        for follower in self.users:
            for _ in range(self.rng.randint(6, 18)):
                followee = self.rng.choice(popular)
                if followee.id == follower.id or (follower.id, followee.id) in pairs:
                    continue
                pairs.add((follower.id, followee.id))
                private = self.profiles[followee.id].is_private
                status = 'pending' if private and pending < 6 and self.rng.random() < 0.5 else 'accepted'
                if status == 'pending':
                    pending += 1
                ts = self.now - timedelta(days=self.rng.random() * WINDOW_DAYS)
                rows.append(Follow(follower_id=follower.id, followee_id=followee.id, status=status))
        Follow.objects.bulk_create(rows)
        Follow.objects.filter(pk__in=[r.pk for r in rows]).update(created_at=self.now - timedelta(days=WINDOW_DAYS))
        for row in rows:
            if row.status == 'accepted':
                self.shift(Follow, row, lambda r: self.now - timedelta(days=self.rng.random() * WINDOW_DAYS))
        self.followers = {}
        for row in rows:
            if row.status == 'accepted':
                self.followers[row.followee_id] = self.followers.get(row.followee_id, 0) + 1

    def shift(self, model, row, when):
        """Give one already-inserted row its real timestamp (auto_now_add wins at insert)."""
        ts = when(row)
        model.objects.filter(pk=row.pk).update(created_at=ts)
        row.created_at = ts
        return ts

    # -------------------------------- posts -------------------------------
    def ensure_clips(self):
        folder = Path(settings.MEDIA_ROOT) / 'demo'
        folder.mkdir(parents=True, exist_ok=True)
        clips = []
        for name, source in CLIPS:
            target = folder / name
            if not target.exists():
                self.stdout.write(f'Fetching demo clip {name}')
                with urllib.request.urlopen(source, timeout=180) as response, target.open('wb') as handle:
                    handle.write(response.read())
            clips.append((f'/media/demo/{name}', mp4_duration(target)))
        return clips

    def posts(self):
        self.clips = self.ensure_clips()
        self.post_media = []
        self.all_posts, self.photo_posts, self.reel_posts = [], [], []
        authors = self.weighted_authors()

        # The mixed video+photos post first, and dated newest: the browser
        # suites open it straight off the first feed page.
        mixed = self.new_post(self.sita, MIXED_POST_TEXT, 'Pokhara', 'happy', 'Travel',
                              self.now - timedelta(minutes=40))
        url, duration = self.clips[0]
        self.post_media.append(PostMedia(post_id=mixed.id, position=0, kind='video', url=url, duration=duration))
        for position in (1, 2, 3):
            self.post_media.append(PostMedia(
                post_id=mixed.id, position=position, kind='image',
                url=f'https://picsum.photos/seed/expo-pokhara-{position}/1600/1000', duration=None))
        self.mixed = mixed
        self.all_posts.append(mixed)

        shapes = [(1, 0.45), (2, 0.30), (3, 0.17), (4, 0.08)]
        for index in range(self.photos):
            author = self.rng.choice(authors)
            ts = self.age(index, self.photos)
            post = self.new_post(
                author, self.deck('photo', PHOTO_LINES, PHOTO_ASIDES),
                self.rng.choice(PLACES) if self.rng.random() < 0.55 else '',
                self.rng.choice(MOODS) if self.rng.random() < 0.45 else '',
                self.rng.choice(CATEGORIES), ts)
            roll, total, count = self.rng.random(), 0.0, 1
            for size, weight in shapes:
                total += weight
                if roll <= total:
                    count = size
                    break
            for position in range(count):
                ratio = self.rng.choice(['1080/1350', '1600/900', '1080/1080', '1400/1000'])
                self.post_media.append(PostMedia(
                    post_id=post.id, position=position, kind='image',
                    url=f'https://picsum.photos/seed/expo-{index:03d}-{position}/{ratio}', duration=None))
            self.photo_posts.append(post)
            self.all_posts.append(post)

        for index in range(self.reels):
            author = self.rng.choice(authors)
            post = self.new_post(
                author, self.deck('reel', REEL_LINES, REELS_ASIDES),
                self.rng.choice(PLACES) if self.rng.random() < 0.7 else '', '',
                self.rng.choice(['Travel', 'Nature', 'Music', 'City', 'Food', 'Sports']),
                self.age(index, self.reels))
            url, duration = self.clips[index % len(self.clips)]
            self.post_media.append(PostMedia(post_id=post.id, position=0, kind='video', url=url, duration=duration))
            self.reel_posts.append(post)
            self.all_posts.append(post)

        PostMedia.objects.bulk_create(self.post_media, batch_size=500)
        self.media_by_post = {}
        for item in self.post_media:
            self.media_by_post.setdefault(item.post_id, []).append(item)
        # A couple of posts taken down by moderation, for the admin queue to act on.
        self.hidden_posts = self.rng.sample(self.all_posts[1:], 4)
        Post.objects.filter(pk__in=[p.id for p in self.hidden_posts]).update(status='hidden')
        self.post_ids = [p.id for p in self.all_posts]

    def new_post(self, author, text, place, mood, category, ts):
        private = self.profiles[author.id].is_private
        post = Post.objects.create(
            author=author, text=text, place=place, mood=mood, category=category,
            audience='followers' if private or self.rng.random() < 0.07 else 'public')
        Post.objects.filter(pk=post.pk).update(created_at=ts, updated_at=ts)
        post.created_at = ts
        return post

    # ------------------------------ comments ------------------------------
    def comments(self):
        rows = []
        for post in self.all_posts:
            for _ in range(self.pick([0, 1, 2, 3, 4, 6, 8], [0.18, 0.22, 0.2, 0.15, 0.11, 0.08, 0.06])):
                author = self.rng.choice(self.others(post.author))
                ts = self.later(post.created_at, 96)
                media = self.media_by_post.get(post.id) or []
                index = self.rng.randrange(len(media)) if len(media) > 1 and self.rng.random() < 0.25 else None
                rows.append(Comment(post=post, author=author, media_index=index,
                                    text=self.deck('comment', COMMENT_LINES), created_at=ts))
            # Replies live under one of that post's own comments.
        Comment.objects.bulk_create(rows, batch_size=500)
        top_level = [r for r in rows]
        replies = []
        for row in top_level:
            if self.rng.random() > 0.18:
                continue
            parent_author = row.author
            for _ in range(self.rng.randint(1, 2)):
                author = self.sita if self.rng.random() < 0.3 and parent_author != self.sita else self.rng.choice(self.others(parent_author))
                ts = self.later(row.created_at, 48)
                replies.append(Comment(post_id=row.post_id, author=author, parent=row, media_index=row.media_index,
                                       text=self.deck('reply', REPLY_LINES), created_at=ts))
        Comment.objects.bulk_create(replies, batch_size=500)
        self.comments = rows + replies
        for row in self.comments:
            self.shift(Comment, row, lambda r: r.created_at)
        counts = {}
        for row in self.comments:
            counts[row.post_id] = counts.get(row.post_id, 0) + 1
        for post in self.all_posts:
            post.comment_count = counts.get(post.id, 0)
        Post.objects.bulk_update(self.all_posts, ['comment_count'], batch_size=400)

    def pick(self, values, weights):
        return self.rng.choices(values, weights=weights, k=1)[0]

    # ------------------------------ reactions -----------------------------
    def reactions(self):
        KINDS = ['like', 'like', 'like', 'love', 'love', 'haha', 'wow', 'sad']
        seen = set()
        rows = []
        for post in self.all_posts:
            pool = self.others(post.author)
            reach = min(len(pool), 3 + self.followers.get(post.author.id, 0))
            for reactor in self.rng.sample(pool, self.rng.randint(2, max(3, min(reach, 14)))):
                key = (reactor.id, 'post', str(post.id))
                if key in seen:
                    continue
                seen.add(key)
                rows.append(Reaction(user=reactor, target_type='post', target_id=str(post.id),
                                     kind=self.rng.choice(KINDS), created_at=self.later(post.created_at, 240)))
            post.like_count = sum(1 for r in rows if r.target_type == 'post' and r.target_id == str(post.id))
            for item in (self.media_by_post.get(post.id) or []):
                if item.kind != 'image' or self.rng.random() > 0.3:
                    continue
                for reactor in self.rng.sample(pool, self.rng.randint(1, min(3, len(pool)))):
                    key = (reactor.id, 'media', f'{post.id}#m{item.position}')
                    if key in seen:
                        continue
                    seen.add(key)
                    rows.append(Reaction(user=reactor, target_type='media', target_id=f'{post.id}#m{item.position}',
                                         kind=self.rng.choice(KINDS), created_at=self.later(post.created_at, 240)))
                    item.like_count += 1
        for comment in self.rng.sample(self.comments, min(len(self.comments), 420)):
            for reactor in self.rng.sample(self.others(comment.author), self.rng.randint(1, 4)):
                key = (reactor.id, 'comment', str(comment.id))
                if key in seen:
                    continue
                seen.add(key)
                rows.append(Reaction(user=reactor, target_type='comment', target_id=str(comment.id),
                                     kind='like', created_at=self.later(comment.created_at, 120)))
                comment.like_count += 1
        Reaction.objects.bulk_create(rows, batch_size=1000)
        for row in rows:
            self.shift(Reaction, row, lambda r: r.created_at)
        Post.objects.bulk_update(self.all_posts, ['like_count'], batch_size=400)
        PostMedia.objects.bulk_update(self.post_media, ['like_count'], batch_size=400)
        Comment.objects.bulk_update(self.comments, ['like_count'], batch_size=400)
        self.reactions = rows

    # -------------------------------- saves -------------------------------
    def saves(self):
        rows = []
        recent = [p for p in self.all_posts if p.created_at > self.now - timedelta(days=60)]
        for user in self.users:
            for post in self.rng.sample(recent, self.rng.randint(2, 7)):
                if post.author_id != user.id:
                    rows.append(SavedPost(user=user, post=post))
        SavedPost.objects.bulk_create(rows, batch_size=400)
        for row in rows:
            self.shift(SavedPost, row, lambda r: self.later(self.now - timedelta(days=30), 1))
        self.saved = rows

    # ------------------------------- listings -----------------------------
    def listings(self):
        self.listing_rows = []
        sellers = self.weighted_authors()
        for index, (title, price, category, condition, description) in enumerate(LISTINGS):
            seller = self.rng.choice(sellers)
            city = self.profiles[seller.id].location or seller.city
            row = Listing(
                seller=seller, title=self.fill(title),
                description=self.fill(description),
                price=Decimal(price) * (1 + (self.rng.randint(-12, 15) / 100)),
                category=category, condition=condition, location=city,
                image_url=f'https://picsum.photos/seed/expo-listing-{index:02d}/1200/900',
                status='active' if index % 11 else 'sold')
            row.created_at = self.age(index, len(LISTINGS))
            self.listing_rows.append(row)
        Listing.objects.bulk_create(self.listing_rows, batch_size=200)
        images = []
        for row in self.listing_rows:
            for position in range(self.rng.randint(1, 3)):
                images.append(ListingImage(listing=row, position=position,
                                           url=f'https://picsum.photos/seed/expo-listing-{row.pk}-{position}/1200/900'))
        ListingImage.objects.bulk_create(images, batch_size=200)
        for row in self.listing_rows:
            self.shift(Listing, row, lambda r: r.created_at)

    # -------------------------------- wallets -----------------------------
    def wallets(self):
        self.wallets_by_user = {}
        rows = []
        for user in self.users:
            wallet = Wallet.objects.create(user=user, balance=Decimal('1000.00'))
            self.wallets_by_user[user.id] = wallet
            rows.append(Ledger(wallet=wallet, kind='credit', amount=Decimal('1000.00'), note='Welcome credit'))
        self.coin_requests = []
        for user in self.rng.sample(self.others(self.sita), 4):
            coins = self.pick([500, 1000, 2500], [0.5, 0.3, 0.2])
            status = self.pick(['approved', 'approved', 'pending', 'rejected'], [0.45, 0.2, 0.2, 0.15])
            request = CoinRequest(user=user, coins=coins, amount=Decimal(coins) * Decimal('1.25'),
                                  method=self.pick(['qr', 'esewa', 'khalti'], [0.5, 0.3, 0.2]),
                                  reference=f'DEMO{self.rng.randint(100000, 999999)}', status=status)
            request.save()
            self.coin_requests.append(request)
            if status == 'approved':
                rows.append(Ledger(wallet=self.wallets_by_user[user.id], kind='credit',
                                   amount=request.amount, note=f'{coins} coins purchased'))
        Ledger.objects.bulk_create(rows, batch_size=200)
        for row in rows:
            self.shift(Ledger, row, lambda r: self.now - timedelta(days=self.rng.random() * 90))
        balances = {}
        for row in rows:
            delta = row.amount if row.kind == 'credit' else -row.amount
            balances[row.wallet_id] = balances.get(row.wallet_id, Decimal('0')) + delta
        wallets = list(self.wallets_by_user.values())
        for wallet in wallets:
            wallet.balance = balances.get(wallet.id, Decimal('1000.00'))
        Wallet.objects.bulk_update(wallets, ['balance'], batch_size=200)

    # ------------------------------- messages -----------------------------
    def messages(self):
        pairs = [(self.sita, self.by_username[n]) for n in ('maya', 'arjun', 'priya', 'anish', 'deepa', 'bibek', 'mingma')]
        while len(pairs) < 30:
            a, b = self.rng.sample(self.users, 2)
            if (a.id, b.id) not in [(x.id, y.id) for x, y in pairs] and (b.id, a.id) not in [(x.id, y.id) for x, y in pairs]:
                pairs.append((a, b))
        links, conversations = [], []
        for a, b in pairs:
            conversation = Conversation.objects.create(last_message_at=None)
            Conversation.participants.through.objects.bulk_create(
                [Conversation.participants.through(conversation_id=conversation.pk, user_id=u.id) for u in (a, b)],
                ignore_conflicts=True)
            conversations.append((conversation, a, b))
        self.messages = []
        for order, (conversation, a, b) in enumerate(conversations):
            lines = self.rng.sample(CHAT_SCRIPTS, self.rng.randint(3, 8))
            script = [self.rng.choice(CHAT_OPENERS)]
            for opener, reply in lines:
                script += [opener, reply]
            script.append(self.rng.choice(CHAT_CLOSERS))
            span = timedelta(days=self.rng.random() * 18 + 1)
            start = self.now - span
            newest = start
            rows = []
            for index, text in enumerate(script):
                sender = a if index % 2 == 0 else b
                ts = start + (span * (index / max(1, len(script) - 1))) + timedelta(minutes=self.rng.randint(0, 25))
                ts = min(ts, self.now - timedelta(minutes=2))
                newest = max(newest, ts)
                incoming = sender is b
                unread_tail = order < 7 and incoming and index > len(script) - 4
                rows.append(Message(conversation=conversation, sender=sender, text=self.fill(text),
                                    created_at=ts, read_at=None if unread_tail else ts))
                self.messages.append((conversation, sender, ts, unread_tail))
            Message.objects.bulk_create(rows, batch_size=100)
            for row in rows:
                self.shift(Message, row, lambda r: r.created_at)
            conversation.last_message_at = newest
            conversation.newest = rows[-1]
            conversation.tail_unread = any(r.read_at is None for r in rows)
            conversation.sender = rows[-1].sender
        Conversation.objects.bulk_update(conversations := [c for c, _, _ in conversations],
                                         ['last_message_at'], batch_size=100)
        self.conversations = conversations

    # ------------------------------ promotions ----------------------------
    def promotions(self):
        self.promos = []
        targets = [('post', self.mixed, self.sita), ('post', self.rng.choice(self.photo_posts), self.sita)]
        for author in self.rng.sample(self.others(self.sita), 4):
            mine = [p for p in self.all_posts if p.author_id == author.id]
            if mine:
                targets.append(('post' if self.rng.random() < 0.7 else 'listing',
                                self.rng.choice(mine) if self.rng.random() < 0.7 else self.rng.choice(self.listing_rows),
                                author))
        statuses = ['active', 'active', 'active', 'paused', 'ended', 'active']
        for position, (kind, row, owner) in enumerate(targets):
            budget = self.pick([Decimal('250'), Decimal('500'), Decimal('1200'), Decimal('2500')],
                               [0.4, 0.3, 0.2, 0.1])
            promo = Promotion(
                owner=owner, target_type=kind, target_id=str(row.pk),
                category=row.category if kind == 'post' else row.category,
                age_min=18, age_max=self.pick([35, 45, 55, 65]),
                country='Nepal', city=self.profiles[owner.id].location,
                budget=budget, package=self.pick(['starter', 'growth', 'peak']),
                status=statuses[position % len(statuses)],
                impressions=self.rng.randint(1200, 46000), clicks=self.rng.randint(40, 1900))
            promo.ends_at = (self.now + timedelta(days=self.rng.randint(3, 21))
                             if statuses[position % len(statuses)] != 'ended'
                             else self.now - timedelta(days=self.rng.randint(2, 30)))
            promo.save()
            self.promos.append(promo)
            if promo.status in ('active', 'paused'):
                wallet = self.wallets_by_user[owner.id]
                debit = Ledger(wallet=wallet, kind='debit', amount=budget,
                               note=f'{promo.package.title()} promotion for {row.pk}')
                debit.save()
                self.shift(Ledger, debit, lambda r: self.now - timedelta(days=self.rng.randint(1, 20)))
                Wallet.objects.filter(pk=wallet.pk).update(balance=max(Decimal('0'), wallet.balance - budget))
            self.shift(Promotion, promo, lambda r: self.now - timedelta(days=self.rng.randint(2, 30)))

    # ------------------------------- reports ------------------------------
    def reports(self):
        self.reports_rows = []
        mix = [('post', self.rng.choice(self.photo_posts), 'spam', 'open'),
               ('post', self.rng.choice(self.all_posts), 'harassment', 'open'),
               ('comment', self.rng.choice(self.comments), 'hate', 'reviewing'),
               ('listing', self.rng.choice(self.listing_rows), 'scam', 'open'),
               ('post', self.hidden_posts[0], 'nudity', 'resolved'),
               ('comment', self.rng.choice(self.comments), 'spam', 'dismissed')]
        for kind, row, reason, status in mix:
            owner = row.author if kind == 'post' else (row.author if kind == 'comment' else row.seller)
            reporter = self.rng.choice(self.others(owner))
            report = Report(reporter=reporter, target_type=kind, target_id=str(row.pk), reason=reason,
                            details=f'{reason.title()} reported by @{reporter.username}.', status=status,
                            resolved_at=self.now - timedelta(days=self.rng.randint(1, 9)) if status in ('resolved', 'dismissed') else None)
            report.save()
            self.shift(Report, report, lambda r: self.now - timedelta(days=self.rng.randint(1, 24)))
            self.reports_rows.append(report)

    # -------------------------------- audit -------------------------------
    def audit(self):
        rows = []
        for post in self.hidden_posts[:2]:
            rows.append(AuditLog(actor=self.sita, action='auto_hide_post', target=f'post:{post.pk}',
                                 detail='3 distinct open reports'))
        for report in self.reports_rows:
            if report.status in ('resolved', 'dismissed'):
                rows.append(AuditLog(actor=self.sita, action=f'{report.status}_report',
                                     target=f'{report.target_type}:{report.target_id}', detail=report.reason))
        for request in self.coin_requests:
            if request.status == 'approved':
                rows.append(AuditLog(actor=self.sita, action='approve_coin_request',
                                     target=f'user:{request.user_id}', detail=f'{request.coins} coins'))
        AuditLog.objects.bulk_create(rows, batch_size=50)
        for row in rows:
            self.shift(AuditLog, row, lambda r: self.now - timedelta(days=self.rng.randint(1, 20)))

    # ---------------------------- notifications ---------------------------
    def notifications(self):
        """Every row is derived from something a person really did, and every row
        has a target, so a tap always lands somewhere instead of doing nothing."""
        recent = self.now - timedelta(days=RECENT_DAYS)
        rows = []

        def add(recipient, actor, kind, text, target_type, target_id, ts, read=True):
            if recipient is None or (actor is not None and recipient.pk == actor.pk):
                return
            rows.append(Notification(recipient=recipient, actor=actor, kind=kind, text=text[:240],
                                     target_type=target_type, target_id=str(target_id),
                                     read_at=ts if read else None, created_at=ts))

        for reaction in self.reactions:
            if reaction.target_type != 'post' or reaction.created_at < recent:
                continue
            post = self.posts_by_id.get(int(reaction.target_id)) if hasattr(self, 'posts_by_id') else None
            post = next((p for p in self.all_posts if p.id == int(reaction.target_id)), None)
            if post is None or self.rng.random() > 0.2:
                continue
            add(post.author, reaction.user, 'reaction',
                f'{reaction.user.username} reacted to your post.', 'post', post.id,
                reaction.created_at, reaction.created_at < self.now - timedelta(days=5))

        for comment in self.comments:
            if comment.created_at < recent or self.rng.random() > 0.45:
                continue
            if comment.parent_id:
                parent = comment.parent
                add(parent.author, comment.author, 'reply',
                    f'{comment.author.username} replied to your comment.', 'post', comment.post_id,
                    comment.created_at, comment.created_at < self.now - timedelta(days=5))
            else:
                post = next((p for p in self.all_posts if p.id == comment.post_id), None)
                add(post.author, comment.author, 'comment',
                    f'{comment.author.username} commented on your post.', 'post', comment.post_id,
                    comment.created_at, comment.created_at < self.now - timedelta(days=5))

        for follow in Follow.objects.all():
            ts = self.now - timedelta(days=self.rng.random() * RECENT_DAYS)
            kind = 'follow_request' if follow.status == 'pending' else 'follow'
            text = (f'{follow.follower.username} requested to follow you.' if kind == 'follow_request'
                    else f'{follow.follower.username} started following you.')
            add(follow.followee, follow.follower, kind, text, 'user', follow.follower_id, ts,
                ts < self.now - timedelta(days=4))

        for conversation in self.conversations:
            for _, sender, ts, unread in [m for m in self.messages if m[0] is conversation]:
                if not unread:
                    continue
                recipient = self.sita if sender != self.sita and conversation in [] else None
            pass

        for conversation, sender, ts, unread in self.messages:
            if not unread or ts < recent:
                continue
            recipient = next(u for u in [p for p in conversation.participants.all()] if u.id != sender.id)
            add(recipient, sender, 'message', f'{sender.username} sent you a message.', 'user', sender.id, ts, False)

        for request in self.coin_requests:
            if request.status == 'approved':
                add(request.user, self.sita, 'coins', f'Your purchase of {request.coins} coins was approved.',
                    'wallet', self.wallets_by_user[request.user.id].pk, request.created_at, True)
        for wallet in self.wallets_by_user.values():
            add(wallet.user, None, 'coins', 'Nrs 1,000 welcome credit added to your wallet.',
                'wallet', wallet.pk, wallet.created_at, True)

        Notification.objects.bulk_create(rows, batch_size=1000)
        for row in rows:
            self.shift(Notification, row, lambda r: r.created_at)

        # Sita's newest bell item has to be tappable: a reaction on the post the
        # browser suites open.
        fresh = Notification(
            recipient=self.sita, actor=self.by_username['maya'], kind='reaction',
            text='maya reacted to your post.', target_type='post', target_id=str(self.mixed.id),
            read_at=None, created_at=self.now - timedelta(minutes=22))
        fresh.save()
        Notification.objects.filter(pk=fresh.pk).update(created_at=fresh.created_at)
        self.notifs = rows + [fresh]

    # -------------------------------- report ------------------------------
    def report(self):
        counts = [
            ('members', User.objects.count()),
            ('photo posts', Post.objects.filter(media__kind='image').distinct().count()),
            ('reels', Post.objects.filter(media__kind='video').distinct().count()),
            ('media items', PostMedia.objects.count()),
            ('comments', Comment.objects.count()),
            ('reactions', Reaction.objects.count()),
            ('follows', Follow.objects.count()),
            ('notifications', Notification.objects.count()),
            ('listings', Listing.objects.count()),
            ('conversations', Conversation.objects.count()),
            ('messages', Message.objects.count()),
            ('promotions', Promotion.objects.count()),
            ('reports', Report.objects.count()),
        ]
        self.stdout.write(self.style.SUCCESS('  |  '.join(f'{k} {v}' for k, v in counts)))
