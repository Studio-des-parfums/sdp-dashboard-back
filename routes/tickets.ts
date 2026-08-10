import { Router, Request, Response } from 'express'
import pool from '../db'

const router = Router()

const TICKET_SELECT = `
  SELECT t.*,
         u.first_name as user_first_name, u.last_name as user_last_name, u.email as user_email,
         p.name as project_name
  FROM support_tickets t
  JOIN users u ON u.id = t.user_id
  LEFT JOIN projects p ON p.id = t.project_id
`

async function getUserFromRequest(req: Request) {
  const email = req.headers['x-user-email'] as string | undefined
  if (!email) return null
  const [rows] = await pool.query<any[]>(
    `SELECT u.id, u.email, u.first_name, u.last_name, r.name as role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.email = ? AND u.is_active = TRUE`,
    [email]
  )
  return rows[0] || null
}

router.get('/tickets', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const isAdmin = user.role_name === 'admin'
    const [rows] = await pool.query(
      `${TICKET_SELECT}
       ${isAdmin ? '' : 'WHERE t.user_id = ?'}
       ORDER BY t.created_at DESC`,
      isAdmin ? [] : [user.id]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des tickets' })
  }
})

router.get('/tickets/open-count', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    if (user.role_name !== 'admin') {
      res.status(403).json({ error: 'Réservé aux administrateurs' })
      return
    }
    const [rows] = await pool.query<any[]>(
      `SELECT COUNT(*) as count FROM support_tickets WHERE status = 'Ouvert'`
    )
    res.json({ count: rows[0].count })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors du comptage des tickets' })
  }
})

router.get('/tickets/:id', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const isAdmin = user.role_name === 'admin'
    const [rows] = await pool.query<any[]>(
      `${TICKET_SELECT}
       WHERE t.id = ? ${isAdmin ? '' : 'AND t.user_id = ?'}`,
      isAdmin ? [req.params.id] : [req.params.id, user.id]
    )
    const ticket = rows[0]
    if (!ticket) {
      res.status(404).json({ error: 'Ticket introuvable' })
      return
    }
    res.json(ticket)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération du ticket' })
  }
})

router.post('/tickets', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }

    const { project, category, priority, subject, description } = req.body
    if (!subject || !description || !category) {
      res.status(400).json({ error: 'Champs requis : subject, description, category' })
      return
    }

    let projectId: number | null = null
    if (project && project !== 'SDP') {
      const [rows] = await pool.query<any[]>(
        'SELECT id FROM projects WHERE name = ? AND id != 1',
        [project]
      )
      projectId = rows[0]?.id ?? null
    }

    const [countRows] = await pool.query<any[]>(
      'SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM support_tickets'
    )
    const ticketNumber = `SDP-${String(countRows[0].next_id).padStart(4, '0')}`

    const [result] = await pool.query<any>(
      `INSERT INTO support_tickets (ticket_number, user_id, project_id, category, priority, subject, description, contact_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ticketNumber, user.id, projectId, category, priority, subject, description, user.email]
    )

    const id = (result as any).insertId

    const [rows] = await pool.query<any[]>(
      `${TICKET_SELECT} WHERE t.id = ?`,
      [id]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la création du ticket' })
  }
})

router.put('/tickets/:id/status', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    if (user.role_name !== 'admin') {
      res.status(403).json({ error: 'Seul un administrateur peut modifier le statut d\'un ticket' })
      return
    }

    const { status } = req.body
    const allowed = ['Ouvert', 'En cours', 'Résolu', 'Fermé']
    if (!allowed.includes(status)) {
      res.status(400).json({ error: 'Statut invalide' })
      return
    }

    const [existingRows] = await pool.query<any[]>(
      'SELECT user_id, ticket_number, status FROM support_tickets WHERE id = ?',
      [req.params.id]
    )
    const existing = existingRows[0]
    if (!existing) {
      res.status(404).json({ error: 'Ticket introuvable' })
      return
    }

    await pool.query(
      'UPDATE support_tickets SET status = ? WHERE id = ?',
      [status, req.params.id]
    )

    if (existing.status !== status) {
      const messages: Record<string, string> = {
        'En cours': `Votre ticket ${existing.ticket_number} est en cours de traitement.`,
        'Résolu': `Votre ticket ${existing.ticket_number} a été résolu.`,
        'Fermé': `Votre ticket ${existing.ticket_number} a été fermé.`,
      }
      const message = messages[status]
      if (message) {
        await pool.query(
          'INSERT INTO notifications (user_id, ticket_id, type, message) VALUES (?, ?, ?, ?)',
          [existing.user_id, req.params.id, 'ticket_status_change', message]
        )
      }
    }

    const [rows] = await pool.query<any[]>(
      `${TICKET_SELECT} WHERE t.id = ?`,
      [req.params.id]
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour du ticket' })
  }
})

export default router
