/* Écoles Propres Kaolack — suivi des opérations de nettoiement
   Catalogue des établissements : donnees.js (relevés GPS des tournées J1–J3,
   complété par les relevés au fil des opérations).
   Avancement : base partagée de l'artefact (capacité db), photos : capacité assets. */
(function () {
  "use strict";

  var ECOLES = window.KL.ecoles;
  var QUARTIERS = window.KL.quartiers;
  var COMMUNE = window.KL.commune;
  var CAMPAGNE = window.KL.campagne;
  var ARCHIVE = window.KLPH || {};   // photos des tournées, publiées avec la page
  var AFFICHES = window.KLAF || [];  // affiches « programme du jour » diffusées par la Commune
  var OSM = window.KLOSM || {};      // fond de plan OpenStreetMap, projeté au format SVG
  var EXEC = (window.KLEX || {}).fiches || {};   // fiches du rapport d'exécution
  var EXEC_META = (window.KLEX || {}).meta || {};

  var ETATS = [
    { k: "attente", court: "À faire", long: "À faire" },
    { k: "encours", court: "En cours", long: "En cours" },
    { k: "fait", court: "Fait", long: "Terminé" },
    { k: "bloque", court: "Bloqué", long: "Bloqué" }
  ];
  var MOTIFS = ["École fermée", "Matériel absent", "Eau stagnante", "Accès refusé", "Autre"];
  /* Ce qu'une reconnaissance de la veille peut constater. « Prête » est le
     constat le plus utile : il lève une contrainte que le diagnostic de
     septembre avait notée, et renvoie l'école à la programmation. */
  var CONSTATS = [
    { cle: "prete", court: "Prête", long: "Rien ne retient l'école : elle peut être programmée" },
    { cle: "eau", court: "Eau stagnante", long: "Cour sous l'eau : le pompage du Service d'Hygiène est préalable" },
    { cle: "chimique", court: "Herbicide posé", long: "Traitée à l'herbicide, la coupe attend que le produit agisse" },
    { cle: "fermee", court: "École fermée", long: "Établissement fermé le jour du passage" },
    { cle: "acces", court: "Accès refusé", long: "L'accès au site n'a pas été accordé" },
    { cle: "autre", court: "Autre", long: "Autre contrainte, précisée en observation" }
  ];
  function constatDe(cle) {
    for (var i = 0; i < CONSTATS.length; i++) if (CONSTATS[i].cle === cle) return CONSTATS[i];
    return null;
  }
  var SERVICES = [
    { nom: "SONAGED", css: "--sv-sonaged" },
    { nom: "Cadre de Vie", css: "--sv-cadre" },
    { nom: "Service d'Hygiène", css: "--sv-hygiene" },
    { nom: "Constructions scolaires", css: "--sv-const" },
    { nom: "Commune / Génie militaire", css: "--sv-genie" },
    { nom: "À préciser", css: "--texte-3" }
  ];
  function couleurService(nom) {
    for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].nom === nom) return "var(" + SERVICES[i].css + ")";
    return "var(--texte-3)";
  }

  /* ---------------- état ---------------- */
  var S = {
    vue: "Planning",
    jour: "demain",   // aujourdhui | demain | avenir | libre | passees
    jourAuto: true,   // vrai tant que l'utilisateur n'a pas choisi d'onglet lui-même
    uc: 0,            // 0 = toutes
    etat: "tous",     // tous | reste | encours | fini | p1
    service: "",      // "" = tous les services pilotes
    q: "",
    suivi: {},        // id école -> { taches:{}, obs, photos:[], date, maj }
    attente: {},      // saisies pas encore confirmées par le serveur
    selection: null,  // id école sélectionnée sur la carte
    coche: null,      // programmation groupée : { id école: true }, null hors de ce mode
    cocheDate: "",    // date que la programmation groupée appliquera
    fiche: null,      // id école ouverte
    db: null, assets: null, user: null, downloads: null,
    moi: null, peutEcrire: null, noms: {},
    maPosition: null,
    gpsRefuse: false,  // la page n'a pas le droit de lire le GPS dans ce cadre
    zoom: 1, centre: null, carteBougee: false
  };
  var CACHE = "kl-suivi-v1";
  var ATTENTE = "kl-attente-v1";

  /* Base partagée hors de claude.ai : renseignée dans config.js, absente sinon.
     Le reste de l'app ne change pas — la file d'attente et le cache local
     fonctionnent de la même façon avec l'une ou l'autre. */
  var DISTANT = (function () {
    var c = window.KLCONF;
    if (!c || !c.url || !c.cle) return null;
    var base = c.url.replace(/\/+$/, "");
    return {
      lignes: base + "/rest/v1/suivi",
      /* stockage des photos prises sur le terrain : dépôt d'un côté,
         adresse publique de lecture de l'autre */
      depot: base + "/storage/v1/object/photos/",
      publique: base + "/storage/v1/object/public/photos/",
      cle: c.cle,
      entetes: {
        "apikey": c.cle,
        "Authorization": "Bearer " + c.cle,
        "Content-Type": "application/json"
      },
      sondage: (c.sondageSecondes || 30) * 1000
    };
  })();

  /* ---------------- utilitaires ---------------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var el = function (t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var minute = 0;
  function toast(m) {
    var t = $("#toast"); t.textContent = m; t.hidden = false;
    clearTimeout(minute); minute = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function suiviDe(id) {
    var d = S.suivi[id];
    return d || { taches: {}, obs: "", photos: [] };
  }
  function etatTache(id, tid) {
    var t = suiviDe(id).taches || {};
    return (t[tid] && t[tid].e) || "attente";
  }
  function bilanEcole(e) {
    var faits = 0, entames = 0, bloques = 0;
    for (var i = 0; i < e.taches.length; i++) {
      var s = etatTache(e.id, e.taches[i].id);
      if (s === "fait") faits++;
      else if (s === "encours") entames++;
      else if (s === "bloque") bloques++;
    }
    var total = e.taches.length;
    /* Deux façons d'être terminé. Avec un diagnostic arrêté, toutes les interventions
       sont faites. Sans diagnostic — J3-005 et J3-006, relevées sur le terrain — il n'y
       a rien à pointer : l'établissement se solde sur la seule foi des clichés « après »,
       par une marque portée dans sa fiche. */
    var soldeSurPieces = total === 0 && !!suiviDe(e.id).fini;
    return {
      faits: faits, entames: entames, bloques: bloques, total: total,
      surPieces: soldeSurPieces,
      fini: total > 0 ? faits === total : soldeSurPieces,
      demarre: faits + entames + bloques > 0 || soldeSurPieces
    };
  }
  /* ---------------- dates ---------------- */
  function jourISO(d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function decale(iso, n) {
    var d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + n);
    return jourISO(d);
  }
  function aujourdhui() { return jourISO(new Date()); }
  function demain() { return decale(aujourdhui(), 1); }
  function joursEntre(a, b) {
    return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
  }
  function dateLongue(iso) {
    var d = new Date(iso + "T12:00:00");
    var s = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function dateMoyenne(iso) {
    var d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  }
  function datePassage(id) { return suiviDe(id).date || ""; }

  /* Photos d'archive (tournées) + photos prises dans l'app. */
  function photosDe(id) {
    var arch = (ARCHIVE[id] || []).map(function (p) {
      return { url: p.f, ph: p.ph, archive: true, src: p.src };
    });
    /* Deux provenances : « u » pour une photo déposée dans Supabase, « a » pour
       une photo confiée au stockage de claude.ai. Les anciennes fiches gardent
       la seconde forme, elles restent lisibles là où elles ont été prises. */
    var champ = (suiviDe(id).photos || []).map(function (p, i) {
      return { url: p.u || ("/_blob/" + p.a), ph: p.ph, par: p.par, le: p.le, index: i };
    });
    return arch.concat(champ);
  }
  function passageConstate(id) {
    return photosDe(id).some(function (p) { return p.ph === "apres"; });
  }

  /* Une école absente du planning est hors du programme SONAGED / Cadre de Vie :
     soit elle n'a pas d'activité de désherbage, soit ses interventions relèvent
     d'un autre service. */
  function horsProgramme(e) { return !e.ordre; }

  /* ---------------- écoles sautées ----------------
     Une tournée ne se déroule pas toujours dans l'ordre : une cour sous l'eau
     attend le pompage du Service d'Hygiène, une emprise traitée à l'herbicide
     attend que le produit agisse. L'équipe passe à la suivante, et l'école
     reste en arrière sans que rien ne le signale. Ces trois fonctions la
     rattrapent, et disent pourquoi. */

  /* Rang le plus avancé déjà soldé dans chaque unité : au-delà, l'équipe est
     passée. Recalculé à chaque rendu, l'avancement bougeant en continu. */
  function rangsAtteints() {
    var m = {};
    ECOLES.forEach(function (e) {
      if (e.ordre && bilanEcole(e).fini) m[e.uc] = Math.max(m[e.uc] || 0, e.ordre);
    });
    return m;
  }

  /* La contrainte qui retient l'école, lue dans le diagnostic et le pointage.
     Un motif saisi par un agent prime sur tout : c'est un constat de terrain. */
  function contrainte(e) {
    /* Un relevé de reconnaissance prime sur tout : il date de la veille, le
       diagnostic date du 4 septembre. */
    var rec = suiviDe(e).constat;
    if (rec && rec.cle) {
      var c = constatDe(rec.cle);
      if (c) {
        return { court: c.court, cle: c.cle === "fermee" || c.cle === "acces" ? "bloque" : c.cle,
                 long: c.long + (rec.le ? " — relevé le " + dateMoyenne(rec.le.slice(0, 10)) : ""),
                 releve: true };
      }
    }
    var d = suiviDe(e).taches || {};
    for (var i = 0; i < e.taches.length; i++) {
      var t = d[e.taches[i].id];
      if (t && t.e === "bloque") {
        return { court: t.m || "Bloquée", long: (t.m || "Intervention bloquée") +
                 " — " + e.taches[i].label, cle: "bloque" };
      }
    }
    var chimique = false, pompage = false;
    e.taches.forEach(function (t) {
      var fait = etatTache(e.id, t.id) === "fait";
      if (t.service === "Cadre de Vie" && fait) chimique = true;
      if (!fait && /pompage|stagnante/i.test(t.label)) pompage = true;
    });
    if (pompage) {
      return { court: "Eau stagnante", cle: "eau",
               long: "Le pompage du Service d'Hygiène conditionne le nettoiement" };
    }
    if (chimique) {
      return { court: "Herbicide posé", cle: "chimique",
               long: "Traitée à l'herbicide par le Cadre de Vie, en attente de coupe" };
    }
    if (e.inondation) {
      return { court: "Inondation", cle: "eau",
               long: "Inondation constatée au diagnostic" };
    }
    return { court: "Motif à préciser", cle: "autre",
             long: "Aucune contrainte n'a été saisie : à renseigner depuis la fiche" };
  }

  function sautee(e, atteints) {
    if (horsProgramme(e) || bilanEcole(e).fini) return false;
    var rec = suiviDe(e).constat;
    if (rec && rec.cle === "prete") return false;   /* la contrainte est levée */
    var dt = datePassage(e.id);
    var auj = aujourdhui();
    if (dt && dt >= auj) return false;        /* programmée aujourd'hui ou plus tard */
    if (dt && dt < auj) return true;          /* le jour est passé, le travail non */
    if (contrainte(e).cle === "bloque") return true;
    return e.ordre < (atteints[e.uc] || 0);   /* l'équipe a soldé plus loin */
  }

  /* Un établissement peut entrer au programme avant d'avoir été relevé au GPS :
     sa fiche existe et se pointe, mais la carte et l'itinéraire l'ignorent tant
     que sa position n'est pas prise. */
  function situee(e) { return typeof e.lat === "number" && typeof e.lon === "number"; }

  /* Le programme compte 47 établissements pour 45 fiches : Cheikh Ahmed Tidiane
     Niass 1 et 2, comme Tanor Dieng 1 et 2, partagent chacun un même site.
     Sept écoles y ont été versées après le planning initial et portent la mention
     « ajoutée » : Ndangane 3 et 4, El Hadji Serigne Diaw et Parcelle 1, traitées
     les 28 et 29 septembre ; Moussa Sow et sa case des tout-petits à Kassaville,
     El Hadji Seck Faye à Kasnack, relevées au GPS le 30 septembre. */
  function nbEtab(liste) {
    return liste.reduce(function (n, e) { return n + e.codes.length; }, 0);
  }

  /* Le rapport d'exécution laisse des travaux partiels ou non constatés. */
  /* Dotation commune en petit matériel (section 3 du rapport d'exécution).
     Chaque fiche y renvoie plutôt que de la répéter ; ici on la déplie. */
  function listeDotation() {
    var l = el("div", "dotation-liste");
    (EXEC_META.dotation || []).forEach(function (d) {
      var r = el("div", "dotation-rangee");
      r.appendChild(el("span", null, d[0]));
      r.appendChild(el("span", "mono", String(d[1])));
      l.appendChild(r);
    });
    return l;
  }
  function totalDotation() {
    return (EXEC_META.dotation || []).reduce(function (n, d) { return n + d[1]; }, 0);
  }

  function aReserves(id) {
    var r = EXEC[id];
    return !!r && r.travaux.some(function (t) { return t[1] !== "fait"; });
  }
  function servicesDe(e) {
    var l = [];
    e.taches.forEach(function (t) { if (l.indexOf(t.service) === -1) l.push(t.service); });
    return l;
  }
  function serviceCourt(nom) {
    return nom.replace("Service d'", "").replace("Commune / Génie militaire", "Commune / Génie")
      .replace("Constructions scolaires", "Constructions");
  }

  function dateCourte(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) + " " +
      d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  function nomDe(uid) {
    if (!uid) return "";
    if (S.moi && uid === S.moi) return S.noms[uid] || "vous";
    return S.noms[uid] || "un agent";
  }

  /* ---------------- pile de navigation ----------------
     Sur Android, le bouton Retour du téléphone quitte l'application dès qu'il
     n'a rien à défaire. Chaque couche ouverte — onglet quitté, fiche, programme,
     photo — pousse donc une entrée dans l'historique : le Retour la dépile au
     lieu de sortir. Quand la pile est vide, le navigateur reprend la main et
     l'app se ferme, ce qui est le comportement attendu depuis l'accueil. */
  var PILE = [];
  var RETOUR = false;   // vrai pendant un retour : ne pas retoucher l'historique

  function empiler(nom, fermer) {
    PILE.push({ nom: nom, fermer: fermer });
    try { history.pushState({ kl: nom, n: PILE.length }, ""); } catch (e) { }
  }

  /* Fermeture demandée par un bouton de l'interface : on repasse par l'historique,
     sinon il y resterait une entrée fantôme et il faudrait appuyer deux fois. */
  function depiler(nom) {
    if (RETOUR || !PILE.length || PILE[PILE.length - 1].nom !== nom) return false;
    history.back();
    return true;
  }

  window.addEventListener("popstate", function () {
    if (!PILE.length) return;   /* plus rien à défaire : le navigateur quitte */
    var couche = PILE.pop();
    RETOUR = true;
    try { couche.fermer(); } finally { RETOUR = false; }
  });

  /* ---------------- persistance ----------------
     Tout ce qui est saisi part d'abord dans une file d'attente gardée sur
     l'appareil. Sans réseau, rien n'est perdu : la file est rejouée dès que la
     liaison revient, et les fiches en attente l'emportent sur celles du serveur
     tant qu'elles n'ont pas été confirmées. */
  function lireCache() {
    /* Hors de l'espace partagé, on part de l'instantané livré avec l'app ;
       la base partagée, quand elle répond, le remplace de toute façon. */
    if (window.KLSUIVI) {
      Object.keys(window.KLSUIVI).forEach(function (k) {
        S.suivi[k] = JSON.parse(JSON.stringify(window.KLSUIVI[k]));
      });
    }
    try {
      var b = localStorage.getItem(CACHE);
      if (b) {
        var loc = JSON.parse(b) || {};
        Object.keys(loc).forEach(function (k) { S.suivi[k] = loc[k]; });
      }
    } catch (e) { }
    try { var a = localStorage.getItem(ATTENTE); if (a) S.attente = JSON.parse(a) || {}; } catch (e) { }
    Object.keys(S.attente).forEach(function (id) { S.suivi[id] = S.attente[id].doc; });
  }
  function ecrireCache() {
    try { localStorage.setItem(CACHE, JSON.stringify(S.suivi)); } catch (e) { }
  }
  function ecrireAttente() {
    try {
      if (Object.keys(S.attente).length) localStorage.setItem(ATTENTE, JSON.stringify(S.attente));
      else localStorage.removeItem(ATTENTE);
    } catch (e) { }
    majBandeauAttente();
  }
  function nbAttente() { return Object.keys(S.attente).length; }

  function majBandeauAttente() {
    var n = nbAttente();
    var b = $("#attente");
    if (!b) return;
    b.hidden = n === 0;
    b.textContent = n + (n > 1 ? " saisies en attente" : " saisie en attente");
  }

  var files = {};   // une écriture à la fois par document

  function envoyer(id) {
    if (!S.attente[id]) return Promise.resolve();
    if (!S.db) return DISTANT ? envoyerDistant(id) : Promise.resolve();
    var seq = S.attente[id].seq;
    var precedent = files[id] || Promise.resolve();
    var suite = precedent.then(function () {
      if (!S.attente[id] || S.attente[id].seq !== seq) return;   // réécrit entre-temps
      return S.db.doc("suivi/" + id).set(JSON.parse(JSON.stringify(S.attente[id].doc)))
        .then(function () {
          if (S.attente[id] && S.attente[id].seq === seq) {
            delete S.attente[id];
            ecrireAttente();
          }
        });
    }).catch(function (err) {
      if (err && err.code === "invalid_argument") {
        S.peutEcrire = false;
        delete S.attente[id];
        ecrireAttente();
        toast("Vous n'avez pas les droits de saisie sur cette fiche.");
      } else {
        planifierRelance();   // la saisie reste en attente
      }
    });
    files[id] = suite;
    return suite;
  }

  /* --- base distante : lecture de toutes les lignes, écriture par fusion --- */
  function envoyerDistant(id) {
    var seq = S.attente[id].seq;
    var precedent = files[id] || Promise.resolve();
    var suite = precedent.then(function () {
      if (!S.attente[id] || S.attente[id].seq !== seq) return;
      return fetch(DISTANT.lignes, {
        method: "POST",
        headers: Object.assign({ "Prefer": "resolution=merge-duplicates" }, DISTANT.entetes),
        body: JSON.stringify([{ id: id, doc: S.attente[id].doc, maj: new Date().toISOString() }])
      }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        if (S.attente[id] && S.attente[id].seq === seq) {
          delete S.attente[id];
          ecrireAttente();
        }
      });
    }).catch(function () { planifierRelance(); });
    files[id] = suite;
    return suite;
  }

  function lireDistant(premier) {
    return fetch(DISTANT.lignes + "?select=id,doc", { headers: DISTANT.entetes })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (lignes) {
        var vu = {};
        lignes.forEach(function (l) { vu[l.id] = l.doc || {}; });
        Object.keys(S.attente).forEach(function (id) { vu[id] = S.attente[id].doc; });
        S.suivi = vu;
        ecrireCache();
        marqueLien("ok", "Données partagées");
        rafraichir();
        avisEnCours();
        if (premier) rejouerAttente();
      })
      .catch(function () {
        marqueLien("ko", "Base injoignable");
      });
  }

  var relance = 0;
  function planifierRelance() {
    if (relance || !nbAttente()) return;
    relance = setTimeout(function () {
      relance = 0;
      rejouerAttente();
    }, 15000);
  }
  function rejouerAttente() {
    if (!S.db && !DISTANT) return;
    var ids = Object.keys(S.attente);
    if (!ids.length) return;
    ids.forEach(envoyer);
  }

  function majSuivi(id, modif) {
    if (!S.suivi[id]) S.suivi[id] = { taches: {}, obs: "", photos: [] };
    modif(S.suivi[id]);
    S.suivi[id].maj = new Date().toISOString();
    ecrireCache();
    S.attente[id] = { seq: (S.attente[id] ? S.attente[id].seq : 0) + 1,
                      doc: JSON.parse(JSON.stringify(S.suivi[id])) };
    ecrireAttente();
    envoyer(id);
  }

  /* ---------------- connexion aux capacités ---------------- */
  function marqueLien(classe, texte) {
    var p = $("#etatLien .pastille");
    p.className = "pastille" + (classe ? " " + classe : "");
    $("#etatTexte").textContent = texte;
  }

  function connecter() {
    if (!window.claude || !window.claude.use) {
      if (!DISTANT) { marqueLien("", "Mode local"); return; }
      marqueLien("", "Connexion…");
      lireDistant(true);
      setInterval(function () { if (!document.hidden) lireDistant(false); }, DISTANT.sondage);
      window.addEventListener("online", function () { lireDistant(false); rejouerAttente(); });
      return;
    }
    window.claude.use("user").then(function (u) {
      if (!u) return;
      S.user = u;
      if (u.can) { try { S.peutEcrire = u.can("data.write"); } catch (e) { } }
      if (u.id) return u.id().then(function (i) { S.moi = i; return u.profiles ? u.profiles([i]) : null; })
        .then(function (p) { if (p && S.moi && p[S.moi]) S.noms[S.moi] = p[S.moi].name || ""; })
        .catch(function () { });
    }).catch(function () { });

    window.claude.use("assets").then(function (a) { S.assets = a; if (S.fiche) ouvrirFiche(S.fiche, true); }).catch(function () { });
    window.claude.use("downloads").then(function (d) { S.downloads = d; if (S.vue === "Bilan") rendreBilan(); }).catch(function () { });

    window.claude.use("db").then(function (db) {
      if (!db) { marqueLien("ko", "Base indisponible"); return; }
      S.db = db;
      rejouerAttente();
      db.collection("suivi").onSnapshot(function (snap) {
        var vu = {};
        snap.docs.forEach(function (d) { vu[d.id] = d.data() || {}; });
        /* les fiches encore en attente l'emportent : elles ne sont pas confirmées */
        Object.keys(S.attente).forEach(function (id) { vu[id] = S.attente[id].doc; });
        S.suivi = vu;
        ecrireCache();
        marqueLien("ok", snap.metadata && snap.metadata.fromCache ? "Sync…" : "Partagé");
        rafraichir();
        avisEnCours();
        rejouerAttente();
      }, function (err) {
        marqueLien("ko", err && err.code === "revoked" ? "Accès retiré" : "Liaison coupée");
      });
    }).catch(function () { marqueLien("ko", "Base indisponible"); });
  }

  function resoudreNoms() {
    if (!S.user || !S.user.profiles) return;
    var manquants = [];
    Object.keys(S.suivi).forEach(function (id) {
      var d = S.suivi[id] || {};
      Object.keys(d.taches || {}).forEach(function (t) {
        var u = d.taches[t].par; if (u && !(u in S.noms)) manquants.push(u);
      });
      (d.photos || []).forEach(function (p) { if (p.par && !(p.par in S.noms)) manquants.push(p.par); });
    });
    if (!manquants.length) return;
    S.user.profiles(manquants.slice(0, 40)).then(function (ps) {
      var change = false;
      Object.keys(ps || {}).forEach(function (k) { S.noms[k] = (ps[k] && ps[k].name) || ""; change = true; });
      if (change && S.fiche) ouvrirFiche(S.fiche, true);
    }).catch(function () { });
  }

  /* ---------------- filtres ---------------- */
  function ecolesFiltrees() {
    var q = S.q.trim().toLowerCase();
    return ECOLES.filter(function (e) {
      if (S.uc && e.uc !== S.uc) return false;
      var b = bilanEcole(e);
      if (S.etat === "reste" && b.fini) return false;
      if (S.etat === "encours" && !(b.demarre && !b.fini)) return false;
      if (S.etat === "fini" && !b.fini) return false;
      if (S.etat === "p1" && e.priorite !== 1) return false;
      if (S.service && !e.taches.some(function (t) { return t.service === S.service; })) return false;
      if (q) {
        var foin = (e.nom + " " + e.quartier + " " + e.codes.join(" ")).toLowerCase();
        if (foin.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function construireFiltres() {
    var uc = $("#filtresUC");
    uc.innerHTML = "";
    [[0, "Toutes les UC"], [1, "UC 1"], [2, "UC 2"], [3, "UC 3"]].forEach(function (p) {
      var n = ECOLES.filter(function (e) { return !p[0] || e.uc === p[0]; }).length;
      var b = el("button", "puce", p[1] + " · " + n);
      b.setAttribute("aria-pressed", String(S.uc === p[0]));
      b.onclick = function () { S.uc = p[0]; S.selection = null; S.coche = null; rafraichir(); };
      uc.appendChild(b);
    });

    var f = $("#filtresEtat");
    f.innerHTML = "";
    [["tous", "Toutes"], ["reste", "Reste à faire"], ["encours", "En cours"], ["fini", "Terminées"], ["p1", "Priorité 1"]].forEach(function (p) {
      var b = el("button", "puce" + (p[0] === "p1" ? " p1" : ""), p[1]);
      b.setAttribute("aria-pressed", String(S.etat === p[0]));
      b.onclick = function () { S.etat = S.etat === p[0] ? "tous" : p[0]; rafraichir(); };
      f.appendChild(b);
    });

    /* Chaque service ne voit que ses propres interventions : c'est ce qui rend
       l'app utilisable par l'Hygiène et les Constructions autant que par la SONAGED. */
    var sv = $("#filtresService");
    sv.innerHTML = "";
    var tousSv = el("button", "puce", "Tous les services");
    tousSv.setAttribute("aria-pressed", String(!S.service));
    tousSv.onclick = function () { S.service = ""; rafraichir(); };
    sv.appendChild(tousSv);
    SERVICES.forEach(function (x) {
      var n = ECOLES.reduce(function (a, e) {
        return a + e.taches.filter(function (t) { return t.service === x.nom; }).length;
      }, 0);
      if (!n) return;
      var b = el("button", "puce", serviceCourt(x.nom) + " · " + n);
      b.setAttribute("aria-pressed", String(S.service === x.nom));
      if (S.service === x.nom) { b.style.background = "var(" + x.css + ")"; b.style.borderColor = "var(" + x.css + ")"; b.style.color = "#fff"; }
      b.onclick = function () { S.service = S.service === x.nom ? "" : x.nom; rafraichir(); };
      sv.appendChild(b);
    });
  }

  /* ---------------- liste ---------------- */
  function rendreListe() {
    var liste = $("#liste");
    liste.innerHTML = "";
    var lot = ecolesFiltrees();
    var tachesTotal = 0, tachesFaites = 0;
    lot.forEach(function (e) {
      e.taches.forEach(function (t) {
        if (S.service && t.service !== S.service) return;
        tachesTotal++;
        if (etatTache(e.id, t.id) === "fait") tachesFaites++;
      });
    });

    $("#compteTexte").textContent = lot.length + (lot.length > 1 ? " établissements" : " établissement") +
      (S.service ? " · " + serviceCourt(S.service) : "");
    $("#compteTaches").textContent = tachesFaites + " / " + tachesTotal + " interventions";

    if (!lot.length) {
      var v = el("div", "vide", "Aucun établissement ne correspond à ce filtre.");
      liste.appendChild(v);
      return;
    }

    lot.forEach(function (e) { liste.appendChild(ligneEcole(e, { date: true })); });
  }

  /* Une ligne d'établissement, réutilisée par la liste et par le planning. */
  function ligneEcole(e, opt) {
    opt = opt || {};
    var b = bilanEcole(e);
    var ligne = el("button", "ligne");
    ligne.type = "button";
    ligne.onclick = function () { ouvrirFiche(e.id); };

    var filet = el("div", "filet" + (e.priorite === 1 ? " p1" : e.priorite === 3 ? " p3" : ""));
    filet.title = "Priorité " + e.priorite;
    ligne.appendChild(filet);

    var corps = el("div", "ligne-corps");
    corps.appendChild(el("div", "ligne-nom", e.nom));
    var meta = el("div", "ligne-meta");
    if (opt.rang && e.ordre) {
      var r = el("span", "rang mono", "N° " + e.ordre + (e.ajoute ? " · ajoutée" : ""));
      if (e.ajoute) r.classList.add("neuf");
      meta.appendChild(r);
    } else if (opt.rang) {
      /* Pas de numéro : l'école n'est pas au programme de nettoiement arrêté. Elle
         se coche et se date quand même, la ligne dit seulement d'où elle vient. */
      meta.appendChild(el("span", "code", "Autre service"));
    }
    meta.appendChild(el("span", "code mono", e.codes[0]));
    meta.appendChild(el("span", null, e.quartier));
    if (opt.motif) {
      var ct = contrainte(e);
      var pc = el("span", "motif motif-" + ct.cle, ct.court);
      pc.title = ct.long;
      meta.appendChild(pc);
    }
    meta.appendChild(el("span", "code", "UC " + e.uc));
    if (e.inondation) {
      var g = el("span", "goutte");
      g.innerHTML = '<svg width="10" height="12" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true"><path d="M6 0C6 0 1 6.1 1 9a5 5 0 0 0 10 0c0-2.9-5-9-5-9z"/></svg>Inondation';
      meta.appendChild(g);
    }
    if (opt.date && datePassage(e.id)) {
      meta.appendChild(el("span", "rang mono", dateMoyenne(datePassage(e.id))));
    }
    corps.appendChild(meta);
    ligne.appendChild(corps);

    var fin = el("div", "ligne-fin");
    if (b.fini && aReserves(e.id)) fin.appendChild(el("span", "etiq bloq", "Fini · réserves"));
    else if (b.fini) fin.appendChild(el("span", "etiq fini", "Terminé"));
    else if (b.bloques) fin.appendChild(el("span", "etiq bloq", b.bloques + " bloqué" + (b.bloques > 1 ? "s" : "")));
    else if (aReserves(e.id)) fin.appendChild(el("span", "etiq bloq", "Réserves"));
    else if (passageConstate(e.id)) fin.appendChild(el("span", "etiq bloq", "Passage constaté"));
    else if (e.priorite === 1) fin.appendChild(el("span", "etiq p1", "Priorité 1"));
    if (!b.total) {
      /* J3-005 et J3-006 : relevées sur le terrain, diagnostic pas encore arrêté */
      fin.appendChild(el("span", "ratio a-faire", b.fini ? "soldée sur pièces" : "à diagnostiquer"));
    } else {
      fin.appendChild(el("span", "ratio mono", b.faits + "/" + b.total));
      var j = el("div", "jauge");
      var i = el("i");
      i.style.width = Math.round(100 * b.faits / b.total) + "%";
      if (!b.faits && b.entames) { i.className = "part"; i.style.width = "12%"; }
      j.appendChild(i); fin.appendChild(j);
    }
    ligne.appendChild(fin);

    /* Le planning bouge en cours de campagne : une équipe est détournée, une école
       n'ouvre pas, la Commune change son affiche. La croix retire la date du jour et
       renvoie l'établissement dans « À programmer », d'où il sera redaté. Rien n'est
       effacé : ni le pointage, ni les photos, ni l'observation. Un span et non un
       bouton — la ligne en est déjà un, et un bouton dans un bouton n'est pas du
       HTML valide. */
    if (opt.retirer) {
      ligne.classList.add("avec-sup");
      var sup = el("span", "ligne-sup", "✕");
      sup.setAttribute("role", "button");
      sup.setAttribute("tabindex", "0");
      sup.setAttribute("aria-label", "Retirer " + e.nom + " de ce jour");
      sup.title = "Retirer de ce jour — l'école repart dans « À programmer »";
      var rendre = function () {
        majSuivi(e.id, function (doc) { doc.date = ""; });
        toast(e.nom + " — remise dans « À programmer ».");
        rendrePlanning();
      };
      sup.onclick = function (ev) { ev.stopPropagation(); rendre(); };
      sup.onkeydown = function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); rendre(); }
      };
      ligne.appendChild(sup);
    }

    /* Programmation groupée : la ligne ne mène plus à la fiche, elle se coche.
       Une case apparaît entre le filet de priorité et le corps. */
    if (opt.cocher) {
      var pris = !!S.coche[e.id];
      ligne.classList.add("cochable");
      if (pris) ligne.classList.add("prise");
      ligne.setAttribute("aria-pressed", String(pris));
      var marque = el("span", "coche-marque");
      marque.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" ' +
        'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true"><path d="M2.5 8.5 6 12l7.5-8"/></svg>';
      ligne.insertBefore(marque, corps);
      ligne.onclick = function () {
        if (S.coche[e.id]) delete S.coche[e.id]; else S.coche[e.id] = true;
        rendrePlanning();
      };
    }
    return ligne;
  }

  /* ---------------- planning ---------------- */
  function lotPlanning() {
    return (S.uc ? ECOLES.filter(function (e) { return e.uc === S.uc; }) : ECOLES);
  }
  function parOrdre(a, b) {
    if (a.uc !== b.uc) return a.uc - b.uc;
    if (!!a.ordre !== !!b.ordre) return a.ordre ? -1 : 1;
    if (a.ordre && b.ordre && a.ordre !== b.ordre) return a.ordre - b.ordre;
    return a.priorite - b.priorite;
  }
  function seau(e, atteints) {
    /* Une école soldée est passée, quelle que soit la date portée au planning :
       le jour n'a plus à la présenter comme un travail à faire, et une école
       terminée sans date n'a rien à faire dans « À programmer ».
       « Passées » ne garde donc que les soldées : une école dont le jour est
       passé sans que le travail soit fait a été sautée, et c'est autre chose. */
    if (bilanEcole(e).fini) return "passees";
    var d = datePassage(e.id);
    var auj = aujourdhui();
    if (d === auj) return "aujourdhui";
    if (d === decale(auj, 1)) return "demain";
    if (d && d > auj) return "avenir";
    if (sautee(e, atteints || rangsAtteints())) return "sautees";
    return "libre";
  }

  /* Itinéraire Google Maps. Sans paramètre origin, Maps part de la position du
     téléphone : c'est le seul chemin fiable, la page elle-même n'ayant pas accès
     au GPS dans le cadre où elle s'affiche. Quand une position a pu être relevée,
     on la passe explicitement en origin. */
  function urlItineraire(lot) {
    lot = (lot || []).filter(situee);
    if (!lot.length) return null;
    var l = lot.slice(0, 10);
    var arrivee = l[l.length - 1];
    var u = "https://www.google.com/maps/dir/?api=1&travelmode=driving";
    if (S.maPosition) u += "&origin=" + S.maPosition[0] + "," + S.maPosition[1];
    u += "&destination=" + arrivee.lat + "," + arrivee.lon;
    if (l.length > 1) {
      u += "&waypoints=" + l.slice(0, -1).map(function (e) { return e.lat + "," + e.lon; }).join("|");
    }
    return u;
  }

  /* Un lien véritable, jamais window.open : une fenêtre ouverte par script depuis
     le cadre où s'affiche la page est refusée par Google Maps
     (ERR_BLOCKED_BY_RESPONSE). Le lien, lui, ouvre bien l'application Maps du
     téléphone, qui part alors de la position réelle de l'agent. */
  function boutonItineraire(libelle, lot, plein) {
    var a = el("a", "btn" + (plein ? " plein" : "") + " large", libelle);
    var url = urlItineraire(lot);
    if (!url) {
      a.classList.add("desactive");
      a.setAttribute("aria-disabled", "true");
      a.title = "Position non relevée";
      return a;
    }
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  /* Répartit les écoles par jour. Celles qui relèvent d'autres services y figurent
     comme les autres : le programme du jour s'arrête sur le terrain, et une école
     hors du programme de nettoiement peut très bien être retenue pour une tournée.
     Leur ligne le rappelle, et le bloc du bas continue de dire quel service est en
     charge de celles qui ne sont pas déjà à l'écran. */
  function repartir(lot) {
    var s = { aujourdhui: [], demain: [], avenir: [], libre: [], sautees: [], passees: [] };
    var atteints = rangsAtteints();
    lot.forEach(function (e) { s[seau(e, atteints)].push(e); });
    return s;
  }

  /* Barre de la programmation groupée : le choix de la date, puis la validation.
     Elle remplace les actions habituelles du jour tant que le mode est ouvert. */
  function barreProgrammation(cochables, auj) {
    var ids = Object.keys(S.coche);
    var barre = el("div", "coche-barre");

    var haut = el("div", "coche-haut");
    haut.appendChild(el("span", "coche-compte", ids.length
      ? ids.length + (ids.length > 1 ? " écoles sélectionnées" : " école sélectionnée")
      : "Touchez les écoles à programmer"));
    /* « Tout » vise ce que l'écran montre, pas la sélection entière : celle-ci peut
       porter sur des écoles cochées dans un autre onglet, qu'un décochage local
       n'a pas à emporter. */
    var tousPris = cochables.length > 0 && cochables.every(function (e) { return !!S.coche[e.id]; });
    var tout = el("button", "puce", tousPris ? "Tout décocher" : "Tout cocher");
    tout.onclick = function () {
      cochables.forEach(function (e) {
        if (tousPris) delete S.coche[e.id]; else S.coche[e.id] = true;
      });
      rendrePlanning();
    };
    haut.appendChild(tout);
    barre.appendChild(haut);

    var rangee = el("div", "date-rangee");
    var champ = el("input", "date-champ");
    champ.type = "date";
    champ.value = S.cocheDate;
    champ.min = CAMPAGNE.debut;
    champ.onchange = function () { S.cocheDate = champ.value || ""; rendrePlanning(); };
    rangee.appendChild(champ);
    barre.appendChild(rangee);

    var racc = el("div", "date-raccourcis");
    [["Aujourd'hui", auj], ["Demain", decale(auj, 1)], ["Après-demain", decale(auj, 2)]].forEach(function (pr) {
      var b = el("button", "puce", pr[0]);
      b.setAttribute("aria-pressed", String(S.cocheDate === pr[1]));
      b.onclick = function () { S.cocheDate = pr[1]; rendrePlanning(); };
      racc.appendChild(b);
    });
    barre.appendChild(racc);

    var act = el("div", "tournee-actions");
    var ok = el("button", "btn plein large", ids.length
      ? "Programmer " + (ids.length > 1 ? "les " + ids.length + " écoles" : "l'école")
      : "Programmer");
    ok.disabled = !ids.length || !S.cocheDate;
    ok.onclick = function () { appliquerDate(ids, S.cocheDate, auj); };
    act.appendChild(ok);
    var annul = el("button", "btn", "Annuler");
    annul.onclick = function () { S.coche = null; rendrePlanning(); };
    act.appendChild(annul);
    barre.appendChild(act);

    /* Depuis un jour déjà daté, on peut aussi renvoyer des écoles à programmer :
       c'est ce qui sert quand une tournée est reportée. */
    if (S.jour !== "libre" && ids.length) {
      var retirer = el("button", "btn large", "Retirer la date");
      retirer.style.marginTop = "var(--e2)";
      retirer.onclick = function () { appliquerDate(ids, "", auj); };
      barre.appendChild(retirer);
    }

    barre.appendChild(el("p", "note-pied", "La date part dans la base partagée : les autres agents " +
      "la voient à la relecture suivante, sans rien republier."));
    return barre;
  }

  function appliquerDate(ids, date, auj) {
    ids.forEach(function (id) { majSuivi(id, function (doc) { doc.date = date; }); });
    S.coche = null;
    S.jourAuto = false;
    S.jour = !date ? "libre"
      : date === auj ? "aujourdhui"
      : date === decale(auj, 1) ? "demain"
      : date > auj ? "avenir" : "passees";
    rendrePlanning();
    toast(ids.length + (ids.length > 1 ? " écoles " : " école ") +
      (date ? "programmée" + (ids.length > 1 ? "s" : "") + " le " + dateMoyenne(date)
            : "remise" + (ids.length > 1 ? "s" : "") + " à programmer"));
  }

  function rendrePlanning() {
    var v = $("#vuePlanning");
    v.innerHTML = "";
    var auj = aujourdhui();
    var auProgramme = lotPlanning().filter(function (e) { return !horsProgramme(e); });
    var restantes = nbEtab(auProgramme.filter(function (e) { return !bilanEcole(e).fini; }));

    var ent = el("div", "jour-entete");
    var g = el("div");
    g.appendChild(el("div", "jour-date", dateLongue(auj)));
    g.appendChild(el("div", "jour-sous", CAMPAGNE.equipes + " équipes · démarrage le " +
      dateMoyenne(CAMPAGNE.debut) + " · J+" + joursEntre(CAMPAGNE.debut, auj)));
    ent.appendChild(g);
    var d = el("div", "jour-reste");
    d.appendChild(el("span", "n mono", restantes + "/" + nbEtab(auProgramme)));
    d.appendChild(el("span", "l", restantes > 1 ? "écoles restantes" : "école restante"));
    ent.appendChild(d);
    v.appendChild(ent);

    var lot = lotPlanning();
    var seaux = repartir(lot);
    /* tant que l'utilisateur n'a pas choisi d'onglet, ouvrir sur un jour qui a du contenu */
    if (S.jourAuto && !seaux[S.jour].length) {
      var ordre = ["demain", "aujourdhui", "avenir", "libre", "passees"];
      for (var oi = 0; oi < ordre.length; oi++) {
        if (seaux[ordre[oi]].length) { S.jour = ordre[oi]; break; }
      }
    }
    Object.keys(seaux).forEach(function (k) { seaux[k].sort(k === "libre" ? parOrdre : function (a, b) {
      var da = datePassage(a.id), db = datePassage(b.id);
      return da === db ? parOrdre(a, b) : (da < db ? -1 : 1);
    }); });

    var onglets = el("div", "filtres");
    [["demain", "Demain"], ["aujourdhui", "Aujourd'hui"], ["avenir", "Jours suivants"],
     ["sautees", "Sautées"], ["libre", "À programmer"],
     ["passees", "Passées"]].forEach(function (p) {
      var n = seaux[p[0]].length;
      var b = el("button", "puce", p[1] + (n ? " · " + n : ""));
      b.setAttribute("aria-pressed", String(S.jour === p[0]));
      /* La sélection survit au changement d'onglet : un jour se compose souvent
         d'écoles puisées dans plusieurs onglets — une à reprogrammer, une jamais
         datée. Le compte affiché dans la barre reste celui de tout le cochage. */
      b.onclick = function () { S.jour = p[0]; S.jourAuto = false; rendrePlanning(); };
      onglets.appendChild(b);
    });
    v.appendChild(onglets);

    var choisi = seaux[S.jour];
    /* Écoles relevant d'autres services que l'onglet courant ne montre pas déjà :
       elles sont listées sous le jour, et se cochent comme les autres. */
    var aLEcran = {};
    choisi.forEach(function (e) { aLEcran[e.id] = true; });
    var hors = lot.filter(function (e) { return horsProgramme(e) && !aLEcran[e.id]; });
    var cochables = choisi.concat(hors);
    var titres = {
      demain: ["Intervention de demain", dateLongue(decale(auj, 1))],
      aujourdhui: ["Intervention du jour", dateLongue(auj)],
      avenir: ["Jours suivants", "programmées au-delà de demain"],
      libre: ["À programmer", "au programme de nettoiement, sans date fixée"],
      sautees: ["Écoles sautées", (function () {
        var c = {};
        seaux.sautees.forEach(function (e) {
          var k = contrainte(e).court;
          c[k] = (c[k] || 0) + 1;
        });
        var l = Object.keys(c).map(function (k) { return c[k] + " " + k.toLowerCase(); });
        return l.length ? "les équipes sont passées devant : " + l.join(", ")
                        : "aucune école n'a été sautée";
      })()],
      passees: ["Passées", (function () {
        var f = seaux.passees.filter(function (e) { return bilanEcole(e).fini; }).length;
        var r = seaux.passees.length - f;
        return r ? f + " soldées, " + r + " datées d'un jour passé sans l'être encore"
                 : "toutes soldées";
      })()]
    };
    var bloc = el("div", "groupe-jour");
    var t = el("div", "groupe-titre" + (S.jour === "demain" ? " demain" : ""));
    t.appendChild(el("span", null, titres[S.jour][0]));
    t.appendChild(el("em", null, titres[S.jour][1]));
    bloc.appendChild(t);

    /* affiche officielle du jour concerné, quand la Commune en a diffusé une */
    var jourVise = S.jour === "demain" ? decale(auj, 1) : S.jour === "aujourdhui" ? auj : null;
    var aff = jourVise ? AFFICHES.filter(function (a) { return a.d.indexOf(jourVise) !== -1; })[0] : null;
    if (aff) {
      var fig = el("button", "affiche");
      fig.type = "button";
      var im = el("img");
      im.src = aff.f;
      im.alt = aff.t + " — programme de nettoiement des écoles, Commune de Kaolack";
      fig.appendChild(im);
      var cap = el("span", null, aff.t + " · affiche de la Commune, touchez pour l'agrandir");
      cap.style.cssText = "display:block;font-size:11.5px;color:var(--texte-3);padding:8px 11px;text-align:left;border-top:1px solid var(--trait)";
      fig.appendChild(cap);
      fig.onclick = function () {
        ouvrirVisionneuse({ nom: aff.t }, [{ url: aff.f, ph: "affiche" }], 0);
      };
      bloc.appendChild(fig);
    }

    /* Le planning se refait tous les jours, depuis un téléphone : ouvrir chaque
       fiche l'une après l'autre serait trop lent. Ici, on coche les écoles et on
       leur donne une date d'un seul geste. Aucun redéploiement n'est en jeu : la
       date part dans la base partagée comme n'importe quelle autre saisie. */
    function lanceurCoche() {
      var ouvrir = el("div", "tournee-actions coche-lancer");
      var lancer = el("button", "btn large", "Programmer pour ce jour");
      lancer.onclick = function () {
        S.coche = {};
        S.cocheDate = jourVise || (S.jour === "passees" ? auj : decale(auj, 1));
        rendrePlanning();
      };
      ouvrir.appendChild(lancer);
      return ouvrir;
    }
    var peutCocher = S.peutEcrire !== false && !S.coche && cochables.length > 0;

    if (!choisi.length) {
      var vide = el("div", "bloc");
      vide.style.textAlign = "center";
      /* Un jour vide parce que tout est soldé n'est pas un jour sans programme. */
      var soldees = jourVise ? lot.filter(function (e) {
        return datePassage(e.id) === jourVise && bilanEcole(e).fini;
      }).length : 0;
      vide.appendChild(el("p", null, S.jour === "libre"
        ? "Toutes les écoles de ce périmètre ont une date de passage."
        : soldees
          ? (soldees > 1
              ? "Les " + soldees + " écoles du jour sont soldées : elles ont rejoint « Passées »."
              : "L'école du jour est soldée : elle a rejoint « Passées ».")
        : "Aucune école programmée. Ouvrez « À programmer » et fixez une date de passage."))
        .style.cssText = "margin:0;color:var(--texte-3);font-size:14px";
      bloc.appendChild(vide);
      if (peutCocher) bloc.appendChild(lanceurCoche());
      v.appendChild(bloc);
    } else {
      if (peutCocher) bloc.appendChild(lanceurCoche());

      /* La croix ne s'offre que sur les jours datés à venir — dans « À programmer »
         il n'y a pas de date à retirer, et une école soldée ne retourne pas en
         attente. Jamais pendant le cochage, où la ligne entière sert de case. */
      var jourDate = S.jour === "demain" || S.jour === "aujourdhui" || S.jour === "avenir";
      var opt = { rang: true, date: S.jour !== "libre", cocher: !!S.coche,
        motif: S.jour === "sautees",
        retirer: jourDate && !S.coche && S.peutEcrire !== false };
      if (S.jour === "sautees" && !S.coche) {
        bloc.appendChild(el("p", "note-hors", "Une tournée ne se déroule pas toujours dans " +
          "l'ordre : une cour sous l'eau attend le pompage du Service d'Hygiène, une emprise " +
          "traitée à l'herbicide attend que le produit agisse. Ces écoles ont été dépassées — " +
          "la contrainte est portée sur chaque ligne. Elles se reprogramment comme les " +
          "autres : touchez « Programmer pour ce jour », puis cochez-les ici même."));
      }
      var liste = el("div", "liste");
      choisi.forEach(function (e) { liste.appendChild(ligneEcole(e, opt)); });
      bloc.appendChild(liste);

      if (!S.coche && (S.jour === "demain" || S.jour === "aujourdhui")) {
        /* Une seule affiche par jour. Celle de la Commune fait foi : elle est déjà
           au-dessus, touchable pour l'agrandir. L'app n'en produit une que les
           jours où la Commune n'en a pas diffusé. */
        if (!aff) {
          var act = el("div", "tournee-actions");
          var aff2 = el("button", "btn plein large", "Afficher le programme");
          aff2.onclick = function () { ouvrirProgramme(jourVise || auj, choisi); };
          act.appendChild(aff2);
          bloc.appendChild(act);
        }

        /* Conduire vers une seule école, ou la situer seule, ferait double emploi
           avec les boutons de sa fiche. Ici, les deux n'ont d'intérêt qu'en groupe. */
        if (choisi.length > 1) {
          var n = Math.min(choisi.length, 10);
          var chaine = el("div", "tournee-actions");
          chaine.appendChild(boutonItineraire("Enchaîner les " + n + " écoles du jour", choisi, false));
          var carte = el("button", "btn large", "Les situer sur la carte");
          carte.onclick = function () { viserLot(choisi); allerA("Carte"); };
          chaine.appendChild(carte);
          bloc.appendChild(chaine);
          if (choisi.length > 10) {
            bloc.appendChild(el("p", "note-pied", "Google Maps n'accepte pas plus de dix arrêts : " +
              "l'itinéraire s'arrête aux dix premières écoles de la liste."));
          }
        }
      }
      v.appendChild(bloc);
    }

    /* Écoles hors du programme SONAGED / Cadre de Vie. */
    if (hors.length) {
      var bh = el("div", "bloc");
      var th = el("div", "bloc-titre");
      th.appendChild(el("span", null, "Relèvent d'autres services"));
      th.appendChild(el("span", "mono", hors.length + ""));
      bh.appendChild(th);
      bh.appendChild(el("p", "note-hors", "Ces établissements ne figurent pas au programme de nettoiement : " +
        "soit ils n'ont aucune activité de désherbage, soit la SONAGED et le Cadre de Vie n'y sont pas " +
        "concernés et l'intervention relève d'un autre service — souvent le pompage du Service d'Hygiène, " +
        "préalable à tout nettoiement. Elles se retiennent pour une tournée comme les " +
        "autres : touchez « Programmer pour ce jour », puis cochez-les ici même. " +
        "Services en charge :"));
      hors.sort(function (a, b) { return a.priorite - b.priorite; });
      if (S.coche) {
        /* Pendant le cochage, ces écoles se présentent comme celles du jour : c'est
           la seule façon de les retenir pour une tournée. Le service en charge se
           lit dans leur fiche, et leur ligne porte la mention « Autre service ». */
        var lc = el("div", "liste");
        hors.forEach(function (e) {
          lc.appendChild(ligneEcole(e, { rang: true, date: true, cocher: true }));
        });
        bh.appendChild(lc);
      } else {
        var lh = el("div", "alerte-liste");
        hors.forEach(function (e) {
          var w = el("div", "alerte");
          var pt = el("span", "pt");
          pt.style.background = e.priorite === 1 ? "var(--laterite)" : "var(--trait-fort)";
          w.appendChild(pt);
          var tx = el("div");
          tx.appendChild(el("div", null, e.nom));
          tx.appendChild(el("em", null, e.quartier + " · UC " + e.uc + " · priorité " + e.priorite +
            (e.inondation ? " · inondation constatée" : "")));
          var chips = el("div", "services-rangee");
          servicesDe(e).forEach(function (s) {
            var c = el("span", "service-puce", serviceCourt(s));
            c.style.color = couleurService(s);
            c.style.borderColor = couleurService(s);
            chips.appendChild(c);
          });
          tx.appendChild(chips);
          w.appendChild(tx);
          w.style.cursor = "pointer";
          w.onclick = function () { ouvrirFiche(e.id); };
          lh.appendChild(w);
        });
        bh.appendChild(lh);
      }
      v.appendChild(bh);
    }

    /* La barre de date vient sous toutes les listes cochables : on coche d'abord,
       où que soient les écoles, on date ensuite. */
    if (S.coche) v.appendChild(barreProgrammation(cochables, auj));

    if (EXEC_META.sequence) v.appendChild(el("p", "note-pied", EXEC_META.sequence));
    var prog = ECOLES.filter(function (e) { return !horsProgramme(e); });
    v.appendChild(el("p", "note-pied", "Programme arrêté : " + nbEtab(prog) + " établissements " +
      "(" + nbEtab(ECOLES.filter(function (e) { return e.uc === 1 && !horsProgramme(e); })) + " en UC 1, " +
      nbEtab(ECOLES.filter(function (e) { return e.uc === 2 && !horsProgramme(e); })) + " en UC 2, " +
      nbEtab(ECOLES.filter(function (e) { return e.uc === 3 && !horsProgramme(e); })) + " en UC 3), " +
      "répartis en " + prog.length + " fiches : Cheikh Ahmed Tidiane Niass 1 et 2, comme Tanor Dieng 1 et 2, " +
      "partagent chacun un même site."));
    v.appendChild(el("p", "note-pied", "Sources : planning des interventions et rapport d'exécution — " +
      "SONAGED Kaolack. Les documents fixent l'ordre de passage ; la date de chaque école se règle ici, " +
      "dans sa fiche, et se met à jour pour tout le monde."));
  }

  /* ---------------- programme du jour, prêt à diffuser ----------------
     Reprend la mise en page des affiches de la Commune : le responsable fixe
     les dates dans l'app, capture cet écran et le diffuse. */
  function texteProgramme(jour, lot) {
    var NL = String.fromCharCode(10);
    var l = ["PROGRAMME DE NETTOIEMENT DES ÉCOLES — COMMUNE DE KAOLACK",
             "Programme du " + dateLongue(jour).toLowerCase(), ""];
    lot.forEach(function (e) { l.push("• " + e.nom + " : quartier " + e.quartier); });
    l.push("", "#NettoiementÉcoles #KaolackPropre #Engagement");
    return l.join(NL);
  }

  function fermerProgrammeReel() {
    var v = $("#programme");
    if (v) v.remove();
    if (!S.fiche) document.body.style.overflow = "";
  }

  function fermerProgramme() {
    if (depiler("programme")) return;
    fermerProgrammeReel();
  }

  function ouvrirProgramme(jour, lot) {
    var v = $("#programme");
    var deja = !!v;
    if (v) v.remove();
    if (!deja) empiler("programme", fermerProgrammeReel);
    v = el("div", "programme");
    v.id = "programme";
    v.setAttribute("role", "dialog");
    v.setAttribute("aria-label", "Programme du " + dateLongue(jour));

    var carte = el("div", "affiche-carte");
    var ent = el("div", "affiche-logos");
    [["logos/cadredevie.png", "Cadre de Vie"],
     ["logos/commune.png", "Commune de Kaolack"],
     ["logos/sonaged.png", "SONAGED"]].forEach(function (p) {
      var c = el("span", "affiche-logo");
      var im = el("img"); im.src = p[0]; im.alt = p[1];
      c.appendChild(im); ent.appendChild(c);
    });
    carte.appendChild(ent);

    var t = el("h2", "affiche-titre");
    t.innerHTML = "PROGRAMME DE NETTOIEMENT DES ÉCOLES <span>COMMUNE DE KAOLACK</span>";
    carte.appendChild(t);
    carte.appendChild(el("div", "affiche-bandeau", "PROGRAMME DU " + dateLongue(jour).toUpperCase()));

    var liste = el("div", "affiche-liste");
    if (!lot.length) {
      liste.appendChild(el("p", "affiche-vide", "Aucune école programmée pour ce jour."));
    } else {
      lot.forEach(function (e) {
        var l = el("div", "affiche-ligne");
        var ic = el("span", "affiche-ecusson");
        ic.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-6h6v6"/></svg>';
        l.appendChild(ic);
        l.appendChild(el("span", "affiche-nom", e.nom + " : quartier " + e.quartier));
        liste.appendChild(l);
      });
    }
    carte.appendChild(liste);
    carte.appendChild(el("div", "affiche-pied", "#NettoiementÉcoles #KaolackPropre #Engagement"));
    v.appendChild(carte);

    var outils = el("div", "programme-outils");
    var fermer = el("button", "btn large", "Fermer");
    fermer.onclick = fermerProgramme;
    var copier = el("button", "btn plein large", "Copier le texte");
    copier.onclick = function () {
      var txt = texteProgramme(jour, lot);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt)
          .then(function () { toast("Programme copié — collez-le dans WhatsApp."); })
          .catch(function () { toast("Copie refusée : capturez l'écran à la place."); });
      } else {
        toast("Copie indisponible : capturez l'écran.");
      }
    };
    outils.appendChild(fermer);
    outils.appendChild(copier);
    v.appendChild(outils);
    v.appendChild(el("p", "programme-aide",
      "Capturez cet écran et diffusez-le, ou copiez le texte. Les écoles affichées sont celles dont la " +
      "date de passage est fixée à ce jour."));

    document.body.appendChild(v);
    document.body.style.overflow = "hidden";
    copier.focus();
  }

  /* ---------------- carte ---------------- */
  /* Projection plate-carrée à l'échelle : la longitude est corrigée par cos(latitude)
     pour que 1 px vaille la même distance au sol horizontalement et verticalement. */
  var PROJ = (function () {
    var minLon = 1e9, maxLon = -1e9, minLat = 1e9, maxLat = -1e9;
    var rings = COMMUNE.concat(QUARTIERS.reduce(function (a, q) { return a.concat(q.rings); }, []));
    rings.forEach(function (r) {
      r.forEach(function (p) {
        if (p[0] < minLon) minLon = p[0]; if (p[0] > maxLon) maxLon = p[0];
        if (p[1] < minLat) minLat = p[1]; if (p[1] > maxLat) maxLat = p[1];
      });
    });
    var k = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
    var m = 16, L = 1000;
    var largeurDeg = (maxLon - minLon) * k, hauteurDeg = maxLat - minLat;
    var s = (L - 2 * m) / largeurDeg;                       // px par degré corrigé
    var H = Math.round(hauteurDeg * s) + 2 * m;
    return {
      L: L, H: H,
      x: function (lon) { return m + (lon - minLon) * k * s; },
      y: function (lat) { return H - m - (lat - minLat) * s; }
    };
  })();

  function chemin(rings) {
    return rings.map(function (r) {
      return "M" + r.map(function (p) { return PROJ.x(p[0]).toFixed(1) + " " + PROJ.y(p[1]).toFixed(1); }).join("L") + "Z";
    }).join(" ");
  }

  function couleurEtatEcole(e) {
    var b = bilanEcole(e);
    if (b.fini) return "var(--vert)";
    if (b.demarre) return "var(--ambre)";
    return "var(--trait-fort)";
  }

  /* Cadrage : les écoles occupent le nord-est de la commune — on cadre sur elles
     (le reste du fond de plan est simplement rogné) pour garder des points lisibles. */
  var ZOOM_MIN = 1, ZOOM_MAX = 10;

  /* Cadre de départ : toute la commune de Kaolack, limite comprise. */
  function cadreBase() { return [0, 0, PROJ.L, PROJ.H]; }

  /* Fenêtre visible : le cadre de base réduit par le zoom, recentré, et maintenu
     à l'intérieur du cadre pour qu'on ne puisse pas faire sortir la carte. */
  function cadreVue() {
    var b = cadreBase();
    if (!S.centre) S.centre = [b[0] + b[2] / 2, b[1] + b[3] / 2];
    var w = b[2] / S.zoom, h = b[3] / S.zoom;
    var cx = Math.min(Math.max(S.centre[0], b[0] + w / 2), b[0] + b[2] - w / 2);
    var cy = Math.min(Math.max(S.centre[1], b[1] + h / 2), b[1] + b[3] - h / 2);
    S.centre = [cx, cy];
    return [cx - w / 2, cy - h / 2, w, h];
  }
  /* Centre du semis d'écoles : c'est là qu'on veut atterrir en zoomant,
     la commune s'étendant loin au sud-ouest sans aucun établissement. */
  var CENTRE_ECOLES = (function () {
    var x = 0, y = 0;
    var n = 0;
    ECOLES.forEach(function (e) {
      if (!situee(e)) return;
      x += PROJ.x(e.lon); y += PROJ.y(e.lat); n++;
    });
    return [x / n, y / n];
  })();

  function majViewBox() {
    var v = cadreVue();
    var svg = $("#carte");
    svg.setAttribute("viewBox", v.map(function (n) { return n.toFixed(1); }).join(" "));
    svg.style.setProperty("--zw", (1 + Math.min(1.3, (S.zoom - 1) * 0.17)).toFixed(2));
    var k = (1 / S.zoom).toFixed(3);
    Array.prototype.forEach.call(svg.querySelectorAll(".pt"), function (g) {
      g.setAttribute("transform", "translate(" + g.getAttribute("data-x") + " " +
        g.getAttribute("data-y") + ") scale(" + k + ")");
    });
    if (S.marqueurPosition) {
      S.marqueurPosition.setAttribute("transform", "translate(" + S.marqueurPosition.getAttribute("data-x") +
        " " + S.marqueurPosition.getAttribute("data-y") + ") scale(" + k + ")");
    }
  }
  function zoomer(facteur) {
    /* premier zoom depuis la vue d'ensemble : viser les écoles, pas le vide */
    if (facteur > 1 && S.zoom <= ZOOM_MIN + 0.01) S.centre = CENTRE_ECOLES.slice();
    S.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, S.zoom * facteur));
    majViewBox();
    majOutilsCarte();
  }
  /* Cadrer la carte sur un groupe d'écoles : le centre et le zoom se calculent
     pour que toutes tiennent dans la vue, avec une marge. */
  function viserLot(lot) {
    if (!lot || !lot.length) return;
    if (lot.length === 1) { viserEcole(lot[0].id); return; }
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    lot = lot.filter(situee);
    if (!lot.length) return;
    if (lot.length === 1) { viserEcole(lot[0].id); return; }
    lot.forEach(function (e) {
      var x = PROJ.x(e.lon), y = PROJ.y(e.lat);
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    });
    var b = cadreBase();
    var marge = 70;
    var zx = b[2] / Math.max(40, x1 - x0 + marge * 2);
    var zy = b[3] / Math.max(40, y1 - y0 + marge * 2);
    S.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(zx, zy)));
    S.centre = [(x0 + x1) / 2, (y0 + y1) / 2];
    S.selection = null;
  }

  /* Cadrer la carte sur une école précise. */
  function viserEcole(id) {
    var e = ECOLES.filter(function (x) { return x.id === id; })[0];
    if (!e || !situee(e)) return;
    S.selection = id;
    S.centre = [PROJ.x(e.lon), PROJ.y(e.lat)];
    S.zoom = Math.max(S.zoom, 5);
  }

  function recadrer() {
    S.zoom = 1; S.centre = null;
    majViewBox();
    majOutilsCarte();
  }
  function majOutilsCarte() {
    var moins = $("#carteMoins"), plus = $("#cartePlus");
    if (!moins) return;
    moins.disabled = S.zoom <= ZOOM_MIN + 0.01;
    plus.disabled = S.zoom >= ZOOM_MAX - 0.01;
    $("#carteNiveau").textContent = "×" + (S.zoom < 10 ? S.zoom.toFixed(1) : "10");
  }

  /* Glisser pour déplacer, pincer ou molette pour zoomer. Pendant le geste on ne
     touche qu'à l'attribut viewBox : redessiner casserait la capture du pointeur. */
  function installerGestes(svg) {
    if (svg.dataset.gestes) return;
    svg.dataset.gestes = "1";
    var doigts = {}, precedent = null;

    function etat() {
      var l = Object.keys(doigts).map(function (k) { return doigts[k]; });
      if (!l.length) return null;
      var cx = 0, cy = 0;
      l.forEach(function (p) { cx += p.x; cy += p.y; });
      cx /= l.length; cy /= l.length;
      var d = l.length === 2 ? Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y) : 0;
      return { n: l.length, cx: cx, cy: cy, d: d };
    }

    svg.addEventListener("pointerdown", function (ev) {
      doigts[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      try { svg.setPointerCapture(ev.pointerId); } catch (e) { }
      precedent = etat();
      S.carteBougee = false;
    });
    svg.addEventListener("pointermove", function (ev) {
      if (!doigts[ev.pointerId]) return;
      doigts[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var e = etat();
      if (!precedent || !e) return;
      var r = svg.getBoundingClientRect();
      var unite = cadreVue()[2] / r.width;
      if (e.n === 2 && precedent.n === 2 && precedent.d > 4) {
        S.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, S.zoom * (e.d / precedent.d)));
        S.carteBougee = true;
      }
      var dx = e.cx - precedent.cx, dy = e.cy - precedent.cy;
      if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
        S.centre[0] -= dx * unite;
        S.centre[1] -= dy * unite;
      }
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) S.carteBougee = true;
      precedent = e;
      majViewBox();
      majOutilsCarte();
    });
    function relacher(ev) {
      delete doigts[ev.pointerId];
      precedent = etat();
      if (!precedent) setTimeout(function () { S.carteBougee = false; }, 60);
    }
    svg.addEventListener("pointerup", relacher);
    svg.addEventListener("pointercancel", relacher);
    svg.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      zoomer(ev.deltaY < 0 ? 1.18 : 1 / 1.18);
    }, { passive: false });
    svg.addEventListener("dblclick", function () { zoomer(1.8); });
  }

  var carteFond = "";
  function rendreCarte() {
    var svg = $("#carte");
    majViewBox();
    installerGestes(svg);
    if (!carteFond) {
      /* Fond de plan OpenStreetMap, dessiné en vectoriel : lisible à tous les
         niveaux de zoom et sans consommer de données sur le terrain.
         non-scaling-stroke garde l'épaisseur des traits constante à l'écran. */
      var p = [], nse = ' vector-effect="non-scaling-stroke" ';
      function couche(d, style) {
        if (d) p.push('<path d="' + d + '"' + nse + style + ' stroke-linejoin="round" stroke-linecap="round"/>');
      }
      p.push('<path d="' + chemin(QUARTIERS.reduce(function (a, q) { return a.concat(q.rings); }, [])) +
        '" class="c-quartier" fill="var(--creux)" stroke="var(--trait)"' + nse + 'stroke-linejoin="round"/>');
      couche(OSM.eauSurf, 'class="c-eauSurf" fill="var(--eau)" stroke="var(--eau)"');
      couche(OSM.piste, 'class="c-piste" fill="none" stroke="var(--trait-fort)"');
      couche(OSM.rue, 'class="c-rue" fill="none" stroke="var(--trait-fort)"');
      couche(OSM.eau, 'class="c-eau" fill="none" stroke="var(--eau)"');
      couche(OSM.secondaire, 'class="c-sec" fill="none" stroke="var(--texte-3)"');
      couche(OSM.principale, 'class="c-prim" fill="none" stroke="var(--texte-2)"');
      couche(OSM.rail, 'class="c-rail" fill="none" stroke="var(--texte-3)"');
      p.push('<path d="' + chemin(COMMUNE) + '" class="c-limite" fill="none" stroke="var(--laterite)"' +
        nse + 'stroke-linejoin="round"/>');
      carteFond = p.join("");
    }
    var pts = [], visibles = ecolesFiltrees();
    var ids = {}; visibles.forEach(function (e) { ids[e.id] = 1; });
    ECOLES.forEach(function (e) {
      if (!ids[e.id] || !situee(e)) return;
      /* Marqueur dessiné autour de l'origine, positionné par translate : le
         groupe est remis à l'échelle 1/zoom pour garder une taille constante
         à l'écran, donc toujours atteignable au doigt. */
      var x = PROJ.x(e.lon), y = PROJ.y(e.lat), k = 1 / S.zoom;
      var g = '<g class="pt" data-id="' + e.id + '" data-x="' + x.toFixed(1) + '" data-y="' + y.toFixed(1) +
        '" transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') scale(' + k.toFixed(3) +
        ')" role="button" tabindex="0" aria-label="' + esc(e.nom) + '">';
      g += '<circle r="34" fill="transparent"/>';
      if (S.selection === e.id) g += '<circle r="25" fill="none" stroke="var(--texte)" stroke-width="4"/>';
      if (e.priorite === 1) g += '<circle r="18" fill="none" stroke="var(--laterite)" stroke-width="3.4"/>';
      g += '<circle r="12" fill="' + couleurEtatEcole(e) + '" stroke="var(--surface)" stroke-width="3"/>';
      if (e.inondation) g += '<circle cx="13" cy="-13" r="6" fill="var(--eau)" stroke="var(--surface)" stroke-width="2.6"/>';
      g += "</g>";
      pts.push(g);
    });
    if (S.maPosition) {
      var mx = PROJ.x(S.maPosition[1]).toFixed(1), my = PROJ.y(S.maPosition[0]).toFixed(1);
      pts.push('<g id="maPosition" data-x="' + mx + '" data-y="' + my + '" transform="translate(' + mx +
        ' ' + my + ') scale(' + (1 / S.zoom).toFixed(3) + ')">' +
        '<circle r="26" fill="var(--eau)" opacity="0.18"/>' +
        '<circle r="9" fill="var(--eau)" stroke="var(--surface)" stroke-width="3"/></g>');
    }
    svg.innerHTML = carteFond + pts.join("");
    S.marqueurPosition = $("#maPosition");
    Array.prototype.forEach.call(svg.querySelectorAll(".pt"), function (g) {
      g.style.cursor = "pointer";
      var choisir = function () {
        S.selection = g.getAttribute("data-id");
        rendreCarte(); rendreApercu();
      };
      /* un glissement de carte ne doit pas sélectionner l'école survolée */
      g.addEventListener("click", function () { if (!S.carteBougee) choisir(); });
      g.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); choisir(); }
      });
    });
    majOutilsCarte();
    rendreApercu();
  }

  function rendreApercu() {
    var c = $("#apercu");
    c.innerHTML = "";
    var boite = el("div", "apercu");
    if (!S.selection) {
      boite.appendChild(el("h3", null, "Touchez un point pour ouvrir la fiche"));
      boite.appendChild(el("p", null, ecolesFiltrees().length + " établissements affichés · fond de plan hors ligne."))
        .style.cssText = "font-size:13px;color:var(--texte-2);margin:0";
      var act = el("div", "apercu-actions");
      if (S.gpsRefuse) {
        var note = el("p", null, "Le repérage de votre position n'est pas autorisé pour cette page. " +
          "Le bouton « M'y conduire » reste fiable : Google Maps, lui, part bien de votre position.");
        note.style.cssText = "font-size:12.5px;color:var(--texte-3);margin:11px 0 0;line-height:1.4";
        boite.appendChild(note);
      } else {
        var bp = el("button", "btn large", S.maPosition ? "Actualiser ma position" : "Me situer sur la carte");
        bp.onclick = function () { localiser(bp); };
        act.appendChild(bp);
        boite.appendChild(act);
      }
      c.appendChild(boite);
      return;
    }
    var e = ECOLES.filter(function (x) { return x.id === S.selection; })[0];
    var b = bilanEcole(e);
    boite.appendChild(el("h3", null, e.nom));
    var m = el("div", "ligne-meta");
    m.appendChild(el("span", "code mono", e.codes[0]));
    m.appendChild(el("span", null, e.quartier + " · UC " + e.uc));
    m.appendChild(el("span", "ratio mono", b.faits + "/" + b.total));
    boite.appendChild(m);
    var act2 = el("div", "apercu-actions");
    var b1 = el("button", "btn plein large", "Ouvrir la fiche");
    b1.onclick = function () { ouvrirFiche(e.id); };
    act2.appendChild(b1);
    act2.appendChild(boutonItineraire("M'y conduire", [e], false));
    boite.appendChild(act2);
    c.appendChild(boite);
  }

  function localiser(btn) {
    if (!navigator.geolocation) {
      S.gpsRefuse = true; rendreApercu();
      toast("Cet appareil ne fournit pas de position.");
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = "Recherche…"; }
    navigator.geolocation.getCurrentPosition(function (p) {
      S.maPosition = [p.coords.latitude, p.coords.longitude];
      /* Relever la position sans y amener la carte ne sert à rien : on cadre
         dessus. Hors de la zone levée, cadrer montrerait du vide — on le dit. */
      var x = PROJ.x(p.coords.longitude), y = PROJ.y(p.coords.latitude);
      var cb = cadreBase();
      var dedans = x >= cb[0] && x <= cb[0] + cb[2] && y >= cb[1] && y <= cb[1] + cb[3];
      if (dedans) {
        S.centre = [x, y];
        S.zoom = Math.max(S.zoom, 6);
      }
      rendreCarte();
      toast(dedans
        ? "Position relevée (± " + Math.round(p.coords.accuracy) + " m)"
        : "Position relevée, mais hors de la commune de Kaolack.");
    }, function (err) {
      /* code 1 = refus : souvent la page elle-même n'a pas le droit de lire le GPS
         dans le cadre où elle s'affiche, indépendamment du réglage du téléphone. */
      S.gpsRefuse = err && err.code === 1;
      rendreApercu();
      toast(S.gpsRefuse
        ? "Position non autorisée pour cette page."
        : "Position introuvable — réessayez à l'extérieur.");
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 });
  }

  /* ---------------- correspondant de l'établissement ----------------
     Le référent de l'école — directeur, surveillant, délégué — et son numéro.
     Ils vivent dans le document partagé : saisis une fois depuis un téléphone,
     ils sont connus de tous les agents. */
  var CORR_EDITION = false;   // la fiche ouverte montre-t-elle la saisie ?

  function correspondantDe(id) {
    var c = suiviDe(id).correspondant;
    return (c && typeof c === "object") ? c : { nom: "", tel: "" };
  }

  /* Un numéro sénégalais se compose à neuf chiffres, mais les liens d'appel et
     de WhatsApp veulent la forme internationale. */
  function telInternational(tel) {
    var n = String(tel || "").replace(/[^\d+]/g, "");
    if (!n) return "";
    if (n.charAt(0) === "+") return n;
    if (n.indexOf("00") === 0) return "+" + n.slice(2);
    if (n.indexOf("221") === 0) return "+" + n;
    if (n.length === 9) return "+221" + n;
    return "+" + n;
  }

  function blocCorrespondant(id) {
    var c = correspondantDe(id);
    var bloc = el("div", "bloc");
    var titre = el("div", "bloc-titre");
    titre.appendChild(el("span", null, "Correspondant de l'établissement"));
    bloc.appendChild(titre);

    if (!CORR_EDITION) {
      if (!c.tel && !c.nom) {
        var ajout = el("button", "btn large", "Ajouter le correspondant");
        ajout.type = "button";
        if (S.peutEcrire === false) ajout.disabled = true;
        ajout.onclick = function () { CORR_EDITION = true; ouvrirFiche(id, true); };
        bloc.appendChild(ajout);
        bloc.appendChild(el("p", "note-pied", "Le référent de l'école et son numéro : "
          + "directeur, surveillant général ou délégué. Renseignés une fois, ils servent "
          + "à toutes les équipes qui passeront ensuite."));
        return bloc;
      }

      var carte = el("div", "corr-fiche");
      if (c.nom) carte.appendChild(el("div", "corr-nom", c.nom));
      if (c.tel) carte.appendChild(el("div", "corr-tel mono", c.tel));
      bloc.appendChild(carte);

      if (c.tel) {
        var num = telInternational(c.tel);
        var actions = el("div", "tournee-actions");
        var appel = el("a", "btn plein large", "Appeler");
        appel.href = "tel:" + num;
        actions.appendChild(appel);
        var wa = el("a", "btn large", "WhatsApp");
        wa.href = "https://wa.me/" + num.replace(/\D/g, "");
        wa.target = "_blank";
        wa.rel = "noopener noreferrer";
        actions.appendChild(wa);
        bloc.appendChild(actions);
      }

      var modif = el("button", "btn large", "Modifier");
      modif.type = "button";
      modif.style.marginTop = "var(--e2)";
      if (S.peutEcrire === false) modif.disabled = true;
      modif.onclick = function () { CORR_EDITION = true; ouvrirFiche(id, true); };
      bloc.appendChild(modif);
      return bloc;
    }

    var nom = el("input", "date-champ");
    nom.type = "text"; nom.value = c.nom || "";
    nom.placeholder = "Nom du correspondant";
    nom.autocomplete = "name";
    var rn = el("div", "date-rangee"); rn.appendChild(nom); bloc.appendChild(rn);

    var tel = el("input", "date-champ");
    tel.type = "tel"; tel.value = c.tel || "";
    tel.placeholder = "77 123 45 67";
    tel.inputMode = "tel"; tel.autocomplete = "tel";
    var rt = el("div", "date-rangee");
    rt.style.marginTop = "9px";
    rt.appendChild(tel);
    bloc.appendChild(rt);

    var act = el("div", "tournee-actions");
    var ok = el("button", "btn plein large", "Enregistrer");
    ok.type = "button";
    ok.onclick = function () {
      var n = nom.value.trim(), t = tel.value.trim();
      majSuivi(id, function (doc) {
        if (!n && !t) delete doc.correspondant;
        else doc.correspondant = { nom: n, tel: t };
      });
      CORR_EDITION = false;
      ouvrirFiche(id, true);
      toast(n || t ? "Correspondant enregistré." : "Correspondant retiré.");
    };
    act.appendChild(ok);
    var annul = el("button", "btn", "Annuler");
    annul.type = "button";
    annul.onclick = function () { CORR_EDITION = false; ouvrirFiche(id, true); };
    act.appendChild(annul);
    bloc.appendChild(act);
    return bloc;
  }

  /* ---------------- fiche école ---------------- */
  function fermerFiche() {
    if (depiler("fiche")) return;
    fermerFicheReel();
  }

  function fermerFicheReel() {
    fermerVisionneuse();
    var f = $("#ficheEcole");
    if (f) f.remove();
    S.fiche = null;
    document.body.style.overflow = "";
    rafraichir();
  }

  function ouvrirFiche(id, silencieux) {
    var e = ECOLES.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    var garde = null;
    var ancien = $("#ficheEcole");
    if (ancien) { garde = ancien.scrollTop; ancien.remove(); }
    if (!S.fiche) empiler("fiche", fermerFicheReel);
    if (S.fiche !== id) CORR_EDITION = false;
    S.fiche = id;
    document.body.style.overflow = "hidden";
    var d = suiviDe(id), b = bilanEcole(e);

    var f = el("div", "fiche"); f.id = "ficheEcole";
    if (silencieux) f.style.animation = "none";
    var inner = el("div", "fiche-inner");

    var barre = el("div", "fiche-bandeau");
    var ret = el("button", "retour");
    ret.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>Retour';
    ret.onclick = fermerFiche;
    barre.appendChild(ret);
    var ratio = el("span", b.total ? "ratio mono" : "ratio a-faire",
      b.total ? b.faits + " / " + b.total + " faites" : "à diagnostiquer");
    ratio.style.marginLeft = "auto";
    barre.appendChild(ratio);
    inner.appendChild(barre);

    inner.appendChild(el("h2", null, e.nom));
    var meta = el("div", "fiche-meta");
    meta.appendChild(el("span", "jeton mono", e.codes.join(" · ")));
    meta.appendChild(el("span", "jeton", e.quartier));
    meta.appendChild(el("span", "jeton", "UC " + e.uc + " · tournée " + e.tournee));
    if (e.priorite === 1) meta.appendChild(el("span", "jeton p1", "Priorité 1"));
    if (e.inondation) meta.appendChild(el("span", "jeton eau", "Inondation constatée"));
    if (horsProgramme(e)) meta.appendChild(el("span", "jeton", "Hors programme de nettoiement"));
    inner.appendChild(meta);

    if (horsProgramme(e)) {
      var avis = el("p", "note-hors");
      avis.style.cssText = "margin:-4px 0 13px";
      avis.textContent = "Cet établissement n'est pas au programme de nettoiement : pas d'activité de " +
        "désherbage, ou intervention relevant d'un autre service. Les travaux ci-dessous sont à la charge de " +
        servicesDe(e).map(serviceCourt).join(", ") + ".";
      inner.appendChild(avis);
    }

    /* date de passage */
    var bd = el("div", "bloc");
    var tbd = el("div", "bloc-titre");
    tbd.appendChild(el("span", null, "Date de passage"));
    if (e.ordre) {
      var jr = el("span", "rang mono", "N° " + e.ordre + " au programme UC " + e.uc);
      if (e.ajoute) jr.classList.add("neuf");
      tbd.appendChild(jr);
    }
    bd.appendChild(tbd);
    if (e.ajoute) {
      var mot = el("p", "note-hors");
      mot.style.cssText = "margin:0 0 11px";
      mot.textContent = e.inondation || servicesDe(e).indexOf("Service d'Hygiène") !== -1
        ? "Ajoutée au programme de nettoiement. Le passage du Service d'Hygiène — pompage ou curage des eaux stagnantes — conditionne l'intervention."
        : "Ajoutée au programme de nettoiement après le planning initial.";
      bd.appendChild(mot);
    }
    var rangee = el("div", "date-rangee");
    var champ = el("input", "date-champ");
    champ.type = "date";
    champ.id = "date-" + id;
    champ.value = datePassage(id);
    champ.min = CAMPAGNE.debut;
    if (S.peutEcrire === false) champ.disabled = true;
    champ.onchange = function () {
      majSuivi(id, function (doc) { doc.date = champ.value || ""; });
      ouvrirFiche(id, true);
    };
    rangee.appendChild(champ);
    bd.appendChild(rangee);
    var racc = el("div", "date-raccourcis");
    [["Aujourd'hui", aujourdhui()], ["Demain", demain()], ["Après-demain", decale(aujourdhui(), 2)]].forEach(function (p) {
      var b = el("button", "puce", p[0]);
      b.setAttribute("aria-pressed", String(datePassage(id) === p[1]));
      if (S.peutEcrire === false) b.disabled = true;
      b.onclick = function () {
        majSuivi(id, function (doc) { doc.date = datePassage(id) === p[1] ? "" : p[1]; });
        ouvrirFiche(id, true);
      };
      racc.appendChild(b);
    });
    bd.appendChild(racc);
    if (datePassage(id)) {
      var ecart = joursEntre(aujourdhui(), datePassage(id));
      bd.appendChild(el("div", "signature", dateLongue(datePassage(id)) +
        (ecart === 0 ? " — aujourd'hui" : ecart === 1 ? " — demain" : ecart > 0 ? " — dans " + ecart + " jours" : " — passée")));
    }
    inner.appendChild(bd);

    inner.appendChild(blocCorrespondant(id));

    /* interventions groupées par service pilote */
    var bloc = el("div", "bloc");
    var bt = el("div", "bloc-titre");
    bt.appendChild(el("span", null, "Interventions à réaliser"));
    bt.appendChild(el("span", "mono", e.taches.length + ""));
    bloc.appendChild(bt);

    var parService = [];
    e.taches.forEach(function (t) {
      var g = parService.filter(function (x) { return x.nom === t.service; })[0];
      if (!g) { g = { nom: t.service, taches: [] }; parService.push(g); }
      g.taches.push(t);
    });
    if (S.service) {
      parService.sort(function (a, b) {
        return (a.nom === S.service ? 0 : 1) - (b.nom === S.service ? 0 : 1);
      });
    }
    parService.forEach(function (g) {
      var sec = el("div", "service-groupe" + (S.service && g.nom !== S.service ? " estompe" : ""));
      var sn = el("div", "service-nom");
      var pas = el("b"); pas.style.background = couleurService(g.nom);
      sn.appendChild(pas); sn.appendChild(el("span", null, g.nom));
      sn.style.color = couleurService(g.nom);
      sec.appendChild(sn);

      g.taches.forEach(function (t) {
        var w = el("div", "tache");
        var lab = el("div", "tache-label");
        lab.appendChild(el("span", null, t.label));
        w.appendChild(lab);

        var seg = el("div", "segments");
        seg.setAttribute("role", "group");
        seg.setAttribute("aria-label", t.label);
        var courant = etatTache(id, t.id);
        ETATS.forEach(function (et) {
          var btn = el("button", null, et.court);
          btn.type = "button";
          btn.setAttribute("data-e", et.k);
          btn.setAttribute("aria-pressed", String(courant === et.k));
          if (S.peutEcrire === false) btn.disabled = true;
          btn.onclick = function () {
            var nouveau = courant === et.k ? "attente" : et.k;
            majSuivi(id, function (doc) {
              if (!doc.taches) doc.taches = {};
              doc.taches[t.id] = { e: nouveau, par: S.moi || "", le: new Date().toISOString() };
            });
            ouvrirFiche(id, true);
          };
          seg.appendChild(btn);
        });
        w.appendChild(seg);
        var info = (d.taches || {})[t.id];

        /* un blocage sans cause n'est pas exploitable : on demande le motif */
        if (courant === "bloque") {
          var mot = el("div", "motifs");
          mot.setAttribute("role", "group");
          mot.setAttribute("aria-label", "Motif du blocage — " + t.label);
          MOTIFS.forEach(function (m) {
            var b = el("button", "puce", m);
            b.type = "button";
            b.setAttribute("aria-pressed", String(info && info.m === m));
            if (S.peutEcrire === false) b.disabled = true;
            b.onclick = function () {
              majSuivi(id, function (doc) { doc.taches[t.id].m = doc.taches[t.id].m === m ? "" : m; });
              ouvrirFiche(id, true);
            };
            mot.appendChild(b);
          });
          w.appendChild(mot);
          if (!(info && info.m)) {
            var rappel = el("div", "signature");
            rappel.style.color = "var(--laterite)";
            rappel.textContent = "Indiquez la cause du blocage.";
            w.appendChild(rappel);
          }
        }

        if (info && info.le) {
          w.appendChild(el("div", "signature", ETATS.filter(function (x) { return x.k === info.e; })[0].long +
            (info.m ? " — " + info.m : "") +
            " · " + dateCourte(info.le) + (info.par ? " · " + nomDe(info.par) : "")));
        }
        sec.appendChild(w);
      });
      bloc.appendChild(sec);
    });
    if (!e.taches.length) {
      bloc.appendChild(el("p", null, "Aucune intervention arrêtée pour cet établissement : diagnostic à compléter sur le terrain."))
        .style.cssText = "font-size:13.5px;color:var(--texte-2);margin:0";
    }
    inner.appendChild(bloc);

    /* ce que le rapport d'exécution constate sur le terrain */
    var rap = EXEC[id];
    if (rap) {
      var br = el("div", "bloc");
      var tbr = el("div", "bloc-titre");
      tbr.appendChild(el("span", null, "Rapport d'exécution"));
      tbr.appendChild(el("span", "rang mono", rap.statut));
      br.appendChild(tbr);

      rap.travaux.forEach(function (t) {
        var w = el("div", "constat");
        var m = el("span", "marque-etat " + t[1]);
        m.textContent = t[1] === "fait" ? "✔" : t[1] === "partiel" ? "◐" : "?";
        m.title = t[1] === "fait" ? "Réalisé" : t[1] === "partiel" ? "Partiel" : "À confirmer";
        w.appendChild(m);
        var tx = el("div");
        tx.appendChild(el("div", "constat-nom", t[0]));
        tx.appendChild(el("div", "constat-detail", t[2]));
        w.appendChild(tx);
        br.appendChild(w);
      });

      [["Équipe", rap.equipe], ["Moyens", rap.moyens], ["Observations", rap.observations],
       ["Photothèque", rap.photos]].forEach(function (p) {
        if (!p[1]) return;
        var l = el("div", "releve");
        l.appendChild(el("span", "releve-cle", p[0]));
        l.appendChild(el("span", null, p[1]));
        br.appendChild(l);
      });
      if ((EXEC_META.dotation || []).length) {
        var vd = el("button", "graphe-voir", "Voir la dotation commune en petit matériel");
        vd.type = "button";
        var ld = listeDotation();
        ld.hidden = true;
        vd.onclick = function () {
          ld.hidden = !ld.hidden;
          vd.textContent = ld.hidden ? "Voir la dotation commune en petit matériel"
                                     : "Masquer la dotation";
        };
        br.appendChild(vd);
        br.appendChild(ld);
      }
      br.appendChild(el("div", "signature", "Constat arrêté au " + dateLongue(EXEC_META.arrete).toLowerCase() +
        " · " + (EXEC_META.source || "")));
      inner.appendChild(br);
    }

    /* photos : archive des tournées + clichés pris dans l'app */
    var toutes = photosDe(id);
    var avant = toutes.filter(function (p) { return p.ph === "avant"; });
    var apres = toutes.filter(function (p) { return p.ph !== "avant"; });

    var bp = el("div", "bloc");
    var bpt = el("div", "bloc-titre");
    bpt.appendChild(el("span", null, "Photos de terrain"));
    bpt.appendChild(el("span", "mono", toutes.length + ""));
    bp.appendChild(bpt);

    [["avant", "Avant intervention", avant], ["apres", "Pendant / après", apres]].forEach(function (grp) {
      var sec = el("div", "service-groupe");
      var sn = el("div", "service-nom");
      var pas = el("b");
      pas.style.background = grp[0] === "avant" ? "var(--texte-3)" : "var(--vert)";
      sn.appendChild(pas);
      sn.appendChild(el("span", null, grp[1] + " · " + grp[2].length));
      sec.appendChild(sn);
      if (!grp[2].length) {
        var vide = el("p", null, grp[0] === "avant"
          ? "Aucun cliché de diagnostic pour cet établissement."
          : "Aucun cliché depuis le passage de l'équipe.");
        vide.style.cssText = "font-size:13px;color:var(--texte-3);margin:0";
        sec.appendChild(vide);
      } else {
        var grille = el("div", "photos");
        grp[2].forEach(function (ph) {
          var pos = toutes.indexOf(ph);
          var c = el("button", "vignette");
          c.type = "button";
          var img = el("img");
          img.src = ph.url;
          img.alt = (ph.ph === "avant" ? "Avant" : "Pendant ou après") + " intervention — " + e.nom;
          img.loading = "lazy";
          c.appendChild(img);
          c.onclick = function () { ouvrirVisionneuse(e, toutes, pos); };
          if (!ph.archive) {
            c.appendChild(el("span", "tag", "Ajoutée"));
            if (S.assets || DISTANT) {
              /* span et non button : une vignette est déjà un bouton */
              var sup = el("span", "sup", "×");
              sup.setAttribute("role", "button");
              sup.setAttribute("tabindex", "0");
              sup.setAttribute("aria-label", "Supprimer la photo");
              sup.title = "Supprimer la photo";
              sup.onclick = function (ev) {
                ev.stopPropagation();
                var aid = (suiviDe(id).photos || [])[ph.index];
                majSuivi(id, function (doc) { doc.photos.splice(ph.index, 1); });
                if (aid && aid.a && S.assets && S.assets.delete) S.assets.delete(aid.a).catch(function () { });
                ouvrirFiche(id, true);
              };
              c.appendChild(sup);
            }
          }
          grille.appendChild(c);
        });
        sec.appendChild(grille);
      }
      bp.appendChild(sec);
    });

    var ajout = el("div", "ajout-photo");
    ["avant", "apres"].forEach(function (phase) {
      var btn = el("button", "btn large", phase === "avant" ? "Photo avant" : "Photo après");
      btn.type = "button";
      if (!S.assets && !DISTANT) { btn.disabled = true; btn.title = "Ajout de photos indisponible hors base partagée"; }
      btn.onclick = function () { prendrePhoto(id, phase, btn); };
      ajout.appendChild(btn);
    });
    bp.appendChild(ajout);

    /* Une école se solde sur pièces : seul un cliché « pendant / après » — la preuve
       du passage de l'équipe, non celle du diagnostic — ouvre la clôture. Elle marque
       les interventions faites, ce qui range l'établissement parmi les terminés.
       Les clichés des tournées publiés avec l'app valent preuve au même titre que
       ceux versés depuis le terrain. */
    var preuve = passageConstate(id);
    if (!preuve && !b.fini && (d.photos || []).length) {
      var attendu = el("p", "solde-mot",
        "Un cliché « après » ouvrira la clôture de l'établissement.");
      attendu.style.cssText = "margin:var(--e3) 0 0; color:var(--texte-3)";
      bp.appendChild(attendu);
    }
    if (preuve || b.fini) {
      var solde = el("div", "solde");
      if (b.fini && b.total) {
        /* Pas de bouton pour défaire : une clôture s'annule intervention par
           intervention, plus haut dans la fiche. Une école ne doit pas pouvoir
           sortir des terminés sur une frappe malheureuse. */
        solde.appendChild(el("p", "solde-mot", "Établissement classé parmi les terminés : ses "
          + b.total + " interventions sont faites. Pour revenir dessus, changez l'état "
          + "d'une intervention plus haut dans la fiche."));
      } else if (b.fini) {
        /* Soldé sur pièces : aucune intervention à rouvrir plus haut dans la fiche,
           c'est donc ici — et seulement ici — qu'on peut revenir sur la clôture. */
        solde.appendChild(el("p", "solde-mot", "Établissement classé parmi les terminés sur la foi "
          + "des clichés « après » : son diagnostic n'avait arrêté aucune intervention."));
        if (d.fini && d.fini.le) {
          solde.appendChild(el("div", "signature", "Soldé le " + dateCourte(d.fini.le)
            + (d.fini.par ? " · " + nomDe(d.fini.par) : "")));
        }
        var rouvrir = el("button", "btn large", "Rouvrir l'établissement");
        rouvrir.type = "button";
        if (S.peutEcrire === false) {
          rouvrir.disabled = true;
          rouvrir.title = "Lecture seule : demandez l'accès « Contributeur » au superviseur.";
        }
        rouvrir.onclick = function () {
          majSuivi(id, function (doc) { delete doc.fini; });
          toast("Établissement rouvert.");
          ouvrirFiche(id, true);
        };
        solde.appendChild(rouvrir);
      } else {
        solde.appendChild(el("p", "solde-mot", b.total
          ? "Passage constaté en photo. Solder l'établissement marque ses " + b.total
            + " interventions faites et le classe parmi les terminés."
          : "Passage constaté en photo. Aucune intervention n'a été arrêtée au diagnostic : "
            + "solder l'établissement le classe parmi les terminés sur la foi de ces clichés."));
        var btnFini = el("button", "btn large plein", "Terminé");
        btnFini.type = "button";
        if (S.peutEcrire === false) {
          btnFini.disabled = true;
          btnFini.title = "Lecture seule : demandez l'accès « Contributeur » au superviseur.";
        }
        btnFini.onclick = function () {
          majSuivi(id, function (doc) {
            if (e.taches.length) {
              if (!doc.taches) doc.taches = {};
              var t0 = new Date().toISOString();
              e.taches.forEach(function (t) {
                doc.taches[t.id] = { e: "fait", par: S.moi || "", le: t0 };
              });
            } else {
              doc.fini = { par: S.moi || "", le: new Date().toISOString() };
            }
            if (!doc.date) doc.date = aujourdhui();
          });
          toast("École soldée — elle rejoint « Passées ».");
          ouvrirFiche(id, true);
        };
        solde.appendChild(btnFini);
      }
      bp.appendChild(solde);
    }
    inner.appendChild(bp);

    /* Relevé de reconnaissance : ce que l'équipe a vu la veille. Il décide de
       la place de l'école au planning, le diagnostic de septembre ne vaut plus
       quand l'eau est partie. */
    var br = el("div", "bloc");
    var tr = el("div", "bloc-titre");
    tr.appendChild(el("span", null, "Reconnaissance sur place"));
    var rec = d.constat || {};
    if (rec.le) tr.appendChild(el("span", "rang mono", dateMoyenne(rec.le.slice(0, 10))));
    br.appendChild(tr);
    br.appendChild(el("p", "note-hors", "Ce qu'une équipe constate la veille prime sur le " +
      "diagnostic du 4 septembre. « Prête » lève la contrainte et renvoie l'école à la " +
      "programmation."));
    var gc = el("div", "constats");
    CONSTATS.forEach(function (c) {
      var b = el("button", "puce" + (rec.cle === c.cle ? " actif" : ""), c.court);
      b.type = "button";
      b.title = c.long;
      if (S.peutEcrire === false) b.disabled = true;
      b.onclick = function () {
        var neuf = rec.cle === c.cle ? null : c.cle;
        majSuivi(id, function (doc) {
          if (!neuf) { delete doc.constat; return; }
          doc.constat = { cle: neuf, le: new Date().toISOString(), par: S.moi || "" };
        });
        ouvrirFiche(id, true);
      };
      gc.appendChild(b);
    });
    br.appendChild(gc);
    if (rec.cle) {
      var cc = constatDe(rec.cle);
      if (cc) {
        var pr = el("p", "constat-dit", cc.long);
        if (rec.par) pr.textContent += " — " + nomDe(rec.par);
        br.appendChild(pr);
      }
    }
    inner.appendChild(br);

    /* observation */
    var bo = el("div", "bloc");
    bo.appendChild(el("div", "bloc-titre")).appendChild(el("span", null, "Observation de terrain"));
    var zone = el("textarea", "zone");
    zone.id = "obs-" + id;
    zone.placeholder = "Difficulté rencontrée, matériel manquant, accord du directeur, date de repassage…";
    zone.value = d.obs || "";
    if (S.peutEcrire === false) { zone.readOnly = true; zone.placeholder = "Lecture seule : demandez l'accès « Contributeur » au superviseur."; }
    var tempo = null;
    zone.oninput = function () {
      clearTimeout(tempo);
      tempo = setTimeout(function () {
        majSuivi(id, function (doc) { doc.obs = zone.value; });
      }, 700);
    };
    bo.appendChild(zone);
    inner.appendChild(bo);

    /* pied : coordonnées + itinéraire */
    var pied = el("div", "bloc");
    var coord = el("div", "ligne-meta");
    coord.appendChild(el("span", "code mono", situee(e)
      ? e.lat.toFixed(6) + " N · " + e.lon.toFixed(6) + " E"
      : "Position à relever"));
    pied.appendChild(coord);
    var actions = el("div", "tournee-actions");
    actions.appendChild(boutonItineraire("M'y conduire", [e], true));
    var surCarte = el("button", "btn large", "Sur la carte");
    surCarte.onclick = function () { viserEcole(e.id); fermerFiche(); allerA("Carte"); };
    actions.appendChild(surCarte);
    pied.appendChild(actions);
    if (d.maj) pied.appendChild(el("div", "signature", "Dernière mise à jour : " + dateCourte(d.maj)));
    inner.appendChild(pied);

    f.appendChild(inner);
    document.body.appendChild(f);
    if (garde != null) f.scrollTop = garde;
  }

  /* ---------------- visionneuse ---------------- */
  var VUE_PHOTO = null;
  function ouvrirVisionneuse(e, liste, pos) {
    var deja = !!VUE_PHOTO;   /* faire défiler ne rouvre pas une couche */
    fermerVisionneuse();
    if (!deja) empiler("photo", fermerVisionneuse);
    VUE_PHOTO = { liste: liste, pos: pos, ecole: e };
    var v = el("div", "visionneuse");
    v.id = "visionneuse";
    v.setAttribute("role", "dialog");
    v.setAttribute("aria-label", "Photo — " + e.nom);

    var haut = el("div", "visionneuse-haut");
    haut.appendChild(el("span", null, e.nom));
    var fermer = el("button", null, "×");
    fermer.type = "button";
    fermer.setAttribute("aria-label", "Fermer");
    fermer.onclick = quitterVisionneuse;
    haut.appendChild(fermer);
    v.appendChild(haut);

    var cadre = el("div", "visionneuse-image");
    var img = el("img");
    img.id = "visionneusePhoto";
    cadre.appendChild(img);
    v.appendChild(cadre);

    var bas = el("div", "visionneuse-bas");
    var prec = el("button", null, "‹ Précédente"); prec.type = "button";
    var lib = el("span", "mono"); lib.id = "visionneuseLegende";
    var suiv = el("button", null, "Suivante ›"); suiv.type = "button";
    prec.onclick = function () { glisser(-1); };
    suiv.onclick = function () { glisser(1); };
    bas.appendChild(prec); bas.appendChild(lib); bas.appendChild(suiv);
    v.appendChild(bas);

    document.body.appendChild(v);
    majVisionneuse();
    fermer.focus();
  }
  function glisser(n) {
    if (!VUE_PHOTO) return;
    VUE_PHOTO.pos = Math.min(VUE_PHOTO.liste.length - 1, Math.max(0, VUE_PHOTO.pos + n));
    majVisionneuse();
  }
  function majVisionneuse() {
    if (!VUE_PHOTO) return;
    var p = VUE_PHOTO.liste[VUE_PHOTO.pos];
    var img = $("#visionneusePhoto");
    img.src = p.url;
    var phase = p.ph === "affiche" ? "Programme" : p.ph === "avant" ? "Avant" : "Pendant / après";
    img.alt = p.ph === "affiche" ? VUE_PHOTO.ecole.nom
      : phase + " intervention — " + VUE_PHOTO.ecole.nom;
    $("#visionneuseLegende").textContent = VUE_PHOTO.liste.length > 1
      ? phase + " · " + (VUE_PHOTO.pos + 1) + " / " + VUE_PHOTO.liste.length
      : phase;
    var b = document.querySelectorAll(".visionneuse-bas button");
    b[0].disabled = VUE_PHOTO.pos === 0;
    b[1].disabled = VUE_PHOTO.pos === VUE_PHOTO.liste.length - 1;
  }
  function quitterVisionneuse() {
    if (depiler("photo")) return;
    fermerVisionneuse();
  }

  function fermerVisionneuse() {
    var v = $("#visionneuse");
    if (v) v.remove();
    VUE_PHOTO = null;
  }

  /* ---------------- photos ---------------- */
  /* Dépose une photo dans le stockage Supabase et rend son adresse publique.
     Le nom tient au code SIG, à la phase et à l'horodatage, plus un tirage
     aléatoire : deux agents qui photographient la même école à la même seconde
     ne s'écrasent pas. Rien n'est jamais remplacé — x-upsert reste à false. */
  function deposerPhoto(id, phase, blob) {
    var nom = id + "/" + phase + "-" + Date.now() + "-" +
              Math.random().toString(36).slice(2, 8) + ".jpg";
    return fetch(DISTANT.depot + nom, {
      method: "POST",
      headers: {
        "apikey": DISTANT.cle,
        "Authorization": "Bearer " + DISTANT.cle,
        "Content-Type": "image/jpeg",
        "x-upsert": "false"
      },
      body: blob
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return { u: DISTANT.publique + nom };
    });
  }

  function bilanEnvoi(faits, rates, refus, phase) {
    var quoi = phase === "avant" ? "avant" : "après";
    if (faits && !rates) {
      return faits > 1 ? faits + " photos " + quoi + " enregistrées."
                       : "Photo " + quoi + " enregistrée.";
    }
    if (faits && rates) {
      return faits + " enregistrée" + (faits > 1 ? "s" : "") + ", "
           + rates + " en échec — réessayez.";
    }
    if (refus) return "Droits insuffisants pour ajouter une photo.";
    return rates > 1 ? "Envoi impossible pour les " + rates + " photos — réessayez."
                     : "Envoi impossible — réessayez.";
  }

  function prendrePhoto(id, phase, btn) {
    if (!S.assets && !DISTANT) return;
    var libelle = phase === "avant" ? "Photo avant" : "Photo après";
    var input = document.createElement("input");
    /* Pas d'attribut « capture » : il forcerait l'appareil photo et priverait
       l'agent de sa galerie. Sans lui, le téléphone propose les deux. */
    input.type = "file"; input.accept = "image/*";
    input.multiple = true;   /* une tournée se photographie rarement en un cliché */
    input.style.display = "none";
    document.body.appendChild(input);

    input.onchange = function () {
      var fichiers = Array.prototype.slice.call(input.files || []);
      input.remove();
      if (!fichiers.length) return;
      btn.disabled = true;
      var faits = 0, rates = 0, refus = false;

      /* Un envoi après l'autre, jamais de front : sur une liaison de terrain,
         cinq requêtes simultanées se gênent plus qu'elles ne s'entraident.
         Chaque photo reçue est inscrite aussitôt dans la fiche : si la liaison
         lâche au troisième cliché, les deux premiers sont déjà acquis. */
      function envoyerUne(i) {
        if (i >= fichiers.length) return terminer();
        btn.textContent = fichiers.length > 1
          ? "Envoi " + (i + 1) + "/" + fichiers.length + "…"
          : "Envoi…";
        return compresser(fichiers[i]).then(function (blob) {
          return S.assets
            ? S.assets.upload(blob, { type: "image/jpeg" }).then(function (res) { return { a: res.id }; })
            : deposerPhoto(id, phase, blob);
        }).then(function (ref) {
          faits++;
          majSuivi(id, function (doc) {
            if (!doc.photos) doc.photos = [];
            doc.photos.push({ u: ref.u, a: ref.a, ph: phase, par: S.moi || "",
                              le: new Date().toISOString() });
          });
        }).catch(function (err) {
          rates++;
          if (err && err.code === "not_granted") refus = true;
        }).then(function () { return envoyerUne(i + 1); });
      }

      function terminer() {
        btn.disabled = false;
        btn.textContent = libelle;
        toast(bilanEnvoi(faits, rates, refus, phase));
        if (faits) ouvrirFiche(id, true);
      }

      envoyerUne(0);
    };
    input.click();
  }

  function compresser(file) {
    return new Promise(function (ok, ko) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1440;
        var r = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? ok(b) : ko(new Error("compression")); }, "image/jpeg", 0.72);
      };
      img.onerror = function () { URL.revokeObjectURL(url); ko(new Error("image")); };
      img.src = url;
    });
  }

  /* ---------------- évolution du suivi ----------------
     Les dates viennent de l'horodatage de chaque intervention passée à « fait ».
     Deux mesures, deux graphiques : jamais deux échelles sur un même axe. */

  function serieAvancement() {
    var parJour = {};
    ECOLES.forEach(function (e) {
      var t = suiviDe(e.id).taches || {};
      e.taches.forEach(function (x) {
        var st = t[x.id];
        if (!st || st.e !== "fait" || !st.le) return;
        var j = String(st.le).slice(0, 10);
        parJour[j] = (parJour[j] || 0) + 1;
      });
    });
    var jours = Object.keys(parJour).sort();
    var debut = CAMPAGNE.debut, fin = aujourdhui();
    if (jours.length) {
      if (jours[0] < debut) debut = jours[0];
      if (jours[jours.length - 1] > fin) fin = jours[jours.length - 1];
    }
    var out = [], cumul = 0, j = debut, garde = 0;
    while (j <= fin && garde++ < 400) {
      cumul += parJour[j] || 0;
      out.push({ jour: j, nb: parJour[j] || 0, cumul: cumul });
      j = decale(j, 1);
    }
    return out;
  }

  function palier(v) {
    if (v <= 5) return 5;
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    return Math.ceil(v / (p / 2)) * (p / 2);
  }
  function jourCourt(iso) {
    var d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  /* Courbe cumulée : une seule série, donc pas de légende — le titre la nomme. */
  function courbeCumul(serie, total) {
    var L = 320, H = 132, ml = 30, mr = 12, mt = 12, mb = 22;
    var max = palier(Math.max(1, serie[serie.length - 1].cumul));
    var px = function (i) { return ml + (serie.length < 2 ? 0 : i * (L - ml - mr) / (serie.length - 1)); };
    var py = function (v) { return mt + (1 - v / max) * (H - mt - mb); };

    var pts = serie.map(function (d, i) { return px(i).toFixed(1) + " " + py(d.cumul).toFixed(1); });
    var ligne = "M" + pts.join("L");
    var aire = ligne + "L" + px(serie.length - 1).toFixed(1) + " " + py(0).toFixed(1) +
      "L" + px(0).toFixed(1) + " " + py(0).toFixed(1) + "Z";

    var g = ['<svg class="graphe" viewBox="0 0 ' + L + ' ' + H + '" role="img" aria-label="' +
      'Interventions réalisées, cumul du ' + jourCourt(serie[0].jour) + ' au ' +
      jourCourt(serie[serie.length - 1].jour) + ' : ' + serie[serie.length - 1].cumul + ' sur ' + total + '">'];
    g.push('<defs><linearGradient id="degradeCumul" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="var(--vert-vif)" stop-opacity="0.28"/>' +
      '<stop offset="1" stop-color="var(--vert-vif)" stop-opacity="0.02"/></linearGradient></defs>');

    [0, 0.5, 1].forEach(function (f) {
      var v = max * f, y = py(v);
      g.push('<line x1="' + ml + '" y1="' + y.toFixed(1) + '" x2="' + (L - mr) + '" y2="' + y.toFixed(1) +
        '" stroke="var(--trait)" stroke-width="1"' + (f ? ' stroke-dasharray="2 4"' : '') + '/>');
      g.push('<text x="' + (ml - 7) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" ' +
        'class="graphe-axe">' + Math.round(v) + '</text>');
    });

    g.push('<path class="graphe-aire" d="' + aire + '" fill="url(#degradeCumul)"/>');
    g.push('<path class="graphe-ligne" d="' + ligne + '" fill="none" stroke="var(--vert-vif)" ' +
      'stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');

    var dernier = serie.length - 1;
    g.push('<circle class="graphe-bout" cx="' + px(dernier).toFixed(1) + '" cy="' + py(serie[dernier].cumul).toFixed(1) +
      '" r="4.5" fill="var(--vert-vif)" stroke="var(--surface)" stroke-width="2"/>');

    g.push('<text x="' + ml + '" y="' + (H - 6) + '" class="graphe-axe">' + jourCourt(serie[0].jour) + '</text>');
    if (serie.length > 1) {
      g.push('<text x="' + (L - mr) + '" y="' + (H - 6) + '" text-anchor="end" class="graphe-axe">' +
        jourCourt(serie[dernier].jour) + '</text>');
    }
    /* couche de survol : un rectangle par jour, cible plus large que la marque */
    serie.forEach(function (d, i) {
      var l = (L - ml - mr) / Math.max(1, serie.length - 1);
      g.push('<rect class="graphe-cible" data-i="' + i + '" x="' + (px(i) - l / 2).toFixed(1) + '" y="0" width="' +
        l.toFixed(1) + '" height="' + (H - mb) + '" fill="transparent"/>');
    });
    g.push('<line id="graphe-croix" x1="0" y1="' + mt + '" x2="0" y2="' + (H - mb) +
      '" stroke="var(--texte-3)" stroke-width="1" stroke-dasharray="2 3" opacity="0"/>');
    g.push("</svg>");
    return { html: g.join(""), px: px, py: py };
  }

  /* Rythme quotidien : barres fines, extrémités arrondies, ancrées à la ligne de base. */
  function barresJour(serie) {
    var L = 320, H = 76, ml = 30, mr = 12, mt = 8, mb = 20;
    var max = palier(Math.max(1, serie.reduce(function (a, d) { return Math.max(a, d.nb); }, 0)));
    var large = (L - ml - mr) / serie.length;
    var l = Math.max(4, Math.min(22, large - 4));
    var g = ['<svg class="graphe" viewBox="0 0 ' + L + ' ' + H + '" role="img" aria-label="' +
      'Interventions réalisées par jour, maximum ' + max + '">'];
    g.push('<line x1="' + ml + '" y1="' + (H - mb) + '" x2="' + (L - mr) + '" y2="' + (H - mb) +
      '" stroke="var(--trait)" stroke-width="1"/>');
    g.push('<text x="' + (ml - 7) + '" y="' + (mt + 4) + '" text-anchor="end" class="graphe-axe">' + max + '</text>');
    serie.forEach(function (d, i) {
      var x = ml + i * large + (large - l) / 2;
      var h = d.nb ? Math.max(3, (d.nb / max) * (H - mt - mb)) : 0;
      if (!h) return;
      g.push('<rect class="graphe-barre" x="' + x.toFixed(1) + '" y="' + (H - mb - h).toFixed(1) +
        '" width="' + l.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="var(--vert-vif)">' +
        '<title>' + jourCourt(d.jour) + " : " + d.nb + ' interventions</title></rect>');
    });
    g.push('<text x="' + ml + '" y="' + (H - 5) + '" class="graphe-axe">' + jourCourt(serie[0].jour) + '</text>');
    if (serie.length > 1) {
      g.push('<text x="' + (L - mr) + '" y="' + (H - 5) + '" text-anchor="end" class="graphe-axe">' +
        jourCourt(serie[serie.length - 1].jour) + '</text>');
    }
    g.push("</svg>");
    return g.join("");
  }

  function blocEvolution() {
    var serie = serieAvancement();
    var total = ECOLES.reduce(function (n, e) { return n + e.taches.length; }, 0);
    var fait = serie.length ? serie[serie.length - 1].cumul : 0;

    var b = el("div", "bloc bloc-evolution");
    var t = el("div", "bloc-titre");
    t.appendChild(el("span", null, "Évolution du suivi"));
    t.appendChild(el("span", "rang mono", fait + " / " + total));
    b.appendChild(t);

    if (fait === 0) {
      b.appendChild(el("p", "note-hors", "Aucune intervention n'a encore été pointée comme réalisée. " +
        "La courbe se construira au fil des saisies."));
      return b;
    }

    b.appendChild(el("p", "graphe-titre", "Interventions réalisées, en cumul"));
    var c1 = el("div", "graphe-boite g-cumul");
    var g = courbeCumul(serie, total);
    c1.innerHTML = g.html;
    var info = el("div", "graphe-info");
    info.innerHTML = '<span class="graphe-jour"></span><span class="graphe-val mono"></span>';
    c1.appendChild(info);
    b.appendChild(c1);

    b.appendChild(el("p", "graphe-titre", "Rythme quotidien"));
    var c2 = el("div", "graphe-boite g-rythme");
    c2.innerHTML = barresJour(serie);
    b.appendChild(c2);

    /* la même donnée en clair, pour qui ne lit pas le graphique */
    var voir = el("button", "graphe-voir", "Voir les valeurs");
    voir.type = "button";
    var tab = el("div", "graphe-table");
    tab.hidden = true;
    serie.slice().reverse().forEach(function (d) {
      var r = el("div", "graphe-rangee");
      r.appendChild(el("span", null, jourCourt(d.jour)));
      r.appendChild(el("span", "mono", (d.nb ? "+" + d.nb : "—") + " · " + d.cumul));
      tab.appendChild(r);
    });
    voir.onclick = function () {
      tab.hidden = !tab.hidden;
      voir.textContent = tab.hidden ? "Voir les valeurs" : "Masquer les valeurs";
    };
    b.appendChild(voir);
    b.appendChild(tab);

    /* survol : croix + valeur du jour */
    var svg = c1.querySelector("svg");
    var croix = svg.querySelector("#graphe-croix");
    var jourTxt = info.querySelector(".graphe-jour");
    var valTxt = info.querySelector(".graphe-val");
    function montrer(i) {
      var d = serie[i];
      croix.setAttribute("x1", g.px(i).toFixed(1));
      croix.setAttribute("x2", g.px(i).toFixed(1));
      croix.setAttribute("opacity", "1");
      jourTxt.textContent = jourCourt(d.jour);
      valTxt.textContent = d.cumul + " réalisées" + (d.nb ? " · +" + d.nb + " ce jour" : "");
      info.classList.add("visible");
    }
    Array.prototype.forEach.call(svg.querySelectorAll(".graphe-cible"), function (r) {
      var i = +r.getAttribute("data-i");
      r.addEventListener("pointerenter", function () { montrer(i); });
      r.addEventListener("pointerdown", function () { montrer(i); });
    });
    svg.addEventListener("pointerleave", function () {
      croix.setAttribute("opacity", "0");
      info.classList.remove("visible");
    });
    return b;
  }

  /* ---------------- bilan ---------------- */
  function agreger(lot) {
    var a = { total: 0, faits: 0, encours: 0, bloques: 0 };
    lot.forEach(function (e) {
      var b = bilanEcole(e);
      a.total += b.total; a.faits += b.faits; a.encours += b.entames; a.bloques += b.bloques;
    });
    return a;
  }
  function barre(nom, couleur, a) {
    var w = el("div", "barre-ligne");
    var n = el("div", "barre-nom");
    if (couleur) { var p = el("b"); p.style.background = couleur; n.appendChild(p); }
    n.appendChild(el("span", null, nom));
    w.appendChild(n);
    w.appendChild(el("div", "barre-val mono", a.total ? Math.round(100 * a.faits / a.total) + " % · " + a.faits + "/" + a.total : "—"));
    var b = el("div", "barre");
    var pc = function (v) { return a.total ? (100 * v / a.total) + "%" : "0%"; };
    [["f", a.faits], ["e", a.encours], ["b", a.bloques]].forEach(function (x) {
      var i = el("i", x[0]); i.style.width = pc(x[1]); b.appendChild(i);
    });
    w.appendChild(b);
    return w;
  }

  function rendreBilan() {
    var v = $("#vueBilan");
    v.innerHTML = "";
    var lot = S.uc ? ECOLES.filter(function (e) { return e.uc === S.uc; }) : ECOLES;
    var a = agreger(lot);
    /* Les compteurs portent sur le programme, pas sur le catalogue : six
       établissements relevés n'en font pas partie — ils n'ont aucune activité
       de désherbage, ou leur intervention revient à un autre service. Les
       mêler donnerait un taux faussement bas, indéfendable en réunion. */
    var auProg = lot.filter(function (e) { return !horsProgramme(e); });
    var soldees = auProg.filter(function (e) { return bilanEcole(e).fini; });
    var nSold = nbEtab(soldees), nProg = nbEtab(auProg);

    /* de quand parle-t-on, et d'après quoi */
    var sit = el("div", "situation");
    var sh = el("div", "situation-haut");
    sh.appendChild(el("span", "situation-jour",
      "Situation arrêtée au " + dateLongue(aujourdhui()).toLowerCase()));
    sh.appendChild(el("span", "situation-jn",
      "J+" + joursEntre(CAMPAGNE.debut, aujourdhui())));
    sit.appendChild(sh);
    /* La phrase que le présentateur peut lire telle quelle. Deux compteurs
       voisins — « 21/48 » et « 27 » — se lisent trop vite comme « 27 sur 48 » :
       la phrase tranche avant que la question ne se pose. */
    var resume = el("p", "situation-resume");
    resume.appendChild(el("b", null, nSold + " des " + nProg + " établissements du programme"));
    resume.appendChild(document.createTextNode(
      " sont soldés" +
      (nProg ? " — " + Math.round(100 * nSold / nProg) + " % du programme" : "") +
      ". " + (nProg - nSold) + " restent à traiter."));
    sit.appendChild(resume);
    sit.appendChild(el("p", "situation-src",
      (S.db || DISTANT ? "Relevé dans la base partagée, mise à jour en continu par les agents."
                       : "Relevé local : les saisies des autres agents ne sont pas visibles.") +
      " Démarrage le " + dateLongue(CAMPAGNE.debut).toLowerCase() + "." +
      (S.uc ? " Vue restreinte à l'UC " + S.uc + "." : "")));
    v.appendChild(sit);

    var k = el("div", "kpis");
    [[nSold + "/" + nProg, "Établissements soldés", "vert"],
    [(a.total ? Math.round(100 * a.faits / a.total) : 0) + " %", "Interventions réalisées", ""],
    [String(nProg - nSold), "Restent à traiter", ""],
    [String(a.bloques), "Points bloqués", a.bloques ? "laterite" : ""]].forEach(function (p) {
      var c = el("div", "kpi" + (p[2] ? " kpi-" + p[2] : ""));
      c.appendChild(el("div", "n mono", p[0]));
      c.appendChild(el("div", "l", p[1]));
      k.appendChild(c);
    });
    v.appendChild(k);

    var hors = lot.filter(horsProgramme);
    v.appendChild(el("p", "situation-pied",
      "Programme arrêté : " + nProg + " établissements" +
      (S.uc ? " en UC " + S.uc : " répartis sur trois unités communales") + ", " +
      auProg.length + " fiches. " +
      (hors.length ? hors.length + " autres établissements ont été relevés sans entrer au " +
                     "programme de nettoiement : leur intervention revient à un autre service."
                   : "")));

    v.appendChild(blocEvolution());

    /* calendrier */
    var cal = el("div", "bloc");
    var tcal = el("div", "bloc-titre");
    tcal.appendChild(el("span", null, "Calendrier"));
    tcal.appendChild(el("span", "rang mono", "J+" + joursEntre(CAMPAGNE.debut, aujourdhui())));
    cal.appendChild(tcal);
    var seaux = repartir(lot);
    var passSold = seaux.passees.filter(function (e) { return bilanEcole(e).fini; }).length;
    var passPas = seaux.passees.length - passSold;
    [["Aujourd'hui — " + dateMoyenne(aujourdhui()), seaux.aujourdhui.length, "aujourdhui", ""],
    ["Demain — " + dateMoyenne(demain()), seaux.demain.length, "demain", ""],
    ["Jours suivants", seaux.avenir.length, "avenir", ""],
    ["Sautées", seaux.sautees.length, "sautees",
     seaux.sautees.length ? "dépassées par les équipes, en attente d'une contrainte levée" : ""],
    ["Déjà passées", seaux.passees.length, "passees",
     passPas ? passSold + " soldées · " + passPas + " datées d'un jour passé, pas encore soldées"
             : "toutes soldées"],
    ["Sans date de passage", seaux.libre.length, "libre", "au programme, à dater"],
    ["Relèvent d'autres services", lot.filter(horsProgramme).length, "libre",
     "relevées, hors programme de nettoiement"]].forEach(function (p) {
      var w = el("div", "barre-ligne");
      w.style.marginBottom = "9px";
      var n = el("div", "barre-nom");
      var hb = el("div");
      hb.appendChild(el("span", null, p[0]));
      if (p[3]) hb.appendChild(el("em", "cal-precision", p[3]));
      n.appendChild(hb);
      w.appendChild(n);
      w.appendChild(el("div", "barre-val mono", p[1] + " école" + (p[1] > 1 ? "s" : "")));
      w.style.cursor = "pointer";
      w.onclick = function () { S.jour = p[2]; S.jourAuto = false; allerA("Planning"); };
      cal.appendChild(w);
    });
    cal.appendChild(el("p", "note-pied", "Démarrage le " + dateLongue(CAMPAGNE.debut).toLowerCase() +
      ". Aucune date butoir n'est retenue : les deux documents de référence divergent."));
    v.appendChild(cal);

    var b1 = el("div", "bloc");
    b1.appendChild(el("div", "bloc-titre")).appendChild(el("span", null, "Avancement par unité communale"));
    [1, 2, 3].forEach(function (n) {
      var l = ECOLES.filter(function (e) { return e.uc === n && !horsProgramme(e); });
      var f = l.filter(function (e) { return bilanEcole(e).fini; });
      b1.appendChild(barre("UC " + n + " · " + nbEtab(f) + "/" + nbEtab(l) + " établissements soldés",
                           null, agreger(l)));
    });
    b1.appendChild(el("p", "note-pied", "La barre mesure les interventions pointées ; le compte " +
      "en tête de ligne, les établissements entièrement soldés. Une école peut avoir trois " +
      "interventions sur quatre sans être soldée."));
    v.appendChild(b1);

    var b2 = el("div", "bloc");
    b2.appendChild(el("div", "bloc-titre")).appendChild(el("span", null, "Avancement par service pilote"));
    SERVICES.forEach(function (sv) {
      var acc = { total: 0, faits: 0, encours: 0, bloques: 0 };
      lot.forEach(function (e) {
        e.taches.forEach(function (t) {
          if (t.service !== sv.nom) return;
          acc.total++;
          var s = etatTache(e.id, t.id);
          if (s === "fait") acc.faits++; else if (s === "encours") acc.encours++; else if (s === "bloque") acc.bloques++;
        });
      });
      if (acc.total) b2.appendChild(barre(sv.nom, "var(" + sv.css + ")", acc));
    });
    v.appendChild(b2);

    /* Ce que le travail a couvert : de quoi répondre sans chercher. */
    var quartiers = {}, photos = 0, pointees = 0;
    soldees.forEach(function (e) { quartiers[e.quartier] = 1; });
    lot.forEach(function (e) {
      photos += (suiviDe(e.id).photos || []).length;
      e.taches.forEach(function (t) { if (etatTache(e.id, t.id) === "fait") pointees++; });
    });
    var bc = el("div", "bloc");
    bc.appendChild(el("div", "bloc-titre")).appendChild(el("span", null, "Couverture"));
    var gc = el("div", "couverture");
    [[String(Object.keys(quartiers).length), "quartiers touchés"],
    [pointees + " / " + a.total, "interventions pointées"],
    [String(photos), "photos versées du terrain"],
    [String(Object.keys(EXEC).length), "fiches d'exécution"]].forEach(function (x) {
      var c = el("div", "couv");
      c.appendChild(el("div", "n mono", x[0]));
      c.appendChild(el("div", "l", x[1]));
      gc.appendChild(c);
    });
    bc.appendChild(gc);
    v.appendChild(bc);

    /* Les écoles sautées, rangées par contrainte : c'est la question qu'on pose
       toujours en réunion — pourquoi celles-là n'avancent pas. Les écoles où le
       Cadre de Vie est passé y figurent nommément, leur herbicide étant posé. */
    var atteintsB = rangsAtteints();
    var saut = lot.filter(function (e) { return sautee(e, atteintsB); });
    if (saut.length) {
      var COUL = { eau: "--eau", chimique: "--sv-cadre", bloque: "--laterite",
                   autre: "--trait-fort" };
      var ORDRE_C = ["eau", "chimique", "bloque", "autre"];
      var par = {};
      saut.forEach(function (e) {
        var c = contrainte(e);
        (par[c.cle] = par[c.cle] || { long: c.long, court: c.court, l: [] }).l.push(e);
      });
      var bp = el("div", "bloc");
      var tp = el("div", "bloc-titre");
      tp.appendChild(el("span", null, "Écoles sautées"));
      tp.appendChild(el("span", "mono", nbEtab(saut) + ""));
      bp.appendChild(tp);
      bp.appendChild(el("p", "note-hors", "Les équipes les ont dépassées : une contrainte " +
        "les retient. Elles restent au programme et se reprogramment dès qu'elle est levée."));
      ORDRE_C.forEach(function (cle) {
        var g = par[cle];
        if (!g) return;
        var ent = el("div", "saut-groupe");
        var pastille = el("span", "saut-pastille");
        pastille.style.background = "var(" + COUL[cle] + ")";
        ent.appendChild(pastille);
        var txt = el("div");
        txt.appendChild(el("div", "saut-nom", g.court + " · " + nbEtab(g.l) +
          (nbEtab(g.l) > 1 ? " écoles" : " école")));
        txt.appendChild(el("div", "saut-long", g.long));
        ent.appendChild(txt);
        bp.appendChild(ent);
        var lp = el("div", "alerte-liste");
        g.l.sort(function (a, b) { return a.uc - b.uc || a.ordre - b.ordre; });
        g.l.forEach(function (e) {
          var w = el("div", "alerte");
          var pt = el("span", "pt");
          pt.style.background = "var(" + COUL[cle] + ")";
          w.appendChild(pt);
          var tx = el("div");
          tx.appendChild(el("div", null, e.nom));
          tx.appendChild(el("em", null, e.quartier + " · UC " + e.uc + " · n° " + e.ordre +
            (datePassage(e.id) ? " · datée du " + dateMoyenne(datePassage(e.id)) : " · sans date")));
          w.appendChild(tx);
          w.style.cursor = "pointer";
          w.onclick = function () { ouvrirFiche(e.id); };
          lp.appendChild(w);
        });
        bp.appendChild(lp);
      });
      v.appendChild(bp);
    }

    var urgentes = lot.filter(function (e) { return e.priorite === 1 && !bilanEcole(e).fini; });
    var b3 = el("div", "bloc");
    var t3 = el("div", "bloc-titre");
    t3.appendChild(el("span", null, "Priorité 1 non soldée"));
    t3.appendChild(el("span", "mono", urgentes.length + ""));
    b3.appendChild(t3);
    if (!urgentes.length) {
      b3.appendChild(el("p", null, "Toutes les écoles de priorité 1 sont soldées.")).style.cssText = "font-size:13.5px;color:var(--vert);margin:0;font-weight:600";
    } else {
      var l3 = el("div", "alerte-liste");
      urgentes.forEach(function (e) {
        var b = bilanEcole(e);
        var w = el("div", "alerte");
        w.appendChild(el("span", "pt"));
        var tx = el("div");
        tx.appendChild(el("div", null, e.nom));
        tx.appendChild(el("em", null, e.quartier + " · UC " + e.uc + " · " + b.faits + "/" + b.total +
          (e.inondation ? " · inondation constatée" : "") +
          (horsProgramme(e) ? " · hors programme de nettoiement" : "")));
        w.appendChild(tx);
        w.style.cursor = "pointer";
        w.onclick = function () { ouvrirFiche(e.id); };
        l3.appendChild(w);
      });
      b3.appendChild(l3);
    }
    v.appendChild(b3);

    /* une école prioritaire sans date de passage ne bougera pas d'elle-même */
    var sansDate = lot.filter(function (e) {
      return e.priorite === 1 && !horsProgramme(e) && !datePassage(e.id) && !bilanEcole(e).fini;
    });
    if (sansDate.length) {
      var b35 = el("div", "bloc");
      var t35 = el("div", "bloc-titre");
      t35.appendChild(el("span", null, "Priorité 1 sans date de passage"));
      t35.appendChild(el("span", "mono", sansDate.length + ""));
      b35.appendChild(t35);
      var l35 = el("div", "alerte-liste");
      sansDate.forEach(function (e) {
        var w = el("div", "alerte");
        w.appendChild(el("span", "pt"));
        var tx = el("div");
        tx.appendChild(el("div", null, e.nom));
        tx.appendChild(el("em", null, e.quartier + " · UC " + e.uc + " · N° " + e.ordre +
          (e.inondation ? " · inondation constatée" : "")));
        w.appendChild(tx);
        w.style.cursor = "pointer";
        w.onclick = function () { ouvrirFiche(e.id); };
        l35.appendChild(w);
      });
      b35.appendChild(l35);
      b35.appendChild(el("p", "note-pied", "Fixez-leur une date dans leur fiche : sans date, elles " +
        "n'apparaissent dans aucune intervention du jour."));
      v.appendChild(b35);
    }

    var bloques = [];
    lot.forEach(function (e) {
      e.taches.forEach(function (t) {
        if (etatTache(e.id, t.id) === "bloque") bloques.push({ e: e, t: t });
      });
    });
    if (bloques.length) {
      var b4 = el("div", "bloc");
      var t4 = el("div", "bloc-titre");
      t4.appendChild(el("span", null, "Interventions bloquées"));
      t4.appendChild(el("span", "mono", bloques.length + ""));
      b4.appendChild(t4);
      var l4 = el("div", "alerte-liste");
      bloques.slice(0, 20).forEach(function (x) {
        var w = el("div", "alerte");
        w.appendChild(el("span", "pt")).style.background = "var(--ambre)";
        var tx = el("div");
        var m = ((suiviDe(x.e.id).taches || {})[x.t.id] || {}).m;
        tx.appendChild(el("div", null, x.t.label + (m ? " — " + m : "")));
        tx.appendChild(el("em", null, x.e.nom + " · " + x.t.service + (m ? "" : " · cause non renseignée")));
        w.appendChild(tx);
        w.style.cursor = "pointer";
        w.onclick = function () { ouvrirFiche(x.e.id); };
        l4.appendChild(w);
      });
      b4.appendChild(l4);
      v.appendChild(b4);
    }

    if ((EXEC_META.confirmer || []).length) {
      var bc = el("div", "bloc");
      var tc = el("div", "bloc-titre");
      tc.appendChild(el("span", null, "Points à confirmer"));
      tc.appendChild(el("span", "mono", EXEC_META.confirmer.length + ""));
      bc.appendChild(tc);
      var lc = el("div", "alerte-liste");
      EXEC_META.confirmer.forEach(function (x) {
        var w = el("div", "alerte");
        w.appendChild(el("span", "pt")).style.background = "var(--ambre)";
        w.appendChild(el("div", null, x));
        lc.appendChild(w);
      });
      bc.appendChild(lc);
      bc.appendChild(el("p", "note-pied", "Relevés dans le rapport d'exécution, à trancher avec les " +
        "responsables d'UC."));
      v.appendChild(bc);
    }

    var b5 = el("div", "bloc");
    b5.appendChild(el("div", "bloc-titre")).appendChild(el("span", null, "Export"));
    if (new Date().getDay() === 5) {
      var rap = el("p", "note-hors");
      rap.style.cssText = "margin:0 0 11px";
      rap.textContent = "Nous sommes vendredi : c'est le jour du relevé hebdomadaire. " +
        "Téléchargez-le et déposez-le dans le dossier du projet.";
      b5.appendChild(rap);
    }
    var bx = el("button", "btn plein", "Télécharger le relevé (CSV)");
    bx.style.width = "100%";
    bx.onclick = exporterCSV;
    b5.appendChild(bx);
    v.appendChild(b5);

    /* moyens mis à disposition des équipes */
    if ((EXEC_META.dotation || []).length) {
      var bm = el("div", "bloc");
      var tm = el("div", "bloc-titre");
      tm.appendChild(el("span", null, "Moyens mis à disposition"));
      tm.appendChild(el("span", "rang mono", totalDotation() + " pièces"));
      bm.appendChild(tm);
      bm.appendChild(el("p", "note-hors", "Dotation commune en petit matériel remise aux équipes de l'UC 1. " +
        "Des moyens complémentaires sont notés au cas par cas dans la fiche de chaque école."));
      bm.appendChild(listeDotation());
      v.appendChild(bm);
    }

    /* dispositif : qui fait quoi */
    var bd = el("div", "bloc");
    bd.appendChild(el("div", "bloc-titre")).appendChild(el("span", null, "Dispositif"));
    var disp = el("div", "dispositif");
    [["logos/cadredevie.png", "Cadre de Vie", "Tutelle du programme · désherbage chimique avant le passage des agents"],
    ["logos/sonaged.png", "SONAGED", "Élagage, désherbage, enlèvement et dépôt des déchets"],
    ["logos/hygiene.png", "Service d'Hygiène", "Pompage, curages, eaux stagnantes, traitement anti-larvaire"],
    ["logos/commune.png", "Commune de Kaolack", "Maîtrise d'ouvrage · nivellement, remblais, dallage"],
    ["logos/genie.png", "Génie militaire", "Appui travaux · évacuation des gravats, branches et mobilier"],
    ["logos/pompiers.png", "Sapeurs-pompiers", "Appui aux opérations de pompage"]].forEach(function (p) {
      var w = el("div", "partenaire");
      var pl = el("span", "plaque");
      var im = el("img");
      im.src = p[0]; im.alt = p[1]; im.loading = "lazy";
      pl.appendChild(im);
      w.appendChild(pl);
      var tx = el("div");
      tx.appendChild(el("div", "nom", p[1]));
      tx.appendChild(el("div", "role", p[2]));
      w.appendChild(tx);
      disp.appendChild(w);
    });
    bd.appendChild(disp);
    v.appendChild(bd);

    if (!S.db && !DISTANT) {
      var loc = el("p", "note-hors");
      loc.style.cssText = "margin:var(--e4) 0 0";
      loc.textContent = "Mode local : ce que vous cochez est enregistré sur cet appareil uniquement " +
        "et n'est pas partagé avec les autres agents. Exportez le relevé pour le transmettre.";
      v.appendChild(loc);
    }

    if (!bilanJoue) { bilanJoue = true; animerBilan(v); }

    var note = el("p", "note-pied");
    note.innerHTML = "Périmètre arrêté par le CSIG le 21/09 : dans les établissements scolaires, la SONAGED intervient pour " +
      "l'élagage, le désherbage et l'enlèvement des déchets ; le curage revient au Service d'Hygiène ; gravats, branches " +
      "et mobilier à la Commune / Génie militaire ; murs, enduits, menuiseries et latrines aux Constructions scolaires. " +
      "Le désherbage chimique se compte à part : l'équipe dédiée du Cadre de Vie traite l'herbe à l'herbicide " +
      "avant le passage des agents, pour que la coupe et le ratissage leur soient plus faciles. " +
      nbEtab(ECOLES) + " établissements relevés au GPS, " +
      ECOLES.reduce(function (n, e) { return n + e.taches.length; }, 0) + " interventions recensées.";
    v.appendChild(note);
  }

  function exporterCSV() {
    /* Pas de garde sur S.downloads : cette capacité n'existe que sur claude.ai,
       et le repli par lien de téléchargement, plus bas, marche partout ailleurs. */
    var l = ['Code SIG;Établissement;Quartier;UC;Tournée;Rang programme;Date de passage;Priorité;Inondation;Latitude;Longitude;Intervention;Service;État;Motif du blocage;Mise à jour;Observation'];
    ECOLES.forEach(function (e) {
      var d = suiviDe(e.id);
      var obs = (d.obs || "").replace(/[\r\n;]+/g, " ").trim();
      (e.taches.length ? e.taches : [{ id: "", label: "(diagnostic à compléter)", service: "" }]).forEach(function (t) {
        var st = t.id ? (d.taches || {})[t.id] : null;
        l.push([
          e.codes.join(" "), e.nom, e.quartier, "UC " + e.uc, e.tournee,
          e.ordre || "hors programme", datePassage(e.id) || "non programmée", e.priorite,
          e.inondation ? "oui" : "non",
          situee(e) ? e.lat : "", situee(e) ? e.lon : "", t.label, t.service,
          /* un état inconnu ne doit pas faire échouer tout le relevé */
          (st && (ETATS.filter(function (x) { return x.k === st.e; })[0] || {}).long) || "À faire",
          (st && st.m) || "",
          st && st.le ? new Date(st.le).toLocaleString("fr-FR") : "", obs
        ].map(function (v) { return String(v).replace(/;/g, ","); }).join(";"));
      });
    });
    var stamp = new Date().toISOString().slice(0, 10);
    var nom = "suivi-nettoiement-ecoles-kaolack-" + stamp + ".csv";
    var texte = "﻿" + l.join("\r\n");
    if (S.downloads) {
      S.downloads.save({ filename: nom, data: texte })
        .then(function () { toast("Relevé exporté."); })
        .catch(function () { toast("Export annulé."); });
      return;
    }
    /* hébergement classique : un simple lien de téléchargement suffit */
    try {
      var url = URL.createObjectURL(new Blob([texte], { type: "text/csv;charset=utf-8" }));
      var a = document.createElement("a");
      a.href = url; a.download = nom;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast("Relevé téléchargé.");
    } catch (e) {
      toast("Téléchargement impossible sur cet appareil.");
    }
  }

  /* ---------------- navigation ---------------- */
  /* Un seul cran d'historique pour les onglets, pas un par tapotement : quitter
     le Planning en pose un, y revenir le retire. Retour ramène donc au Planning,
     puis quitte — ce qu'attend un utilisateur Android. */
  function allerA(vue) {
    if (!RETOUR) {
      var horsPlanning = PILE.some(function (c) { return c.nom === "vue"; });
      if (vue !== "Planning" && !horsPlanning) {
        empiler("vue", function () { appliquerVue("Planning"); });
      } else if (vue === "Planning" && horsPlanning &&
                 PILE[PILE.length - 1].nom === "vue") {
        history.back();   /* popstate fera le retour au Planning */
        return;
      }
    }
    appliquerVue(vue);
  }

  /* ---------------- mise en scène du Bilan ----------------
     Le Bilan se projette devant un comité : à l'ouverture de l'onglet, les
     chiffres montent, les barres se remplissent et la courbe s'écrit. Rien ne
     rejoue aux relectures de la base, toutes les trente secondes — une page
     qui s'anime sans cesse devient illisible, et fatigue une salle. */
  var bilanJoue = false;

  function sobre() {
    try { return matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  /* Un nombre qui monte se lit mieux qu'un nombre qui apparaît : on retient le
     suffixe (« /48 », « % ») et on n'anime que la part chiffrée de tête. */
  function compter(n, retard) {
    var m = String(n.textContent).match(/^(\d+)([\s\S]*)$/);
    if (!m || +m[1] <= 0) return;
    var cible = +m[1], suite = m[2], debut = 0;
    n.textContent = "0" + suite;
    function pas(t) {
      if (!debut) debut = t;
      var u = (t - debut - retard) / 850;
      if (u < 0) { requestAnimationFrame(pas); return; }
      u = Math.min(1, u);
      n.textContent = Math.round(cible * (1 - Math.pow(1 - u, 3))) + suite;
      if (u < 1) requestAnimationFrame(pas);
    }
    requestAnimationFrame(pas);
  }

  function animerBilan(v) {
    if (sobre()) return;
    v.classList.add("anime");
    Array.prototype.forEach.call(v.children, function (c, i) {
      c.style.setProperty("--i", Math.min(i, 10));
    });
    Array.prototype.forEach.call(v.querySelectorAll(".kpi .n"), function (n, i) {
      compter(n, 120 + i * 90);
    });
    Array.prototype.forEach.call(v.querySelectorAll(".couv .n"), function (n, i) {
      compter(n, 420 + i * 70);
    });
    /* les barres repartent de zéro, puis s'étirent jusqu'à leur mesure */
    var barres = v.querySelectorAll(".barre i");
    Array.prototype.forEach.call(barres, function (b, i) {
      var l = b.style.width;
      b.style.transition = "none";
      b.style.width = "0%";
      b.setAttribute("data-l", l);
      void b.offsetWidth;
      b.style.transition = "width .85s cubic-bezier(.22,.7,.3,1) " + (260 + i * 45) + "ms";
    });
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(barres, function (b) {
        b.style.width = b.getAttribute("data-l") || "0%";
      });
    });
    /* la courbe s'écrit à sa longueur réelle, non à une longueur devinée */
    var l = v.querySelector(".graphe-ligne");
    if (l && l.getTotalLength) {
      var d = l.getTotalLength();
      l.style.transition = "none";
      l.style.strokeDasharray = d;
      l.style.strokeDashoffset = d;
      void l.getBoundingClientRect();
      l.style.transition = "stroke-dashoffset 1.25s cubic-bezier(.22,.7,.3,1) .3s";
      l.style.strokeDashoffset = "0";
    }
    Array.prototype.forEach.call(v.querySelectorAll(".graphe-barre"), function (r, i) {
      r.style.setProperty("--i", i);
    });
  }

  function appliquerVue(vue) {
    if (vue !== "Bilan") bilanJoue = false;
    S.vue = vue;
    $("#vuePlanning").hidden = vue !== "Planning";
    $("#vueEcoles").hidden = vue !== "Ecoles";
    $("#vueCarte").hidden = vue !== "Carte";
    $("#vueBilan").hidden = vue !== "Bilan";
    Array.prototype.forEach.call(document.querySelectorAll(".nav button"), function (b) {
      if (b.getAttribute("data-vue") === vue) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
    rafraichir();
  }

  function rafraichir() {
    construireFiltres();
    if (S.vue === "Planning") rendrePlanning();
    else if (S.vue === "Ecoles") rendreListe();
    else if (S.vue === "Carte") rendreCarte();
    else rendreBilan();
    resoudreNoms();
  }

  /* ---------------- avis d'ouverture ----------------
     Ce qu'un agent veut savoir en ouvrant l'app : les écoles en cours, c'est-à-dire
     celles programmées aujourd'hui et pas encore soldées — le contenu de l'onglet
     « Aujourd'hui ». L'avis paraît une fois par ouverture, dès que l'avancement est
     connu, et s'efface seul au bout de cinq secondes. Toucher une ligne ouvre la
     fiche ; toucher le pied le referme tout de suite. */
  var avisFait = false, avisMinuteur = 0;
  function fermerAvis() {
    clearTimeout(avisMinuteur);
    var a = $("#avis");
    if (!a || !a.parentNode || a.classList.contains("sort")) return;
    /* La sortie par la droite est une animation : on retire l'avis quand elle est
       jouée. Le minuteur de secours couvre le cas où l'événement ne vient pas —
       mouvement réduit, onglet en arrière-plan. */
    a.classList.add("sort");
    var oter = function () { if (a.parentNode) a.parentNode.removeChild(a); };
    a.addEventListener("animationend", oter, { once: true });
    setTimeout(oter, 600);
  }
  function avisEnCours() {
    if (avisFait) return;
    /* L'écran d'accueil passe d'abord : l'avis attend qu'on soit entré. */
    var ac = $("#accueil");
    if (ac && !ac.hidden) return;
    avisFait = true;

    var auj = aujourdhui();
    var duJour = ECOLES.filter(function (e) { return datePassage(e.id) === auj; });
    var soldees = duJour.filter(function (e) { return bilanEcole(e).fini; }).length;
    var lot = duJour.filter(function (e) { return !bilanEcole(e).fini; })
      .sort(function (a, b) {
        if (a.priorite !== b.priorite) return a.priorite - b.priorite;
        return bilanEcole(b).faits - bilanEcole(a).faits;
      });
    if (!lot.length) return;

    var a = el("div", "avis");
    a.id = "avis";
    a.setAttribute("role", "status");
    var haut = el("div", "avis-haut");
    haut.appendChild(el("b", null, lot.length > 1
      ? lot.length + " écoles en cours"
      : "Une école en cours"));
    haut.appendChild(el("span", null, "programmées aujourd'hui"
      + (soldees ? " · " + soldees + " déjà soldée" + (soldees > 1 ? "s" : "") : "")));
    a.appendChild(haut);

    lot.slice(0, 4).forEach(function (e) {
      var b = bilanEcole(e);
      var w = el("button", "avis-ligne");
      w.type = "button";
      var g = el("div");
      var nom = el("div");
      if (e.priorite === 1) nom.appendChild(el("span", "avis-p1", "P1"));
      nom.appendChild(document.createTextNode(e.nom));
      g.appendChild(nom);
      g.appendChild(el("em", null, e.quartier + " · UC " + e.uc
        + (datePassage(e.id) ? " · " + dateMoyenne(datePassage(e.id)) : "")
        + (b.bloques ? " · " + b.bloques + " bloqué" + (b.bloques > 1 ? "s" : "") : "")));
      w.appendChild(g);
      w.appendChild(el("span", "mono", b.total ? b.faits + "/" + b.total : "à diagnostiquer"));
      w.onclick = function () { fermerAvis(); ouvrirFiche(e.id); };
      a.appendChild(w);
    });

    var reste = lot.length - 4;
    var pied = el("button", "avis-pied", reste > 0
      ? "et " + reste + " autre" + (reste > 1 ? "s" : "") + " — toucher pour fermer"
      : "Toucher pour fermer");
    pied.type = "button";
    pied.onclick = fermerAvis;
    a.appendChild(pied);

    document.body.appendChild(a);
    avisMinuteur = setTimeout(fermerAvis, 5000);
  }

  /* ---------------- démarrage ---------------- */
  lireCache();
  majBandeauAttente();
  construireFiltres();
  rendrePlanning();
  marqueLien("", "Connexion…");
  /* Filet : sans base partagée, ou si elle tarde, l'avis part de l'instantané. */
  setTimeout(avisEnCours, 1800);

  $("#q").addEventListener("input", function (ev) { S.q = ev.target.value; if (S.vue === "Ecoles") rendreListe(); else rafraichir(); });
  Array.prototype.forEach.call(document.querySelectorAll(".nav button"), function (b) {
    b.addEventListener("click", function () { allerA(b.getAttribute("data-vue")); });
  });
  window.addEventListener("online", function () {
    if (nbAttente()) { toast("Réseau retrouvé — envoi des saisies en attente."); rejouerAttente(); }
  });
  $("#cartePlus").addEventListener("click", function () { zoomer(1.7); });
  $("#carteMoins").addEventListener("click", function () { zoomer(1 / 1.7); });
  $("#carteRecadrer").addEventListener("click", recadrer);
  document.addEventListener("keydown", function (ev) {
    if (VUE_PHOTO) {
      if (ev.key === "Escape") { ev.preventDefault(); quitterVisionneuse(); }
      else if (ev.key === "ArrowLeft") { ev.preventDefault(); glisser(-1); }
      else if (ev.key === "ArrowRight") { ev.preventDefault(); glisser(1); }
      return;
    }
    if (ev.key === "Escape") {
      if ($("#programme")) { ev.preventDefault(); fermerProgramme(); return; }
      if (S.fiche) fermerFiche();
    }
  });

  /* ---------------- écran d'accueil et installation ----------------
     Le navigateur ne laisse pas déclencher l'installation quand on veut : il
     annonce qu'elle est possible, et il faut garder son événement pour le
     rejouer au moment où l'utilisateur touche le bouton. */
  var INSTALL = null;

  window.addEventListener("beforeinstallprompt", function (ev) {
    ev.preventDefault();
    INSTALL = ev;
  });

  window.addEventListener("appinstalled", function () {
    INSTALL = null;
    var a = $("#accueil");
    if (a) a.hidden = true;
    toast("Application installée — retrouvez-la sur l'écran d'accueil.");
  });

  (function ecranAccueil() {
    var vue = $("#accueil");
    if (!vue || vue.hidden) return;   /* déjà écarté : on tourne en app installée */
    var installer = $("#accueilInstaller"), entrer = $("#accueilEntrer"), aide = $("#accueilAide");

    installer.onclick = function () {
      if (!INSTALL) {
        /* Safari et quelques autres n'offrent pas d'installation automatique :
           on décrit le geste manuel plutôt que de laisser un bouton inerte. */
        aide.hidden = false;
        aide.textContent = /iphone|ipad|ipod/i.test(navigator.userAgent)
          ? "Sur iPhone : touchez « Partager » en bas de Safari, puis « Sur l'écran d'accueil »."
          : "Dans le menu du navigateur (⋮ en haut à droite), choisissez « Installer l'application » "
            + "ou « Ajouter à l'écran d'accueil ».";
        return;
      }
      installer.disabled = true;
      INSTALL.prompt();
      INSTALL.userChoice.then(function (r) {
        INSTALL = null;
        if (r && r.outcome === "accepted") vue.hidden = true;
        else installer.disabled = false;
      }).catch(function () { installer.disabled = false; });
    };

    entrer.onclick = function () { vue.hidden = true; avisEnCours(); };
  })();

  connecter();
})();
