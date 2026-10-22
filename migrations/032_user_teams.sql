-- Un utilisateur peut appartenir à plusieurs équipes : remplace users.team_slug (031)
-- par une table de liaison. team_slug = slug d'un espace officiel Polux.
CREATE TABLE IF NOT EXISTS user_teams (
  user_id INT NOT NULL,
  team_slug VARCHAR(100) NOT NULL,
  PRIMARY KEY (user_id, team_slug),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT IGNORE INTO user_teams (user_id, team_slug)
SELECT id, team_slug FROM users WHERE team_slug IS NOT NULL;

ALTER TABLE users DROP COLUMN team_slug;
