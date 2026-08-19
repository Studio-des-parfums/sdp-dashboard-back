-- Une règle peut viser plusieurs tailles de flacon à la fois (ex: 30ml et
-- 50ml en même temps), sur les 4 types de règles. bottle_size (VARCHAR unique)
-- est remplacé par une table de liaison, sur le même modèle que
-- ingredient_rule_targets.
CREATE TABLE IF NOT EXISTS ingredient_rule_bottle_sizes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rule_id INT NOT NULL,
  bottle_size VARCHAR(20) NOT NULL,
  FOREIGN KEY (rule_id) REFERENCES ingredient_rules(id) ON DELETE CASCADE,
  UNIQUE KEY uq_rule_bottle_size (rule_id, bottle_size)
);

-- L'unicité stricte sur note_count (bottle_size, box_set, intensity) n'est
-- plus applicable proprement avec des tailles multiples (une règle "30ml+50ml"
-- et une règle "50ml" se recouvrent partiellement sans être identiques) :
-- elle est retirée. Deux règles note_count peuvent désormais se chevaucher
-- sur une taille commune ; à l'usage (application des règles), la dernière
-- créée ou une priorité à définir devra arbitrer un éventuel conflit.
DROP INDEX uq_note_count_bottle_size ON ingredient_rules;
ALTER TABLE ingredient_rules DROP COLUMN note_count_key;
ALTER TABLE ingredient_rules DROP COLUMN bottle_size;
