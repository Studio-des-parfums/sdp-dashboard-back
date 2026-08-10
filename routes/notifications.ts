import { Router, Request, Response } from 'express'
import pool from '../db'

const router = Router()

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

router.get('/notifications', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const [rows] = await pool.query(
      `SELECT n.*, t.ticket_number
       FROM notifications n
       LEFT JOIN support_tickets t ON t.id = n.ticket_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [user.id]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des notifications' })
  }
})

router.get('/notifications/unread-count', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const [rows] = await pool.query<any[]>(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
      [user.id]
    )
    res.json({ count: rows[0].count })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors du comptage des notifications' })
  }
})

router.put('/notifications/:id/read', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    await pool.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
      [req.params.id, user.id]
    )
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la notification' })
  }
})

router.put('/notifications/read-all', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    await pool.query(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
      [user.id]
    )
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour des notifications' })
  }
})

export default router
