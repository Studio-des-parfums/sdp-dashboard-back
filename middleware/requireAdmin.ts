import { Request, Response, NextFunction } from 'express'
import pool from '../db'

/**
 * Vérifie que l'utilisateur (header x-user-email) a le rôle "admin".
 * Utilisé pour verrouiller la page Admin (projets, utilisateurs, rôles)
 * ainsi que les actions réservées aux admins (création/reset de compte).
 */
export function requireAdmin() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = req.headers['x-user-email'] as string | undefined
      if (!email) {
        res.status(401).json({ error: 'Authentification requise' })
        return
      }

      const [users] = await pool.query<any[]>(
        `SELECT r.name as role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ? AND u.is_active = TRUE`,
        [email]
      )
      const user = users[0]
      if (!user) {
        res.status(401).json({ error: 'Authentification requise' })
        return
      }

      if (user.role_name !== 'admin') {
        res.status(403).json({ error: 'Accès réservé aux administrateurs' })
        return
      }

      next()
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: 'Erreur lors de la vérification des permissions' })
    }
  }
}
