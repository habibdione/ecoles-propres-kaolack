# -*- coding: utf-8 -*-
"""Fabrique le depot deployable (GitHub Pages) a partir des sources de l'app.

L'app publiee sur claude.ai est un fragment : la plateforme l'enveloppe elle-meme
dans un document HTML. Pour un hebergement classique il faut ce document complet,
plus un manifeste et un agent de service pour l'usage hors ligne.
"""
import io, os, shutil, sys, json, glob

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app")
DEP = r"C:\Users\30100-23-SNG\Documents\ecoles-propres-kaolack"

FICHIERS = ["app.js", "donnees.js", "photos.js", "affiches.js", "execution.js",
            "osm.js", "suivi.js"]
DOSSIERS = ["logos", "affiches", "photos"]

TETE = """<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Suivi des operations de nettoiement des ecoles de la commune de Kaolack — CSIG SONAGED.">
<meta name="theme-color" content="#0C7048">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icone-192.png" sizes="192x192">
<link rel="apple-touch-icon" href="icone-192.png">
"""

RESET = """<style>
html,body{margin:0}
img{max-width:100%}
[hidden]{display:none!important}
</style>
"""

PIED = """<script>
if ("serviceWorker" in navigator) {
  addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}
</script>
</body>
</html>
"""


def page():
    s = io.open(os.path.join(SRC, "index.html"), encoding="utf-8").read()
    i = s.index("<div id=\"app\">")
    tete_fragment, corps = s[:i], s[i:]
    # l'instantane de l'avancement n'existe que dans la version autonome
    ancre = '<script src="app.js"></script>'
    assert ancre in corps
    corps = corps.replace(ancre, '<script src="suivi.js"></script>\n' + ancre, 1)
    return TETE + RESET + tete_fragment + "</head>\n<body>\n" + corps + PIED


def icones():
    """Ecusson simple : la couleur SONAGED et l'initiale du programme."""
    from PIL import Image, ImageDraw
    for taille in (192, 512):
        im = Image.new("RGB", (taille, taille), "#0C7048")
        d = ImageDraw.Draw(im)
        m = taille // 8
        d.rounded_rectangle([m, m, taille - m, taille - m], radius=taille // 10,
                            outline="#F2EFE6", width=max(3, taille // 40))
        # un toit d'ecole schematique
        h = taille // 2
        d.polygon([(taille * 0.28, h), (taille * 0.5, taille * 0.3), (taille * 0.72, h)], fill="#F2EFE6")
        d.rectangle([taille * 0.36, h, taille * 0.64, taille * 0.68], fill="#F2EFE6")
        im.save(os.path.join(DEP, "icone-%d.png" % taille), "PNG", optimize=True)


MANIFESTE = {
    "name": "Écoles Propres Kaolack",
    "short_name": "Écoles Propres",
    "description": "Suivi des opérations de nettoiement des écoles de la commune de Kaolack.",
    "start_url": ".",
    "scope": ".",
    "display": "standalone",
    "orientation": "portrait",
    "background_color": "#F2EFE6",
    "theme_color": "#0C7048",
    "lang": "fr",
    "icons": [
        {"src": "icone-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icone-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
    ],
}


def agent_de_service(version):
    """Cache d'abord : l'app doit s'ouvrir sans reseau, sur le terrain."""
    return """/* Agent de service — Écoles Propres Kaolack.
   Le noyau est mis en cache à l'installation ; les photos le sont au fil des consultations. */
var VERSION = "%s";
var NOYAU = "noyau-" + VERSION;
var MEDIA = "media-" + VERSION;
var ESSENTIELS = %s;

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

  var media = /\\.(jpg|jpeg|png|webp)$/i.test(u.pathname);
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
""" % (version, json.dumps([
        "./", "index.html", "app.js", "donnees.js", "photos.js", "affiches.js",
        "execution.js", "osm.js", "suivi.js", "manifest.webmanifest",
        "icone-192.png", "icone-512.png",
        "logos/cadredevie.png", "logos/commune.png", "logos/sonaged.png",
        "logos/hygiene.png", "logos/genie.png", "logos/pompiers.png",
    ], indent=2))


GITIGNORE = """# systeme
Thumbs.db
desktop.ini
.DS_Store

# editeurs
.vscode/
.idea/

# sorties temporaires
*.tmp
_*.docx
"""


def construire():
    os.makedirs(DEP, exist_ok=True)
    for f in FICHIERS:
        shutil.copy2(os.path.join(SRC, f), os.path.join(DEP, f))
    for d in DOSSIERS:
        cible = os.path.join(DEP, d)
        if os.path.isdir(cible):
            shutil.rmtree(cible)
        shutil.copytree(os.path.join(SRC, d), cible)

    io.open(os.path.join(DEP, "index.html"), "w", encoding="utf-8").write(page())
    io.open(os.path.join(DEP, "manifest.webmanifest"), "w", encoding="utf-8").write(
        json.dumps(MANIFESTE, ensure_ascii=False, indent=2))
    icones()

    import hashlib
    h = hashlib.sha1()
    for f in ["index.html"] + FICHIERS:
        h.update(io.open(os.path.join(DEP, f), "rb").read())
    io.open(os.path.join(DEP, "sw.js"), "w", encoding="utf-8").write(
        agent_de_service(h.hexdigest()[:8]))
    io.open(os.path.join(DEP, ".gitignore"), "w", encoding="utf-8").write(GITIGNORE)

    n = sum(len(fs) for _, _, fs in os.walk(DEP))
    o = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(DEP) for f in fs)
    print("dépôt prêt : %d fichiers, %.1f Mo" % (n, o / 1048576))
    print("version de l'agent de service :", h.hexdigest()[:8])


if __name__ == "__main__":
    construire()
