import { Router, Request, Response } from 'express'
import pool from '../db'

const router = Router()

// Un coffret porte ses traductions en sous-objet `translations: { fr: "...", en: "..." }`,
// construites via une agrégation JSON pour ne faire qu'un aller-retour en base
// (même approche que TRANSLATIONS_SUBSELECT dans routes/ingredients.ts).
const TRANSLATIONS_SUBSELECT = `
  (SELECT JSON_OBJECTAGG(t.language, t.name)
   FROM coffret_translations t
   WHERE t.coffret_id = c.id) AS translations
`

function parseCoffret(row: any) {
  const { translations, ...rest } = row
  return {
    ...rest,
    is_active: !!row.is_active,
    translations: translations
      ? (typeof translations === 'string' ? JSON.parse(translations) : translations)
      : {},
  }
}

async function setTranslations(coffretId: number, translations: Record<string, string>) {
  const entries = Object.entries(translations).filter(([, name]) => name && name.trim())
  if (entries.length === 0) return
  const values = entries.map(([lang, name]) => [coffretId, lang, name.trim()])
  await pool.query(
    `INSERT INTO coffret_translations (coffret_id, language, name) VALUES ?
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [values]
  )
  // Langues explicitement vidées dans la requête : on les retire.
  const emptyLangs = Object.entries(translations).filter(([, name]) => !name || !name.trim()).map(([lang]) => lang)
  if (emptyLangs.length > 0) {
    await pool.query(
      'DELETE FROM coffret_translations WHERE coffret_id = ? AND language IN (?)',
      [coffretId, emptyLangs]
    )
  }
}

router.get('/coffrets', async (req: Request, res: Response) => {
  try {
    const { active_only } = req.query
    const where = active_only === 'true' ? 'WHERE c.is_active = TRUE' : ''
    const [rows] = await pool.query<any[]>(
      `SELECT c.*, ${TRANSLATIONS_SUBSELECT} FROM coffrets c ${where} ORDER BY c.id`
    )
    res.json(rows.map(parseCoffret))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch coffrets' })
  }
})

router.post('/coffrets', async (req: Request, res: Response) => {
  try {
    const { translations } = req.body
    if (!translations || typeof translations !== 'object' || !Object.values(translations).some((v) => typeof v === 'string' && v.trim())) {
      res.status(400).json({ error: 'Au moins un nom traduit (translations) est requis' })
      return
    }
    const [result] = await pool.query<any>('INSERT INTO coffrets () VALUES ()')
    await setTranslations(result.insertId, translations)
    const [rows] = await pool.query<any[]>(
      `SELECT c.*, ${TRANSLATIONS_SUBSELECT} FROM coffrets c WHERE c.id = ?`,
      [result.insertId]
    )
    res.status(201).json(parseCoffret(rows[0]))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create coffret' })
  }
})

router.patch('/coffrets/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { translations, is_active } = req.body
    const fields: string[] = []
    const params: unknown[] = []

    if (is_active !== undefined) { fields.push('is_active = ?'); params.push(!!is_active) }

    if (fields.length > 0) {
      params.push(id)
      await pool.query(`UPDATE coffrets SET ${fields.join(', ')} WHERE id = ?`, params)
    }

    if (translations && typeof translations === 'object') {
      await setTranslations(Number(id), translations)
    }

    if (fields.length === 0 && !translations) {
      res.status(400).json({ error: 'Aucun champ à mettre à jour' })
      return
    }

    const [rows] = await pool.query<any[]>(
      `SELECT c.*, ${TRANSLATIONS_SUBSELECT} FROM coffrets c WHERE c.id = ?`,
      [id]
    )
    if (!rows[0]) {
      res.status(404).json({ error: 'Coffret not found' })
      return
    }
    res.json(parseCoffret(rows[0]))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update coffret' })
  }
})

router.delete('/coffrets/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM coffrets WHERE id = ?', [req.params.id])
    res.status(204).send()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete coffret' })
  }
})

export default router
