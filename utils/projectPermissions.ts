import pool from '../db'

/**
 * Détermine si un utilisateur (identifié par email) a accès à un projet donné.
 *
 * Règles :
 * - "sdp-core" (accueil) est toujours accessible à tout utilisateur connecté.
 * - "admin-portal" n'est accessible qu'aux utilisateurs du rôle "admin".
 * - Le rôle "admin" a accès à tous les projets, sans exception.
 * - Pour les autres rôles, l'accès à un projet est explicitement attribué
 *   via la table user_projects (assignation par utilisateur, gérée sur sa carte
 *   dans la page Admin → Utilisateurs). Aucune ligne = pas d'accès.
 */
export async function hasProjectAccess(userEmail: string | undefined, projectId: number, slug: string): Promise<boolean> {
  if (!userEmail) return slug === 'sdp-core'

  const [users] = await pool.query<any[]>(
    `SELECT u.id, r.name as role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ? AND u.is_active = TRUE`,
    [userEmail]
  )
  const user = users[0]
  if (!user) return slug === 'sdp-core'

  if (user.role_name === 'admin') return true
  if (slug === 'admin-portal') return false
  if (slug === 'sdp-core') return true

  const [access] = await pool.query<any[]>(
    `SELECT 1 FROM user_projects WHERE user_id = ? AND project_id = ? AND permission <> 'none'`,
    [user.id, projectId]
  )
  return access.length > 0
}
