-- Tâches détectées par l'IA dans le compte rendu d'une réunion (message summary_for_call).
-- Partagées entre participants : une tâche acceptée crée UNE tâche Polux (polux_task_id) ;
-- refuser retire la personne des assignés (refusée quand il n'en reste plus).
-- Supprimées avec le message du compte rendu (purge 30 jours comprise).
CREATE TABLE IF NOT EXISTS meeting_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  message_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  assignee_ids JSON NOT NULL,
  team_slug VARCHAR(100) NULL,
  deadline DATE NULL,
  priority ENUM('basse', 'moyenne', 'haute', 'urgente') NOT NULL DEFAULT 'moyenne',
  status ENUM('proposee', 'acceptee', 'refusee') NOT NULL DEFAULT 'proposee',
  decided_by INT NULL,
  polux_task_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  INDEX idx_meeting_tasks_message (message_id)
);
