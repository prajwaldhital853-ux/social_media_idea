from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from apps.comments.models import Comment
from apps.follows.models import Follow
from apps.marketplace.models import Listing
from apps.messages.models import Conversation, Message
from apps.moderation.models import Report
from apps.notifications.models import Notification
from apps.posts.models import Post, PostMedia
from apps.profiles.models import Profile
from apps.promotions.models import Promotion
from apps.reactions.models import Reaction
from apps.saved.models import SavedPost
from apps.wallet.models import Transaction, Wallet

User = get_user_model()


class Command(BaseCommand):
    help = 'Seed believable demo records across every feature app (idempotent).'

    def handle(self, *args, **options):
        people = {}
        for username, name, city, email in [
            ('sita', 'Sita Karki', 'Kathmandu', 'sita@demo.test'),
            ('maya', 'Maya Gurung', 'Pokhara', 'maya@demo.test'),
            ('arjun', 'Arjun Thapa', 'Lalitpur', 'arjun@demo.test'),
            ('priya', 'Priya Sharma', 'Biratnagar', 'priya@demo.test'),
        ]:
            user, created = User.objects.get_or_create(
                username=username,
                defaults={'first_name': name.split()[0], 'last_name': name.split()[-1],
                          'city': city, 'country': 'Nepal', 'email': email, 'email_verified': True},
            )
            if created:
                user.set_password('exposing-demo-1')
                user.save()
            elif not user.email:
                # Older seeds left emails blank, which made email codes and Google
                # sign-in unaddressable; fill them in rather than re-seeding.
                user.email = email
                user.email_verified = True
                user.save(update_fields=['email', 'email_verified'])
            people[username] = user
            Profile.objects.get_or_create(user=user, defaults={'display_name': name, 'bio': f'{name} on Exposing.', 'location': city, 'verified': username == 'sita'})
        sita = people['sita']
        if not sita.is_superuser:
            sita.is_superuser = True
            sita.is_staff = True
            sita.save()

        for follower, followee in [('maya', 'sita'), ('arjun', 'sita'), ('sita', 'maya'), ('priya', 'maya')]:
            Follow.objects.get_or_create(follower=people[follower], followee=people[followee])

        posts = {}
        specs = [
            ('pokhara', sita, 'Weekend in Pokhara: a little clip from Phewa, then the rest of the roll.', 'public', [('video', 'https://cdn.example.com/clips/phewa.mp4', 5.0), ('image', 'https://picsum.photos/seed/phewa/1200/800', None)]),
            ('sunset', people['maya'], 'Golden hour over the lake. No filter needed.', 'public', [('image', 'https://picsum.photos/seed/golden/1200/800', None)]),
            ('rain', people['arjun'], 'Rain over New Road again. Traffic is a river.', 'public', []),
            ('crew', sita, 'Trail crew only: meet at the ridge at six.', 'followers', []),
        ]
        for key, author, text, audience, media in specs:
            post, _ = Post.objects.get_or_create(author=author, text=text, defaults={'audience': audience, 'place': 'Pokhara' if key == 'pokhara' else ''})
            posts[key] = post
            for position, (kind, url, duration) in enumerate(media):
                PostMedia.objects.get_or_create(post=post, position=position, defaults={'kind': kind, 'url': url, 'duration': duration})

        root, _ = Comment.objects.get_or_create(post=posts['pokhara'], author=people['maya'], text='That water color is unreal.')
        Comment.objects.get_or_create(post=posts['pokhara'], author=sita, parent=root, text='Right? Phewa at dawn.')
        Comment.objects.get_or_create(post=posts['sunset'], author=people['priya'], text='Saving this for my wallpaper.')

        for user, target_type, target_id, kind in [
            (people['maya'], 'post', str(posts['pokhara'].id), 'love'),
            (people['arjun'], 'post', str(posts['pokhara'].id), 'like'),
            (people['priya'], 'post', str(posts['sunset'].id), 'wow'),
            (sita, 'comment', str(root.id), 'like'),
            (people['maya'], 'media', f"{posts['pokhara'].id}#m1", 'love'),
        ]:
            Reaction.objects.update_or_create(user=user, target_type=target_type, target_id=target_id, defaults={'kind': kind})

        SavedPost.objects.get_or_create(user=sita, post=posts['sunset'])
        SavedPost.objects.get_or_create(user=people['priya'], post=posts['pokhara'])

        Listing.objects.get_or_create(seller=people['arjun'], title='Trekking pole pair, barely used', defaults={'description': 'Two seasons old, grips intact.', 'price': 2500, 'category': 'Outdoors', 'condition': 'Used - good', 'location': 'Lalitpur'})
        Listing.objects.get_or_create(seller=people['maya'], title='Handmade wool blanket', defaults={'description': 'Woven in Pokhara, 2x1.5m.', 'price': 4200, 'category': 'Home', 'condition': 'New', 'location': 'Pokhara'})

        for username in people:
            wallet, _ = Wallet.objects.get_or_create(user=people[username])
            Transaction.objects.get_or_create(wallet=wallet, kind='credit', amount=1000, defaults={'note': 'Welcome credit'})
        wallet = Wallet.objects.get(user=sita)
        Transaction.objects.get_or_create(wallet=wallet, kind='debit', amount=250, defaults={'note': 'Promotion budget'})

        Notification.objects.get_or_create(recipient=sita, actor=people['maya'], kind='reaction', target_type='post', target_id=str(posts['pokhara'].id), defaults={'text': 'Maya Gurung reacted to your post.'})
        Notification.objects.get_or_create(recipient=sita, actor=people['arjun'], kind='follow', defaults={'text': 'Arjun Thapa started following you.'})
        Notification.objects.get_or_create(recipient=people['maya'], actor=sita, kind='comment', target_type='post', target_id=str(posts['sunset'].id), defaults={'text': 'Sita Karki commented on your post.'})

        conversation = Conversation.objects.filter(participants=sita).filter(participants=people['maya']).first()
        if conversation is None:
            conversation = Conversation.objects.create()
            conversation.participants.set([sita, people['maya']])
        Message.objects.get_or_create(conversation=conversation, sender=people['maya'], text='Are we still on for the ridge hike?')
        Message.objects.get_or_create(conversation=conversation, sender=sita, text='Yes — six sharp, bring the good camera.')

        Report.objects.get_or_create(reporter=people['priya'], target_type='post', target_id=str(posts['rain'].id), reason='spam', defaults={'details': 'Repeated traffic posts.'})
        Promotion.objects.get_or_create(owner=sita, target_type='post', target_id=str(posts['pokhara'].id), defaults={'category': 'Travel', 'age_min': 18, 'age_max': 40, 'country': 'Nepal', 'budget': 250, 'status': 'active'})

        self.stdout.write(self.style.SUCCESS(
            f'Seeded: {User.objects.count()} users, {Post.objects.count()} posts, {Comment.objects.count()} comments, '
            f'{Reaction.objects.count()} reactions, {Follow.objects.count()} follows, {Listing.objects.count()} listings, '
            f'{Notification.objects.count()} notifications, {Message.objects.count()} messages.'
        ))