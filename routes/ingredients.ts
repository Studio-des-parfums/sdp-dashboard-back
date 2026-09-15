import { Router, Request, Response } from 'express'
import pool from '../db'

const router = Router()

function parseJsonArray(value: unknown): string[] | null {
  if (!value) return null
  return typeof value === 'string' ? JSON.parse(value) : (value as string[])
}

// Une note porte ses traductions en sous-objet `translations: { fr: "...", en: "..." }`,
// construites via une agrégation JSON pour ne faire qu'un aller-retour en base.
const TRANSLATIONS_SUBSELECT = `
  (SELECT JSON_OBJECTAGG(t.language, t.name)
   FROM ingredient_translations t
   WHERE t.ingredient_id = i.id) AS translations
`

// Les coffrets d'une note vivent dans la table de jointure ingredient_coffrets
// (remplace l'ancien tag libre box_sets JSON) — même approche que TARGETS_SUBSELECT
// dans routes/ingredient-rules.ts.
const COFFRET_IDS_SUBSELECT = `
  (SELECT JSON_ARRAYAGG(ic.coffret_id)
   FROM ingredient_coffrets ic
   WHERE ic.ingredient_id = i.id) AS coffret_ids
`

function parseIngredient(row: any) {
  const { translations, coffret_ids, ...rest } = row
  return {
    ...rest,
    is_active: !!row.is_active,
    allergens: parseJsonArray(row.allergens),
    coffret_ids: coffret_ids
      ? (typeof coffret_ids === 'string' ? JSON.parse(coffret_ids) : coffret_ids)
      : [],
    translations: translations
      ? (typeof translations === 'string' ? JSON.parse(translations) : translations)
      : {},
  }
}

async function setCoffrets(ingredientId: number, coffretIds: number[]) {
  await pool.query('DELETE FROM ingredient_coffrets WHERE ingredient_id = ?', [ingredientId])
  const ids = [...new Set(coffretIds)].filter((id) => Number.isInteger(id))
  if (ids.length === 0) return
  const values = ids.map((coffretId) => [ingredientId, coffretId])
  await pool.query(
    'INSERT INTO ingredient_coffrets (ingredient_id, coffret_id) VALUES ?',
    [values]
  )
}

async function setTranslations(ingredientId: number, translations: Record<string, string>) {
  const entries = Object.entries(translations).filter(([, name]) => name && name.trim())
  if (entries.length === 0) return
  const values = entries.map(([lang, name]) => [ingredientId, lang, name.trim()])
  await pool.query(
    `INSERT INTO ingredient_translations (ingredient_id, language, name) VALUES ?
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [values]
  )
  // Langues explicitement vidées dans la requête : on les retire.
  const emptyLangs = Object.entries(translations).filter(([, name]) => !name || !name.trim()).map(([lang]) => lang)
  if (emptyLangs.length > 0) {
    await pool.query(
      'DELETE FROM ingredient_translations WHERE ingredient_id = ? AND language IN (?)',
      [ingredientId, emptyLangs]
    )
  }
}

router.get('/ingredients', async (req: Request, res: Response) => {
  try {
    const { language, type, active_only, coffret_id, q } = req.query
    const conditions: string[] = []
    const params: unknown[] = []

    if (language) {
      conditions.push('EXISTS (SELECT 1 FROM ingredient_translations t WHERE t.ingredient_id = i.id AND t.language = ?)')
      params.push(language)
    }
    if (type) {
      conditions.push('i.type = ?')
      params.push(type)
    }
    if (active_only === 'true') {
      conditions.push('i.is_active = TRUE')
    }
    if (coffret_id) {
      conditions.push('EXISTS (SELECT 1 FROM ingredient_coffrets ic WHERE ic.ingredient_id = i.id AND ic.coffret_id = ?)')
      params.push(coffret_id)
    }
    if (q) {
      conditions.push('EXISTS (SELECT 1 FROM ingredient_translations t WHERE t.ingredient_id = i.id AND t.name LIKE ?)')
      params.push(`%${q}%`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const [rows] = await pool.query<any[]>(
      `SELECT i.*, ${TRANSLATIONS_SUBSELECT}, ${COFFRET_IDS_SUBSELECT} FROM ingredients i ${where} ORDER BY i.id`,
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
    const { translations, type, category, description, intensity, allergens, coffret_ids } = req.body
    if (!translations || typeof translations !== 'object' || !Object.values(translations).some((v) => typeof v === 'string' && v.trim())) {
      res.status(400).json({ error: 'Au moins un nom traduit (translations) est requis' })
      return
    }
    if (!type) {
      res.status(400).json({ error: 'type est requis' })
      return
    }
    const [result] = await pool.query<any>(
      `INSERT INTO ingredients (type, category, description, intensity, allergens)
       VALUES (?, ?, ?, ?, ?)`,
      [
        type,
        category ?? null,
        description ?? null,
        intensity ?? null,
        allergens ? JSON.stringify(allergens) : null,
      ]
    )
    await setTranslations(result.insertId, translations)
    if (Array.isArray(coffret_ids)) {
      await setCoffrets(result.insertId, coffret_ids)
    }
    const [rows] = await pool.query<any[]>(
      `SELECT i.*, ${TRANSLATIONS_SUBSELECT}, ${COFFRET_IDS_SUBSELECT} FROM ingredients i WHERE i.id = ?`,
      [result.insertId]
    )
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

    const { translations, type, category, description, intensity, allergens, coffret_ids, is_active } = req.body

    if (type !== undefined) { fields.push('type = ?'); params.push(type) }
    if (category !== undefined) { fields.push('category = ?'); params.push(category) }
    if (description !== undefined) { fields.push('description = ?'); params.push(description) }
    if (intensity !== undefined) { fields.push('intensity = ?'); params.push(intensity) }
    if (allergens !== undefined) { fields.push('allergens = ?'); params.push(allergens ? JSON.stringify(allergens) : null) }
    if (is_active !== undefined) { fields.push('is_active = ?'); params.push(!!is_active) }

    if (fields.length > 0) {
      params.push(id)
      await pool.query(`UPDATE ingredients SET ${fields.join(', ')} WHERE id = ?`, params)
    }

    if (translations && typeof translations === 'object') {
      await setTranslations(Number(id), translations)
    }

    if (Array.isArray(coffret_ids)) {
      await setCoffrets(Number(id), coffret_ids)
    }

    if (fields.length === 0 && !translations && !Array.isArray(coffret_ids)) {
      res.status(400).json({ error: 'Aucun champ à mettre à jour' })
      return
    }

    const [rows] = await pool.query<any[]>(
      `SELECT i.*, ${TRANSLATIONS_SUBSELECT}, ${COFFRET_IDS_SUBSELECT} FROM ingredients i WHERE i.id = ?`,
      [id]
    )
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

// Retire une note d'un coffret précis. Si c'était son dernier coffret, elle
// n'a plus de sens dans ce référentiel : elle est supprimée entièrement
// (même règle que la suppression d'un coffret entier dans routes/coffrets.ts).
router.delete('/ingredients/:id/coffrets/:coffretId', async (req: Request, res: Response) => {
  try {
    const { id, coffretId } = req.params
    await pool.query('DELETE FROM ingredient_coffrets WHERE ingredient_id = ? AND coffret_id = ?', [id, coffretId])
    const [remaining] = await pool.query<any[]>('SELECT 1 FROM ingredient_coffrets WHERE ingredient_id = ?', [id])
    if (remaining.length === 0) {
      await pool.query('DELETE FROM ingredients WHERE id = ?', [id])
    }
    res.status(204).send()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to unlink ingredient from coffret' })
  }
})

export default router
