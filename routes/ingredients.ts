import { Router, Request, Response } from 'express'
import pool from '../db'

const router = Router()

function parseJsonArray(value: unknown): string[] | null {
  if (!value) return null
  return typeof value === 'string' ? JSON.parse(value) : (value as string[])
}

function parseIngredient(row: any) {
  return {
    ...row,
    is_active: !!row.is_active,
    allergens: parseJsonArray(row.allergens),
    box_sets: parseJsonArray(row.box_sets),
  }
}

router.get('/ingredients', async (req: Request, res: Response) => {
  try {
    const { language, type, active_only, box_set } = req.query
    const conditions: string[] = []
    const params: unknown[] = []

    if (language) {
      conditions.push('language = ?')
      params.push(language)
    }
    if (type) {
      conditions.push('type = ?')
      params.push(type)
    }
    if (active_only === 'true') {
      conditions.push('is_active = TRUE')
    }
    if (box_set) {
      conditions.push('JSON_CONTAINS(box_sets, JSON_QUOTE(?))')
      params.push(box_set)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const [rows] = await pool.query<any[]>(
      `SELECT * FROM ingredients ${where} ORDER BY name`,
      params
    )
    res.json(rows.map(parseIngredient))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch ingredients' })
  }
})

router.post('/ingredients', async (req: Request, res: Response) => {
  try {
    const { name, type, category, language, description, intensity, allergens, box_sets } = req.body
    if (!name || !type) {
      res.status(400).json({ error: 'name et type sont requis' })
      return
    }
    const [result] = await pool.query<any>(
      `INSERT INTO ingredients (name, type, category, language, description, intensity, allergens, box_sets)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        type,
        category ?? null,
        language ?? 'fr',
        description ?? null,
        intensity ?? null,
        allergens ? JSON.stringify(allergens) : null,
        box_sets ? JSON.stringify(box_sets) : null,
      ]
    )
    const [rows] = await pool.query<any[]>('SELECT * FROM ingredients WHERE id = ?', [result.insertId])
    res.status(201).json(parseIngredient(rows[0]))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create ingredient' })
  }
})

router.patch('/ingredients/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const fields: string[] = []
    const params: unknown[] = []

    const { name, type, category, language, description, intensity, allergens, box_sets, is_active } = req.body

    if (name !== undefined) { fields.push('name = ?'); params.push(name) }
    if (type !== undefined) { fields.push('type = ?'); params.push(type) }
    if (category !== undefined) { fields.push('category = ?'); params.push(category) }
    if (language !== undefined) { fields.push('language = ?'); params.push(language) }
    if (description !== undefined) { fields.push('description = ?'); params.push(description) }
    if (intensity !== undefined) { fields.push('intensity = ?'); params.push(intensity) }
    if (allergens !== undefined) { fields.push('allergens = ?'); params.push(allergens ? JSON.stringify(allergens) : null) }
    if (box_sets !== undefined) { fields.push('box_sets = ?'); params.push(box_sets ? JSON.stringify(box_sets) : null) }
    if (is_active !== undefined) { fields.push('is_active = ?'); params.push(!!is_active) }

    if (fields.length === 0) {
      res.status(400).json({ error: 'Aucun champ à mettre à jour' })
      return
    }

    params.push(id)
    await pool.query(`UPDATE ingredients SET ${fields.join(', ')} WHERE id = ?`, params)

    const [rows] = await pool.query<any[]>('SELECT * FROM ingredients WHERE id = ?', [id])
    if (!rows[0]) {
      res.status(404).json({ error: 'Ingredient not found' })
      return
    }
    res.json(parseIngredient(rows[0]))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update ingredient' })
  }
})

router.delete('/ingredients/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM ingredients WHERE id = ?', [req.params.id])
    res.status(204).send()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete ingredient' })
  }
})

export default router
