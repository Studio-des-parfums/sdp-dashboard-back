-- max_dosage passe du modèle "une note source" au modèle "un groupe de notes
-- partageant le même plafond ml" (comme incompatibility), pour éviter de
-- créer une règle par note quand plusieurs notes partagent le même max_ml.
-- Migration des données existantes : chaque source_ingredient_id devient une
-- entrée dans ingredient_rule_targets pour sa règle.
INSERT INTO ingredient_rule_targets (rule_id, target_ingredient_id)
SELECT id, source_ingredient_id FROM ingredient_rules
WHERE rule_type = 'max_dosage' AND source_ingredient_id IS NOT NULL;

UPDATE ingredient_rules SET source_ingredient_id = NULL WHERE rule_type = 'max_dosage';
