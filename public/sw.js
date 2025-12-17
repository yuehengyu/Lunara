self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'LunaRemind';

    const options = {
        body: data.body || 'Event Reminder',
        icon: '/icon.png', // Ensure you have this icon or it might fail silently on some browsers
        badge: '/icon.png',
        data: data.url || '/',
        // CRITICAL for Lock Screen visibility:
        requireInteraction: true, // Keeps notification until user dismisses it
        renotify: true, // Vibrate/Sound again even if old notification is there
        tag: 'luna-reminder' // Groups notifications
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((windowClients) => {
            // If app is open, focus it
            for (let client of windowClients) {
                if (client.url === '/' && 'focus' in client) {
                    return client.focus();
                }
            }
            // If app is closed, open it
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});