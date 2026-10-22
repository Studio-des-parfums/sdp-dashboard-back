// Visio intégrée via Daily (daily.co) : salles privées créées à la demande, accès par jeton
// nominatif délivré par le serveur. Clé API : DAILY_API_KEY (server/.env, jamais côté front).
const DAILY_API = 'https://api.daily.co/v1'
/** Durée de vie d'une salle : au-delà, l'appel est considéré terminé et la salle se ferme. */
export const CALL_ROOM_TTL_SECONDS = 6 * 60 * 60

async function dailyRequest<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const key = process.env.DAILY_API_KEY
  if (!key) throw new Error('DAILY_API_KEY manquante')
  const res = await fetch(`${DAILY_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Daily ${path} : ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function createCallRoom(): Promise<{ name: string; url: string }> {
  const exp = Math.floor(Date.now() / 1000) + CALL_ROOM_TTL_SECONDS
  return dailyRequest('/rooms', {
    privacy: 'private',
    properties: {
      exp, eject_at_room_exp: true, enable_screenshare: true, enable_chat: true, enable_prejoin_ui: true,
      // La transcription (compte rendu IA) n'est conservée chez Daily que si cette option est active.
      enable_transcription_storage: true,
    },
  })
}

/** isOwner : propriétaire de la salle (celui qui lance l'appel) — seul à pouvoir démarrer la transcription. */
export async function createCallToken(roomName: string, userName: string, isOwner = false): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + CALL_ROOM_TTL_SECONDS
  const { token } = await dailyRequest<{ token: string }>('/meeting-tokens', {
    properties: { room_name: roomName, user_name: userName, exp, is_owner: isOwner },
  })
  return token
}

interface DailyTranscript {
  transcriptId: string
  status: 't_finished' | 't_in_progress' | 't_error' | 't_deleted'
  isVttAvailable: boolean
  created_at: string
}

export async function listRoomTranscripts(roomName: string): Promise<DailyTranscript[]> {
  const { data } = await dailyRequest<{ data: DailyTranscript[] }>(`/transcript?room_name=${encodeURIComponent(roomName)}&limit=100`)
  return data
}

/** Texte d'une transcription (fichier WebVTT) : horodatages retirés, "Nom: texte" par réplique. */
export async function getTranscriptText(transcriptId: string): Promise<string> {
  const access = await dailyRequest<{ link?: string; download_link?: string }>(`/transcript/${transcriptId}/access-link`)
  const link = access.link ?? access.download_link
  if (!link) throw new Error('Lien de transcription indisponible')
  const vtt = await (await fetch(link)).text()
  return vtt
    .split(/\r?\n/)
    .filter((line) => line.trim() && line.trim() !== 'WEBVTT' && !line.includes('-->') && !/^\d+$/.test(line.trim()))
    .map((line) => line.replace(/<v ([^>]+)>/g, '$1: ').replace(/<\/?[^>]+>/g, '').trim())
    .join('\n')
}

/** Arrête la transcription en cours dans une salle (fin de réunion) — sans effet si aucune ne tourne. */
export async function stopRoomTranscription(roomName: string): Promise<void> {
  await dailyRequest(`/rooms/${encodeURIComponent(roomName)}/transcription/stop`, {}).catch(() => {})
}

export async function deleteTranscript(transcriptId: string): Promise<void> {
  await dailyRequest(`/transcript/${transcriptId}`, undefined, 'DELETE').catch((err) => console.error('[daily] transcription non supprimée', err))
}

export function roomNameOf(callUrl: string): string {
  return callUrl.split('/').pop() ?? ''
}
