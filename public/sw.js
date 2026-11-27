/* Exposing's background half.

   A push is delivered here, not to a page: the browser wakes this worker, draws
   the card from the sentence the server already wrote, and the tap opens the
   bell row it came from. Nothing is fetched and nothing is read from storage —
   a worker that asks the network before it can show a message is a worker that
   shows nothing exactly when the network is the reason for the message.

   There is no fetch handler on purpose. This worker wakes and speaks; it does
   not sit between the site and its files, so no deploy can be served stale. */

const HOME = '/notifications';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  // Take the tabs that are already open, so a redeployed worker is the one that
  // hears the tap rather than the old one still holding the page.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let card = {};
  try {
    card = event.data ? event.data.json() : {};
  } catch (err) {
    card = {};
  }
  const options = {
    body: card.body || '',
    // One card per thread or per post: the tenth message in a conversation
    // replaces the ninth instead of stacking ten deep over the same shelf.
    tag: card.tag || 'exposing',
    icon: '/exposing-icon.png',
    badge: '/exposing-icon.png',
    data: { url: card.url || HOME },
  };
  // A card that replaces another is silent unless it asks to be heard again —
  // which is how a second message from the same person still makes a noise.
  if (card.renotify) options.renotify = true;
  event.waitUntil(self.registration.showNotification(card.title || 'Exposing', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || HOME;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const tab of tabs) {
      if (!('focus' in tab)) continue;
      await tab.focus();
      // A worker cannot navigate a window it did not open, so the page is told
      // to move itself instead of a second copy of the site being started.
      tab.postMessage({ url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
