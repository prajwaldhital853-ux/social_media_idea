import { Database, Follow, Reaction, ReactionKind, Settings, User } from './types';
import { DAY, hash } from './utils';

const KINDS: ReactionKind[] = ['like', 'like', 'like', 'love', 'haha', 'wow', 'sad'];

export function seed(): Database {
  const now = Date.now();
  const M = 60000;

  const mk = (
    id: string, email: string, username: string, name: string,
    extra: Partial<User> = {}
  ): User => ({
    id, email, username, name,
    role: 'user', verified: false, emailVerified: true, susp: null,
    provider: 'email', dob: '1996-04-12', country: 'Nepal', province: 'Bagmati', city: 'Kathmandu',
    bio: '', twoStep: false, joined: now - 200 * DAY, coins: 0, warning: null,
    ...extra
  });

  const users: User[] = [
    mk('u_admin', 'admin@exposing.demo', 'exposing_team', 'Exposing Team', {
      role: 'superadmin', verified: true, twoStep: true, coins: 0,
      bio: 'Official Exposing account. Platform news and support.', joined: now - 400 * DAY
    }),
    mk('u_mod', 'mod@exposing.demo', 'exposing_mod', 'Exposing Moderator', {
      role: 'moderator', verified: true, twoStep: true, joined: now - 300 * DAY
    }),
    mk('u1', 'sita@demo.test', 'sita_k', 'Sita Karki', { verified: true, dob: '1994-02-08', city: 'Pokhara', province: 'Gandaki', coins: 260, bio: 'Lakeside walks, film rolls, and slow mornings.' }),
    mk('u2', 'bikash@demo.test', 'bikash_s', 'Bikash Shrestha', { dob: '1990-11-23', coins: 40, bio: 'Keyboard shortcuts and keyboard coffee.' }),
    mk('u3', 'anju@demo.test', 'anju_t', 'Anju Tamang', { verified: true, dob: '1998-07-30', city: 'Patan', bio: 'Heritage corners and morning tea.' }),
    mk('u4', 'rojan@demo.test', 'rojan_b', 'Rojan B', { dob: '2001-01-17', coins: 0, bio: 'Hungry, always.', private: true }),
    mk('u5', 'maya@demo.test', 'maya_g', 'Maya Gurung', { verified: true, dob: '1993-09-02', city: 'Pokhara', province: 'Gandaki', coins: 120, bio: 'Weekends on the water.' }),
    mk('u6', 'elon@demo.test', 'elon_musk', 'Elon Musk', { verified: true, provider: 'google', dob: '1971-06-28', country: 'United States', province: 'Texas', city: 'Austin', coins: 0 }),
    mk('u7', 'tech@demo.test', 'tech_news', 'Tech News', { verified: true, provider: 'facebook', dob: '1985-03-15', country: 'United Kingdom', city: 'London', coins: 0 }),
    mk('u8', 'kathmandu@demo.test', 'ktm_daily', 'Kathmandu Daily', { verified: true, dob: '1988-12-01', coins: 300, bio: 'The city, daily.' }),
    mk('u9', 'chef@demo.test', 'nima_kitchen', 'Nima Kitchen', { verified: true, dob: '1992-05-21', coins: 90, bio: 'Newari feast, seconds mandatory.' }),
    mk('u10', 'lens@demo.test', 'himal_lens', 'Himal Lens', { verified: true, dob: '1989-08-14', coins: 500, bio: 'Golden hour, no filter.', cover: 'https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=1600&q=80' }),
    mk('u11', 'goal@demo.test', 'goalnepal', 'Goal Nepal', { dob: '1997-10-09', coins: 0, bio: 'Grassroots football.' })
  ];

  const posts = [
    {
      id: 'p_mix', uid: 'u5',
      text: 'Weekend in Pokhara: a little clip from Phewa, then the rest of the roll. Same trip, same light. 🚤🏔️',
      media: [
        { type: 'video' as const, src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', dur: 5 },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1605640840605-14ac1855827b?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&q=80' }
      ],
      ts: now - 12 * M, status: 'live' as const
    },
    {
      id: 'p1', uid: 'u6',
      text: 'Starlink will bring high-speed internet to remote areas around the world. The constellation now has over 4,000 satellites in orbit! 🛰️🌍',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1517976487492-5750f3195933?w=1400&q=80' }],
      ts: now - 35 * M, status: 'live' as const
    },
    {
      id: 'p2', uid: 'u7',
      text: 'BREAKING: Apple announces new AI features coming to iOS 18 with enhanced Siri capabilities and on-device machine learning. #Apple #AI',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?w=1400&q=80' }],
      ts: now - 125 * M, status: 'live' as const
    },
    {
      id: 'p3', uid: 'u1',
      text: 'Just witnessed the most beautiful sunset over the Himalayas today. Nature never fails to amaze me! 🏔️✨',
      media: [
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=80' }
      ],
      ts: now - 300 * M, status: 'live' as const
    },
    {
      id: 'p9', uid: 'u10',
      text: 'Golden hour on the Annapurna circuit. Four frames, one walk, no filter. Prints available this week. #Himal #Photography',
      media: [
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1486870591958-9b9d0d1dda99?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1454496522488-7a8e488e8606?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1200&q=80' }
      ],
      ts: now - 48 * M, status: 'live' as const
    },
    {
      id: 'p10', uid: 'u9',
      text: 'Newari feast at home tonight. Aila optional. Seconds mandatory. 🍽️',
      media: [
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=1200&q=80' }
      ],
      ts: now - 70 * M, status: 'live' as const
    },
    {
      id: 'p11', uid: 'u8',
      text: 'Rain over New Road this afternoon. The city always looks cinematic in monsoon light.',
      media: [{ type: 'video' as const, src: 'https://www.w3schools.com/html/mov_bbb.mp4', dur: 10 }],
      ts: now - 90 * M, status: 'live' as const
    },
    {
      id: 'p12', uid: 'u11',
      text: 'Training clip from Satdobato. First touch, then the finish. ⚽️',
      media: [
        { type: 'video' as const, src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', dur: 5 },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=1200&q=80' }
      ],
      ts: now - 155 * M, status: 'live' as const
    },
    {
      id: 'p4', uid: 'u5',
      text: 'Morning coffee thoughts: The best way to start your day is with gratitude and a hot cup of coffee. What\'s your morning routine? ☕',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1400&q=80' }],
      ts: now - 26 * 60 * M, status: 'live' as const
    },
    {
      id: 'p13', uid: 'u3',
      text: 'Three quiet corners of Patan before the tour buses arrive.',
      media: [
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=1200&q=80' }
      ],
      ts: now - 210 * M, status: 'live' as const
    },
    {
      id: 'p5', uid: 'u2',
      text: 'Pro tip: Use keyboard shortcuts to boost your productivity. Cmd+C / Cmd+V are just the beginning. What\'s your favorite shortcut? ⌨️',
      media: [], ts: now - 50 * 60 * M, status: 'live' as const
    },
    {
      id: 'p6', uid: 'u3',
      text: 'आज बिहानै चिया खाँदै झ्यालबाहिर हेर्दा हिमाल प्रष्ट देखिएको थियो। यस्तो दिन कमै आउँछ।',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1579033461380-adb47c3eb938?w=1400&q=80' }],
      ts: now - 190 * M, status: 'live' as const
    },
    {
      id: 'p7', uid: 'u4',
      text: 'Does anyone know a good momo place near Baneshwor that is not packed on weekends? Asking for a hungry friend. 🥟',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=1400&q=80' }],
      ts: now - 400 * M, status: 'live' as const
    },
    {
      id: 'p14', uid: 'u10',
      text: 'Night market in Thamel, steam, neon, and a really good sel roti stand.',
      media: [
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1534274988757-a28bf1a57c17?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80' }
      ],
      ts: now - 520 * M, status: 'live' as const
    },
    {
      id: 'p8', uid: 'u_admin',
      text: 'Welcome to Exposing! 🎉 Share what you see: photos, clips, and stories from your corner of the world. Be kind, be authentic, and enjoy the conversation.',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=1400&q=80' }],
      ts: now - 4 * 24 * 60 * M, status: 'live' as const
    }
  ];

  const comments = [
    { id: 'c1', pid: 'p3', uid: 'u4', text: 'Worth it. Was it clear all morning?', ts: now - 30 * M, status: 'live' as const },
    { id: 'c2', pid: 'p3', uid: 'u3', text: 'Until about nine, then the clouds rolled back in.', ts: now - 24 * M, status: 'live' as const },
    { id: 'c3', pid: 'p2', uid: 'u2', text: 'On-device would be huge if they actually ship it.', ts: now - 100 * M, status: 'live' as const },
    { id: 'c4', pid: 'p2', uid: 'u1', text: 'Waiting for the Nepal availability note.', ts: now - 80 * M, status: 'live' as const },
    { id: 'c5', pid: 'p3', uid: 'u5', text: 'कति राम्रो! कहाँबाट खिच्नुभएको?', ts: now - 250 * M, status: 'live' as const },
    { id: 'c6', pid: 'p_mix', uid: 'u1', text: 'This album is stunning. The video with those stills together is perfect.', ts: now - 8 * M, status: 'live' as const },
    { id: 'c7', pid: 'p_mix', uid: 'u2', text: 'Need that lakeside café in frame 3. Drop the name?', ts: now - 5 * M, status: 'live' as const },
    { id: 'c8', pid: 'p9', uid: 'u5', text: 'Frame two is the one. Print that.', ts: now - 40 * M, status: 'live' as const },
    { id: 'c9', pid: 'p10', uid: 'u4', text: 'Saving this. Recipe when?', ts: now - 60 * M, status: 'live' as const },
    { id: 'c10', pid: 'p11', uid: 'u1', text: 'That clip feels like a music video.', ts: now - 85 * M, status: 'live' as const },
    { id: 'c11', pid: 'p12', uid: 'u2', text: 'Left foot still needs work but the run is clean.', ts: now - 140 * M, status: 'live' as const },
    { id: 'c1r1', pid: 'p3', parentId: 'c1', uid: 'u5', text: 'Clear until nine, then the mist came back like it owns the place.', ts: now - 22 * M, status: 'live' as const },
    { id: 'c1r2', pid: 'p3', parentId: 'c1', uid: 'u4', text: '@Maya Gurung same story every winter 😅', ts: now - 19 * M, status: 'live' as const },
    { id: 'c1r3', pid: 'p3', parentId: 'c1', uid: 'u1', text: 'Worth the early alarm either way.', ts: now - 15 * M, status: 'live' as const },
    { id: 'c1r4', pid: 'p3', parentId: 'c1', uid: 'u3', text: 'Saving this spot for Saturday.', ts: now - 12 * M, status: 'live' as const },
    { id: 'c6r1', pid: 'p_mix', parentId: 'c6', uid: 'u5', text: 'Thank you! The clip was one take, pure luck.', ts: now - 6 * M, status: 'live' as const },
    { id: 'c6r2', pid: 'p_mix', parentId: 'c6', uid: 'u2', text: 'One take?? Teach me.', ts: now - 4 * M, status: 'live' as const },
    { id: 'c9r1', pid: 'p9', parentId: 'c9', uid: 'u9', text: 'Recipe drops this Friday, promise.', ts: now - 50 * M, status: 'live' as const },
    { id: 'c9r2', pid: 'p9', parentId: 'c9', uid: 'u4', text: 'Friday cannot come soon enough.', ts: now - 44 * M, status: 'live' as const },
    { id: 'c9r3', pid: 'p9', parentId: 'c9', uid: 'u1', text: 'Setting a reminder right now.', ts: now - 30 * M, status: 'live' as const }
  ];

  const followPairs: [string, string][] = [
    ['u1', 'u2'], ['u1', 'u3'], ['u1', 'u5'], ['u1', 'u10'], ['u1', 'u9'],
    ['u2', 'u1'], ['u2', 'u7'], ['u2', 'u6'],
    ['u3', 'u1'], ['u3', 'u10'], ['u3', 'u8'],
    ['u4', 'u1'], ['u4', 'u9'], ['u4', 'u11'],
    ['u5', 'u1'], ['u5', 'u10'], ['u5', 'u3'],
    ['u6', 'u7'], ['u7', 'u6'], ['u7', 'u8'],
    ['u8', 'u1'], ['u8', 'u10'], ['u8', 'u9'],
    ['u9', 'u1'], ['u9', 'u5'],
    ['u10', 'u1'], ['u10', 'u5'], ['u10', 'u3'],
    ['u11', 'u8'], ['u11', 'u4'],
    ['u_admin', 'u1'], ['u_admin', 'u10']
  ];
  const follows: Follow[] = followPairs.map(([a, b], i) => ({ follower: a, following: b, ts: now - (30 - i) * DAY, status: 'accepted' as const }));
  follows.push({ follower: 'u6', following: 'u1', ts: now - 2 * M, status: 'pending' as const });

  const reactions: Reaction[] = posts.flatMap((p, pi) =>
    users
      .filter(u => u.id !== p.uid && hash(p.id + u.id) % 3 !== 0)
      .map((u, i) => ({
        id: `rx_${p.id}_${u.id}`,
        targetType: 'post' as const,
        targetId: p.id,
        uid: u.id,
        kind: KINDS[hash(p.id + u.id + 'k') % KINDS.length],
        ts: p.ts + (i + 1) * 4 * M
      }))
  );
  reactions.push(
    { id: 'rx_c1', targetType: 'comment', targetId: 'c1', uid: 'u1', kind: 'like', ts: now - 28 * M },
    { id: 'rx_c6', targetType: 'comment', targetId: 'c6', uid: 'u5', kind: 'love', ts: now - 7 * M },
    { id: 'rx_c1r1', targetType: 'comment', targetId: 'c1r1', uid: 'u4', kind: 'love', ts: now - 20 * M },
    { id: 'rx_c1r3', targetType: 'comment', targetId: 'c1r3', uid: 'u5', kind: 'like', ts: now - 14 * M },
    { id: 'rx_c6r1', targetType: 'comment', targetId: 'c6r1', uid: 'u1', kind: 'haha', ts: now - 5 * M }
  );

  const saves = [
    { uid: 'u1', pid: 'p9', ts: now - 40 * M },
    { uid: 'u1', pid: 'p10', ts: now - 60 * M },
    { uid: 'u2', pid: 'p_mix', ts: now - 6 * M },
    { uid: 'u5', pid: 'p3', ts: now - 200 * M }
  ];

  const notifications = [
    { id: 'n1', uid: 'u1', kind: 'follow' as const, actor: 'u10', text: 'started following you', href: '/u/himal_lens', ts: now - 2 * M, read: false },
    { id: 'n2', uid: 'u1', kind: 'reaction' as const, actor: 'u5', text: 'reacted ❤️ to your post', href: '/post/p3', ts: now - 20 * M, read: false },
    { id: 'n3', uid: 'u1', kind: 'comment' as const, actor: 'u4', text: 'commented on your post', href: '/post/p3', ts: now - 30 * M, read: false },
    { id: 'n4', uid: 'u1', kind: 'message' as const, actor: 'u2', text: 'sent you a message', href: '/messages/u2', ts: now - 45 * M, read: true },
    { id: 'n5', uid: 'u1', kind: 'coins' as const, text: '260 Coins added to your wallet', href: '/wallet', ts: now - 2 * DAY, read: true },
    { id: 'n6', uid: 'u10', kind: 'promotion' as const, text: 'Your promotion for "Golden hour on the Annapurna circuit" is live', href: '/wallet', ts: now - 40 * M, read: false },
    { id: 'n7', uid: 'u2', kind: 'warning' as const, text: 'Moderator notice: keep links relevant to the post topic.', href: '/notifications', ts: now - 1 * DAY, read: false },
    { id: 'n8', uid: 'u_admin', kind: 'system' as const, text: '2 open reports need review', href: '/admin', ts: now - 90 * M, read: false }
  ];

  const messages = [
    { id: 'm1', from: 'u2', to: 'u1', text: 'That sunset roll came out great. Which film?', ts: now - 60 * M, read: true },
    { id: 'm2', from: 'u1', to: 'u2', text: 'Portra 400, pushed one stop. Lakeside light forgives everything.', ts: now - 55 * M, read: true },
    { id: 'm3', from: 'u2', to: 'u1', text: 'Sending you the shortcut list tonight.', ts: now - 45 * M, read: false },
    { id: 'm4', from: 'u5', to: 'u1', text: 'Phewa on Saturday? Bringing the camera.', ts: now - 3 * 60 * M, read: false },
    { id: 'm5', from: 'u1', to: 'u5', text: 'Yes. Six am, before the wind.', ts: now - 2 * 60 * M, read: true }
  ];

  const listings = [
    {
      id: 'l1', uid: 'u10', title: 'Framed Annapurna print, 40x60', desc: 'Museum-grade matte print from the circuit series, signed on the back. Frame included. Pickup in Pokhara or courier nationwide.',
      price: 4500, category: 'Home & Garden', location: 'Pokhara, Gandaki',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1454496522488-7a8e488e8606?w=1200&q=80' }],
      ts: now - 5 * 60 * M, status: 'active' as const
    },
    {
      id: 'l2', uid: 'u2', title: 'Mechanical keyboard, hot-swap, barely used', desc: '75% layout, gasket mount, lubed switches. Two keycap sets included. Box and cable present.',
      price: 8200, category: 'Electronics', location: 'Kathmandu, Bagmati',
      media: [
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1595044426077-d36d9236d54a?w=1200&q=80' }
      ],
      ts: now - 9 * 60 * M, status: 'active' as const
    },
    {
      id: 'l3', uid: 'u9', title: 'Newari cooking class, small group', desc: 'Four hours, six dishes, market walk included. Saturdays only, max six people. Ingredients provided.',
      price: 2500, category: 'Services', location: 'Patan, Bagmati',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=1200&q=80' }],
      ts: now - 26 * 60 * M, status: 'active' as const
    },
    {
      id: 'l4', uid: 'u5', title: 'Two-person kayak, dry bag included', desc: 'Stable sit-on-top hull, two paddles and a dry bag. Great for Phewa mornings. Small scratch on the bow.',
      price: 32000, category: 'Other', location: 'Pokhara, Gandaki',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1200&q=80' }],
      ts: now - 2 * DAY, status: 'active' as const
    },
    {
      id: 'l5', uid: 'u8', title: 'City cycle, single speed, serviced', desc: 'Fresh brakes and chain, new tyres. Ready to ride. Test rides welcome near New Road.',
      price: 12500, category: 'Vehicles', location: 'Kathmandu, Bagmati',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=1200&q=80' }],
      ts: now - 3 * DAY, status: 'active' as const
    },
    {
      id: 'l6', uid: 'u3', title: 'Handwoven dhaka topi, custom size', desc: 'Traditional pattern, woven to order in Palpa. Two weeks lead time. Measure once, wear forever.',
      price: 1800, category: 'Fashion', location: 'Patan, Bagmati',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=1200&q=80' }],
      ts: now - 4 * DAY, status: 'sold' as const
    }
  ];

  const coinRequests = [
    { id: 'cr1', uid: 'u2', coins: 100, amount: 1000, method: 'bank' as const, reference: 'TXN-88412', ts: now - 5 * 60 * M, status: 'pending' as const },
    { id: 'cr2', uid: 'u9', coins: 200, amount: 2000, method: 'qr' as const, reference: 'QR-55190', ts: now - 2 * DAY, status: 'approved' as const },
    { id: 'cr3', uid: 'u4', coins: 50, amount: 500, method: 'bank' as const, reference: 'TXN-77120', ts: now - 3 * DAY, status: 'rejected' as const, note: 'Reference not found in bank statement.' }
  ];

  const ledger = [
    { id: 'le1', uid: 'u1', delta: 300, kind: 'purchase' as const, note: 'Bank transfer TXN-90233', ts: now - 6 * DAY },
    { id: 'le2', uid: 'u1', delta: -40, kind: 'spend' as const, note: 'Promotion: Starter package', ts: now - 5 * DAY },
    { id: 'le3', uid: 'u10', delta: 800, kind: 'purchase' as const, note: 'QR payment QR-40021', ts: now - 4 * DAY },
    { id: 'le4', uid: 'u10', delta: -300, kind: 'spend' as const, note: 'Promotion: Growth package', ts: now - 40 * M },
    { id: 'le5', uid: 'u9', delta: 200, kind: 'purchase' as const, note: 'QR payment QR-55190', ts: now - 2 * DAY },
    { id: 'le6', uid: 'u9', delta: -110, kind: 'spend' as const, note: 'Promotion: Starter package', ts: now - 1 * DAY },
    { id: 'le7', uid: 'u5', delta: 120, kind: 'admin' as const, note: 'Welcome credit', ts: now - 10 * DAY }
  ];

  const promotions = [
    {
      id: 'pr1', uid: 'u10', targetType: 'post' as const, targetId: 'p9', packageId: 'pk_growth',
      category: 'Photography', ageMin: 18, ageMax: 40, country: 'Nepal', cities: [],
      coins: 300, budget: 300, ts: now - 40 * M, starts: now - 30 * M, ends: now + 6 * DAY + 20 * 60 * M,
      status: 'active' as const, impressions: 4180, clicks: 262
    },
    {
      id: 'pr2', uid: 'u9', targetType: 'listing' as const, targetId: 'l3', packageId: 'pk_starter',
      category: 'Services', ageMin: 20, ageMax: 55, country: 'Nepal', cities: ['Kathmandu', 'Lalitpur'],
      coins: 100, budget: 100, ts: now - 1 * DAY, starts: now - 20 * 60 * M, ends: now + 2 * DAY,
      status: 'active' as const, impressions: 1210, clicks: 74
    },
    {
      id: 'pr3', uid: 'u1', targetType: 'post' as const, targetId: 'p3', packageId: 'pk_starter',
      category: 'Travel', ageMin: 18, ageMax: 35, country: 'Nepal', cities: ['Pokhara'],
      coins: 100, budget: 100, ts: now - 5 * DAY, starts: now - 4 * DAY, ends: now - 2 * DAY,
      status: 'ended' as const, impressions: 2600, clicks: 141
    },
    {
      id: 'pr4', uid: 'u1', targetType: 'post' as const, targetId: 'p3', packageId: 'pk_starter',
      category: 'Travel', ageMin: 25, ageMax: 45, country: 'Nepal', cities: ['Kathmandu', 'Bhaktapur'],
      coins: 0, budget: 100, ts: now - 40 * M, starts: 0, ends: 0,
      status: 'pending' as const, impressions: 0, clicks: 0
    }
  ];

  const reports = [
    { id: 'r1', type: 'post' as const, targetId: 'p6', by: 'u1', reason: 'r_spam', note: '', ts: now - 120 * M, status: 'open' as const },
    { id: 'r2', type: 'post' as const, targetId: 'p6', by: 'u2', reason: 'r_spam', note: 'Link looks fake', ts: now - 90 * M, status: 'open' as const },
    { id: 'r3', type: 'listing' as const, targetId: 'l4', by: 'u4', reason: 'r_price', note: 'Price seems misleading', ts: now - 6 * 60 * M, status: 'open' as const }
  ];

  const lang = (typeof window !== 'undefined' && navigator.language || '').toLowerCase().indexOf('ne') === 0 ? 'ne' : 'en';

  return {
    users,
    posts,
    comments,
    follows,
    reactions,
    saves,
    notifications,
    messages,
    listings,
    coinRequests,
    ledger,
    promotions,
    reports,
    audit: [
      { id: 'a1', ts: now - 2 * DAY, actor: 'u_admin', action: 'approve_coin_request', target: 'cr2', reason: 'Bank reference matched' },
      { id: 'a2', ts: now - 3 * DAY, actor: 'u_admin', action: 'reject_coin_request', target: 'cr3', reason: 'Reference not found' }
    ],
    settings: defaultSettings(),
    meId: 'u1',
    lang,
    seedVersion: 3
  };
}

/** Settings the client renders with before /api/meta/ arrives. */
export function defaultSettings(): Settings {
  return {
    threshold: 3,
    coinPrice: 10,
    minPurchase: 100,
    limits: { textChars: 2000, photoCount: 4, photoMb: 5, videoCount: 1, videoSeconds: 60, videoMb: 150 },
    bankName: 'Nepal Bank Ltd',
    bankAccount: '0120-4455-8891',
    bankHolder: 'Exposing Pvt Ltd',
    features: { video: true, marketplace: true, promotion: true, googleLogin: true, facebookLogin: true, appleLogin: false },
    packages: [
      { id: 'pk_starter', name: 'Starter', coins: 100, days: 3, reach: 'Up to 3,000 people' },
      { id: 'pk_growth', name: 'Growth', coins: 300, days: 7, reach: 'Up to 12,000 people' },
      { id: 'pk_prime', name: 'Prime', coins: 800, days: 14, reach: 'Up to 40,000 people' }
    ],
    categories: ['Electronics', 'Vehicles', 'Property', 'Fashion', 'Home & Garden', 'Jobs', 'Services', 'Other']
  };
}