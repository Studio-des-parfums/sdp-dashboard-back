// Script one-shot : les boosters doivent être liés à tous les coffrets (règle
// appliquée automatiquement pour les coffrets créés désormais, cf.
// linkBoostersToCoffret dans routes/coffrets.ts). Ce script rattrape les
// boosters créés avant cette règle (ex: Musc Blanc/Floral/Accord Musc, créés
// sans coffret en migration 021), en les liant à tous les coffrets existants.
//
// Usage : depuis server/, `npx tsx scripts/link-boosters-to-existing-coffrets.ts`

import 'dotenv/config'
import pool from '../db'

async function main() {
  const [boosters] = await pool.query<any[]>("SELECT id FROM ingredients WHERE type = 'booster'")
  const [coffrets] = await pool.query<any[]>('SELECT id FROM coffrets')

  if (boosters.length === 0 || coffrets.length === 0) {
    console.log('Rien à faire :', boosters.length, 'booster(s),', coffrets.length, 'coffret(s).')
    await pool.end()
    return
  }

  const values: number[][] = []
  for (const booster of boosters) {
    for (const coffret of coffrets) {
      values.push([booster.id, coffret.id])
    }
  }

  await pool.query(
    'INSERT INTO ingredient_coffrets (ingredient_id, coffret_id) VALUES ? ON DUPLICATE KEY UPDATE ingredient_id = ingredient_id',
    [values]
  )

  console.log(`${boosters.length} booster(s) lié(s) à ${coffrets.length} coffret(s) (${values.length} lien(s) au total, doublons ignorés).`)
  await pool.end()
}

main().catch((err) => {
  console.error('Erreur pendant le rattrapage :', err)
  process.exit(1)
})
