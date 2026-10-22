-- Équipe de l'utilisateur = slug d'un espace officiel Polux (ex: 'laboratoire').
-- Les espaces vivent dans la base polux : pas de clé étrangère possible, la liste est
-- fournie au front par polux-back (GET /teams, is_official = TRUE).
ALTER TABLE users ADD COLUMN team_slug VARCHAR(100) NULL AFTER role_id;
