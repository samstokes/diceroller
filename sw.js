'use strict';

// The app has no backend and no data, so this only exists to make it work offline
// (and to satisfy Chrome's install criteria on Android). It caches the app's own
// files and nothing else.
//
// Stale-while-revalidate: a launch is served from the cache instantly, and the
// cache is refreshed from the network in the background, so a deploy lands on the
// next launch by itself. Bumping VERSION forces it immediately; it is a belt-and-
// braces measure rather than the only way an update can arrive.
const VERSION = 'v3';
const SHELL = 'dice-shell-' + VERSION;

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Every navigation (including ?roll=… deep links) is answered by index.html, so
  // they all share its cache entry.
  const key = request.mode === 'navigate' ? './index.html' : request;

  // Kick the refresh off synchronously: waitUntil has to be called while the event
  // is still active, and it's what keeps the worker alive to finish writing the
  // cache after we've already answered from it.
  const network = fetch(request)
    .then(async (res) => {
      if (res.ok) (await caches.open(SHELL)).put(key, res.clone());
      return res;
    })
    .catch(() => null); // offline: the cached copy below is the answer
  event.waitUntil(network);

  event.respondWith(
    caches.match(key).then(async (cached) => cached || (await network) || Response.error())
  );
});
