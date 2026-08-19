-- Une règle peut être restreinte à une intensité de parfum précise (léger,
-- modéré/moyenne, fort) ou s'appliquer aux 3 (valeur par défaut). Applicable
-- à tous les types de règles. Mêmes valeurs que ingredients.intensity pour
-- rester cohérent, + 'toutes' qui n'a pas d'équivalent côté note.
ALTER TABLE ingredient_rules
  ADD COLUMN intensity ENUM('legere', 'moyenne', 'forte', 'toutes') NOT NULL DEFAULT 'toutes' AFTER box_set;

-- L'unicité note_count portait sur (bottle_size, box_set) ; elle doit
-- maintenant aussi tenir compte de l'intensité, pour permettre des règles
-- note_count différentes par intensité sur une même taille/coffret.
DROP INDEX uq_note_count_bottle_size ON ingredient_rules;
ALTER TABLE ingredient_rules DROP COLUMN note_count_key;
ALTER TABLE ingredient_rules
  ADD COLUMN note_count_key VARCHAR(300)
    GENERATED ALWAYS AS (
      CASE WHEN rule_type = 'note_count'
        THEN CONCAT(COALESCE(bottle_size, ''), '::', COALESCE(box_set, ''), '::', intensity)
      END
    ) STORED;
CREATE UNIQUE INDEX uq_note_count_bottle_size ON ingredient_rules (note_count_key);
