import { Request, Response, NextFunction } from 'express'
import pool from '../db'
import { hasProjectAccess } from '../utils/projectPermissions'

/**
 * Vérifie que l'utilisateur (header x-user-email) a accès au projet ciblé
 * par req.params.id (id numérique du projet).
 */
export function requireProjectAccess() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = req.headers['x-user-email'] as string | undefined
      if (!email) {
        res.status(401).json({ error: 'Authentification requise' })
        return
      }

      const [projects] = await pool.query<any[]>('SELECT id, slug FROM projects WHERE id = ?', [req.params.id])
      const project = projects[0]
      if (!project) {
        res.status(404).json({ error: 'Projet introuvable' })
        return
      }

      if (!(await hasProjectAccess(email, project.id, project.slug))) {
        res.status(403).json({ error: 'Accès non autorisé à ce projet' })
        return
      }

      next()
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: 'Erreur lors de la vérification des permissions' })
    }
  }
}
