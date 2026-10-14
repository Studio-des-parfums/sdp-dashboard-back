// Script one-shot : complète les traductions manquantes (en, pt, ru, ar, es) de
// tous les ateliers existants qui ont déjà un nom français, via OpenAI.
// N'écrase jamais une traduction déjà présente en base.
//
// Usage : depuis server/, `npx tsx scripts/translate-all-ateliers.ts`

import 'dotenv/config'
import pool from '../db'
import { translateAtelierName } from '../services/translate'

async function main() {
  const [rows] = await pool.query<any[]>(`
    SELECT a.id, ${`(SELECT JSON_OBJECTAGG(t.language, t.name) FROM atelier_translations t WHERE t.atelier_id = a.id)`} AS translations
    FROM ateliers a
  `)

  let updated = 0
  let skipped = 0

  for (const row of rows) {
    const translations: Record<string, string> = row.translations
      ? (typeof row.translations === 'string' ? JSON.parse(row.translations) : row.translations)
      : {}

    const fr = translations.fr?.trim()
    if (!fr) {
      console.warn(`⚠️  Atelier #${row.id} sans nom français, ignoré.`)
      skipped++
      continue
    }

    const missingLangs = ['en', 'pt', 'ru', 'ar', 'es'].filter((lang) => !translations[lang]?.trim())
    if (missingLangs.length === 0) {
      skipped++
      continue
    }

    const generated = await translateAtelierName(fr)
    const toInsert = missingLangs
      .filter((lang) => generated[lang])
      .map((lang) => [row.id, lang, generated[lang]])

    if (toInsert.length === 0) {
      console.warn(`⚠️  Atelier #${row.id} ("${fr}") : traduction OpenAI vide ou échouée.`)
      skipped++
      continue
    }

    await pool.query(
      `INSERT INTO atelier_translations (atelier_id, language, name) VALUES ?
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [toInsert]
    )
    updated++
    console.log(`✓ Atelier #${row.id} ("${fr}") → ${toInsert.map(([, lang]) => lang).join(', ')}`)
  }

  console.log(`\nTerminé : ${updated} atelier(s) complété(s), ${skipped} ignoré(s)/déjà complets.`)
  await pool.end()
}

main().catch((err) => {
  console.error('Erreur pendant la traduction :', err)
  process.exit(1)
})
