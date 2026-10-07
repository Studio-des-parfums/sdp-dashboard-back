-- Chaque note olfactive a désormais un code unique attribué (ex: référentiel fournisseur).
ALTER TABLE ingredients ADD COLUMN code VARCHAR(50) NULL AFTER type;
