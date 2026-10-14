import { Router, Request, Response } from 'express'
import multer from 'multer'
import pool from '../db'
import { uploadOptionImage, deleteOptionImage } from '../services/s3'
import { translateOptionName } from '../services/translate'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

// Une option porte ses traductions en sous-objet `translations: { fr: "...", en: "..." }`,
// même approche que TRANSLATIONS_SUBSELECT dans routes/ateliers.ts et routes/ingredients.ts.
const TRANSLATIONS_SUBSELECT = `
  (SELECT JSON_OBJECTAGG(t.language, t.name)
   FROM option_translations t
   WHERE t.option_id = o.id) AS translations
`

// Coffrets pour lesquels l'option est disponible, via la table de jointure option_coffrets
// (même modèle que ingredient_coffrets) : liste vide = disponible pour tous les coffrets.
const COFFRET_IDS_SUBSELECT = `
  (SELECT JSON_ARRAYAGG(oc.coffret_id)
   FROM option_coffrets oc
   WHERE oc.option_id = o.id) AS coffret_ids
`

// Ateliers pour lesquels l'option est disponible, via option_ateliers : même principe, liste
// vide = disponible pour tous les ateliers. Se combine en ET avec le filtre coffret.
const ATELIER_IDS_SUBSELECT = `
  (SELECT JSON_ARRAYAGG(oa.atelier_id)
   FROM option_ateliers oa
   WHERE oa.option_id = o.id) AS atelier_ids
`

function parseOption(row: any) {
  const { translations, coffret_ids, atelier_ids, ...rest } = row
  return {
    ...rest,
    is_active: !!row.is_active,
    coffret_ids: coffret_ids
      ? (typeof coffret_ids === 'string' ? JSON.parse(coffret_ids) : coffret_ids)
      : [],
    atelier_ids: atelier_ids
      ? (typeof atelier_ids === 'string' ? JSON.parse(atelier_ids) : atelier_ids)
      : [],
    translations: translations
      ? (typeof translations === 'string' ? JSON.parse(translations) : translations)
      : {},
  }
}

async function setCoffrets(optionId: number, coffretIds: number[]) {
  await pool.query('DELETE FROM option_coffrets WHERE option_id = ?', [optionId])
  const ids = [...new Set(coffretIds)].filter((id) => Number.isInteger(id))
  if (ids.length === 0) return
  const values = ids.map((coffretId) => [optionId, coffretId])
  await pool.query(
    'INSERT INTO option_coffrets (option_id, coffret_id) VALUES ?',
    [values]
  )
}

async function setAteliers(optionId: number, atelierIds: number[]) {
  await pool.query('DELETE FROM option_ateliers WHERE option_id = ?', [optionId])
  const ids = [...new Set(atelierIds)].filter((id) => Number.isInteger(id))
  if (ids.length === 0) return
  const values = ids.map((atelierId) => [optionId, atelierId])
  await pool.query(
    'INSERT INTO option_ateliers (option_id, atelier_id) VALUES ?',
    [values]
  )
}

// Complète les traductions saisies manuellement avec celles générées automatiquement (OpenAI)
// à partir du nom français, sans jamais écraser une traduction déjà fournie explicitement.
async function withAutoTranslations(translations: Record<string, string>): Promise<Record<string, string>> {
  const fr = translations.fr?.trim()
  if (!fr) return translations
  const generated = await translateOptionName(fr)
  const result = { ...translations }
  for (const [lang, name] of Object.entries(generated)) {
    if (!result[lang]?.trim()) result[lang] = name
  }
  return result
}

async function setTranslations(optionId: number, translations: Record<string, string>) {
  const entries = Object.entries(translations).filter(([, name]) => name && name.trim())
  if (entries.length === 0) return
  const values = entries.map(([lang, name]) => [optionId, lang, name.trim()])
  await pool.query(
    `INSERT INTO option_translations (option_id, language, name) VALUES ?
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [values]
  )
  // Langues explicitement vidées dans la requête : on les retire.
  const emptyLangs = Object.entries(translations).filter(([, name]) => !name || !name.trim()).map(([lang]) => lang)
  if (emptyLangs.length > 0) {
    await pool.query(
      'DELETE FROM option_translations WHERE option_id = ? AND language IN (?)',
      [optionId, emptyLangs]
    )
  }
}

router.get('/options', async (req: Request, res: Response) => {
  try {
    const { coffret_id, atelier_id, active_only } = req.query
    const conditions: string[] = []
    const params: unknown[] = []

    if (coffret_id) {
      // Disponible pour ce coffret : soit aucune restriction (pas de ligne dans
      // option_coffrets), soit une ligne explicite pour ce coffret précis.
      conditions.push(`(
        NOT EXISTS (SELECT 1 FROM option_coffrets oc WHERE oc.option_id = o.id)
        OR EXISTS (SELECT 1 FROM option_coffrets oc WHERE oc.option_id = o.id AND oc.coffret_id = ?)
      )`)
      params.push(coffret_id)
    }
    if (atelier_id) {
      // Même principe pour l'atelier : se combine en ET avec le filtre coffret ci-dessus.
      conditions.push(`(
        NOT EXISTS (SELECT 1 FROM option_ateliers oa WHERE oa.option_id = o.id)
        OR EXISTS (SELECT 1 FROM option_ateliers oa WHERE oa.option_id = o.id AND oa.atelier_id = ?)
      )`)
      params.push(atelier_id)
    }
    if (active_only === 'true') {
      conditions.push('o.is_active = TRUE')
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const [rows] = await pool.query<any[]>(
      `SELECT o.*, ${TRANSLATIONS_SUBSELECT}, ${COFFRET_IDS_SUBSELECT}, ${ATELIER_IDS_SUBSELECT} FROM options o ${where} ORDER BY o.id`,
      params
    )
    res.json(rows.map(parseOption))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch options' })
  }
})

router.post('/options', async (req: Request, res: Response) => {
  try {
    const { translations, description, coffret_ids, atelier_ids } = req.body
    if (!translations || typeof translations !== 'object' || !Object.values(translations).some((v) => typeof v === 'string' && v.trim())) {
      res.status(400).json({ error: 'Au moins un nom traduit (translations) est requis' })
      return
    }
    const [result] = await pool.query<any>(
      `INSERT INTO options (description) VALUES (?)`,
      [description ?? null]
    )
    const fullTranslations = await withAutoTranslations(translations)
    await setTranslations(result.insertId, fullTranslations)
    if (Array.isArray(coffret_ids)) {
      await setCoffrets(result.insertId, coffret_ids)
    }
    if (Array.isArray(atelier_ids)) {
      await setAteliers(result.insertId, atelier_ids)
    }
    const [rows] = await pool.query<any[]>(
      `SELECT o.*, ${TRANSLATIONS_SUBSELECT}, ${COFFRET_IDS_SUBSELECT}, ${ATELIER_IDS_SUBSELECT} FROM options o WHERE o.id = ?`,
      [result.insertId]
    )
    res.status(201).json(parseOption(rows[0]))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create option' })
  }
})

router.patch('/options/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const fields: string[] = []
    const params: unknown[] = []

    const { translations, description, coffret_ids, atelier_ids, is_active } = req.body

    if (description !== undefined) { fields.push('description = ?'); params.push(description) }
    if (is_active !== undefined) { fields.push('is_active = ?'); params.push(!!is_active) }

    if (fields.length > 0) {
      params.push(id)
      await pool.query(`UPDATE options SET ${fields.join(', ')} WHERE id = ?`, params)
    }

    if (translations && typeof translations === 'object') {
      const fullTranslations = await withAutoTranslations(translations)
      await setTranslations(Number(id), fullTranslations)
    }
    if (Array.isArray(coffret_ids)) {
      await setCoffrets(Number(id), coffret_ids)
    }
    if (Array.isArray(atelier_ids)) {
      await setAteliers(Number(id), atelier_ids)
    }

    if (fields.length === 0 && !translations && !Array.isArray(coffret_ids) && !Array.isArray(atelier_ids)) {
      res.status(400).json({ error: 'Aucun champ à mettre à jour' })
      return
    }

    const [rows] = await pool.query<any[]>(
      `SELECT o.*, ${TRANSLATIONS_SUBSELECT}, ${COFFRET_IDS_SUBSELECT}, ${ATELIER_IDS_SUBSELECT} FROM options o WHERE o.id = ?`,
      [id]
    )
    if (!rows[0]) {
      res.status(404).json({ error: 'Option not found' })
      return
    }
    res.json(parseOption(rows[0]))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update option' })
  }
})

router.post('/options/:id/image', upload.single('image'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    if (!req.file) {
      res.status(400).json({ error: 'Fichier image requis (champ "image")' })
      return
    }
    if (!req.file.mimetype.startsWith('image/')) {
      res.status(400).json({ error: 'Le fichier doit être une image' })
      return
    }

    const [existingRows] = await pool.query<any[]>('SELECT image_url FROM options WHERE id = ?', [id])
    if (!existingRows[0]) {
      res.status(404).json({ error: 'Option not found' })
      return
    }

    const imageUrl = await uploadOptionImage(Number(id), req.file.buffer, req.file.originalname, req.file.mimetype)

    if (existingRows[0].image_url) {
      await deleteOptionImage(existingRows[0].image_url).catch((err) => console.error('Failed to delete old option image', err))
    }

    await pool.query('UPDATE options SET image_url = ? WHERE id = ?', [imageUrl, id])

    const [rows] = await pool.query<any[]>(
      `SELECT o.*, ${TRANSLATIONS_SUBSELECT}, ${COFFRET_IDS_SUBSELECT}, ${ATELIER_IDS_SUBSELECT} FROM options o WHERE o.id = ?`,
      [id]
    )
    res.json(parseOption(rows[0]))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to upload option image' })
  }
})

router.delete('/options/:id/image', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const [rows] = await pool.query<any[]>('SELECT image_url FROM options WHERE id = ?', [id])
    if (!rows[0]) {
      res.status(404).json({ error: 'Option not found' })
      return
    }
    if (rows[0].image_url) {
      await deleteOptionImage(rows[0].image_url).catch((err) => console.error('Failed to delete option image from S3', err))
      await pool.query('UPDATE options SET image_url = NULL WHERE id = ?', [id])
    }
    res.status(204).send()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete option image' })
  }
})

router.delete('/options/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const [rows] = await pool.query<any[]>('SELECT image_url FROM options WHERE id = ?', [id])
    if (rows[0]?.image_url) {
      await deleteOptionImage(rows[0].image_url).catch((err) => console.error('Failed to delete option image from S3', err))
    }
    await pool.query('DELETE FROM options WHERE id = ?', [id])
    res.status(204).send()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete option' })
  }
})

export default router
