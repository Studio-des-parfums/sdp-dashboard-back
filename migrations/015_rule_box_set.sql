-- Une règle peut être rattachée à un coffret précis : les notes d'un coffret
-- étant différentes de celles d'un autre, ça permet de restreindre à quel
-- univers de notes une règle s'applique (filtrage côté formulaire uniquement,
-- pas de contrainte stricte en base sur l'appartenance réelle des notes).
ALTER TABLE ingredient_rules ADD COLUMN box_set VARCHAR(255) AFTER bottle_size;

-- L'unicité note_count portait uniquement sur bottle_size ; elle doit
-- maintenant tenir compte du coffret (deux coffrets peuvent chacun avoir leur
-- propre règle note_count pour la même taille de flacon).
DROP INDEX uq_note_count_bottle_size ON ingredient_rules;
ALTER TABLE ingredient_rules DROP COLUMN note_count_key;
ALTER TABLE ingredient_rules
  ADD COLUMN note_count_key VARCHAR(521)
    GENERATED ALWAYS AS (
      CASE WHEN rule_type = 'note_count'
        THEN CONCAT(COALESCE(bottle_size, ''), '::', COALESCE(box_set, ''))
      END
    ) STORED;
CREATE UNIQUE INDEX uq_note_count_bottle_size ON ingredient_rules (note_count_key);
