# Écoles Propres Kaolack

Application mobile de suivi des opérations de nettoiement des établissements scolaires
de la commune de Kaolack — la **SONAGED**, avec Cadre de Vie, la Commune de Kaolack,
le Service d'Hygiène, le Génie militaire et les Sapeurs-pompiers.

Elle fonctionne **sans serveur** : tout tient dans des fichiers statiques, et une fois
la page ouverte une première fois, elle s'ouvre encore sans réseau.

## Ce que contient l'application

- **Planning** — l'affiche officielle du jour, les écoles programmées, l'itinéraire
  enchaîné vers Google Maps, et le programme à diffuser quand la Commune n'en a pas fait.
  Le bouton **Programmer pour ce jour** date plusieurs écoles en une fois, et renvoie
  à *À programmer* une tournée reportée : le planning se refait chaque jour depuis
  le téléphone, sans rien republier.
- **Écoles** — les 48 établissements relevés au GPS, filtrables par unité communale,
  par avancement et par service pilote ; 181 interventions à pointer.
- **Carte** — fond OpenStreetMap vectoriel (voirie, hydrographie, 44 quartiers),
  zoom et déplacement, sans consommer de données mobiles.
- **Bilan** — avancement par UC et par service, courbe d'évolution, rythme quotidien,
  écoles prioritaires sans date, points à confirmer, dotation en matériel, export CSV.

234 photos de terrain et les fiches du rapport d'exécution sont embarquées.

## Mettre en ligne sur GitHub Pages

1. **GitHub Desktop** → *File* → *Add local repository* → choisir ce dossier.
2. Rédiger un message de commit, puis *Commit to main*.
3. *Publish repository* — décocher « Keep this code private » si le dépôt doit être public.
4. Sur github.com, dans le dépôt : *Settings* → *Pages* → *Source* : `Deploy from a branch`,
   branche `main`, dossier `/ (root)` → *Save*.
5. L'adresse apparaît au bout d'une minute :
   `https://<votre-compte>.github.io/ecoles-propres-kaolack/`

Sur le téléphone, ouvrir cette adresse puis **« Ajouter à l'écran d'accueil »** : l'app
se lance en plein écran, avec son icône, et fonctionne hors réseau.

## Ce qui change par rapport à la version claude.ai

L'application publiée sur claude.ai dispose d'une base partagée : ce qu'un agent coche
est vu par tous, les photos prises sur le terrain y sont versées, chaque saisie est signée.

Cette version-ci est autonome, donc :

| | claude.ai | GitHub Pages |
|---|---|---|
| Consultation (planning, carte, photos, bilan) | oui | oui |
| Pointage des interventions | partagé entre tous | local, ou partagé via Supabase (ci-dessous) |
| Ajout de photos depuis le téléphone | oui | non |
| Export CSV | oui | oui |
| Fonctionne sans réseau | partiellement | oui, entièrement |

L'avancement livré avec l'app est un **instantané** (`suivi.js`) figé au moment de la
construction. Les saisies faites localement le recouvrent et restent sur l'appareil ;
pour les transmettre, exporter le relevé CSV depuis le Bilan.

## Activer la saisie partagée

Par défaut, chaque agent ne voit que ses propres saisies. Pour que tout le monde
travaille sur les mêmes données, il faut une base hébergée. L'application est prête
pour **Supabase**, dont l'offre gratuite suffit largement pour 48 écoles.

**À faire une seule fois, par vous — je ne peux pas créer de compte à votre place :**

1. Créer un compte sur [supabase.com](https://supabase.com), puis un projet
   (nom libre, région *West EU (Ireland)* ou *Frankfurt*, la plus proche du Sénégal).
   À l'écran de création, laisser les trois options *Data API* cochées (*Enable Data API*,
   *Automatically expose new tables*, *Enable automatic RLS*) : la première est indispensable,
   les deux autres sont sans risque ici. Conserver le mot de passe de base proposé — il ne sert
   pas à l'app, et n'est plus jamais réaffiché.
2. Dans le projet : **SQL Editor → New query**, coller le contenu de `supabase.sql`
   en entier, puis *Run*. La table, ses règles de sécurité et l'avancement actuel
   — six écoles soldées, deux programmées — sont mis en place d'un coup ; le
   contrôle final doit afficher 8 lignes.
3. **Project Settings → API** : copier *Project URL* et la clé *anon public*.
4. Les coller dans `config.js`, valider et publier depuis GitHub Desktop.

L'indicateur en haut de l'app passe alors de « Mode local » à « Données partagées ».
Ce qu'un agent coche est relu par les autres dans les trente secondes.

### Ce que la sécurité garantit, et ce qu'elle ne garantit pas

La clé *anon* est publique par conception : elle figure dans le code de la page, que
n'importe qui peut lire. C'est la politique posée par `supabase.sql` qui protège les
données, et elle autorise :

- la **lecture** par tous — l'app est un outil de transparence ;
- l'**écriture** uniquement sur les 48 codes SIG du programme : une ligne inventée est
  refusée ;
- **aucune suppression** : aucune règle ne l'autorise, rien ne peut être effacé.

En revanche, une personne qui connaît l'adresse du site peut modifier l'avancement
d'une école. Les données ne sont pas personnelles et le programme est public, donc le
risque est celui d'une farce, pas d'une fuite. Si cela pose problème, deux options :
garder le dépôt **privé** et la saisie sur claude.ai, ou ajouter une authentification
Supabase — dites-le moi.

### Remettre les deux bases d'accord

L'app publiée sur claude.ai et la base Supabase sont indépendantes. Pour éviter qu'elles
divergent, choisissez-en **une seule comme référence de saisie**. le bloc d'amorçage de `supabase.sql`
peut être régénéré à tout moment depuis l'avancement de claude.ai pour repartir d'un
état commun.

## Régénérer le dépôt

Les sources de l'app vivent dans `PROJET MAIRIE KL/APP SUIVI/`. Après modification :

```
python build_deploiement.py
```

Le script reconstruit `index.html` (document complet), le manifeste, l'agent de service
et recopie données, photos, affiches et logos. La version de l'agent de service change
à chaque build, ce qui force la mise à jour du cache sur les téléphones.

## Données et crédits

- Positions des écoles : relevés GPS des tournées J1 à J3, septembre 2026, WGS 84.
- Fond de plan : © les contributeurs **OpenStreetMap**, sous licence ODbL.
- Quartiers et limite communale : base SIG de la commune de Kaolack.
- Typographies : Archivo, Public Sans et IBM Plex Mono (Google Fonts).
- Photographies de terrain : SONAGED Kaolack.
