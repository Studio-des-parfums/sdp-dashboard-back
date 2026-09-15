-- À exécuter seulement après avoir lancé server/scripts/migrate-box-sets-to-coffrets.ts
-- et vérifié que coffrets/ingredient_coffrets sont bien peuplés : box_sets est
-- remplacé par la relation ingredient_coffrets.
ALTER TABLE ingredients DROP COLUMN box_sets;
