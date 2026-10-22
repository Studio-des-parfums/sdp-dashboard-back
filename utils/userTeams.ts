import pool from '../db'

/**
 * Équipes d'un utilisateur (table user_teams) : slugs d'espaces officiels Polux.
 * Les espaces vivent dans la base polux, d'où l'absence de clé étrangère sur team_slug.
 */
export async function withTeamSlugs<T extends { id: number }>(users: T[]): Promise<Array<T & { team_slugs: string[] }>> {
  if (users.length === 0) return []
  const [rows] = await pool.query<any[]>(
    'SELECT user_id, team_slug FROM user_teams WHERE user_id IN (?) ORDER BY team_slug',
    [users.map((u) => u.id)]
  )
  return users.map((u) => ({
    ...u,
    team_slugs: rows.filter((r) => r.user_id === u.id).map((r) => r.team_slug),
  }))
}

export async function setUserTeams(userId: number, teamSlugs: string[]): Promise<void> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM user_teams WHERE user_id = ?', [userId])
    if (teamSlugs.length > 0) {
      await conn.query('INSERT INTO user_teams (user_id, team_slug) VALUES ?', [teamSlugs.map((slug) => [userId, slug])])
    }
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}
