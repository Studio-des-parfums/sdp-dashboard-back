-- Coffrets ("box sets") : simple liste de noms libres saisis sur chaque ingrédient,
-- une note pouvant appartenir à plusieurs coffrets (ex: ["Découverte", "Prestige"]).
ALTER TABLE ingredients ADD COLUMN box_sets JSON AFTER allergens;
