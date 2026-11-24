"""Build (or rebuild) the demo dataset the app opens on.

    manage.py seed_demo --purge      wipe the junk and lay a fresh showcase
    manage.py seed_demo              trim an oversized showcase, or lay one if missing

The showcase is 36 named Nepali members, 16 photo posts (single and multi image)
and 4 reels whose clips are cached first-party under MEDIA_ROOT/demo, and the
follow, comment, reaction, message, listing, wallet and moderation rows that put
those posts inside a real network. Twenty media is what a hosted demo can carry
on a free tier; ``--photos 500 --reels 110`` lays the big one locally. One
``random.Random`` drives every choice, so a rebuild produces the same demo
instead of a new one to re-test.
"""

import random
import shutil
import urllib.request
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from apps.accounts.demo_content import (
    BIOS, CATEGORIES, CHAT_CLOSERS, CHAT_OPENERS, CHAT_SCRIPTS, CLIPS, COMMENT_LINES,
    CORE_PEOPLE, COUNTS, LISTINGS, MIXED_POST_TEXT, MOODS, PEOPLE, PHOTO_ASIDES,
    PHOTO_LINES, PLACES, RAIN_POST_TEXT, REEL_ASIDES, REEL_LINES, REPLY_LINES, contacts_for,
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
# Core profiles kept across a content rebuild; seeded accounts cannot sign in.
KEEP = {'sita', 'maya', 'arjun', 'priya'}
WINDOW_DAYS = 120
# Activity younger than this still shows in the bell, so it has to be real.
RECENT_DAYS = 25
REACTION_KINDS = ['like', 'like', 'like', 'love', 'love', 'haha', 'wow', 'sad']
# Sample-video hosts filter bots in opposite directions, so a clip is fetched
# twice over rather than guessed once: filesamples.com and test-videos.co.uk
# answer a browser and refuse Python-urllib, media.w3.org is the other way round.
CLIP_AGENTS = (
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    'Python-urllib/3.12',
)


def mp4_duration(path):
    """Seconds from an mp4's mvhd box, because the reels feed shows a duration."""
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
        parser.add_argument('--photos', type=int, default=16, help='Photo posts to write.')
        parser.add_argument('--reels', type=int, default=4, help='Reels to write.')
        parser.add_argument('--prune-clips', action='store_true',
                            help='Delete cached demo reels this seed will not use, from MEDIA_ROOT/demo only.')

    def handle(self, *args, **options):
        self.photos = options['photos']
        self.reels = options['reels']
        self.prune_clips = options['prune_clips']
        self.rng = random.Random(SEED)
        self.now = timezone.now().replace(microsecond=0)
        self.decks = {}
        # The ledger is written by wallets() and promotions(), then stamped and
        # totalled once at the end, because balances are read off the ledger.
        self.ledger, self.ledger_stamps = [], []

        if options['purge'] or Post.objects.count() < self.photos:
            self.purge()
        else:
            if not self.trim():
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
            self.settle()
            self.reports()
            self.audit()
            self.notifications()
        self.report()

    # ------------------------------- helpers ------------------------------
    def fill(self, line):
        return line.replace('{place}', self.rng.choice(PLACES)).replace('{count}', str(self.rng.choice(COUNTS)))

    def deck(self, key, lines, asides=()):
        """Walk a shuffled deck, then recycle it with a distinct second sentence.

        Captions repeat far less often than the bank is long, which is what keeps
        500 posts from reading like one template.
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

    def pick(self, values, weights=None):
        if weights is None:
            return self.rng.choice(values)
        return self.rng.choices(values, weights=weights, k=1)[0]

    def age(self, index, total):
        """Recent-weighted timestamp, so page one looks like today."""
        share = (index + self.rng.random()) / total
        days = (share ** 2.2) * WINDOW_DAYS
        return self.now - timedelta(days=days, hours=self.rng.random() * 8)

    def later(self, ts, limit_hours=72):
        """A timestamp somewhere after ``ts`` and never in the future."""
        delta = timedelta(hours=limit_hours * self.rng.random() ** 2)
        return min(ts + delta, self.now - timedelta(minutes=self.rng.randint(1, 90)))

    def others(self, user):
        return [u for u in self.users if u.id != user.id]

    def create_stamped(self, model, rows, stamps, batch=500):
        """Insert in one query with the timestamps the demo needs.

        ``auto_now_add`` wins at insert time, so its clock is switched off for
        this one insert and the real dates go in with the rows. Rewriting them
        afterwards is not an option: the wallet ledger refuses UPDATE at the
        database level, and the same stamping path has to work for every table.
        """
        field = model._meta.get_field('created_at')
        for row, ts in zip(rows, stamps):
            row.created_at = ts
        field.auto_now_add = False
        try:
            model.objects.bulk_create(rows, batch_size=batch)
        finally:
            field.auto_now_add = True
        return rows

    # -------------------------------- purge -------------------------------
    def purge(self):
        """Drop every generated row and every member this command created.

        The rule for accounts is written on the row: a member the seeder made carries
        ``seeded=True`` and goes, and one who signed up from a browser does not, no
        matter which environment this runs in. That has to be the rule, because this
        command is a deploy step — the first version of it deleted every real account
        on every push, which is what an account disappearing actually looked like.

        The ledger's append-only rule is enforced by a database trigger, and a
        cascade from user deletion reaches it, so the trigger is muted for the
        length of this one transaction and put back before anything else runs.
        """
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('ALTER TABLE wallet_transaction DISABLE TRIGGER wallet_ledger_no_update')
                cursor.execute('ALTER TABLE wallet_transaction DISABLE TRIGGER wallet_ledger_no_delete')
                for model in (SavedListing, SavedPost, ListingImage, Listing, CoinRequest, Ledger,
                              Promotion, Report, AuditLog, Notification, Message, Conversation,
                              Reaction, Comment, PostMedia, Post, Follow, Wallet):
                    model.objects.all().delete()
                junk = User.objects.exclude(username__in=KEEP).filter(seeded=True)
                count = junk.count()
                junk.delete()
                spared = User.objects.filter(seeded=False).count()
                Profile.objects.filter(user__seeded=True).delete()
                # Lockouts and suspensions are reset for the demo cast only. Wiping
                # them for a real account here would undo a moderator's decision.
                User.objects.filter(seeded=True).update(
                    failed_attempts=0, locked_until=None, suspended_until=None, suspend_reason='')
                cursor.execute('ALTER TABLE wallet_transaction ENABLE TRIGGER wallet_ledger_no_update')
                cursor.execute('ALTER TABLE wallet_transaction ENABLE TRIGGER wallet_ledger_no_delete')
        kept = f' {spared} signed-up accounts were left alone.' if spared else ''
        self.stdout.write(f'Purged {count} seeded demo members and all generated content.{kept}')

    # ------------------------------- trim ---------------------------------
    def trim(self):
        """Cut an oversized showcase down to the requested size without rebuilding it.

        A purge lays the demo fresh, and it is the fresh part that costs the admin
        console its paper trail — so a showcase that only needs to get smaller takes
        the quiet path. The newest posts of each shape stay where they are, with the
        comments, reactions and bell rows already hanging off them, and only the
        surplus goes. Surplus means a post a seeded member wrote: nothing anyone
        made from a browser is ever eligible to be trimmed.
        """
        keep = set(Post.objects.filter(media__kind='image').order_by('-created_at')
                   .distinct().values_list('pk', flat=True)[:self.photos])
        keep |= set(Post.objects.filter(media__kind='video').order_by('-created_at')
                    .distinct().values_list('pk', flat=True)[:self.reels])
        surplus = list(Post.objects.exclude(pk__in=keep).filter(author__seeded=True)
                       .values_list('pk', flat=True))
        if not surplus:
            return 0
        # These three point at a post by its id in a string, so no cascade reaches
        # them: a campaign or a report left behind would open on nothing.
        targets = [str(pk) for pk in surplus]
        with transaction.atomic():
            Post.objects.filter(pk__in=surplus).delete()
            Notification.objects.filter(target_type='post', target_id__in=targets).delete()
            Promotion.objects.filter(target_type='post', target_id__in=targets).delete()
            Report.objects.filter(target_type='post', target_id__in=targets).delete()
        self.stdout.write(f'Trimmed {len(surplus)} demo posts down to the newest '
                          f'{self.photos} photo posts and {self.reels} reels.')
        return len(surplus)

    # ------------------------------- people -------------------------------
    def people(self):
        roster = [tuple(item) + (True,) for item in CORE_PEOPLE]
        roster += [tuple(item) + (False,) for item in PEOPLE]
        self.users, self.profiles, self.by_username = [], {}, {}
        for index, (username, first, last, city, province, portrait, verified, private, core) in enumerate(roster):
            user = User.objects.filter(username=username).first() or User(username=username)
            user.first_name, user.last_name = first, last
            user.city, user.country = city, 'Nepal'
            user.email, user.provider, user.email_verified = f'{username}@demo.test', 'email', True
            # What tells a purge that this account is the demo's to delete.
            user.seeded = True
            user.date_of_birth = datetime(1980 + (index * 7) % 22, (index % 12) + 1, (index % 27) + 1).date()
            user.is_superuser = user.is_staff = False
            user.set_unusable_password()
            user.save()
            # Signing a user up creates their profile row, so this writes into it
            # rather than inserting a second one.
            Profile.objects.update_or_create(
                user=user,
                defaults={
                    'display_name': f'{first} {last}', 'bio': BIOS[index % len(BIOS)],
                    'avatar_url': f'https://randomuser.me/api/portraits/{portrait}.jpg',
                    'cover_url': f'https://picsum.photos/seed/expo-{username}-cover/1600/500',
                    'location': city, 'province': province, 'verified': verified,
                    'is_private': private,
                    **contacts_for(username, index),
                    'two_step': False,
                })
            profile = Profile.objects.get(user=user)
            self.users.append(user)
            self.profiles[user.id] = profile
            self.by_username[username] = user
        self.sita = self.by_username['sita']
        self.pool = self.weighted_authors()
        self.stdout.write(f'Seeded {len(self.users)} members.')

    def weighted_authors(self):
        pool = []
        for user in self.users:
            pool.extend([user] * (3 if self.profiles[user.id].verified else 1))
        return pool

    # -------------------------------- graph -------------------------------
    def follows(self):
        pairs, pending, rows, stamps = set(), 0, [], []
        for follower in self.users:
            for _ in range(self.rng.randint(6, 18)):
                followee = self.rng.choice(self.pool)
                if followee.id == follower.id or (follower.id, followee.id) in pairs:
                    continue
                pairs.add((follower.id, followee.id))
                status = 'accepted'
                if self.profiles[followee.id].is_private and pending < 6 and self.rng.random() < 0.5:
                    status, pending = 'pending', pending + 1
                rows.append(Follow(follower_id=follower.id, followee_id=followee.id, status=status))
                stamps.append(self.now - timedelta(days=self.rng.random() * WINDOW_DAYS))
        self.create_stamped(Follow, rows, stamps)
        self.followers = {}
        for row in rows:
            if row.status == 'accepted':
                self.followers[row.followee_id] = self.followers.get(row.followee_id, 0) + 1

    # -------------------------------- posts -------------------------------
    def fetch_clip(self, target, sources):
        """Write the first source that actually serves an mp4; keep a bad body out of the folder."""
        partial = target.with_suffix('.part')
        for url in sources:
            for agent in CLIP_AGENTS:
                try:
                    request = urllib.request.Request(url, headers={'User-Agent': agent})
                    with urllib.request.urlopen(request, timeout=120) as response:
                        blob = response.read()
                except OSError:
                    continue
                # An HTML block page or a CDN notice would otherwise become the reel.
                if blob[4:8] != b'ftyp':
                    continue
                partial.write_bytes(blob)
                partial.replace(target)
                return True
        return False

    def reuse_clip(self, target, saved):
        """A dead sample host must not cost the deploy: show a clip we already have."""
        for donor in saved:
            shutil.copyfile(donor, target)
            self.stdout.write(f'  {target.name} served from {donor.name}')
            return
        shipped = settings.BASE_DIR / 'demo_clips' / 'clip-fallback.mp4'
        if shipped.exists():
            shutil.copyfile(shipped, target)
            self.stdout.write(f'  {target.name} served from the shipped fallback clip')
            return
        raise CommandError(
            f'No demo clip could be fetched for {target.name}. Every sample host is unreachable '
            'and there is nothing to copy; add backend/demo_clips/clip-fallback.mp4 or fix the network.'
        )

    def ensure_clips(self):
        """Cache the demo reels first-party so no clip depends on a third host.

        Only as many distinct files as the reels spread over, because every one of
        them is a fetch and megabytes on a hosted disk — and a reel is happy to
        reuse a clip it already has.
        """
        folder = Path(settings.MEDIA_ROOT) / 'demo'
        folder.mkdir(parents=True, exist_ok=True)
        # Two are the floor: the showcase post and the single-video post on page
        # one want different clips, however few reels are asked for.
        wanted = CLIPS[:max(2, min(len(CLIPS), self.reels))]
        if self.prune_clips:
            keep = {name for name, _ in wanted}
            for stale in folder.glob('*.mp4'):
                if stale.name in keep:
                    continue
                stale.unlink()
                self.stdout.write(f'Pruned {stale.name} from the media disk')
        clips, saved = [], []
        for name, sources in wanted:
            target = folder / name
            if not target.exists():
                self.stdout.write(f'Fetching demo clip {name}')
                if not self.fetch_clip(target, sources):
                    self.reuse_clip(target, saved)
            saved.append(target)
            clips.append((f'/media/demo/{name}', mp4_duration(target)))
        return clips

    def posts(self):
        self.clips = self.ensure_clips()
        rows, stamps, shapes = [], [], []

        def build(author, text, place, mood, category, ts, followers_only=False, public=False):
            hidden = self.rng.random() < 0.07
            private = self.profiles[author.id].is_private
            rows.append(Post(
                author=author, text=text, place=place, mood=mood, category=category,
                audience='public' if public else ('followers' if private or followers_only or hidden else 'public')))
            stamps.append(ts)
            return len(rows) - 1

        # The mixed video+photos post goes in first and dated newest: the browser
        # suites open it straight off the first feed page. Same for the single
        # video reel the feed autoplay checks look for.
        mixed_at = self.now - timedelta(minutes=40)
        self.mixed_index = build(self.sita, MIXED_POST_TEXT, 'Pokhara', 'happy', 'Travel',
                                 mixed_at, public=True)
        self.rain_index = build(self.by_username['arjun'], RAIN_POST_TEXT, 'Kathmandu', 'tired',
                                'City', self.now - timedelta(minutes=70), public=True)

        counts = [(1, 0.45), (2, 0.30), (3, 0.17), (4, 0.08)]
        for index in range(self.photos):
            roll, total, images = self.rng.random(), 0.0, 1
            for size, weight in counts:
                total += weight
                if roll <= total:
                    images = size
                    break
            position = build(
                self.rng.choice(self.pool), self.deck('photo', PHOTO_LINES, PHOTO_ASIDES),
                self.rng.choice(PLACES) if self.rng.random() < 0.55 else '',
                self.rng.choice(MOODS) if self.rng.random() < 0.45 else '',
                self.rng.choice(CATEGORIES), self.age(index, self.photos))
            shapes.append((position, images, index))
        for index in range(self.reels):
            position = build(
                self.rng.choice(self.pool), self.deck('reel', REEL_LINES, REEL_ASIDES),
                self.rng.choice(PLACES) if self.rng.random() < 0.7 else '', '',
                self.rng.choice(['Travel', 'Nature', 'Music', 'City', 'Food', 'Sports']),
                self.age(index, self.reels))
            shapes.append((position, 0, -1 - index))

        self.create_stamped(Post, rows, stamps)
        self.all_posts = rows
        self.posts_by_id = {post.id: post for post in rows}

        media = []
        url, duration = self.clips[0]
        media.append(PostMedia(post=rows[self.mixed_index], position=0, kind='video', url=url, duration=duration))
        # Eight items on the showcase post: the mosaic then shows five cells and
        # a +3, which is the layout a reviewer of a carousel wants to see.
        for position in range(1, 8):
            media.append(PostMedia(post=rows[self.mixed_index], position=position, kind='image',
                                   url=f'https://picsum.photos/seed/expo-pokhara-{position}/1600/1000'))
        clip, seconds = self.clips[1]
        media.append(PostMedia(post=rows[self.rain_index], position=0, kind='video', url=clip, duration=seconds))
        for position, images, index in shapes:
            post = rows[position]
            if index < 0:
                clip, seconds = self.clips[(-index - 1) % len(self.clips)]
                media.append(PostMedia(post=post, position=0, kind='video', url=clip, duration=seconds))
                continue
            for slot in range(images):
                ratio = self.rng.choice(['1080/1350', '1600/900', '1080/1080', '1400/1000'])
                media.append(PostMedia(post=post, position=slot, kind='image',
                                       url=f'https://picsum.photos/seed/expo-{index:03d}-{slot}/{ratio}'))
        PostMedia.objects.bulk_create(media, batch_size=500)
        self.media_by_post = {}
        for item in media:
            self.media_by_post.setdefault(item.post_id, []).append(item)
        self.mixed = rows[self.mixed_index]
        self.photo_posts = [rows[p] for p, images, index in shapes if images]
        self.reel_posts = [rows[p] for p, images, index in shapes if not images]
        # The two anchor posts stay live: moderation takes its samples from the rest.
        self.hidden_posts = self.rng.sample(self.all_posts[2:], 4)
        Post.objects.filter(pk__in=[p.pk for p in self.hidden_posts]).update(status='hidden')

    # ------------------------------- comments -----------------------------
    def comments(self):
        tops, top_stamps = [], []
        for post in self.all_posts:
            for _ in range(self.pick([0, 1, 2, 3, 4, 6, 8], [0.18, 0.22, 0.20, 0.15, 0.11, 0.08, 0.06])):
                media = self.media_by_post.get(post.id) or []
                index = self.rng.randrange(len(media)) if len(media) > 1 and self.rng.random() < 0.25 else None
                ts = self.later(post.created_at, 96)
                tops.append(Comment(
                    post=post, author=self.rng.choice(self.others(post.author)), media_index=index,
                    text=self.deck('comment', COMMENT_LINES, PHOTO_ASIDES), created_at=ts))
                top_stamps.append(ts)
        # Written before the replies: a reply can only point at a parent that has
        # an id, and bulk inserts refuse unsaved rows.
        self.create_stamped(Comment, tops, top_stamps)

        replies, reply_stamps = [], []
        for parent in [row for row in tops if self.rng.random() < 0.18]:
            post = self.posts_by_id[parent.post_id]
            for _ in range(self.rng.randint(1, 2)):
                # A third of replies are the post's own author answering
                # underneath; nobody replies to themselves.
                author = post.author if (post.author_id != parent.author_id
                                         and self.rng.random() < 0.35) \
                    else self.rng.choice(self.others(parent.author))
                ts = self.later(parent.created_at, 48)
                replies.append(Comment(post=post, author=author, parent=parent,
                                       text=self.deck('reply', REPLY_LINES), created_at=ts))
                reply_stamps.append(ts)
        self.create_stamped(Comment, replies, reply_stamps)

        rows = tops + replies
        self.comments = rows
        self.comments_by_id = {row.pk: row for row in rows}
        counts = {}
        for row in rows:
            counts[row.post_id] = counts.get(row.post_id, 0) + 1
        for post in self.all_posts:
            post.comment_count = counts.get(post.id, 0)
        Post.objects.bulk_update(self.all_posts, ['comment_count'], batch_size=400)

    # ------------------------------- reactions ----------------------------
    def reactions(self):
        seen, rows, stamps = set(), [], []
        post_likes = {}
        media_likes, comment_likes = {}, {}

        def react(user, target_type, target_id, kind, ts):
            key = (user.id, target_type, str(target_id))
            if key in seen:
                return False
            seen.add(key)
            rows.append(Reaction(user=user, target_type=target_type, target_id=str(target_id),
                                 kind=kind, created_at=ts))
            stamps.append(ts)
            return True

        for post in self.all_posts:
            pool = self.others(post.author)
            reach = max(2, min(len(pool), 2 + self.followers.get(post.author.id, 0)))
            for reactor in self.rng.sample(pool, self.rng.randint(2, reach)):
                if react(reactor, 'post', post.id, self.rng.choice(REACTION_KINDS),
                         self.later(post.created_at, 240)):
                    post_likes[post.id] = post_likes.get(post.id, 0) + 1
            for item in (self.media_by_post.get(post.id) or []):
                if item.kind != 'image' or self.rng.random() > 0.3:
                    continue
                for reactor in self.rng.sample(pool, self.rng.randint(1, min(3, len(pool)))):
                    if react(reactor, 'media', f'{post.id}#m{item.position}',
                             self.rng.choice(REACTION_KINDS), self.later(post.created_at, 240)):
                        media_likes[item.pk] = media_likes.get(item.pk, 0) + 1
        for comment in self.rng.sample(self.comments, min(len(self.comments), 420)):
            pool = self.others(comment.author)
            for reactor in self.rng.sample(pool, self.rng.randint(1, min(4, len(pool)))):
                if react(reactor, 'comment', comment.id, 'like', self.later(comment.created_at, 120)):
                    comment_likes[comment.id] = comment_likes.get(comment.id, 0) + 1

        self.create_stamped(Reaction, rows, stamps)
        self.reaction_rows = rows
        for post in self.all_posts:
            post.like_count = post_likes.get(post.id, 0)
        Post.objects.bulk_update(self.all_posts, ['like_count'], batch_size=400)
        for item in self.media_by_post.values():
            for media in item:
                media.like_count = media_likes.get(media.pk, 0)
        PostMedia.objects.bulk_update([m for group in self.media_by_post.values() for m in group],
                                      ['like_count'], batch_size=400)
        for comment in self.comments:
            comment.like_count = comment_likes.get(comment.pk, 0)
        Comment.objects.bulk_update(self.comments, ['like_count'], batch_size=400)

    # --------------------------------- saves ------------------------------
    def saves(self):
        recent = [p for p in self.all_posts if p.created_at > self.now - timedelta(days=60)]
        rows, stamps = [], []
        for user in self.users:
            for post in self.rng.sample(recent, self.rng.randint(2, min(7, len(recent)))):
                if post.author_id != user.id:
                    rows.append(SavedPost(user=user, post=post))
                    stamps.append(self.later(post.created_at, 240))
        self.create_stamped(SavedPost, rows, stamps)

    # -------------------------------- listings ----------------------------
    def listings(self):
        rows, stamps = [], []
        for index, (title, price, category, condition, description) in enumerate(LISTINGS):
            seller = self.rng.choice(self.pool)
            city = self.profiles[seller.id].location or seller.city
            rows.append(Listing(
                seller=seller, title=self.fill(title), description=self.fill(description),
                price=(Decimal(price) * (1 + Decimal(self.rng.randint(-12, 15)) / Decimal(100))).quantize(Decimal('0.01')),
                category=category, condition=condition, location=city,
                image_url=f'https://picsum.photos/seed/expo-listing-{index:02d}/1200/900',
                status='active' if index % 11 else 'sold'))
            stamps.append(self.age(index, len(LISTINGS)))
        self.create_stamped(Listing, rows, stamps)
        self.listing_rows = rows
        images = []
        for row in rows:
            for position in range(self.rng.randint(1, 3)):
                images.append(ListingImage(listing=row, position=position,
                                           url=f'https://picsum.photos/seed/expo-listing-{row.pk}-{position}/1200/900'))
        ListingImage.objects.bulk_create(images, batch_size=300)

    # -------------------------------- wallets -----------------------------
    def ledger_row(self, wallet, kind, amount, note, ts):
        """Queue one append-only ledger entry and track the running balance.

        Balances are only ever the sum of the ledger, so a spend can be checked
        against funds already on the wallet before it is written.
        """
        amount = Decimal(amount).quantize(Decimal('0.01'))
        self.totals[wallet.id] = self.totals.get(wallet.id, Decimal('0')) + (
            amount if kind == 'credit' else -amount)
        self.ledger.append(Ledger(wallet=wallet, kind=kind, amount=amount, note=note[:200]))
        self.ledger_stamps.append(ts)

    def wallets(self):
        # Signing a user up creates their wallet, and a purge may have removed it,
        # so every member is matched to one rather than given a second row.
        self.wallets_by_user = {}
        self.totals = {}
        # Wallet zero is the welcome credit, so remember when each one landed.
        self.credits = {}

        for user in self.users:
            wallet, _ = Wallet.objects.get_or_create(user=user, defaults={'currency': 'NPR'})
            self.wallets_by_user[user.id] = wallet
            ts = self.now - timedelta(days=self.rng.randint(30, 120))
            self.ledger_row(wallet, 'credit', Decimal('1000.00'), 'Welcome credit', ts)
            self.credits[wallet.id] = ts

        self.coin_requests = []
        for user in self.rng.sample(self.others(self.sita), 4):
            coins = self.pick([500, 1000, 2500], [0.5, 0.3, 0.2])
            status = self.pick(['approved', 'pending', 'rejected'], [0.6, 0.2, 0.2])
            ts = self.now - timedelta(days=self.rng.randint(1, 40))
            request = CoinRequest(user=user, coins=coins,
                                  amount=(Decimal(coins) * Decimal('1.25')).quantize(Decimal('0.01')),
                                  method=self.pick(['qr', 'esewa', 'khalti'], [0.5, 0.3, 0.2]),
                                  reference=f'DEMO{self.rng.randint(100000, 999999)}',
                                  status=status, created_at=ts,
                                  reviewed_at=self.later(ts, 24) if status != 'pending' else None)
            self.coin_requests.append(request)
            if status == 'approved':
                self.ledger_row(self.wallets_by_user[user.id], 'credit', request.amount,
                                f'{coins} coins purchased', self.later(ts, 24))
        CoinRequest.objects.bulk_create(self.coin_requests, batch_size=50)

    def settle(self):
        """Stamp the ledger once, then write the totals it implies."""
        self.create_stamped(Ledger, self.ledger, self.ledger_stamps)
        for user, wallet in self.wallets_by_user.items():
            wallet.balance = self.totals.get(wallet.id, Decimal('0'))
        Wallet.objects.bulk_update(list(self.wallets_by_user.values()), ['balance'], batch_size=100)

    # -------------------------------- messages ----------------------------
    def messages(self):
        partners = [self.by_username[name] for name in ('maya', 'arjun', 'priya', 'anish', 'deepa', 'bibek', 'mingma')]
        pairs = [(self.sita, partner) for partner in partners]
        linked = {(self.sita.id, p.id) for p in partners}
        while len(pairs) < 30:
            a, b = self.rng.sample(self.users, 2)
            if a.id == b.id or (a.id, b.id) in linked or (b.id, a.id) in linked:
                continue
            linked.add((a.id, b.id))
            pairs.append((a, b))

        self.messages = []
        conversations = []
        for order, (a, b) in enumerate(pairs):
            conversation = Conversation.objects.create()
            Conversation.participants.through.objects.bulk_create(
                [Conversation.participants.through(conversation_id=conversation.pk, user_id=user.id)
                 for user in (a, b)], ignore_conflicts=True)
            script = [self.rng.choice(CHAT_OPENERS)]
            for opener, reply in self.rng.sample(CHAT_SCRIPTS, self.rng.randint(3, 8)):
                script += [opener, reply]
            script.append(self.rng.choice(CHAT_CLOSERS))

            span = timedelta(days=self.rng.random() * 18 + 1)
            start = self.now - span
            rows, stamps = [], []
            for index, text in enumerate(script):
                sender = a if index % 2 == 0 else b
                ts = min(start + span * (index / max(1, len(script) - 1)) + timedelta(minutes=self.rng.randint(0, 20)),
                         self.now - timedelta(minutes=2))
                # A few of sita's threads keep unread incoming mail so the badge means something.
                unread = order < 7 and sender is b and index > len(script) - 4
                rows.append(Message(conversation=conversation, sender=sender, text=self.fill(text),
                                    read_at=None if unread else ts))
                stamps.append(ts)
                self.messages.append((conversation, sender, ts, unread))
            self.create_stamped(Message, rows, stamps)
            conversation.last_message_at = stamps[-1]
            conversations.append(conversation)
        Conversation.objects.bulk_update(conversations, ['last_message_at'], batch_size=100)

    # ------------------------------- promotions ---------------------------
    def promotions(self):
        targets = [('post', self.mixed), ('post', self.rng.choice(self.photo_posts))]
        for owner in self.rng.sample(self.others(self.sita), 4):
            mine = [p for p in self.all_posts if p.author_id == owner.id]
            listings = [l for l in self.listing_rows if l.seller_id == owner.id]
            if mine or listings:
                kind, row = ('post', self.rng.choice(mine)) if (mine and not listings or self.rng.random() < 0.7) \
                    else ('listing', self.rng.choice(listings))
                targets.append((kind, row, owner))
        statuses = ['active', 'active', 'active', 'paused', 'ended', 'active']
        rows, stamps = [], []
        self.promos = []
        for position, item in enumerate(targets):
            kind = item[0]
            row = item[1]
            owner = item[2] if len(item) > 2 else (row.author if kind == 'post' else row.seller)
            budget = self.pick([Decimal('250'), Decimal('500'), Decimal('1200'), Decimal('2500')],
                               [0.4, 0.3, 0.2, 0.1])
            status = statuses[position % len(statuses)]
            promo = Promotion(
                owner=owner, target_type=kind, target_id=str(row.pk), category=row.category,
                age_min=18, age_max=self.pick([35, 45, 55, 65]), country='Nepal',
                city=self.profiles[owner.id].location, budget=budget, package=self.pick(['starter', 'growth', 'peak']),
                status=status, impressions=self.rng.randint(1200, 46000), clicks=self.rng.randint(40, 1900),
                ends_at=(self.now - timedelta(days=self.rng.randint(2, 30)) if status == 'ended'
                         else self.now + timedelta(days=self.rng.randint(3, 21))))
            rows.append(promo)
            stamps.append(self.now - timedelta(days=self.rng.randint(2, 30)))
            self.promos.append(promo)
            if status in ('active', 'paused'):
                wallet = self.wallets_by_user[owner.id]
                spent = self.totals.get(wallet.id, Decimal('0'))
                if spent < budget:
                    # A campaign never runs on an empty wallet: fund it first.
                    self.ledger_row(wallet, 'credit', budget - spent + Decimal('800.00'),
                                    'Added funds', self.now - timedelta(days=self.rng.randint(6, 12)))
                self.ledger_row(wallet, 'debit', budget,
                                f'{promo.package.title()} promotion on {kind} {row.pk}',
                                self.now - timedelta(days=self.rng.randint(1, 5)))
        self.create_stamped(Promotion, rows, stamps)

    # -------------------------------- reports -----------------------------
    def reports(self):
        mix = [('post', self.rng.choice(self.photo_posts), 'spam', 'open'),
               ('post', self.rng.choice(self.all_posts), 'harassment', 'open'),
               ('comment', self.rng.choice(self.comments), 'hate', 'reviewing'),
               ('listing', self.rng.choice(self.listing_rows), 'scam', 'open'),
               ('post', self.hidden_posts[0], 'nudity', 'resolved'),
               ('comment', self.rng.choice(self.comments), 'spam', 'dismissed')]
        rows, stamps = [], []
        for kind, row, reason, status in mix:
            owner = row.author if kind != 'listing' else row.seller
            reporter = self.rng.choice(self.others(owner))
            ts = self.now - timedelta(days=self.rng.randint(1, 24))
            rows.append(Report(reporter=reporter, target_type=kind, target_id=str(row.pk), reason=reason,
                               details=f'{reason.title()} reported by @{reporter.username}.', status=status,
                               resolved_at=ts + timedelta(hours=self.rng.randint(2, 40))
                               if status in ('resolved', 'dismissed') else None, created_at=ts))
            stamps.append(ts)
        self.create_stamped(Report, rows, stamps)
        self.report_rows = rows

    # --------------------------------- audit ------------------------------
    def audit(self):
        rows, stamps = [], []

        def log(action, target, detail, ts):
            rows.append(AuditLog(actor=self.sita, action=action, target=target, detail=detail, created_at=ts))
            stamps.append(ts)

        for post in self.hidden_posts[:2]:
            ts = self.now - timedelta(days=self.rng.randint(1, 20))
            log('auto_hide_post', f'post:{post.pk}', '3 distinct open reports', ts)
        for report in self.report_rows:
            if report.status in ('resolved', 'dismissed'):
                log(f'{report.status}_report', f'{report.target_type}:{report.target_id}',
                    report.reason, report.resolved_at)
        for request in self.coin_requests:
            if request.status == 'approved':
                log('approve_coin_request', f'user:{request.user_id}', f'{request.coins} coins',
                    request.reviewed_at)
        self.create_stamped(AuditLog, rows, stamps)

    # ------------------------------ notifications -------------------------
    def notifications(self):
        """Every bell row comes from something a member really did, and every row
        carries a target, so tapping one always lands somewhere."""
        rows = []

        def add(recipient, actor, kind, text, target_type, target_id, ts, read):
            if recipient is None or (actor is not None and recipient.pk == actor.pk):
                return
            rows.append(Notification(recipient=recipient, actor=actor, kind=kind, text=text[:240],
                                     target_type=target_type, target_id=str(target_id),
                                     read_at=ts if read else None, created_at=ts))

        cutoff = self.now - timedelta(days=RECENT_DAYS)
        read_line = self.now - timedelta(days=5)

        for reaction in self.reaction_rows:
            ts = reaction.created_at
            if reaction.target_type != 'post' or ts < cutoff or self.rng.random() > 0.2:
                continue
            post = self.posts_by_id.get(int(reaction.target_id))
            if post:
                add(post.author, reaction.user, 'reaction',
                    f'{reaction.user.username} reacted to your post.', 'post', post.id, ts, ts < read_line)

        for comment in self.comments:
            ts = comment.created_at
            if ts < cutoff or self.rng.random() > 0.45:
                continue
            post = self.posts_by_id.get(comment.post_id)
            if comment.parent_id:
                parent = self.comments_by_id.get(comment.parent_id)
                if parent:
                    add(parent.author, comment.author, 'reply',
                        f'{comment.author.username} replied to your comment.', 'post', comment.post_id,
                        ts, ts < read_line)
            elif post:
                add(post.author, comment.author, 'comment',
                    f'{comment.author.username} commented on your post.', 'post', post.id, ts, ts < read_line)

        for follow in Follow.objects.select_related('follower', 'followee'):
            ts = follow.created_at
            if ts < cutoff:
                continue
            pending = follow.status == 'pending'
            add(follow.followee, follow.follower,
                'follow_request' if pending else 'follow',
                f'{follow.follower.username} {"requested to follow" if pending else "started following"} you.',
                'user', follow.follower_id, ts, ts < read_line)

        # One message notification per thread tail that is still unread.
        for conversation, sender, ts, unread in self.messages:
            if not unread or ts < cutoff:
                continue
            for recipient in conversation.participants.exclude(pk=sender.pk):
                add(recipient, sender, 'message', f'{sender.username} sent you a message.',
                    'user', sender.id, ts, False)

        for request in self.coin_requests:
            if request.status == 'approved':
                add(request.user, self.sita, 'coins', f'Your purchase of {request.coins} coins was approved.',
                    'wallet', self.wallets_by_user[request.user.id].pk, request.reviewed_at, True)
        for user in self.users:
            wallet = self.wallets_by_user[user.id]
            add(user, None, 'coins', 'Nrs 1,000 welcome credit added to your wallet.',
                'wallet', wallet.pk, self.credits[wallet.id], True)

        # Sita's newest bell item has to be tappable in the QA suite: a reaction
        # on the post the browser opens first.
        add(self.sita, self.by_username['maya'], 'reaction', 'maya reacted to your post.',
            'post', self.mixed.pk, self.now - timedelta(minutes=22), False)

        # Cap the unread pile so badges stay believable for a busy member.
        by_recipient = {}
        for row in rows:
            by_recipient.setdefault(row.recipient_id, []).append(row)
        for recipient_rows in by_recipient.values():
            recipient_rows.sort(key=lambda r: r.created_at, reverse=True)
            unread = 0
            for row in recipient_rows:
                if row.read_at is None:
                    unread += 1
                    if unread > 12:
                        row.read_at = row.created_at
        self.create_stamped(Notification, rows, [r.created_at for r in rows], batch=1000)

    # --------------------------------- report -----------------------------
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
        self.stdout.write(self.style.SUCCESS('  |  '.join(f'{name} {value}' for name, value in counts)))
