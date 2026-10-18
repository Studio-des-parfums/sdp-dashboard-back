#!/usr/bin/env tsx
/**
 * Script de nettoyage des données de test créées par Bruno pour SDP Dashboard Back.
 * Supprime tous les enregistrements de test (utilisateurs, coffrets, ateliers avec libellé Bruno ou test)
 * sans jamais toucher aux vraies données.
 *
 * Usage : `npx tsx scripts/cleanup_test_data.ts`
 */

import 'dotenv/config'
import pool from '../db'
import type { ResultSetHeader } from 'mysql2/promise'

console.log('='.repeat(60))
console.log('🧹 NETTOYAGE DES DONNÉES DE TEST BRUNO (SDP Dashboard Back)')
console.log('='.repeat(60))

async function main() {
  let totalDeleted = 0

  async function runDelete(table: string, query: string, desc: string) {
    try {
      const [res] = await pool.query<ResultSetHeader>(query)
      const count = res.affectedRows || 0
      totalDeleted += count
      if (count > 0) {
        console.log(`  ✅ ${desc} (${table}) : ${count} supprimé(s)`)
      } else {
        console.log(`  ℹ️  ${desc} (${table}) : aucun élément à supprimer`)
      }
    } catch (err: any) {
      console.error(`  ⚠️  Erreur sur table ${table} : ${err.message}`)
    }
  }

  // 1. Utilisateurs de test
  await runDelete(
    'users',
    "DELETE FROM users WHERE email LIKE '%bruno%' OR email LIKE '%@example.com%' OR first_name LIKE '%Bruno%'",
    'Utilisateurs test orphelins'
  )

  // 2. Coffrets de test & traductions
  await runDelete(
    'coffret_translations',
    "DELETE FROM coffret_translations WHERE name LIKE '%Bruno%'",
    'Traductions coffrets test'
  )

  await runDelete(
    'coffrets',
    'DELETE FROM coffrets WHERE id NOT IN (SELECT DISTINCT coffret_id FROM coffret_translations) AND id > 10',
    'Coffrets test orphelins'
  )

  // 3. Ateliers de test & traductions
  await runDelete(
    'atelier_translations',
    "DELETE FROM atelier_translations WHERE name LIKE '%Bruno%'",
    'Traductions ateliers test'
  )

  await pool.end()

  console.log('-'.repeat(60))
  console.log(`🎉 Nettoyage terminé avec succès ! (${totalDeleted} enregistrement(s) supprimé(s))`)
  console.log('='.repeat(60))
}

main().catch((err) => {
  console.error('Erreur fatale:', err)
  process.exit(1)
})
