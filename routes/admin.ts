import { Router, Request, Response } from 'express'
import pool from '../db'
import { requireAdmin } from '../middleware/requireAdmin'

const router = Router()

// Toute la page Admin (projets, utilisateurs, rôles) est réservée au rôle "admin".
router.use(requireAdmin())

// ─────────────────────── PROJECTS ───────────────────────

router.put('/projects/:id', async (req: Request, res: Response) => {
  try {
    const { name, description, color, status, notes } = req.body
    await pool.query(
      'UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description), color = COALESCE(?, color), status = COALESCE(?, status), notes = COALESCE(?, notes) WHERE id = ?',
      [name, description, color, status, notes, req.params.id]
    )
    const [rows] = await pool.query('SELECT * FROM projects WHERE id = ?', [req.params.id])
    res.json((rows as any[])[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour du projet' })
  }
})

router.get('/projects/:id/notes', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM project_notes WHERE project_id = ? ORDER BY created_at DESC',
      [req.params.id]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des notes' })
  }
})

router.post('/projects/:id/notes', async (req: Request, res: Response) => {
  try {
    const { content, type } = req.body
    const [result] = await pool.query(
      'INSERT INTO project_notes (project_id, content, type) VALUES (?, ?, ?)',
      [req.params.id, content, type || 'info']
    )
    const [rows] = await pool.query('SELECT * FROM project_notes WHERE id = ?', [(result as any).insertId])
    res.json((rows as any[])[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de l\'ajout de la note' })
  }
})

router.delete('/projects/:id/notes/:noteId', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM project_notes WHERE id = ? AND project_id = ?', [req.params.noteId, req.params.id])
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la suppression de la note' })
  }
})

// ─────────────────────── USERS ───────────────────────

router.get('/users', async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.*, r.name as role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.last_name, u.first_name`
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs' })
  }
})

router.post('/users', async (req: Request, res: Response) => {
  try {
    const { email, first_name, last_name, role_id, is_active } = req.body
    const [result] = await pool.query(
      'INSERT INTO users (email, first_name, last_name, role_id, is_active) VALUES (?, ?, ?, ?, ?)',
      [email, first_name, last_name, role_id, is_active ?? true]
    )
    const [rows] = await pool.query(
      `SELECT u.*, r.name as role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [(result as any).insertId]
    )
    res.json((rows as any[])[0])
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Cet email est déjà utilisé' })
      return
    }
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la création de l\'utilisateur' })
  }
})

router.put('/users/:id', async (req: Request, res: Response) => {
  try {
    const { email, first_name, last_name, role_id, is_active } = req.body
    await pool.query(
      'UPDATE users SET email = COALESCE(?, email), first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), role_id = COALESCE(?, role_id), is_active = COALESCE(?, is_active) WHERE id = ?',
      [email, first_name, last_name, role_id, is_active, req.params.id]
    )
    const [rows] = await pool.query(
      `SELECT u.*, r.name as role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [req.params.id]
    )
    res.json((rows as any[])[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'utilisateur' })
  }
})

router.delete('/users/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM users WHERE id = ?', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'utilisateur' })
  }
})

router.get('/users/:id/projects', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, up.permission FROM projects p
       LEFT JOIN user_projects up ON up.project_id = p.id AND up.user_id = ?
       ORDER BY p.name`,
      [req.params.id]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des projets' })
  }
})

router.put('/users/:id/projects', async (req: Request, res: Response) => {
  try {
    const { projects } = req.body
    await pool.query('DELETE FROM user_projects WHERE user_id = ?', [req.params.id])
    for (const p of projects) {
      await pool.query(
        'INSERT INTO user_projects (user_id, project_id, permission) VALUES (?, ?, ?)',
        [req.params.id, p.project_id, p.permission]
      )
    }
    const [rows] = await pool.query(
      `SELECT p.*, up.permission FROM projects p
       LEFT JOIN user_projects up ON up.project_id = p.id AND up.user_id = ?
       ORDER BY p.name`,
      [req.params.id]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour des projets' })
  }
})

// ─────────────────────── ROLES ───────────────────────
// Gestion des rôles personnalisés et de leurs permissions par page/projet — conservée telle quelle
// pour une évolution future ; l'accès à la page Admin elle-même reste conditionné à role="admin" ci-dessus.

router.get('/roles', async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*,
        (SELECT JSON_ARRAYAGG(JSON_OBJECT('resource', rp.resource, 'action', rp.action))
         FROM role_permissions rp WHERE rp.role_id = r.id) as permissions
       FROM roles r
       ORDER BY r.name`
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des rôles' })
  }
})

router.post('/roles', async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body
    const [result] = await pool.query('INSERT INTO roles (name, description) VALUES (?, ?)', [name, description])
    res.json({ id: (result as any).insertId, name, description })
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Ce nom de rôle existe déjà' })
      return
    }
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la création du rôle' })
  }
})

router.put('/roles/:id', async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body
    await pool.query('UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?',
      [name, description, req.params.id])
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour du rôle' })
  }
})

router.delete('/roles/:id', async (req: Request, res: Response) => {
  try {
    const [users] = await pool.query('SELECT id FROM users WHERE role_id = ? LIMIT 1', [req.params.id])
    if ((users as any[]).length > 0) {
      res.status(400).json({ error: 'Impossible de supprimer un rôle attribué à des utilisateurs' })
      return
    }
    await pool.query('DELETE FROM roles WHERE id = ?', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la suppression du rôle' })
  }
})

router.get('/roles/:id/permissions', async (req: Request, res: Response) => {
  try {
    const [pagePerms] = await pool.query(
      'SELECT resource, action FROM role_permissions WHERE role_id = ?', [req.params.id])
    const [projectPerms] = await pool.query(
      `SELECT rp.project_id, rp.permission, p.name as project_name
       FROM role_project_permissions rp
       JOIN projects p ON p.id = rp.project_id
       WHERE rp.role_id = ?`, [req.params.id])
    res.json({ page_permissions: pagePerms, project_permissions: projectPerms })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des permissions' })
  }
})

router.put('/roles/:id/permissions', async (req: Request, res: Response) => {
  try {
    const { page_permissions, project_permissions } = req.body
    await pool.query('DELETE FROM role_permissions WHERE role_id = ?', [req.params.id])
    await pool.query('DELETE FROM role_project_permissions WHERE role_id = ?', [req.params.id])
    for (const p of page_permissions || []) {
      await pool.query(
        'INSERT INTO role_permissions (role_id, resource, action) VALUES (?, ?, ?)',
        [req.params.id, p.resource, p.action]
      )
    }
    for (const p of project_permissions || []) {
      await pool.query(
        'INSERT INTO role_project_permissions (role_id, project_id, permission) VALUES (?, ?, ?)',
        [req.params.id, p.project_id, p.permission]
      )
    }
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour des permissions' })
  }
})

export default router
