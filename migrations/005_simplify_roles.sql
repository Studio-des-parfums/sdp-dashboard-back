-- Simplifie le modèle de rôles à deux rôles de base : admin et user.
-- - admin : accès à tous les projets + à la page Admin.
-- - user  : accès uniquement aux projets qui lui sont explicitement attribués (user_projects) ; pas d'accès à la page Admin.
-- D'autres rôles personnalisés peuvent toujours être créés depuis Admin → Rôles (page conservée pour une granularité future),
-- mais seul le rôle nommé "admin" donne accès à la page Admin (cf. server/middleware/requireAdmin.ts).

-- Fusionne "manager" dans "viewer", puis renomme "viewer" en "user".
UPDATE roles v
JOIN roles m ON m.name = 'manager'
SET v.name = 'user', v.description = 'Accès aux projets qui lui sont attribués'
WHERE v.name = 'viewer';

UPDATE users u
JOIN roles m ON m.name = 'manager'
JOIN roles v ON v.name = 'user'
SET u.role_id = v.id
WHERE u.role_id = m.id;

INSERT IGNORE INTO role_project_permissions (role_id, project_id, permission)
SELECT v.id, rpp.project_id, rpp.permission
FROM role_project_permissions rpp
JOIN roles m ON m.id = rpp.role_id AND m.name = 'manager'
JOIN roles v ON v.name = 'user';

INSERT IGNORE INTO role_permissions (role_id, resource, action)
SELECT v.id, rp.resource, rp.action
FROM role_permissions rp
JOIN roles m ON m.id = rp.role_id AND m.name = 'manager'
JOIN roles v ON v.name = 'user';

DELETE rpp FROM role_project_permissions rpp JOIN roles m ON m.id = rpp.role_id WHERE m.name = 'manager';
DELETE rp FROM role_permissions rp JOIN roles m ON m.id = rp.role_id WHERE m.name = 'manager';
DELETE FROM roles WHERE name = 'manager';

-- Si "viewer" n'existait pas mais "manager" oui (ordre inverse), renomme-le directement.
UPDATE roles SET name = 'user', description = 'Accès aux projets qui lui sont attribués' WHERE name = 'manager';
