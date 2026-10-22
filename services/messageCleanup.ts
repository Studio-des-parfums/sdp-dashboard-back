import pool from '../db'
import { deleteMessageFile } from './s3'

export const MESSAGE_RETENTION_DAYS = 30
const PURGE_BATCH = 500

interface MessageFiles {
  id: number
  audio_key: string | null
  attachment_key: string | null
}

// Supprime des messages en base ET leurs fichiers S3 (vocaux, pièces jointes), pour ne rien
// laisser traîner dans le stockage. Un fichier introuvable ne bloque pas la suppression.
export async function deleteMessages(messages: MessageFiles[]): Promise<void> {
  if (messages.length === 0) return
  const keys = messages.flatMap((m) => [m.audio_key, m.attachment_key]).filter((k): k is string => !!k)
  await Promise.all(keys.map((key) => deleteMessageFile(key).catch((err) => console.error('[messages] fichier S3 non supprimé', key, err))))
  await pool.query('DELETE FROM messages WHERE id IN (?)', [messages.map((m) => m.id)])
}

// Les messages ne sont conservés que 30 jours : purge par lots (au démarrage puis chaque jour).
export async function purgeOldMessages(): Promise<void> {
  try {
    for (;;) {
      const [rows] = await pool.query<any[]>(
        'SELECT id, audio_key, attachment_key FROM messages WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT ?',
        [MESSAGE_RETENTION_DAYS, PURGE_BATCH]
      )
      await deleteMessages(rows)
      if (rows.length < PURGE_BATCH) break
    }
  } catch (err) {
    console.error('[messages] erreur purge', err)
  }
}
