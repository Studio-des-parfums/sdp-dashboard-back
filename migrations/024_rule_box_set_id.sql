-- box_set (VARCHAR libre, migration 015) devient box_set_id (FK vers coffrets),
-- pour rester cohérent avec le passage des coffrets en table dédiée.
-- ON DELETE SET NULL : une règle sans coffret s'applique à tous (comportement
-- déjà existant quand box_set était NULL).
ALTER TABLE ingredient_rules ADD COLUMN box_set_id INT NULL AFTER box_set;
ALTER TABLE ingredient_rules
  ADD FOREIGN KEY (box_set_id) REFERENCES coffrets(id) ON DELETE SET NULL;

UPDATE ingredient_rules r
JOIN coffret_translations ct ON ct.name = r.box_set AND ct.language = 'fr'
SET r.box_set_id = ct.coffret_id;

ALTER TABLE ingredient_rules DROP COLUMN box_set;
