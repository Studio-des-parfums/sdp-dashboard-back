import { Router, Request, Response } from 'express'
import pool from '../db'
import { hasProjectAccess } from '../utils/projectPermissions'

const router = Router()

router.get('/projects', async (req: Request, res: Response) => {
  try {
    const userEmail = req.headers['x-user-email'] as string | undefined
    const [rows] = await pool.query<any[]>(
      'SELECT id, name, slug, description, color, status, created_at FROM projects ORDER BY name'
    )

    const withAccess = await Promise.all(
      rows.map(async (p) => ({ ...p, hasAccess: await hasProjectAccess(userEmail, p.id, p.slug) }))
    )
    const accessible = withAccess.filter((p) => p.hasAccess).map(({ hasAccess: _hasAccess, ...p }) => p)
    res.json(accessible)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch projects' })
  }
})

router.get('/projects/:slug', async (req: Request, res: Response) => {
  try {
    const userEmail = req.headers['x-user-email'] as string | undefined
    const [projects] = await pool.query<any[]>(
      'SELECT id, name, slug, description, color, status, created_at FROM projects WHERE slug = ?',
      [req.params.slug]
    )
    const project = projects[0]
    if (!project) {
      res.status(404).json({ error: 'Project not found' })
      return
    }

    if (!(await hasProjectAccess(userEmail, project.id, project.slug))) {
      res.status(403).json({ error: 'Accès non autorisé à ce projet' })
      return
    }

    const [metrics] = await pool.query(
      'SELECT id, name, value, unit, type, `change` FROM metrics WHERE project_id = ?',
      [project.id]
    )

    const [charts] = await pool.query<any[]>(
      'SELECT c.id, c.title, c.type, c.chart_order, cd.label, cd.value FROM charts c LEFT JOIN chart_data cd ON cd.chart_id = c.id WHERE c.project_id = ? ORDER BY c.chart_order, cd.id',
      [project.id]
    )

    const chartMap = new Map<number, any>()
    for (const row of charts) {
      if (!chartMap.has(row.id)) {
        chartMap.set(row.id, {
          id: row.id,
          title: row.title,
          type: row.type,
          data: [],
        })
      }
      if (row.label !== null) {
        chartMap.get(row.id)!.data.push({ label: row.label, value: row.value })
      }
    }

    res.json({
      ...project,
      metrics,
      charts: Array.from(chartMap.values()),
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch dashboard' })
  }
})

export default router
