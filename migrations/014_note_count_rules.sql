-- 4e type de règle : note_count. Contraint, pour une taille de flacon donnée,
-- le NOMBRE de notes choisies (pas une quantité en ml) dans chaque famille
-- (tête, cœur, fond). Pas de note source ni de notes cibles : bottle_size
-- devient obligatoire pour ce type, et porte à lui seul l'identité de la règle.
ALTER TABLE ingredient_rules MODIFY COLUMN rule_type
  ENUM('incompatibility', 'max_dosage', 'recommendation', 'note_count') NOT NULL;

ALTER TABLE ingredient_rules
  ADD COLUMN min_top INT AFTER bottle_size,
  ADD COLUMN max_top INT AFTER min_top,
  ADD COLUMN min_heart INT AFTER max_top,
  ADD COLUMN max_heart INT AFTER min_heart,
  ADD COLUMN min_base INT AFTER max_heart,
  ADD COLUMN max_base INT AFTER min_base;

-- Une seule règle note_count par taille de flacon, pour éviter toute ambiguïté
-- sur laquelle appliquer. Colonne générée non-NULL uniquement pour note_count :
-- l'unicité ne s'applique donc qu'à ce type, sans contraindre max_dosage (qui
-- peut légitimement avoir plusieurs règles — sur des notes différentes —
-- partageant la même bottle_size).
ALTER TABLE ingredient_rules
  ADD COLUMN note_count_key VARCHAR(20)
    GENERATED ALWAYS AS (CASE WHEN rule_type = 'note_count' THEN bottle_size END) STORED;
CREATE UNIQUE INDEX uq_note_count_bottle_size ON ingredient_rules (note_count_key);
