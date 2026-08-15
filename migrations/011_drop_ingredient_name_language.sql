-- Le nom vit désormais dans ingredient_translations (une note = un nom par langue),
-- donc `name`/`language` sur `ingredients` seraient redondants et trompeurs.
ALTER TABLE ingredients DROP COLUMN name;
ALTER TABLE ingredients DROP COLUMN language;
