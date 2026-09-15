import { Router, Request, Response } from 'express'
import pool from '../db'

const router = Router()

const RULE_TYPES = ['incompatibility', 'max_dosage', 'recommendation', 'note_count', 'group_limit'] as const
type RuleType = (typeof RULE_TYPES)[number]

const NOTE_COUNT_FIELDS = ['min_top', 'max_top', 'min_heart', 'max_heart', 'min_base', 'max_base'] as const

const INTENSITIES = ['legere', 'moyenne', 'forte', 'toutes'] as const
type Intensity = (typeof INTENSITIES)[number]

// Une règle porte ses notes cibles et ses tailles de flacon en sous-tableaux,
// construits via une agrégation JSON pour ne faire qu'un aller-retour en base
// (même approche que TRANSLATIONS_SUBSELECT dans routes/ingredients.ts).
const TARGETS_SUBSELECT = `
  (SELECT JSON_ARRAYAGG(rt.target_ingredient_id)
   FROM ingredient_rule_targets rt
   WHERE rt.rule_id = r.id) AS target_ingredient_ids
`
const BOTTLE_SIZES_SUBSELECT = `
  (SELECT JSON_ARRAYAGG(bs.bottle_size)
   FROM ingredient_rule_bottle_sizes bs
   WHERE bs.rule_id = r.id) AS bottle_sizes
`

function parseRule(row: any) {
  const { target_ingredient_ids, bottle_sizes, ...rest } = row
  for (const field of NOTE_COUNT_FIELDS) {
    if (rest[field] != null) rest[field] = Number(rest[field])
  }
  return {
    ...rest,
    is_active: !!row.is_active,
    max_ml: row.max_ml != null ? Number(row.max_ml) : null,
    max_choices: row.max_choices != null ? Number(row.max_choices) : null,
    target_ingredient_ids: target_ingredient_ids
      ? (typeof target_ingredient_ids === 'string' ? JSON.parse(target_ingredient_ids) : target_ingredient_ids)
      : [],
    bottle_sizes: bottle_sizes
      ? (typeof bottle_sizes === 'string' ? JSON.parse(bottle_sizes) : bottle_sizes)
      : [],
  }
}

async function setTargets(ruleId: number, targetIds: number[]) {
  await pool.query('DELETE FROM ingredient_rule_targets WHERE rule_id = ?', [ruleId])
  const ids = [...new Set(targetIds)].filter((id) => Number.isInteger(id))
  if (ids.length === 0) return
  const values = ids.map((targetId) => [ruleId, targetId])
  await pool.query(
    'INSERT INTO ingredient_rule_targets (rule_id, target_ingredient_id) VALUES ?',
    [values]
  )
}

async function setBottleSizes(ruleId: number, sizes: string[]) {
  await pool.query('DELETE FROM ingredient_rule_bottle_sizes WHERE rule_id = ?', [ruleId])
  const cleaned = [...new Set(sizes.map((s) => String(s).trim()).filter(Boolean))]
  if (cleaned.length === 0) return
  const values = cleaned.map((size) => [ruleId, size])
  await pool.query(
    'INSERT INTO ingredient_rule_bottle_sizes (rule_id, bottle_size) VALUES ?',
    [values]
  )
}

/** Extrait et valide les 6 bornes min/max par famille pour une règle note_count. */
function readNoteCountFields(body: any): Record<(typeof NOTE_COUNT_FIELDS)[number], number | null> | { error: string } {
  const values: Record<string, number | null> = {}
  for (const field of NOTE_COUNT_FIELDS) {
    const raw = body[field]
    if (raw === undefined || raw === null || raw === '') { values[field] = null; continue }
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0) return { error: `${field} doit être un entier positif` }
    values[field] = n
  }
  for (const family of ['top', 'heart', 'base'] as const) {
    const min = values[`min_${family}`]
    const max = values[`max_${family}`]
    if (min != null && max != null && min > max) {
      return { error: `min_${family} ne peut pas être supérieur à max_${family}` }
    }
  }
  return values as Record<(typeof NOTE_COUNT_FIELDS)[number], number | null>
}

router.get('/ingredient-rules', async (req: Request, res: Response) => {
  try {
    const { source_ingredient_id, rule_type, bottle_size, box_set_id, intensity, active_only } = req.query
    const conditions: string[] = []
    const params: unknown[] = []

    if (source_ingredient_id) {
      conditions.push('r.source_ingredient_id = ?')
      params.push(source_ingredient_id)
    }
    if (rule_type) {
      conditions.push('r.rule_type = ?')
      params.push(rule_type)
    }
    if (bottle_size) {
      conditions.push('EXISTS (SELECT 1 FROM ingredient_rule_bottle_sizes bs WHERE bs.rule_id = r.id AND bs.bottle_size = ?)')
      params.push(bottle_size)
    }
    if (box_set_id) {
      conditions.push('r.box_set_id = ?')
      params.push(box_set_id)
    }
    if (intensity) {
      // Une règle 'toutes' s'applique à toutes les intensités : on la
      // renvoie aussi bien quand on filtre sur une intensité précise.
      conditions.push('(r.intensity = ? OR r.intensity = ?)')
      params.push(intensity, 'toutes')
    }
    if (active_only === 'true') {
      conditions.push('r.is_active = TRUE')
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const [rows] = await pool.query<any[]>(
      `SELECT r.*, ${TARGETS_SUBSELECT}, ${BOTTLE_SIZES_SUBSELECT} FROM ingredient_rules r ${where} ORDER BY r.id`,
      params
    )
    res.json(rows.map(parseRule))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch ingredient rules' })
  }
})

router.post('/ingredient-rules', async (req: Request, res: Response) => {
  try {
    const { source_ingredient_id, rule_type, max_ml, max_choices, bottle_sizes, box_set_id, intensity, note, target_ingredient_ids } = req.body

    if (!RULE_TYPES.includes(rule_type as RuleType)) {
      res.status(400).json({ error: `rule_type doit être l'un de : ${RULE_TYPES.join(', ')}` })
      return
    }
    if (intensity !== undefined && !INTENSITIES.includes(intensity as Intensity)) {
      res.status(400).json({ error: `intensity doit être l'un de : ${INTENSITIES.join(', ')}` })
      return
    }
    // incompatibility, max_dosage et group_limit portent un groupe de notes
    // partageant la même règle (pas de note "source" : toutes les notes
    // sélectionnées sont équivalentes — incompatibilité mutuelle, plafond ml
    // partagé, ou plafond sur le nombre de choix parmi elles).
    // recommendation reste asymétrique : une note source précise est requise.
    // note_count ne porte ni source ni cibles : au moins une taille de flacon
    // est requise.
    if (rule_type === 'incompatibility') {
      if (!Array.isArray(target_ingredient_ids) || target_ingredient_ids.length < 2) {
        res.status(400).json({ error: 'Une règle incompatibility nécessite au moins 2 notes dans le groupe' })
        return
      }
    } else if (rule_type === 'max_dosage') {
      if (!Array.isArray(target_ingredient_ids) || target_ingredient_ids.length < 1) {
        res.status(400).json({ error: 'Une règle max_dosage nécessite au moins 1 note' })
        return
      }
    } else if (rule_type === 'group_limit') {
      if (!Array.isArray(target_ingredient_ids) || target_ingredient_ids.length < 2) {
        res.status(400).json({ error: 'Une règle group_limit nécessite au moins 2 notes dans le groupe' })
        return
      }
    } else if (rule_type === 'note_count') {
      if (!Array.isArray(bottle_sizes) || bottle_sizes.length === 0) {
        res.status(400).json({ error: 'Au moins une taille de flacon est requise pour une règle note_count' })
        return
      }
    } else if (!source_ingredient_id) {
      res.status(400).json({ error: 'source_ingredient_id est requis pour ce type de règle' })
      return
    }
    if (rule_type === 'max_dosage' && (max_ml === undefined || max_ml === null)) {
      res.status(400).json({ error: 'max_ml est requis pour une règle max_dosage' })
      return
    }
    if (rule_type === 'group_limit') {
      const n = Number(max_choices)
      if (max_choices === undefined || max_choices === null || !Number.isInteger(n) || n < 1) {
        res.status(400).json({ error: 'max_choices (entier ≥ 1) est requis pour une règle group_limit' })
        return
      }
      if (Array.isArray(target_ingredient_ids) && n >= target_ingredient_ids.length) {
        res.status(400).json({ error: 'max_choices doit être inférieur au nombre de notes du groupe' })
        return
      }
    }
    if (rule_type === 'recommendation' && !Array.isArray(target_ingredient_ids)) {
      res.status(400).json({ error: 'target_ingredient_ids (tableau) est requis pour ce type de règle' })
      return
    }

    let noteCountValues: Record<string, number | null> = Object.fromEntries(NOTE_COUNT_FIELDS.map((f) => [f, null]))
    if (rule_type === 'note_count') {
      const parsed = readNoteCountFields(req.body)
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error })
        return
      }
      noteCountValues = parsed
    }

    const [result] = await pool.query<any>(
      `INSERT INTO ingredient_rules
         (source_ingredient_id, rule_type, max_ml, max_choices, box_set_id, intensity, note,
          min_top, max_top, min_heart, max_heart, min_base, max_base)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rule_type === 'recommendation' ? source_ingredient_id : null,
        rule_type,
        rule_type === 'max_dosage' ? max_ml : null,
        rule_type === 'group_limit' ? max_choices : null,
        box_set_id ?? null,
        intensity ?? 'toutes',
        note ?? null,
        noteCountValues.min_top, noteCountValues.max_top,
        noteCountValues.min_heart, noteCountValues.max_heart,
        noteCountValues.min_base, noteCountValues.max_base,
      ]
    )

    if (Array.isArray(target_ingredient_ids)) {
      await setTargets(result.insertId, target_ingredient_ids)
    }
    if (Array.isArray(bottle_sizes)) {
      await setBottleSizes(result.insertId, bottle_sizes)
    }

    const [rows] = await pool.query<any[]>(
      `SELECT r.*, ${TARGETS_SUBSELECT}, ${BOTTLE_SIZES_SUBSELECT} FROM ingredient_rules r WHERE r.id = ?`,
      [result.insertId]
    )
    res.status(201).json(parseRule(rows[0]))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create ingredient rule' })
  }
})

router.patch('/ingredient-rules/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const fields: string[] = []
    const params: unknown[] = []

    const { source_ingredient_id, rule_type, max_ml, max_choices, bottle_sizes, box_set_id, intensity, note, is_active, target_ingredient_ids } = req.body

    if (rule_type !== undefined && !RULE_TYPES.includes(rule_type as RuleType)) {
      res.status(400).json({ error: `rule_type doit être l'un de : ${RULE_TYPES.join(', ')}` })
      return
    }
    if (intensity !== undefined && !INTENSITIES.includes(intensity as Intensity)) {
      res.status(400).json({ error: `intensity doit être l'un de : ${INTENSITIES.join(', ')}` })
      return
    }

    if (source_ingredient_id !== undefined) {
      // Seul recommendation porte encore une note source ; les autres types
      // reposent sur un groupe de notes (target_ingredient_ids) ou aucune.
      fields.push('source_ingredient_id = ?')
      params.push(rule_type === 'recommendation' ? source_ingredient_id : null)
    } else if (rule_type === 'incompatibility' || rule_type === 'max_dosage' || rule_type === 'note_count' || rule_type === 'group_limit') {
      fields.push('source_ingredient_id = ?')
      params.push(null)
    }
    if (rule_type !== undefined) { fields.push('rule_type = ?'); params.push(rule_type) }
    if (max_ml !== undefined) { fields.push('max_ml = ?'); params.push(max_ml) }
    if (max_choices !== undefined) { fields.push('max_choices = ?'); params.push(max_choices) }
    if (box_set_id !== undefined) { fields.push('box_set_id = ?'); params.push(box_set_id) }
    if (intensity !== undefined) { fields.push('intensity = ?'); params.push(intensity) }
    if (note !== undefined) { fields.push('note = ?'); params.push(note) }
    if (is_active !== undefined) { fields.push('is_active = ?'); params.push(!!is_active) }

    if (rule_type === 'note_count' || NOTE_COUNT_FIELDS.some((f) => req.body[f] !== undefined)) {
      const parsed = readNoteCountFields(req.body)
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error })
        return
      }
      for (const field of NOTE_COUNT_FIELDS) {
        fields.push(`${field} = ?`)
        params.push(parsed[field])
      }
    }

    if (fields.length > 0) {
      params.push(id)
      await pool.query(`UPDATE ingredient_rules SET ${fields.join(', ')} WHERE id = ?`, params)
    }

    if (Array.isArray(target_ingredient_ids)) {
      await setTargets(Number(id), target_ingredient_ids)
    }
    if (Array.isArray(bottle_sizes)) {
      await setBottleSizes(Number(id), bottle_sizes)
    }

    if (fields.length === 0 && !Array.isArray(target_ingredient_ids) && !Array.isArray(bottle_sizes)) {
      res.status(400).json({ error: 'Aucun champ à mettre à jour' })
      return
    }

    const [rows] = await pool.query<any[]>(
      `SELECT r.*, ${TARGETS_SUBSELECT}, ${BOTTLE_SIZES_SUBSELECT} FROM ingredient_rules r WHERE r.id = ?`,
      [id]
    )
    if (!rows[0]) {
      res.status(404).json({ error: 'Ingredient rule not found' })
      return
    }
    res.json(parseRule(rows[0]))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update ingredient rule' })
  }
})

router.delete('/ingredient-rules/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM ingredient_rules WHERE id = ?', [req.params.id])
    res.status(204).send()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete ingredient rule' })
  }
})

export default router
