-- Un atelier peut exister en plusieurs formats (ex : [10, 30, 50]).
-- volume_ml reste renseigné avec le premier format, pour les versions de l'app qui le lisent encore.
ALTER TABLE ateliers ADD COLUMN volume_options JSON NULL AFTER volume_ml;
