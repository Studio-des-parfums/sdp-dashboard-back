-- Espaces Polux créés à la volée : chaque espace est un projet (kind = 'polux') dont le slug
-- est celui de l'espace dans la base polux. L'accès à l'espace = l'accès à ce projet
-- (user_projects). Le Polux existant est le premier espace.
ALTER TABLE projects ADD COLUMN kind VARCHAR(20) NULL AFTER slug;
UPDATE projects SET kind = 'polux' WHERE slug = 'polux';
