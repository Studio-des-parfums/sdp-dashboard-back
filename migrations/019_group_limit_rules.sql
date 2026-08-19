-- 5e type de règle : group_limit. Une liste de notes choisies à la main
-- (stockées dans ingredient_rule_targets, comme incompatibility/max_dosage),
-- avec un plafond sur le nombre de notes que l'utilisateur peut choisir parmi
-- elles (ex: "parmi note1..note4, max 3 choisies"). Pas de minimum, pas de
-- notion de famille tête/cœur/fond — contrairement à note_count.
ALTER TABLE ingredient_rules MODIFY COLUMN rule_type
  ENUM('incompatibility', 'max_dosage', 'recommendation', 'note_count', 'group_limit') NOT NULL;

ALTER TABLE ingredient_rules ADD COLUMN max_choices INT AFTER max_ml;
