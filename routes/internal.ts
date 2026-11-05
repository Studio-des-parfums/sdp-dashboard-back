import { Router, Request, Response } from 'express'
import pool from '../db'
import { requireServiceKey } from '../middleware/requireServiceKey'

// API des utilisateurs pour les autres backends SDP : sdp-dashboard est le seul service
// connecté à la base globale. Aucun hash de mot de passe n'est exposé.
const router = Router()
router.use(requireServiceKey)

router.get('/users/by-email', async (req: Request, res: Response) => {
  const email = req.query.email
  if (typeof email !== 'string' || !email) {
    res.status(400).json({ error: 'Email requis' })
    return
  }
  try {
    const [rows] = await pool.query<any[]>(
      `SELECT u.id, u.email, u.first_name, u.last_name, r.name as role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.email = ? AND u.is_active = TRUE`,
      [email]
    )
    if (!rows[0]) {
      res.status(404).json({ error: 'Utilisateur introuvable' })
      return
    }
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de la récupération de l'utilisateur" })
  }
})

// Sans `ids` : utilisateurs actifs. Avec `all=1` : tous, anciens membres compris (is_active
// exposé) — pour garder l'auteur des actions passées. Avec `ids=1,2` : contacts demandés, actifs ou non.
router.get('/users', async (req: Request, res: Response) => {
  const { ids, all } = req.query
  try {
    if (all === '1') {
      const [rows] = await pool.query<any[]>(
        'SELECT id, email, first_name, last_name, is_active FROM users ORDER BY first_name, last_name'
      )
      res.json(rows.map((r) => ({ ...r, is_active: Boolean(r.is_active) })))
      return
    }
    if (ids === undefined) {
      const [rows] = await pool.query<any[]>(
        'SELECT id, email, first_name, last_name FROM users WHERE is_active = TRUE ORDER BY first_name, last_name'
      )
      res.json(rows)
      return
    }
    if (typeof ids !== 'string' || !/^\d+(,\d+)*$/.test(ids)) {
      res.status(400).json({ error: 'Paramètre ids invalide' })
      return
    }
    const [rows] = await pool.query<any[]>(
      'SELECT id, email, first_name, last_name FROM users WHERE id IN (?)',
      [ids.split(',').map(Number)]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs' })
  }
})

export default router
