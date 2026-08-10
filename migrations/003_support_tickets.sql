CREATE TABLE IF NOT EXISTS support_tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_number VARCHAR(20) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  project_id INT NULL,
  category ENUM('bug', 'question', 'feature', 'other') NOT NULL DEFAULT 'other',
  priority ENUM('Basse', 'Moyenne', 'Haute') NOT NULL DEFAULT 'Moyenne',
  subject VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  contact_email VARCHAR(255) NULL,
  status ENUM('Ouvert', 'En cours', 'Résolu', 'Fermé') DEFAULT 'Ouvert',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

INSERT INTO role_permissions (role_id, resource, action)
SELECT r.id, p.resource, p.action
FROM (SELECT id FROM roles WHERE name = 'admin') r
CROSS JOIN (
  SELECT 'tickets' as resource, 'view' as action
  UNION SELECT 'tickets', 'edit'
) p
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.resource = p.resource AND rp.action = p.action
);
