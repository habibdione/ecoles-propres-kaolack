/* Base partagée de l'application — à renseigner une seule fois.

   Tant que ces deux valeurs sont vides, l'app fonctionne en mode local :
   chacun voit ses propres saisies, sur son appareil. Dès qu'elles sont
   renseignées, les saisies de tous les agents se rejoignent.

   Où les trouver, après avoir créé le projet Supabase (voir README.md) :
   Project Settings → API
     • url = « Project URL »        (de la forme https://xxxxxxxx.supabase.co)
     • cle = « Publishable key »  (Settings → API Keys ; jamais une « Secret key »)

   La clé « publishable » est faite pour être publiée : c'est la politique de sécurité
   de la table, posée par supabase.sql, qui décide de ce qu'elle autorise.
   Ne collez JAMAIS ici une clé « sb_secret_… ».                              */

window.KLCONF = {
  url: "https://zsjbfzepserhcekulxxf.supabase.co",
  cle: "sb_publishable_cvyyf-Fg1w9iJ7HwhJH1jQ_rSqXjruJ",
  sondageSecondes: 30   // fréquence de relecture de la base, en secondes
};
