/// <reference types="vite/client" />

// Only remove this app's Workbox asset caches; wiki content lives in IndexedDB.
export async function clearAppCache() {
  const scope = new URL(import.meta.env.BASE_URL, location.origin).href;
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      if (registration.scope === scope && !await registration.unregister()) {
        throw new Error('Unable to unregister the offline app. Close other wiki windows and try again.');
      }
    }
  }
  if ('caches' in window) {
    for (const name of await caches.keys()) {
      if (name.startsWith('workbox-') && name.endsWith(scope)) await caches.delete(name);
    }
  }
}
