-- Quantité (en ml) du parfum réalisé lors de l'atelier. Une seule taille par
-- atelier (pas de multi-tailles comme ingredient_rule_bottle_sizes).
ALTER TABLE ateliers ADD COLUMN volume_ml DECIMAL(5,2) AFTER description;
