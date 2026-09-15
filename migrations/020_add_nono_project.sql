-- Le projet Nono (backoffice du robot magasin) a été ajouté côté front
-- (commit 54a9f28) mais jamais inséré dans la table `projects` en base,
-- donc GET /projects ne le renvoyait jamais, même pour un admin.
INSERT INTO projects (name, slug, description, color, status)
SELECT 'Nono', 'nono', 'Backoffice du robot magasin', '#0ea5e9', 'active'
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE slug = 'nono');
