import { Router, Request, Response } from 'express'
import pool from '../db'

const router = Router()

// Un atelier porte ses traductions en sous-objet `translations: { fr: "...", en: "..." }`,
// même approche que TRANSLATIONS_SUBSELECT dans routes/ingredients.ts et routes/coffrets.ts.
const TRANSLATIONS_SUBSELECT = `
  (SELECT JSON_OBJECTAGG(t.language, t.name)
   FROM atelier_translations t
   WHERE t.atelier_id = a.id) AS translations
`

function parseAtelier(row: any) {
  const { translations, ...rest } = row
  return {
    ...rest,
    is_active: !!row.is_active,
    translations: translations
      ? (typeof translations === 'string' ? JSON.parse(translations) : translations)
      : {},
  }
}

async function setTranslations(atelierId: number, translations: Record<string, string>) {
  const entries = Object.entries(translations).filter(([, name]) => name && name.trim())
  if (entries.length === 0) return
  const values = entries.map(([lang, name]) => [atelierId, lang, name.trim()])
  await pool.query(
    `INSERT INTO atelier_translations (atelier_id, language, name) VALUES ?
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [values]
  )
  // Langues explicitement vidées dans la requête : on les retire.
  const emptyLangs = Object.entries(translations).filter(([, name]) => !name || !name.trim()).map(([lang]) => lang)
  if (emptyLangs.length > 0) {
    await pool.query(
      'DELETE FROM atelier_translations WHERE atelier_id = ? AND language IN (?)',
      [atelierId, emptyLangs]
    )
  }
}

router.get('/ateliers', async (req: Request, res: Response) => {
  try {
    const { coffret_id, active_only } = req.query
    const conditions: string[] = []
    const params: unknown[] = []

    if (coffret_id) {
      conditions.push('a.coffret_id = ?')
      params.push(coffret_id)
    }
    if (active_only === 'true') {
      conditions.push('a.is_active = TRUE')
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const [rows] = await pool.query<any[]>(
      `SELECT a.*, ${TRANSLATIONS_SUBSELECT} FROM ateliers a ${where} ORDER BY a.id`,
      params
    )
    res.json(rows.map(parseAtelier))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch ateliers' })
  }
})

router.post('/ateliers', async (req: Request, res: Response) => {
  try {
    const { translations, coffret_id, description } = req.body
    if (!translations || typeof translations !== 'object' || !Object.values(translations).some((v) => typeof v === 'string' && v.trim())) {
      res.status(400).json({ error: 'Au moins un nom traduit (translations) est requis' })
      return
    }
    if (!coffret_id) {
      res.status(400).json({ error: 'coffret_id est requis' })
      return
    }
    const [result] = await pool.query<any>(
      `INSERT INTO ateliers (coffret_id, description) VALUES (?, ?)`,
      [coffret_id, description ?? null]
    )
    await setTranslations(result.insertId, translations)
    const [rows] = await pool.query<any[]>(
      `SELECT a.*, ${TRANSLATIONS_SUBSELECT} FROM ateliers a WHERE a.id = ?`,
      [result.insertId]
    )
    res.status(201).json(parseAtelier(rows[0]))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create atelier' })
  }
})

router.patch('/ateliers/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const fields: string[] = []
    const params: unknown[] = []

    const { translations, coffret_id, description, is_active } = req.body

    if (coffret_id !== undefined) { fields.push('coffret_id = ?'); params.push(coffret_id) }
    if (description !== undefined) { fields.push('description = ?'); params.push(description) }
    if (is_active !== undefined) { fields.push('is_active = ?'); params.push(!!is_active) }

    if (fields.length > 0) {
      params.push(id)
      await pool.query(`UPDATE ateliers SET ${fields.join(', ')} WHERE id = ?`, params)
    }

    if (translations && typeof translations === 'object') {
      await setTranslations(Number(id), translations)
    }

    if (fields.length === 0 && !translations) {
      res.status(400).json({ error: 'Aucun champ à mettre à jour' })
      return
    }

    const [rows] = await pool.query<any[]>(
      `SELECT a.*, ${TRANSLATIONS_SUBSELECT} FROM ateliers a WHERE a.id = ?`,
      [id]
    )
    if (!rows[0]) {
      res.status(404).json({ error: 'Atelier not found' })
      return
    }
    res.json(parseAtelier(rows[0]))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update atelier' })
  }
})

router.delete('/ateliers/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM ateliers WHERE id = ?', [req.params.id])
    res.status(204).send()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete atelier' })
  }
})

export default router
