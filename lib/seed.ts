import { Database } from './types';
import { uid, DAY } from './utils';

export function seed(): Database {
  const now = Date.now();
  const M = 60000;

  const users = [
    { id: 'u_admin', email: 'admin@chautari.demo', username: 'chautari_team', name: 'Chautari Team', role: 'admin' as const, verified: true, susp: null },
    { id: 'u1', email: 'sita@demo.test', username: 'sita_k', name: 'Sita Karki', role: 'user' as const, verified: true, susp: null },
    { id: 'u2', email: 'bikash@demo.test', username: 'bikash_s', name: 'Bikash Shrestha', role: 'user' as const, verified: true, susp: null },
    { id: 'u3', email: 'anju@demo.test', username: 'anju_t', name: 'Anju Tamang', role: 'user' as const, verified: true, susp: null },
    { id: 'u4', email: 'rojan@demo.test', username: 'rojan_b', name: 'Rojan B', role: 'user' as const, verified: true, susp: null },
    { id: 'u5', email: 'maya@demo.test', username: 'maya_g', name: 'Maya Gurung', role: 'user' as const, verified: true, susp: null },
    { id: 'u6', email: 'elon@demo.test', username: 'elon_musk', name: 'Elon Musk', role: 'user' as const, verified: true, susp: null },
    { id: 'u7', email: 'tech@demo.test', username: 'tech_news', name: 'Tech News', role: 'user' as const, verified: true, susp: null }
  ];

  const posts = [
    {
      id: 'p1',
      uid: 'u6',
      text: 'Starlink will bring high-speed internet to remote areas around the world. The constellation now has over 4,000 satellites in orbit! 🛰️🌍',
      media: [{ type: 'image', src: 'https://images.unsplash.com/photo-1517976487492-5750f3195933?w=800&q=80' }],
      ts: now - 35 * M,
      status: 'live' as const
    },
    {
      id: 'p2',
      uid: 'u7',
      text: 'BREAKING: Apple announces new AI features coming to iOS 18 with enhanced Siri capabilities and on-device machine learning. #Apple #AI',
      media: [{ type: 'image', src: 'https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?w=800&q=80' }],
      ts: now - 125 * M,
      status: 'live' as const
    },
    {
      id: 'p3',
      uid: 'u1',
      text: 'Just witnessed the most beautiful sunset over the Himalayas today. Nature never fails to amaze me! 🏔️✨',
      media: [
        { type: 'image', src: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80' },
        { type: 'image', src: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80' }
      ],
      ts: now - 300 * M,
      status: 'live' as const
    },
    {
      id: 'p4',
      uid: 'u5',
      text: 'Morning coffee thoughts: The best way to start your day is with gratitude and a hot cup of coffee. What\'s your morning routine? ☕',
      media: [{ type: 'image', src: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&q=80' }],
      ts: now - 26 * 60 * M,
      status: 'live' as const
    },
    {
      id: 'p5',
      uid: 'u2',
      text: 'Pro tip: Use keyboard shortcuts to boost your productivity. Cmd+C / Cmd+V are just the beginning. What\'s your favorite shortcut? ⌨️',
      media: [],
      ts: now - 50 * 60 * M,
      status: 'live' as const
    },
    {
      id: 'p6',
      uid: 'u3',
      text: 'आज बिहानै चिया खाँदै झ्यालबाहिर हेर्दा हिमाल प्रष्ट देखिएको थियो। यस्तो दिन कमै आउँछ।',
      media: [{ type: 'image', src: 'https://images.unsplash.com/photo-1579033461380-adb47c3eb938?w=800&q=80' }],
      ts: now - 190 * M,
      status: 'live' as const
    },
    {
      id: 'p7',
      uid: 'u4',
      text: 'Does anyone know a good momo place near Baneshwor that is not packed on weekends? Asking for a hungry friend. 🥟',
      media: [{ type: 'image', src: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=800&q=80' }],
      ts: now - 400 * M,
      status: 'live' as const
    },
    {
      id: 'p8',
      uid: 'u_admin',
      text: 'Welcome to Chautari! 🎉 A modern social platform for sharing your thoughts. Be kind, be authentic, and enjoy the conversation!',
      media: [],
      ts: now - 4 * 24 * 60 * M,
      status: 'live' as const
    }
  ];

  const comments = [
    { id: 'c1', pid: 'p1', uid: 'u4', text: 'Worth it. Was it clear all morning?', ts: now - 30 * M, status: 'live' as const },
    { id: 'c2', pid: 'p1', uid: 'u3', text: 'Until about nine, then the clouds rolled back in.', ts: now - 24 * M, status: 'live' as const },
    { id: 'c3', pid: 'p2', uid: 'u2', text: 'Try the small place behind the temple. It closes at 8 though.', ts: now - 100 * M, status: 'live' as const },
    { id: 'c4', pid: 'p2', uid: 'u1', text: 'Seconded. Go before noon.', ts: now - 80 * M, status: 'live' as const },
    { id: 'c5', pid: 'p3', uid: 'u5', text: 'कति राम्रो! कहाँबाट खिच्नुभएको?', ts: now - 250 * M, status: 'live' as const }
  ];

  const reports = [
    { id: 'r1', type: 'post' as const, targetId: 'p6', by: 'u1', reason: 'r_spam', note: '', ts: now - 120 * M, status: 'open' as const },
    { id: 'r2', type: 'post' as const, targetId: 'p6', by: 'u2', reason: 'r_spam', note: 'Link looks fake', ts: now - 90 * M, status: 'open' as const }
  ];

  const lang = (typeof navigator !== 'undefined' && navigator.language || '').toLowerCase().indexOf('ne') === 0 ? 'ne' : 'en';

  return {
    users,
    posts,
    comments,
    reports,
    audit: [],
    settings: { threshold: 3 },
    meId: null,
    lang
  };
}
