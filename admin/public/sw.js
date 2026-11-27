/* The console's background half — the staff seat's version of the member site's
   worker, and the reason a report filed at midnight reaches a person who is not
   sitting at the desk.

   A push is delivered here, not to a page: the browser wakes this worker, draws
   the card from the sentence the server already wrote, and the tap opens the
   desk the notice was pointing at. Nothing is fetched and nothing is read from
   storage — a worker that asks the network before it can show a message is a
   worker that shows nothing exactly when the network is the reason for it.

   There is no fetch handler on purpose. This worker wakes and speaks; it does
   not sit between the console and its files, so no deploy can be served stale. */

const HOME = '/overview';

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
    tag: card.tag || 'exposing-staff',
    icon: '/exposing-logo.png',
    badge: '/exposing-logo.png',
    data: { url: card.url || HOME },
  };
  // A card that replaces another is silent unless it asks to be heard again.
  if (card.renotify) options.renotify = true;
  event.waitUntil((async () => {
    // A staffer already looking at the console sees the tray move on its own; a
    // card over the top of the thing it describes is in the way, not a help.
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (tabs.some((tab) => tab.visibilityState === 'visible')) return;
    await self.registration.showNotification(card.title || 'Exposing staff', options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || HOME;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const tab of tabs) {
      if (!('focus' in tab)) continue;
      await tab.focus();
      // A worker cannot navigate a window it did not open, so the screen is told
      // to move itself instead of a second copy of the console being started.
      tab.postMessage({ url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
