// Script one-shot : fusionne les paires FR/EN de la table `ingredients` (une ligne
// par langue) en une seule ligne par note, avec ses noms traduits dans la nouvelle
// table `ingredient_translations`.
//
// Les paires sont appariées par position au sein de chaque `type` (top/heart/base) :
// vérifié manuellement que les 10 FR et 10 EN de chaque type sont dans le même ordre.
//
// Usage : depuis server/, `npx tsx scripts/merge-ingredient-languages.ts`

import 'dotenv/config'
import pool from '../db'

type IngredientRow = {
  id: number
  name: string
  type: 'top' | 'heart' | 'base'
  category: string | null
  language: string
  description: string | null
  intensity: string | null
  allergens: string | null
  box_sets: string | null
  is_active: number
}

async function main() {
  const [rows] = await pool.query<any[]>('SELECT * FROM ingredients ORDER BY type, id')
  const ingredients = rows as IngredientRow[]

  const byType = new Map<string, { fr: IngredientRow[]; en: IngredientRow[] }>()
  for (const ing of ingredients) {
    if (!byType.has(ing.type)) byType.set(ing.type, { fr: [], en: [] })
    const bucket = byType.get(ing.type)!
    if (ing.language === 'fr') bucket.fr.push(ing)
    else if (ing.language === 'en') bucket.en.push(ing)
    else {
      console.warn(`Langue inattendue ignorée : ingredient #${ing.id} (${ing.language})`)
    }
  }

  let merged = 0
  const idsToDelete: number[] = []

  for (const [type, { fr, en }] of byType) {
    if (fr.length !== en.length) {
      console.warn(`⚠️  Type "${type}" : ${fr.length} FR vs ${en.length} EN — appariement partiel seulement.`)
    }
    const count = Math.min(fr.length, en.length)

    for (let i = 0; i < count; i++) {
      const frRow = fr[i]
      const enRow = en[i]

      // La ligne FR devient la ligne "canonique" de la note (garde son id).
      // On y attache les deux traductions puis on supprime la ligne EN dupliquée.
      await pool.query(
        `INSERT INTO ingredient_translations (ingredient_id, language, name) VALUES (?, 'fr', ?), (?, 'en', ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [frRow.id, frRow.name, frRow.id, enRow.name]
      )
      idsToDelete.push(enRow.id)
      merged++
      console.log(`✓ [${type}] "${frRow.name}" (fr) ↔ "${enRow.name}" (en) → ingredient #${frRow.id}`)
    }
  }

  if (idsToDelete.length > 0) {
    await pool.query('DELETE FROM ingredients WHERE id IN (?)', [idsToDelete])
  }

  console.log(`\nFusion terminée : ${merged} note(s) fusionnée(s), ${idsToDelete.length} ligne(s) EN dupliquée(s) supprimée(s).`)
  await pool.end()
}

main().catch((err) => {
  console.error('Erreur pendant la fusion :', err)
  process.exit(1)
})
