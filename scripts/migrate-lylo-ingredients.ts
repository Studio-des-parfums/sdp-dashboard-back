// Script one-shot : copie les ingrédients du backend Lylo (Railway) vers la table
// `ingredients` de la base générale du dashboard SDP.
//
// Usage : depuis server/, `npx ts-node scripts/migrate-lylo-ingredients.ts`
// (ou `npm run migrate:lylo-ingredients` si le script est ajouté au package.json)

import 'dotenv/config'
import pool from '../db'

const LYLO_API_URL = process.env.LYLO_API_URL || 'https://lylo-back-production.up.railway.app'

type LyloIngredient = {
  id: number
  name: string
  type: 'top' | 'heart' | 'base'
  category: string | null
  language: string
  description: string | null
  intensity: string | null
  allergens: string[] | null
  is_active: boolean
}

async function fetchLyloIngredients(): Promise<LyloIngredient[]> {
  const res = await fetch(`${LYLO_API_URL}/catalog/ingredients?active_only=false`, {
    headers: { 'ngrok-skip-browser-warning': 'true' },
  })
  if (!res.ok) {
    throw new Error(`Échec de la récupération des ingrédients Lylo : HTTP ${res.status}`)
  }
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

async function main() {
  console.log(`Récupération des ingrédients depuis ${LYLO_API_URL}...`)
  const ingredients = await fetchLyloIngredients()
  console.log(`${ingredients.length} ingrédient(s) trouvé(s).`)

  let inserted = 0
  let skipped = 0

  for (const ing of ingredients) {
    // Évite les doublons si le script est relancé (même nom + langue).
    const [existing] = await pool.query<any[]>(
      'SELECT id FROM ingredients WHERE name = ? AND language = ?',
      [ing.name, ing.language]
    )
    if (existing.length > 0) {
      skipped++
      continue
    }

    await pool.query(
      `INSERT INTO ingredients (name, type, category, language, description, intensity, allergens, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ing.name,
        ing.type,
        ing.category ?? null,
        ing.language ?? 'fr',
        ing.description ?? null,
        ing.intensity ?? null,
        ing.allergens ? JSON.stringify(ing.allergens) : null,
        !!ing.is_active,
      ]
    )
    inserted++
  }

  console.log(`Migration terminée : ${inserted} insérés, ${skipped} déjà présents (ignorés).`)
  await pool.end()
}

main().catch((err) => {
  console.error('Erreur pendant la migration :', err)
  process.exit(1)
})
