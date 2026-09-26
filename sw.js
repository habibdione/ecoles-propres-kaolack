/* Agent de service — Écoles Propres Kaolack.
   Le noyau est mis en cache à l'installation ; les photos le sont au fil des consultations. */
var VERSION = "ca226c22";
var NOYAU = "noyau-" + VERSION;
var MEDIA = "media-" + VERSION;
var ESSENTIELS = [
  "./",
  "index.html",
  "app.js",
  "donnees.js",
  "photos.js",
  "affiches.js",
  "execution.js",
  "osm.js",
  "suivi.js",
  "config.js",
  "manifest.webmanifest",
  "icone-192.png",
  "icone-512.png",
  "logos/cadredevie.png",
  "logos/commune.png",
  "logos/sonaged.png",
  "logos/hygiene.png",
  "logos/genie.png",
  "logos/pompiers.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(NOYAU).then(function (c) { return c.addAll(ESSENTIELS); })
    .then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (noms) {
    return Promise.all(noms.filter(function (n) { return n !== NOYAU && n !== MEDIA; })
      .map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var r = e.request;
  if (r.method !== "GET") return;
  var u = new URL(r.url);
  if (u.origin !== location.origin) return;

  var media = /\.(jpg|jpeg|png|webp)$/i.test(u.pathname);
  e.respondWith(
    caches.match(r).then(function (dans) {
      if (dans) {
        if (!media) { reseau(r, NOYAU); }   /* rafraîchit le noyau en arrière-plan */
        return dans;
      }
      return fetch(r).then(function (rep) {
        if (rep && rep.status === 200) {
          var copie = rep.clone();
          caches.open(media ? MEDIA : NOYAU).then(function (c) { c.put(r, copie); });
        }
        return rep;
      }).catch(function () {
        return caches.match("index.html");
      });
    })
  );
});

function reseau(r, cache) {
  fetch(r).then(function (rep) {
    if (rep && rep.status === 200) caches.open(cache).then(function (c) { c.put(r, rep); });
  }).catch(function () {});
}
