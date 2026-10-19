// Script one-shot : complète les traductions manquantes (en, pt, ru, ar, es) de
// toutes les notes existantes qui ont déjà un nom français, via OpenAI.
// N'écrase jamais une traduction déjà présente en base.
//
// Usage : depuis server/, `npx tsx scripts/translate-all-notes.ts`

import 'dotenv/config'
import pool from '../db'
import { translateNoteName } from '../services/translate'

async function main() {
  const [rows] = await pool.query<any[]>(`
    SELECT i.id, ${`(SELECT JSON_OBJECTAGG(t.language, t.name) FROM ingredient_translations t WHERE t.ingredient_id = i.id)`} AS translations
    FROM ingredients i
  `)

  let updated = 0
  let skipped = 0

  for (const row of rows) {
    const translations: Record<string, string> = row.translations
      ? (typeof row.translations === 'string' ? JSON.parse(row.translations) : row.translations)
      : {}

    const fr = translations.fr?.trim()
    if (!fr) {
      console.warn(`⚠️  Note #${row.id} sans nom français, ignorée.`)
      skipped++
      continue
    }

    const missingLangs = ['en', 'pt', 'ru', 'ar', 'es'].filter((lang) => !translations[lang]?.trim())
    if (missingLangs.length === 0) {
      skipped++
      continue
    }

    const generated = await translateNoteName(fr)
    const toInsert = missingLangs
      .filter((lang) => generated[lang])
      .map((lang) => [row.id, lang, generated[lang]])

    if (toInsert.length === 0) {
      console.warn(`⚠️  Note #${row.id} ("${fr}") : traduction OpenAI vide ou échouée.`)
      skipped++
      continue
    }

    await pool.query(
      `INSERT INTO ingredient_translations (ingredient_id, language, name) VALUES ?
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [toInsert]
    )
    updated++
    console.log(`✓ Note #${row.id} ("${fr}") → ${toInsert.map(([, lang]) => lang).join(', ')}`)
  }

  console.log(`\nTerminé : ${updated} note(s) complétée(s), ${skipped} ignorée(s)/déjà complètes.`)
  await pool.end()
}

main().catch((err) => {
  console.error('Erreur pendant la traduction :', err)
  process.exit(1)
})
