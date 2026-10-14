// Script one-shot : complète les traductions manquantes (en, pt, ru, ar, es) de
// toutes les options existantes qui ont déjà un nom français, via OpenAI.
// N'écrase jamais une traduction déjà présente en base.
//
// Usage : depuis server/, `npx tsx scripts/translate-all-options.ts`

import 'dotenv/config'
import pool from '../db'
import { translateOptionName } from '../services/translate'

async function main() {
  const [rows] = await pool.query<any[]>(`
    SELECT o.id, ${`(SELECT JSON_OBJECTAGG(t.language, t.name) FROM option_translations t WHERE t.option_id = o.id)`} AS translations
    FROM options o
  `)

  let updated = 0
  let skipped = 0

  for (const row of rows) {
    const translations: Record<string, string> = row.translations
      ? (typeof row.translations === 'string' ? JSON.parse(row.translations) : row.translations)
      : {}

    const fr = translations.fr?.trim()
    if (!fr) {
      console.warn(`⚠️  Option #${row.id} sans nom français, ignorée.`)
      skipped++
      continue
    }

    const missingLangs = ['en', 'pt', 'ru', 'ar', 'es'].filter((lang) => !translations[lang]?.trim())
    if (missingLangs.length === 0) {
      skipped++
      continue
    }

    const generated = await translateOptionName(fr)
    const toInsert = missingLangs
      .filter((lang) => generated[lang])
      .map((lang) => [row.id, lang, generated[lang]])

    if (toInsert.length === 0) {
      console.warn(`⚠️  Option #${row.id} ("${fr}") : traduction OpenAI vide ou échouée.`)
      skipped++
      continue
    }

    await pool.query(
      `INSERT INTO option_translations (option_id, language, name) VALUES ?
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [toInsert]
    )
    updated++
    console.log(`✓ Option #${row.id} ("${fr}") → ${toInsert.map(([, lang]) => lang).join(', ')}`)
  }

  console.log(`\nTerminé : ${updated} option(s) complétée(s), ${skipped} ignorée(s)/déjà complètes.`)
  await pool.end()
}

main().catch((err) => {
  console.error('Erreur pendant la traduction :', err)
  process.exit(1)
})
