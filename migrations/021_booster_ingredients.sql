-- Les boosters partagent la table `ingredients` avec les notes olfactives
-- (top/heart/base) : mêmes attributs (traductions, catégorie, intensité,
-- allergènes, coffrets), donc pas de nouvelle table — juste un 4e type.
ALTER TABLE ingredients MODIFY COLUMN type ENUM('top', 'heart', 'base', 'booster') NOT NULL;

-- Seed des 3 boosters existants (un INSERT + une traduction FR à la fois,
-- pour ne pas dépendre du comportement de LAST_INSERT_ID() sur un batch).
INSERT INTO ingredients (type) VALUES ('booster');
INSERT INTO ingredient_translations (ingredient_id, language, name) VALUES (LAST_INSERT_ID(), 'fr', 'Musc Blanc');

INSERT INTO ingredients (type) VALUES ('booster');
INSERT INTO ingredient_translations (ingredient_id, language, name) VALUES (LAST_INSERT_ID(), 'fr', 'Musc Floral');

INSERT INTO ingredients (type) VALUES ('booster');
INSERT INTO ingredient_translations (ingredient_id, language, name) VALUES (LAST_INSERT_ID(), 'fr', 'Accord Musc');
