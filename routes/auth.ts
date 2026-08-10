import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import pool from '../db'
import { sendWelcomeEmail, sendPasswordChangeConfirmation } from '../services/email'
import { requireAdmin } from '../middleware/requireAdmin'

const router = Router()

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let pwd = ''
  for (let i = 0; i < 12; i++) pwd += chars.charAt(Math.floor(Math.random() * chars.length))
  return pwd
}

router.get('/users/me', async (req: Request, res: Response) => {
  const email = req.headers['x-user-email'] as string
  if (!email) {
    res.status(401).json({ error: 'Email requis' })
    return
  }
  const [rows] = await pool.query<any[]>(
    `SELECT u.id, u.email, u.pseudo, u.first_name, u.last_name, u.is_active, u.last_login, u.must_change_password,
            r.id as role_id, r.name as role_name, r.description as role_description
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.email = ? AND u.is_active = TRUE`,
    [email]
  )
  const user = rows[0]
  if (!user) {
    res.status(404).json({ error: 'Utilisateur non trouvé' })
    return
  }
  const [permissions] = await pool.query<any[]>(
    'SELECT resource, action FROM role_permissions WHERE role_id = ?',
    [user.role_id]
  )
  res.json({ ...user, permissions })
})

function generatePseudo(firstName: string, lastName: string): string {
  const base = (lastName[0] + firstName).toLowerCase().replace(/[^a-z]/g, '')
  const digits = Math.floor(Math.random() * 900) + 100
  return base + digits
}

router.post('/auth/register', requireAdmin(), async (req: Request, res: Response) => {
  try {
    const { email, first_name, last_name, role_id } = req.body
    if (!email || !first_name || !last_name || !role_id) {
      res.status(400).json({ error: 'Champs requis : email, first_name, last_name, role_id' })
      return
    }

    const tempPassword = generateTempPassword()
    const password_hash = await bcrypt.hash(tempPassword, 10)
    let pseudo = generatePseudo(first_name, last_name)

    while (true) {
      const [dup] = await pool.query<any[]>('SELECT id FROM users WHERE pseudo = ?', [pseudo])
      if (dup.length === 0) break
      pseudo = generatePseudo(first_name, last_name)
    }

    const [result] = await pool.query<any>(
      'INSERT INTO users (email, pseudo, first_name, last_name, password_hash, role_id, must_change_password) VALUES (?, ?, ?, ?, ?, ?, TRUE)',
      [email, pseudo, first_name, last_name, password_hash, role_id]
    )

    await sendWelcomeEmail(email, first_name, tempPassword)

    const [rows] = await pool.query<any[]>(
      `SELECT u.*, r.name as role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [(result as any).insertId]
    )
    res.status(201).json(rows[0])
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Cet email est déjà utilisé' })
      return
    }
    console.error(err)
    res.status(500).json({ error: "Erreur lors de la création de l'utilisateur" })
  }
})

router.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      res.status(400).json({ error: 'Email/pseudo et mot de passe requis' })
      return
    }

    const [rows] = await pool.query<any[]>(
      `SELECT u.*, r.id as role_id, r.name as role_name, r.description as role_description
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.email = ? OR u.pseudo = ?`,
      [email, email]
    )

    const user = rows[0]
    if (!user) {
      res.status(401).json({ error: 'Email/pseudo ou mot de passe incorrect' })
      return
    }
    if (!user.is_active) {
      res.status(403).json({ error: 'Compte désactivé. Contactez un administrateur.' })
      return
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      res.status(401).json({ error: 'Email/pseudo ou mot de passe incorrect' })
      return
    }

    await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id])

    const [permissions] = await pool.query<any[]>(
      'SELECT resource, action FROM role_permissions WHERE role_id = ?',
      [user.role_id]
    )

    res.json({
      id: user.id,
      email: user.email,
      pseudo: user.pseudo,
      first_name: user.first_name,
      last_name: user.last_name,
      is_active: user.is_active,
      must_change_password: user.must_change_password,
      last_login: user.last_login,
      role_id: user.role_id,
      role_name: user.role_name,
      role_description: user.role_description,
      permissions,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la connexion' })
  }
})

router.post('/auth/change-password', async (req: Request, res: Response) => {
  try {
    const { email, current_password, new_password } = req.body
    if (!email || !current_password || !new_password) {
      res.status(400).json({ error: 'Champs requis : email, current_password, new_password' })
      return
    }
    if (new_password.length < 6) {
      res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères' })
      return
    }

    const [rows] = await pool.query<any[]>(
      'SELECT * FROM users WHERE email = ?',
      [email]
    )
    const user = rows[0]
    if (!user) {
      res.status(404).json({ error: 'Utilisateur non trouvé' })
      return
    }

    const valid = await bcrypt.compare(current_password, user.password_hash)
    if (!valid) {
      res.status(401).json({ error: 'Mot de passe actuel incorrect' })
      return
    }

    const password_hash = await bcrypt.hash(new_password, 10)
    await pool.query(
      'UPDATE users SET password_hash = ?, must_change_password = FALSE WHERE id = ?',
      [password_hash, user.id]
    )

    await sendPasswordChangeConfirmation(email, user.first_name)
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors du changement de mot de passe' })
  }
})

router.post('/auth/reset-password', requireAdmin(), async (req: Request, res: Response) => {
  try {
    const { email } = req.body
    if (!email) {
      res.status(400).json({ error: 'Email requis' })
      return
    }

    const [rows] = await pool.query<any[]>('SELECT * FROM users WHERE email = ?', [email])
    const user = rows[0]
    if (!user) {
      res.status(404).json({ error: 'Utilisateur non trouvé' })
      return
    }

    const tempPassword = generateTempPassword()
    const password_hash = await bcrypt.hash(tempPassword, 10)
    await pool.query(
      'UPDATE users SET password_hash = ?, must_change_password = TRUE WHERE id = ?',
      [password_hash, user.id]
    )

    await sendWelcomeEmail(email, user.first_name, tempPassword)
    res.json({ success: true, message: 'Mot de passe réinitialisé, email envoyé' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la réinitialisation du mot de passe' })
  }
})

export default router
