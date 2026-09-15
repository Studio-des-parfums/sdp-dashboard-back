// Script one-shot : lit les valeurs distinctes de `ingredients.box_sets` (JSON de
// noms libres), crée une ligne `coffrets` (+ traduction FR) par valeur distincte,
// recrée la relation dans `ingredient_coffrets`, puis retire la colonne `box_sets`.
//
// À lancer après la migration 022_coffrets.sql et avant 024_rule_box_set_id.sql
// (qui dépend de coffret_translations pour retrouver les box_set_id des règles).
//
// Usage : depuis server/, `npx tsx scripts/migrate-box-sets-to-coffrets.ts`

import 'dotenv/config'
import pool from '../db'

type IngredientRow = {
  id: number
  box_sets: string | null
}

async function main() {
  const [rows] = await pool.query<any[]>('SELECT id, box_sets FROM ingredients WHERE box_sets IS NOT NULL')
  const ingredients = rows as IngredientRow[]

  const coffretIdByName = new Map<string, number>()
  const links: { ingredientId: number; coffretName: string }[] = []

  for (const ing of ingredients) {
    const names: string[] = typeof ing.box_sets === 'string' ? JSON.parse(ing.box_sets) : (ing.box_sets as unknown as string[])
    for (const name of names) {
      const trimmed = name.trim()
      if (!trimmed) continue
      links.push({ ingredientId: ing.id, coffretName: trimmed })
    }
  }

  const distinctNames = [...new Set(links.map((l) => l.coffretName))].sort()

  for (const name of distinctNames) {
    const [result] = await pool.query<any>('INSERT INTO coffrets () VALUES ()')
    const coffretId = result.insertId
    await pool.query('INSERT INTO coffret_translations (coffret_id, language, name) VALUES (?, ?, ?)', [coffretId, 'fr', name])
    coffretIdByName.set(name, coffretId)
    console.log(`✓ Coffret créé : "${name}" → #${coffretId}`)
  }

  let linked = 0
  for (const { ingredientId, coffretName } of links) {
    const coffretId = coffretIdByName.get(coffretName)!
    await pool.query(
      'INSERT INTO ingredient_coffrets (ingredient_id, coffret_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE ingredient_id = ingredient_id',
      [ingredientId, coffretId]
    )
    linked++
  }

  console.log(`\n${distinctNames.length} coffret(s) créé(s), ${linked} lien(s) note↔coffret recréé(s).`)
  console.log('Vérifiez SELECT * FROM coffrets / ingredient_coffrets avant de continuer.')
  console.log('Une fois vérifié, retirez la colonne box_sets avec :')
  console.log('  ALTER TABLE ingredients DROP COLUMN box_sets;')
  await pool.end()
}

main().catch((err) => {
  console.error('Erreur pendant la migration :', err)
  process.exit(1)
})
