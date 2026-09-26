-- Écoles Propres Kaolack — base partagée
-- À exécuter une seule fois dans Supabase : SQL Editor → New query → coller
-- ce fichier en entier → Run. Crée la table, ses règles de sécurité, puis
-- charge l'avancement constaté le 26/09/2026 : six écoles soldées, deux
-- programmées le dimanche 27 septembre.
-- Le relancer plus tard est sans danger : rien n'est effacé, les huit lignes
-- d'amorçage sont simplement réécrites.

-- 1. La table : une ligne par établissement, le suivi dans un champ JSON.
create table if not exists public.suivi (
  id  text primary key,
  doc jsonb       not null default '{}'::jsonb,
  maj timestamptz not null default now()
);

-- 1 bis. Accès de l'API au travers de la table. Utile si le projet a été créé
--        sans « Automatically expose new tables » ; sans effet dans le cas
--        contraire. Aucune suppression n'est accordée.
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.suivi to anon, authenticated;
revoke delete on public.suivi from anon, authenticated;

-- 2. Sécurité au niveau des lignes : rien n'est autorisé tant qu'une règle
--    ne l'autorise explicitement.
alter table public.suivi enable row level security;

drop policy if exists "lecture publique"        on public.suivi;
drop policy if exists "creation codes connus"   on public.suivi;
drop policy if exists "mise a jour codes connus" on public.suivi;

-- 3. Tout le monde peut lire : l'app est un outil de transparence.
create policy "lecture publique"
  on public.suivi for select
  using (true);

-- 4. L'écriture est limitée aux 48 codes SIG du programme (J1-001 … J3-010).
--    Une ligne inventée est refusée ; aucune règle de suppression n'existe,
--    donc rien ne peut être effacé.
create policy "creation codes connus"
  on public.suivi for insert
  with check (id ~ '^J[123]-[0-9]{3}$');

create policy "mise a jour codes connus"
  on public.suivi for update
  using      (id ~ '^J[123]-[0-9]{3}$')
  with check (id ~ '^J[123]-[0-9]{3}$');

-- 5. Horodatage automatique de chaque modification.
create or replace function public.suivi_maj()
returns trigger language plpgsql as $$
begin
  new.maj := now();
  return new;
end $$;

drop trigger if exists suivi_maj on public.suivi;
create trigger suivi_maj before insert or update on public.suivi
  for each row execute function public.suivi_maj();

-- 6. Amorçage : l'avancement connu au moment de la construction de l'app.
--    « on conflict » rend l'exécution répétable ; ce bloc peut aussi être
--    régénéré depuis claude.ai pour repartir d'un état commun.
insert into public.suivi (id, doc) values
  ('J2-001', '{"date": "2026-09-26", "maj": "2026-09-26T15:00:00.000Z", "obs": "Terminée le samedi 26 septembre. Rang 7 du programme UC 1.", "photos": [], "taches": {"J2-001-T1": {"e": "fait", "le": "2026-09-26T15:00:00.000Z", "par": ""}, "J2-001-T2": {"e": "fait", "le": "2026-09-26T15:00:00.000Z", "par": ""}, "J2-001-T3": {"e": "fait", "le": "2026-09-26T15:00:00.000Z", "par": ""}, "J2-001-T4": {"e": "fait", "le": "2026-09-26T15:00:00.000Z", "par": ""}}}'::jsonb),
  ('J2-007', '{"date": "2026-09-25", "maj": "2026-09-25T21:00:00.000Z", "obs": "Terminée le vendredi 25 septembre. Cour dégagée, arbres élagués, branches et déchets évacués.", "photos": [], "taches": {"J2-007-T1": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}, "J2-007-T2": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}, "J2-007-T3": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}, "J2-007-T4": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}}}'::jsonb),
  ('J2-009', '{"date": "2026-09-23", "maj": "2026-09-25T21:00:00.000Z", "obs": "Terminée. Première école soldée du programme, passée le mercredi 23 septembre.", "photos": [], "taches": {"J2-009-T1": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}, "J2-009-T2": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}, "J2-009-T3": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}, "J2-009-T4": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}}}'::jsonb),
  ('J2-010', '{"date": "2026-09-24", "maj": "2026-09-25T21:00:00.000Z", "obs": "Terminée. Deux jours de passage, les 23 et 24 septembre.", "photos": [], "taches": {"J2-010-T1": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}, "J2-010-T2": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}, "J2-010-T3": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}, "J2-010-T4": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}}}'::jsonb),
  ('J2-011', '{"date": "2026-09-26", "maj": "2026-09-26T15:00:00.000Z", "obs": "Terminée le samedi 26 septembre. Quatre jours de passage : 23, 24 et 26 septembre. Rang 4 du programme UC 1.", "photos": [], "taches": {"J2-011-T1": {"e": "fait", "le": "2026-09-26T15:00:00.000Z", "par": ""}, "J2-011-T2": {"e": "fait", "le": "2026-09-26T15:00:00.000Z", "par": ""}, "J2-011-T3": {"e": "fait", "le": "2026-09-26T15:00:00.000Z", "par": ""}, "J2-011-T4": {"e": "fait", "le": "2026-09-26T15:00:00.000Z", "par": ""}}}'::jsonb),
  ('J2-012', '{"date": "2026-09-24", "maj": "2026-09-25T21:00:00.000Z", "obs": "Terminée. Deux jours de passage, les 23 et 24 septembre.", "photos": [], "taches": {"J2-012-T1": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}, "J2-012-T2": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}, "J2-012-T3": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}, "J2-012-T4": {"e": "fait", "le": "2026-09-25T21:00:00.000Z", "par": ""}}}'::jsonb),
  ('J3-001', '{"date": "2026-09-27", "maj": "2026-09-26T14:30:00.000Z", "obs": "Programmée dimanche 27 septembre (affiche de la Commune). Rang 10 du programme UC 1.", "photos": [], "taches": {}}'::jsonb),
  ('J3-003', '{"date": "2026-09-27", "maj": "2026-09-26T14:30:00.000Z", "obs": "Programmée dimanche 27 septembre (affiche de la Commune). Rang 9 du programme UC 1.", "photos": [], "taches": {}}'::jsonb)
on conflict (id) do update set doc = excluded.doc;

-- 7. Stockage des photos de terrain, déposées depuis le téléphone.
--    Compartiment public en lecture : les vignettes s'affichent dans l'app sans
--    signature. En écriture, le dépôt est ouvert, comme le pointage ; aucune
--    règle de suppression n'existe, donc une photo déposée ne peut pas disparaître.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

drop policy if exists "photos lecture publique" on storage.objects;
drop policy if exists "photos depot"            on storage.objects;

create policy "photos lecture publique"
  on storage.objects for select
  using (bucket_id = 'photos');

create policy "photos depot"
  on storage.objects for insert
  with check (bucket_id = 'photos');

-- Contrôle : doit renvoyer les 8 lignes d'amorçage.
select id, doc->>'date' as date_passage,
       jsonb_array_length(coalesce(doc->'photos', '[]'::jsonb)) as photos
from public.suivi order by id;
