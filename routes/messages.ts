import { Router, Request, Response } from 'express'
import pool from '../db'
import { emitToUser } from '../services/socket'

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

// Liste des conversations de l'utilisateur : un dernier message par interlocuteur,
// trié par date décroissante, avec le nombre de non-lus par conversation.
router.get('/messages/conversations', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }

    const [rows] = await pool.query<any[]>(
      `SELECT
         other.id as user_id,
         other.first_name,
         other.last_name,
         other.email,
         last_msg.content as last_message,
         last_msg.created_at as last_message_at,
         last_msg.sender_id as last_message_sender_id,
         COALESCE(unread.count, 0) as unread_count
       FROM users other
       JOIN (
         SELECT
           CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as other_id,
           MAX(id) as last_id
         FROM messages
         WHERE sender_id = ? OR receiver_id = ?
         GROUP BY other_id
       ) conv ON conv.other_id = other.id
       JOIN messages last_msg ON last_msg.id = conv.last_id
       LEFT JOIN (
         SELECT sender_id, COUNT(*) as count
         FROM messages
         WHERE receiver_id = ? AND is_read = FALSE
         GROUP BY sender_id
       ) unread ON unread.sender_id = other.id
       ORDER BY last_msg.created_at DESC`,
      [user.id, user.id, user.id, user.id]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des conversations' })
  }
})

// Liste des utilisateurs actifs (pour démarrer une nouvelle conversation).
router.get('/messages/contacts', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const [rows] = await pool.query<any[]>(
      `SELECT id, first_name, last_name, email
       FROM users
       WHERE is_active = TRUE AND id != ?
       ORDER BY first_name, last_name`,
      [user.id]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des contacts' })
  }
})

// Compteur global de messages non lus (pour le badge de la topbar).
router.get('/messages/unread-count', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const [rows] = await pool.query<any[]>(
      'SELECT COUNT(*) as count FROM messages WHERE receiver_id = ? AND is_read = FALSE',
      [user.id]
    )
    res.json({ count: rows[0].count })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors du comptage des messages' })
  }
})

// Historique des messages échangés avec un utilisateur donné.
router.get('/messages/:userId', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const otherId = Number(req.params.userId)
    if (!Number.isInteger(otherId)) {
      res.status(400).json({ error: 'Identifiant invalide' })
      return
    }
    const [rows] = await pool.query<any[]>(
      `SELECT * FROM messages
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
       ORDER BY created_at ASC
       LIMIT 200`,
      [user.id, otherId, otherId, user.id]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des messages' })
  }
})

// Envoi d'un message. Crée aussi une notification et pousse en temps réel
// au destinataire s'il a une connexion socket active.
router.post('/messages', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const { receiverId, content } = req.body as { receiverId: number; content: string }
    if (!receiverId || !content || !content.trim()) {
      res.status(400).json({ error: 'Destinataire et contenu requis' })
      return
    }

    const [result] = await pool.query<any>(
      'INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)',
      [user.id, receiverId, content.trim()]
    )
    const messageId = result.insertId

    const [rows] = await pool.query<any[]>('SELECT * FROM messages WHERE id = ?', [messageId])
    const message = rows[0]

    const preview = content.trim().slice(0, 100)
    const notifMessage = `${user.first_name} ${user.last_name}: ${preview}`
    await pool.query(
      `INSERT INTO notifications (user_id, message_id, type, message)
       VALUES (?, ?, 'new_message', ?)`,
      [receiverId, messageId, notifMessage]
    )

    const payload = {
      ...message,
      sender_first_name: user.first_name,
      sender_last_name: user.last_name,
    }

    emitToUser(receiverId, 'new_message', payload)

    res.status(201).json(message)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de l'envoi du message" })
  }
})

// Marque tous les messages d'un interlocuteur comme lus.
router.put('/messages/:userId/read', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const otherId = Number(req.params.userId)
    await pool.query(
      'UPDATE messages SET is_read = TRUE WHERE sender_id = ? AND receiver_id = ? AND is_read = FALSE',
      [otherId, user.id]
    )
    await pool.query(
      `UPDATE notifications SET is_read = TRUE
       WHERE user_id = ? AND type = 'new_message'
       AND message_id IN (SELECT id FROM messages WHERE sender_id = ? AND receiver_id = ?)`,
      [user.id, otherId, user.id]
    )
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour des messages' })
  }
})

export default router
