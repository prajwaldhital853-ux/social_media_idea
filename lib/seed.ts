import { Database } from './types';

export function seed(): Database {
  const now = Date.now();
  const M = 60000;

  const users = [
    { id: 'u_admin', email: 'admin@chautari.demo', username: 'chautari_team', name: 'Chautari Team', role: 'admin' as const, verified: true, susp: null },
    { id: 'u1', email: 'sita@demo.test', username: 'sita_k', name: 'Sita Karki', role: 'user' as const, verified: true, susp: null },
    { id: 'u2', email: 'bikash@demo.test', username: 'bikash_s', name: 'Bikash Shrestha', role: 'user' as const, verified: false, susp: null },
    { id: 'u3', email: 'anju@demo.test', username: 'anju_t', name: 'Anju Tamang', role: 'user' as const, verified: true, susp: null },
    { id: 'u4', email: 'rojan@demo.test', username: 'rojan_b', name: 'Rojan B', role: 'user' as const, verified: false, susp: null },
    { id: 'u5', email: 'maya@demo.test', username: 'maya_g', name: 'Maya Gurung', role: 'user' as const, verified: true, susp: null },
    { id: 'u6', email: 'elon@demo.test', username: 'elon_musk', name: 'Elon Musk', role: 'user' as const, verified: true, susp: null },
    { id: 'u7', email: 'tech@demo.test', username: 'tech_news', name: 'Tech News', role: 'user' as const, verified: true, susp: null },
    { id: 'u8', email: 'kathmandu@demo.test', username: 'ktm_daily', name: 'Kathmandu Daily', role: 'user' as const, verified: true, susp: null },
    { id: 'u9', email: 'chef@demo.test', username: 'nima_kitchen', name: 'Nima Kitchen', role: 'user' as const, verified: true, susp: null },
    { id: 'u10', email: 'lens@demo.test', username: 'himal_lens', name: 'Himal Lens', role: 'user' as const, verified: true, susp: null },
    { id: 'u11', email: 'goal@demo.test', username: 'goalnepal', name: 'Goal Nepal', role: 'user' as const, verified: false, susp: null }
  ];

  const posts = [
    {
      id: 'p_mix',
      uid: 'u5',
      text: 'Weekend in Pokhara: a little clip from Phewa, then the rest of the roll. Same trip, same light. 🚤🏔️',
      media: [
        { type: 'video' as const, src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', dur: 5 },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1605640840605-14ac1855827b?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200&q=80' }
      ],
      ts: now - 12 * M,
      status: 'live' as const
    },
    {
      id: 'p1',
      uid: 'u6',
      text: 'Starlink will bring high-speed internet to remote areas around the world. The constellation now has over 4,000 satellites in orbit! 🛰️🌍',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1517976487492-5750f3195933?w=1400&q=80' }],
      ts: now - 35 * M,
      status: 'live' as const
    },
    {
      id: 'p2',
      uid: 'u7',
      text: 'BREAKING: Apple announces new AI features coming to iOS 18 with enhanced Siri capabilities and on-device machine learning. #Apple #AI',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?w=1400&q=80' }],
      ts: now - 125 * M,
      status: 'live' as const
    },
    {
      id: 'p3',
      uid: 'u1',
      text: 'Just witnessed the most beautiful sunset over the Himalayas today. Nature never fails to amaze me! 🏔️✨',
      media: [
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=80' }
      ],
      ts: now - 300 * M,
      status: 'live' as const
    },
    {
      id: 'p9',
      uid: 'u10',
      text: 'Golden hour on the Annapurna circuit. Four frames, one walk, no filter.',
      media: [
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1486870591958-9b9d0d1dda99?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1454496522488-7a8e488e8606?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1200&q=80' }
      ],
      ts: now - 48 * M,
      status: 'live' as const
    },
    {
      id: 'p10',
      uid: 'u9',
      text: 'Newari feast at home tonight. Aila optional. Seconds mandatory. 🍽️',
      media: [
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=1200&q=80' }
      ],
      ts: now - 70 * M,
      status: 'live' as const
    },
    {
      id: 'p11',
      uid: 'u8',
      text: 'Rain over New Road this afternoon. The city always looks cinematic in monsoon light.',
      media: [
        { type: 'video' as const, src: 'https://www.w3schools.com/html/mov_bbb.mp4', dur: 10 }
      ],
      ts: now - 90 * M,
      status: 'live' as const
    },
    {
      id: 'p12',
      uid: 'u11',
      text: 'Training clip from Satdobato. First touch, then the finish. ⚽️',
      media: [
        { type: 'video' as const, src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', dur: 5 },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=1200&q=80' }
      ],
      ts: now - 155 * M,
      status: 'live' as const
    },
    {
      id: 'p4',
      uid: 'u5',
      text: 'Morning coffee thoughts: The best way to start your day is with gratitude and a hot cup of coffee. What\'s your morning routine? ☕',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1400&q=80' }],
      ts: now - 26 * 60 * M,
      status: 'live' as const
    },
    {
      id: 'p13',
      uid: 'u3',
      text: 'Three quiet corners of Patan before the tour buses arrive.',
      media: [
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=1200&q=80' }
      ],
      ts: now - 210 * M,
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
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1579033461380-adb47c3eb938?w=1400&q=80' }],
      ts: now - 190 * M,
      status: 'live' as const
    },
    {
      id: 'p7',
      uid: 'u4',
      text: 'Does anyone know a good momo place near Baneshwor that is not packed on weekends? Asking for a hungry friend. 🥟',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=1400&q=80' }],
      ts: now - 400 * M,
      status: 'live' as const
    },
    {
      id: 'p14',
      uid: 'u10',
      text: 'Night market in Thamel — steam, neon, and a really good sel roti stand.',
      media: [
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1534274988757-a28bf1a57c17?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1200&q=80' },
        { type: 'image' as const, src: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80' }
      ],
      ts: now - 520 * M,
      status: 'live' as const
    },
    {
      id: 'p8',
      uid: 'u_admin',
      text: 'Welcome to Chautari! 🎉 A modern social platform for sharing your thoughts. Be kind, be authentic, and enjoy the conversation!',
      media: [{ type: 'image' as const, src: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=1400&q=80' }],
      ts: now - 4 * 24 * 60 * M,
      status: 'live' as const
    }
  ];

  const comments = [
    { id: 'c1', pid: 'p1', uid: 'u4', text: 'Worth it. Was it clear all morning?', ts: now - 30 * M, status: 'live' as const },
    { id: 'c2', pid: 'p1', uid: 'u3', text: 'Until about nine, then the clouds rolled back in.', ts: now - 24 * M, status: 'live' as const },
    { id: 'c3', pid: 'p2', uid: 'u2', text: 'On-device would be huge if they actually ship it.', ts: now - 100 * M, status: 'live' as const },
    { id: 'c4', pid: 'p2', uid: 'u1', text: 'Waiting for the Nepal availability note.', ts: now - 80 * M, status: 'live' as const },
    { id: 'c5', pid: 'p3', uid: 'u5', text: 'कति राम्रो! कहाँबाट खिच्नुभएको?', ts: now - 250 * M, status: 'live' as const },
    { id: 'c6', pid: 'p_mix', uid: 'u1', text: 'This album is stunning. The video with those stills together is perfect.', ts: now - 8 * M, status: 'live' as const },
    { id: 'c7', pid: 'p_mix', uid: 'u2', text: 'Need that lakeside café in frame 3. Drop the name?', ts: now - 5 * M, status: 'live' as const },
    { id: 'c8', pid: 'p9', uid: 'u5', text: 'Frame two is the one. Print that.', ts: now - 40 * M, status: 'live' as const },
    { id: 'c9', pid: 'p10', uid: 'u4', text: 'Saving this. Recipe when?', ts: now - 60 * M, status: 'live' as const },
    { id: 'c10', pid: 'p11', uid: 'u1', text: 'That clip feels like a music video.', ts: now - 85 * M, status: 'live' as const },
    { id: 'c11', pid: 'p12', uid: 'u2', text: 'Left foot still needs work but the run is clean.', ts: now - 140 * M, status: 'live' as const }
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
