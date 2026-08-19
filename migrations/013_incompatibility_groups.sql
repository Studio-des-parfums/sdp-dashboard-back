-- Une règle d'incompatibilité n'a plus de note "source" : c'est un groupe
-- symétrique de notes qui ne doivent jamais être choisies ensemble (toutes
-- stockées comme cibles dans ingredient_rule_targets). source_ingredient_id
-- reste obligatoire pour max_dosage et recommendation, qui restent asymétriques
-- (une note précise → un plafond, ou une note précise → des suggestions).
ALTER TABLE ingredient_rules MODIFY COLUMN source_ingredient_id INT NULL;
