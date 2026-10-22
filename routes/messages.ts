import { Router, Request, Response } from 'express'
import pool from '../db'
import multer from 'multer'
import { emitToUser } from '../services/socket'
import { deleteMessages } from '../services/messageCleanup'
import { createCallRoom, createCallToken, roomNameOf, CALL_ROOM_TTL_SECONDS, listRoomTranscripts, getTranscriptText, deleteTranscript, stopRoomTranscription } from '../services/daily'
import { summarizeMeeting } from '../services/meetingSummary'
import { uploadVoiceMessage, getVoiceMessageUrl, uploadMessageAttachment, getMessageAttachmentUrls } from '../services/s3'

const VOICE_LABEL = '🎤 Message vocal'
// ~5 min d'audio opus : largement au-dessus d'un vocal normal.
const voiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })
const attachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

function isAllowedAttachment(mimetype: string): boolean {
  return mimetype.startsWith('image/') || mimetype === 'application/pdf'
}

interface MediaColumns {
  audio_key?: string | null
  attachment_key?: string | null
  attachment_name?: string | null
  attachment_type?: string | null
}

// Ajoute les URL pré-signées : écoute des vocaux, aperçu/téléchargement des pièces jointes.
async function withMediaUrls<T extends MediaColumns>(rows: T[]) {
  return Promise.all(rows.map(async (m) => ({
    ...m,
    audio_url: m.audio_key ? await getVoiceMessageUrl(m.audio_key) : null,
    attachment: m.attachment_key
      ? { name: m.attachment_name ?? 'fichier', type: m.attachment_type ?? '', ...(await getMessageAttachmentUrls(m.attachment_key, m.attachment_name ?? 'fichier', m.attachment_type ?? 'application/octet-stream')) }
      : null,
  })))
}

const router = Router()

async function getUserFromRequest(req: Request) {
  const email = req.headers['x-user-email'] as string | undefined
  if (!email) return null
  const [rows] = await pool.query<any[]>(
    `SELECT u.id, u.email, u.first_name, u.last_name, r.name as role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.email = ? AND u.is_active = TRUE`,
    [email]
  )
  return rows[0] || null
}

// Liste des conversations de l'utilisateur : un dernier message par interlocuteur,
// trié par date décroissante, avec le nombre de non-lus par conversation.
router.get('/messages/conversations', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }

    const [rows] = await pool.query<any[]>(
      `SELECT
         other.id as user_id,
         other.first_name,
         other.last_name,
         other.email,
         last_msg.content as last_message,
         last_msg.created_at as last_message_at,
         last_msg.sender_id as last_message_sender_id,
         COALESCE(unread.count, 0) as unread_count
       FROM users other
       JOIN (
         SELECT
           CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as other_id,
           MAX(id) as last_id
         FROM messages
         WHERE group_id IS NULL AND (sender_id = ? OR receiver_id = ?)
         GROUP BY other_id
       ) conv ON conv.other_id = other.id
       JOIN messages last_msg ON last_msg.id = conv.last_id
       LEFT JOIN (
         SELECT sender_id, COUNT(*) as count
         FROM messages
         WHERE receiver_id = ? AND is_read = FALSE
         GROUP BY sender_id
       ) unread ON unread.sender_id = other.id
       ORDER BY last_msg.created_at DESC`,
      [user.id, user.id, user.id, user.id]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des conversations' })
  }
})

// Liste des utilisateurs actifs (pour démarrer une nouvelle conversation).
router.get('/messages/contacts', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const [rows] = await pool.query<any[]>(
      `SELECT id, first_name, last_name, email
       FROM users
       WHERE is_active = TRUE AND id != ?
       ORDER BY first_name, last_name`,
      [user.id]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des contacts' })
  }
})

// Compteur global de messages non lus (pour le badge de la topbar).
router.get('/messages/unread-count', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const [rows] = await pool.query<any[]>(
      `SELECT
         (SELECT COUNT(*) FROM messages WHERE receiver_id = ? AND is_read = FALSE)
         + (SELECT COUNT(*) FROM messages m
            JOIN message_group_members gm ON gm.group_id = m.group_id AND gm.user_id = ?
            WHERE m.sender_id <> ? AND m.id > COALESCE(gm.last_read_message_id, 0)) AS count`,
      [user.id, user.id, user.id]
    )
    res.json({ count: Number(rows[0].count) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors du comptage des messages' })
  }
})

// Historique des messages échangés avec un utilisateur donné.
router.get('/messages/:userId', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const otherId = Number(req.params.userId)
    if (!Number.isInteger(otherId)) {
      res.status(400).json({ error: 'Identifiant invalide' })
      return
    }
    // ASC + LIMIT tronquerait les messages les plus récents dans une longue conversation
    // (ex: une réponse qu'on vient d'envoyer n'apparaîtrait plus) — on prend donc les 200
    // derniers par date décroissante, puis on les remet dans l'ordre chronologique.
    const [rows] = await pool.query<any[]>(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
         ORDER BY created_at DESC
         LIMIT 200
       ) recent
       ORDER BY created_at ASC`,
      [user.id, otherId, otherId, user.id]
    )
    res.json(await withMediaUrls(rows))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des messages' })
  }
})

interface SendTarget {
  receiverId: number | null
  groupId: number | null
  /** Personnes à prévenir en temps réel (l'expéditeur exclu). */
  recipientIds: number[]
}

// Destinataire d'un envoi : un collègue (receiverId) ou un groupe dont on est membre (groupId).
async function resolveTarget(body: Record<string, unknown>, userId: number): Promise<SendTarget | null> {
  const groupId = Number(body.groupId)
  if (groupId) {
    const [members] = await pool.query<any[]>('SELECT user_id FROM message_group_members WHERE group_id = ?', [groupId])
    if (!members.some((m) => m.user_id === userId)) return null
    return { receiverId: null, groupId, recipientIds: members.map((m) => m.user_id).filter((id) => id !== userId) }
  }
  const receiverId = Number(body.receiverId)
  if (!receiverId) return null
  return { receiverId, groupId: null, recipientIds: [receiverId] }
}

// Enregistre le message, le pousse en temps réel aux destinataires, et (groupe) avance le
// pointeur de lecture de l'expéditeur pour que son propre message ne compte pas en non-lu.
async function insertAndBroadcast(user: { id: number; first_name: string; last_name: string }, target: SendTarget, columns: Record<string, unknown>) {
  const values: Record<string, unknown> = { sender_id: user.id, receiver_id: target.receiverId, group_id: target.groupId, ...columns }
  const keys = Object.keys(values)
  const [result] = await pool.query<any>(
    `INSERT INTO messages (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    Object.values(values)
  )
  const [rows] = await pool.query<any[]>('SELECT * FROM messages WHERE id = ?', [result.insertId])
  const [message] = await withMediaUrls(rows)
  const payload = { ...message, sender_first_name: user.first_name, sender_last_name: user.last_name }
  for (const id of target.recipientIds) emitToUser(id, 'new_message', payload)
  if (target.groupId) {
    await pool.query('UPDATE message_group_members SET last_read_message_id = ? WHERE group_id = ? AND user_id = ?', [message.id, target.groupId, user.id])
  }
  return payload
}

// Envoi d'un message texte à un collègue (receiverId) ou à un groupe (groupId).
router.post('/messages', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : ''
    const target = await resolveTarget(req.body, user.id)
    if (!target || !content) {
      res.status(400).json({ error: 'Destinataire et contenu requis' })
      return
    }
    res.status(201).json(await insertAndBroadcast(user, target, { content }))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de l'envoi du message" })
  }
})

// Message vocal : fichier audio (champ "audio") + receiverId ou groupId + duration (secondes).
router.post('/messages/voice', voiceUpload.single('audio'), async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const target = await resolveTarget(req.body, user.id)
    const duration = Math.max(0, Math.round(Number(req.body.duration) || 0))
    if (!target || !req.file || !req.file.mimetype.startsWith('audio/')) {
      res.status(400).json({ error: 'Destinataire et fichier audio requis' })
      return
    }
    const audioKey = await uploadVoiceMessage(user.id, req.file.buffer, req.file.mimetype)
    res.status(201).json(await insertAndBroadcast(user, target, { content: VOICE_LABEL, audio_key: audioKey, audio_duration: duration }))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de l'envoi du message vocal" })
  }
})

// Pièce jointe (image ou PDF, champ "file") + receiverId ou groupId + légende optionnelle (caption).
router.post('/messages/attachment', attachmentUpload.single('file'), async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const target = await resolveTarget(req.body, user.id)
    const file = req.file
    if (!target || !file) {
      res.status(400).json({ error: 'Destinataire et fichier requis' })
      return
    }
    if (!isAllowedAttachment(file.mimetype)) {
      res.status(400).json({ error: 'Seules les images et les PDF peuvent être envoyés' })
      return
    }
    // multer décode le nom en latin1 : on le ré-encode en UTF-8 (accents).
    const filename = Buffer.from(file.originalname, 'latin1').toString('utf8')
    const caption = typeof req.body.caption === 'string' ? req.body.caption.trim() : ''
    const content = caption || (file.mimetype.startsWith('image/') ? '📷 Image' : `📄 ${filename}`)
    const key = await uploadMessageAttachment(user.id, file.buffer, filename, file.mimetype)
    res.status(201).json(await insertAndBroadcast(user, target, {
      content, attachment_key: key, attachment_name: filename, attachment_type: file.mimetype, attachment_size: file.size,
    }))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de l'envoi du fichier" })
  }
})

// ─────────────────────── APPELS VISIO (Daily) ───────────────────────

const CALL_LABEL = '📹 Appel visio'

// Lance un appel dans une conversation (collègue ou groupe) : salle privée + message d'invitation.
router.post('/calls', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const target = await resolveTarget(req.body, user.id)
    if (!target) {
      res.status(400).json({ error: 'Destinataire requis' })
      return
    }
    const room = await createCallRoom()
    const message = await insertAndBroadcast(user, target, { content: CALL_LABEL, call_url: room.url })
    // Celui qui lance l'appel en est propriétaire : lui seul peut activer le compte rendu IA.
    const token = await createCallToken(room.name, `${user.first_name} ${user.last_name}`, true)
    res.status(201).json({ message, url: room.url, token })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Impossible de lancer l'appel" })
  }
})

// Appel (message d'invitation) accessible à l'utilisateur : membre de la conversation où il a été lancé.
async function callForUser(callUrl: unknown, userId: number): Promise<{ call: any } | { status: number; error: string }> {
  const [[call]] = await pool.query<any[]>(
    'SELECT sender_id, receiver_id, group_id, call_url, created_at FROM messages WHERE call_url = ? LIMIT 1',
    [callUrl]
  )
  if (!call) return { status: 404, error: 'Appel introuvable' }
  const allowed = call.group_id
    ? (await pool.query<any[]>('SELECT 1 FROM message_group_members WHERE group_id = ? AND user_id = ?', [call.group_id, userId]))[0].length > 0
    : call.sender_id === userId || call.receiver_id === userId
  return allowed ? { call } : { status: 403, error: 'Vous ne faites pas partie de cet appel' }
}

// Rejoindre un appel : jeton délivré uniquement aux membres de la conversation où il a été lancé.
router.post('/calls/join', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const access = await callForUser(req.body.callUrl, user.id)
    if ('error' in access) {
      res.status(access.status).json({ error: access.error })
      return
    }
    const { call } = access
    if (Date.now() - new Date(call.created_at).getTime() > CALL_ROOM_TTL_SECONDS * 1000) {
      res.status(410).json({ error: 'Cet appel est terminé' })
      return
    }
    const token = await createCallToken(roomNameOf(call.call_url), `${user.first_name} ${user.last_name}`)
    res.json({ url: call.call_url, token })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Impossible de rejoindre l'appel" })
  }
})

// ─────────────────────── COMPTE RENDU DE RÉUNION (IA) ───────────────────────

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Appels dont le compte rendu est en cours de génération (évite les doublons si deux clics). */
const summariesInProgress = new Set<string>()

// Fin de réunion : on arrête la transcription puis on attend que Daily l'ait finalisée (~1 min max).
async function waitForFinishedTranscripts(roomName: string) {
  await stopRoomTranscription(roomName)
  for (let attempt = 0; attempt < 20; attempt++) {
    const transcripts = await listRoomTranscripts(roomName)
    const inProgress = transcripts.some((t) => t.status === 't_in_progress')
    const finished = transcripts.filter((t) => t.status === 't_finished' && t.isVttAvailable)
    if (!inProgress && finished.length > 0) {
      return finished.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    if (!inProgress && transcripts.length === 0 && attempt >= 5) return []
    await wait(3000)
  }
  return null
}

/** Membres d'une conversation (pour les droits et le temps réel). */
async function conversationMemberIds(message: { sender_id: number; receiver_id: number | null; group_id: number | null }): Promise<number[]> {
  if (message.group_id) {
    const [rows] = await pool.query<any[]>('SELECT user_id FROM message_group_members WHERE group_id = ?', [message.group_id])
    return rows.map((r) => r.user_id)
  }
  return [message.sender_id, message.receiver_id].filter((id): id is number => !!id)
}

// Compte rendu IA d'un appel : transcription(s) Daily → résumé + tâches (OpenAI) → message dans
// la conversation. Une seule fois par appel ; la transcription est ensuite supprimée chez Daily.
// Déclenché automatiquement quand le propriétaire quitte l'appel (ou manuellement en secours).
router.post('/calls/summary', async (req: Request, res: Response) => {
  let lockedCall: string | null = null
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const access = await callForUser(req.body.callUrl, user.id)
    if ('error' in access) {
      res.status(access.status).json({ error: access.error })
      return
    }
    const { call } = access
    const [existing] = await pool.query<any[]>('SELECT id FROM messages WHERE summary_for_call = ? LIMIT 1', [call.call_url])
    if (existing.length > 0 || summariesInProgress.has(call.call_url)) {
      res.status(409).json({ error: 'Le résumé de cette réunion est déjà généré (ou en cours)' })
      return
    }
    summariesInProgress.add(call.call_url)
    lockedCall = call.call_url

    const finished = await waitForFinishedTranscripts(roomNameOf(call.call_url))
    if (finished === null) {
      res.status(409).json({ error: 'La transcription est encore en cours : réessayez dans un instant' })
      return
    }
    if (finished.length === 0) {
      res.status(404).json({ error: "Aucune transcription : le compte rendu IA n'a pas été activé pendant l'appel" })
      return
    }
    const transcript = (await Promise.all(finished.map((t) => getTranscriptText(t.transcriptId)))).join('\n')
    if (!transcript.trim()) {
      res.status(422).json({ error: "La transcription est vide : personne n'a parlé pendant l'enregistrement" })
      return
    }

    // Tous les utilisateurs actifs (et leurs équipes) : l'IA attribue chaque tâche à la bonne personne.
    const [userRows] = await pool.query<any[]>(
      `SELECT u.id, u.first_name, u.last_name, GROUP_CONCAT(ut.team_slug) AS teams
       FROM users u LEFT JOIN user_teams ut ON ut.user_id = u.id
       WHERE u.is_active = TRUE GROUP BY u.id`
    )
    const users = userRows.map((u) => ({ id: u.id, name: `${u.first_name} ${u.last_name}`, teams: u.teams ? String(u.teams).split(',') : [] }))
    const memberIds = await conversationMemberIds(call)
    const participants = users.filter((u) => memberIds.includes(u.id)).map((u) => u.name)
    const { summary, tasks } = await summarizeMeeting(transcript, participants, users)

    const otherId = call.sender_id === user.id ? call.receiver_id : call.sender_id
    const target: SendTarget = call.group_id
      ? (await resolveTarget({ groupId: call.group_id }, user.id))!
      : { receiverId: otherId, groupId: null, recipientIds: [otherId] }
    const message = await insertAndBroadcast(user, target, {
      content: '📝 Résumé de la réunion',
      summary_for_call: call.call_url,
      call_summary: JSON.stringify(summary),
    })
    if (tasks.length > 0) {
      await pool.query(
        'INSERT INTO meeting_tasks (message_id, title, description, assignee_ids, team_slug, deadline, priority) VALUES ?',
        [tasks.map((t) => [message.id, t.title, t.description, JSON.stringify(t.assigneeIds), t.teamSlug, t.deadline, t.priority])]
      )
    }
    await Promise.all(finished.map((t) => deleteTranscript(t.transcriptId)))
    res.status(201).json({ ...message, call_summary: summary })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Impossible de générer le résumé de la réunion' })
  } finally {
    if (lockedCall) summariesInProgress.delete(lockedCall)
  }
})

// Message de compte rendu accessible à l'utilisateur (membre de la conversation).
async function summaryMessageForUser(messageId: number, userId: number) {
  const [[message]] = await pool.query<any[]>(
    'SELECT id, sender_id, receiver_id, group_id, call_summary, created_at FROM messages WHERE id = ? AND summary_for_call IS NOT NULL',
    [messageId]
  )
  if (!message) return null
  const memberIds = await conversationMemberIds(message)
  return memberIds.includes(userId) ? { message, memberIds } : null
}

function serializeTask(t: any) {
  return {
    ...t,
    assignee_ids: typeof t.assignee_ids === 'string' ? JSON.parse(t.assignee_ids) : t.assignee_ids,
    deadline: t.deadline ? new Intl.DateTimeFormat('sv-SE').format(new Date(t.deadline)) : null,
  }
}

async function loadMeetingTasks(messageId: number) {
  const [rows] = await pool.query<any[]>('SELECT * FROM meeting_tasks WHERE message_id = ? ORDER BY id', [messageId])
  return rows.map(serializeTask)
}

/** Les autres participants rechargent les tâches (modale ouverte) en temps réel. */
function broadcastMeetingTasks(memberIds: number[], actorId: number, messageId: number) {
  for (const id of memberIds) if (id !== actorId) emitToUser(id, 'meeting_tasks_updated', { message_id: messageId })
}

// Résumé complet + tâches détectées (pour la modale).
router.get('/meeting-summaries/:messageId', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const access = await summaryMessageForUser(Number(req.params.messageId), user.id)
    if (!access) {
      res.status(404).json({ error: 'Résumé introuvable' })
      return
    }
    res.json({ summary: access.message.call_summary, created_at: access.message.created_at, tasks: await loadMeetingTasks(access.message.id) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération du résumé' })
  }
})

async function meetingTaskForUser(taskId: number, userId: number) {
  const [[task]] = await pool.query<any[]>('SELECT * FROM meeting_tasks WHERE id = ?', [taskId])
  if (!task) return null
  const access = await summaryMessageForUser(task.message_id, userId)
  return access ? { task: serializeTask(task), memberIds: access.memberIds } : null
}

// Correction d'une tâche proposée (titre, description, assignés, équipe, échéance, priorité).
router.put('/meeting-tasks/:id', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const access = await meetingTaskForUser(Number(req.params.id), user.id)
    if (!access) {
      res.status(404).json({ error: 'Tâche introuvable' })
      return
    }
    if (access.task.status !== 'proposee') {
      res.status(409).json({ error: 'Cette tâche a déjà été traitée' })
      return
    }
    const { title, description, assignee_ids, team_slug, deadline, priority } = req.body
    const fields: string[] = []
    const values: unknown[] = []
    if (typeof title === 'string' && title.trim()) { fields.push('title = ?'); values.push(title.trim().slice(0, 255)) }
    if (typeof description === 'string') { fields.push('description = ?'); values.push(description) }
    if (Array.isArray(assignee_ids)) { fields.push('assignee_ids = ?'); values.push(JSON.stringify(await activeUserIds(assignee_ids))) }
    if (team_slug !== undefined) { fields.push('team_slug = ?'); values.push(team_slug || null) }
    if (deadline !== undefined) { fields.push('deadline = ?'); values.push(/^\d{4}-\d{2}-\d{2}$/.test(deadline ?? '') ? deadline : null) }
    if (['basse', 'moyenne', 'haute', 'urgente'].includes(priority)) { fields.push('priority = ?'); values.push(priority) }
    if (fields.length > 0) await pool.query(`UPDATE meeting_tasks SET ${fields.join(', ')} WHERE id = ?`, [...values, access.task.id])
    const [[updated]] = await pool.query<any[]>('SELECT * FROM meeting_tasks WHERE id = ?', [access.task.id])
    broadcastMeetingTasks(access.memberIds, user.id, access.task.message_id)
    res.json(serializeTask(updated))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la tâche' })
  }
})

// Tâche ajoutée dans Polux (créée par le front avec l'identité de l'utilisateur) : on la marque acceptée.
router.post('/meeting-tasks/:id/accept', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const access = await meetingTaskForUser(Number(req.params.id), user.id)
    if (!access) {
      res.status(404).json({ error: 'Tâche introuvable' })
      return
    }
    await pool.query(
      "UPDATE meeting_tasks SET status = 'acceptee', decided_by = ?, polux_task_id = ? WHERE id = ? AND status = 'proposee'",
      [user.id, Number(req.body.poluxTaskId) || null, access.task.id]
    )
    const [[updated]] = await pool.query<any[]>('SELECT * FROM meeting_tasks WHERE id = ?', [access.task.id])
    broadcastMeetingTasks(access.memberIds, user.id, access.task.message_id)
    res.json(serializeTask(updated))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de l'acceptation de la tâche" })
  }
})

// Refus : retire l'utilisateur des assignés ; la tâche est refusée quand il n'en reste plus
// (ou directement si l'utilisateur n'en faisait pas partie, ex. le responsable qui l'écarte).
router.post('/meeting-tasks/:id/reject', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const access = await meetingTaskForUser(Number(req.params.id), user.id)
    if (!access) {
      res.status(404).json({ error: 'Tâche introuvable' })
      return
    }
    if (access.task.status !== 'proposee') {
      res.status(409).json({ error: 'Cette tâche a déjà été traitée' })
      return
    }
    const remaining = (access.task.assignee_ids as number[]).filter((id) => id !== user.id)
    const wasAssigned = remaining.length < access.task.assignee_ids.length
    if (wasAssigned && remaining.length > 0) {
      await pool.query('UPDATE meeting_tasks SET assignee_ids = ? WHERE id = ?', [JSON.stringify(remaining), access.task.id])
    } else {
      await pool.query("UPDATE meeting_tasks SET status = 'refusee', decided_by = ?, assignee_ids = ? WHERE id = ?", [user.id, JSON.stringify(remaining), access.task.id])
    }
    const [[updated]] = await pool.query<any[]>('SELECT * FROM meeting_tasks WHERE id = ?', [access.task.id])
    broadcastMeetingTasks(access.memberIds, user.id, access.task.message_id)
    res.json(serializeTask(updated))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors du refus de la tâche' })
  }
})

// Suppression d'un message par son expéditeur, tant que personne n'a répondu après lui
// (l'interlocuteur, ou un autre membre du groupe). Supprime aussi son fichier S3 et prévient
// les destinataires en temps réel.
router.delete('/messages/:id', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const [[message]] = await pool.query<any[]>(
      'SELECT id, sender_id, receiver_id, group_id, audio_key, attachment_key FROM messages WHERE id = ?',
      [req.params.id]
    )
    if (!message) {
      res.status(404).json({ error: 'Message introuvable' })
      return
    }
    if (message.sender_id !== user.id) {
      res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres messages' })
      return
    }
    const [replies] = message.group_id
      ? await pool.query<any[]>('SELECT 1 FROM messages WHERE group_id = ? AND sender_id <> ? AND id > ? LIMIT 1', [message.group_id, user.id, message.id])
      : await pool.query<any[]>('SELECT 1 FROM messages WHERE sender_id = ? AND receiver_id = ? AND id > ? LIMIT 1', [message.receiver_id, user.id, message.id])
    if (replies.length > 0) {
      res.status(403).json({ error: 'Impossible de supprimer un message auquel quelqu\'un a déjà répondu' })
      return
    }
    const recipients = message.group_id
      ? (await pool.query<any[]>('SELECT user_id FROM message_group_members WHERE group_id = ? AND user_id <> ?', [message.group_id, user.id]))[0].map((m: any) => m.user_id)
      : [message.receiver_id]
    await deleteMessages([message])
    for (const id of recipients) emitToUser(id, 'message_deleted', { id: message.id, sender_id: user.id, group_id: message.group_id })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la suppression du message' })
  }
})

// Marque tous les messages d'un interlocuteur comme lus.
router.put('/messages/:userId/read', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const otherId = Number(req.params.userId)
    await pool.query(
      'UPDATE messages SET is_read = TRUE WHERE sender_id = ? AND receiver_id = ? AND is_read = FALSE',
      [otherId, user.id]
    )
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour des messages' })
  }
})

// ─────────────────────── GROUPES ───────────────────────

async function groupMemberIds(groupId: number): Promise<number[]> {
  const [rows] = await pool.query<any[]>('SELECT user_id FROM message_group_members WHERE group_id = ?', [groupId])
  return rows.map((r) => r.user_id)
}

async function activeUserIds(ids: unknown): Promise<number[]> {
  const wanted = Array.isArray(ids) ? ids.map(Number).filter((id) => Number.isInteger(id) && id > 0) : []
  if (wanted.length === 0) return []
  const [rows] = await pool.query<any[]>('SELECT id FROM users WHERE id IN (?) AND is_active = TRUE', [wanted])
  return rows.map((r) => r.id)
}

/** Prévient les membres (liste à jour) qu'un groupe a changé : ils rechargent leurs conversations. */
function broadcastGroup(memberIds: number[], event: 'group_updated' | 'group_deleted', groupId: number) {
  for (const id of memberIds) emitToUser(id, event, { group_id: groupId })
}

// Groupes de l'utilisateur, avec membres, dernier message et nombre de non-lus.
router.get('/message-groups', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const [groups] = await pool.query<any[]>(
      `SELECT g.id, g.name, g.owner_id, g.created_at
       FROM message_groups g JOIN message_group_members gm ON gm.group_id = g.id AND gm.user_id = ?`,
      [user.id]
    )
    if (groups.length === 0) {
      res.json([])
      return
    }
    const ids = groups.map((g) => g.id)
    const [members] = await pool.query<any[]>(
      `SELECT gm.group_id, u.id, u.first_name, u.last_name FROM message_group_members gm
       JOIN users u ON u.id = gm.user_id WHERE gm.group_id IN (?) ORDER BY u.first_name, u.last_name`,
      [ids]
    )
    const [lastMessages] = await pool.query<any[]>(
      `SELECT m.group_id, m.content, m.created_at, m.sender_id, u.first_name AS sender_first_name
       FROM messages m
       JOIN (SELECT group_id, MAX(id) AS id FROM messages WHERE group_id IN (?) GROUP BY group_id) l ON l.id = m.id
       JOIN users u ON u.id = m.sender_id`,
      [ids]
    )
    const [unread] = await pool.query<any[]>(
      `SELECT m.group_id, COUNT(*) AS count FROM messages m
       JOIN message_group_members gm ON gm.group_id = m.group_id AND gm.user_id = ?
       WHERE m.group_id IN (?) AND m.sender_id <> ? AND m.id > COALESCE(gm.last_read_message_id, 0)
       GROUP BY m.group_id`,
      [user.id, ids, user.id]
    )
    const result = groups.map((g) => {
      const last = lastMessages.find((m) => m.group_id === g.id)
      return {
        ...g,
        members: members.filter((m) => m.group_id === g.id).map(({ id, first_name, last_name }) => ({ id, first_name, last_name })),
        last_message: last ? `${last.sender_id === user.id ? 'Vous' : last.sender_first_name} : ${last.content}` : null,
        last_message_at: last?.created_at ?? null,
        unread_count: Number(unread.find((u) => u.group_id === g.id)?.count ?? 0),
      }
    })
    result.sort((a, b) => new Date(b.last_message_at ?? b.created_at).getTime() - new Date(a.last_message_at ?? a.created_at).getTime())
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des groupes' })
  }
})

// Création : nom + participants ; le créateur en est membre et propriétaire.
router.post('/message-groups', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 100) : ''
    const memberIds = (await activeUserIds(req.body.memberIds)).filter((id) => id !== user.id)
    // Un groupe compte au moins 3 personnes (le créateur + 2) ; à deux, c'est une discussion privée.
    if (!name || memberIds.length < 2) {
      res.status(400).json({ error: 'Nom du groupe et au moins 2 participants requis' })
      return
    }
    const [result] = await pool.query<any>('INSERT INTO message_groups (name, owner_id) VALUES (?, ?)', [name, user.id])
    const groupId = result.insertId
    await pool.query('INSERT INTO message_group_members (group_id, user_id) VALUES ?', [[user.id, ...memberIds].map((id) => [groupId, id])])
    broadcastGroup(memberIds, 'group_updated', groupId)
    res.status(201).json({ id: groupId })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la création du groupe' })
  }
})

async function ownedGroup(groupId: number, userId: number) {
  const [[group]] = await pool.query<any[]>('SELECT id, owner_id FROM message_groups WHERE id = ?', [groupId])
  if (!group) return { error: 404, message: 'Groupe introuvable' }
  if (group.owner_id !== userId) return { error: 403, message: 'Réservé au propriétaire du groupe' }
  return { group }
}

// Ajout de participants (propriétaire). Les messages déjà échangés ne leur comptent pas en non-lus.
router.post('/message-groups/:id/members', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const groupId = Number(req.params.id)
    const check = await ownedGroup(groupId, user.id)
    if ('error' in check) {
      res.status(check.error as number).json({ error: check.message })
      return
    }
    const userIds = await activeUserIds(req.body.userIds)
    if (userIds.length === 0) {
      res.status(400).json({ error: 'Aucun participant à ajouter' })
      return
    }
    const [[{ lastId }]] = await pool.query<any[]>('SELECT MAX(id) AS lastId FROM messages WHERE group_id = ?', [groupId])
    await pool.query(
      'INSERT IGNORE INTO message_group_members (group_id, user_id, last_read_message_id) VALUES ?',
      [userIds.map((id) => [groupId, id, lastId ?? null])]
    )
    broadcastGroup(await groupMemberIds(groupId), 'group_updated', groupId)
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de l'ajout des participants" })
  }
})

// Transfert de la propriété (lead) à un autre membre du groupe.
router.put('/message-groups/:id/owner', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const groupId = Number(req.params.id)
    const check = await ownedGroup(groupId, user.id)
    if ('error' in check) {
      res.status(check.error as number).json({ error: check.message })
      return
    }
    const newOwnerId = Number(req.body.userId)
    const memberIds = await groupMemberIds(groupId)
    if (!memberIds.includes(newOwnerId)) {
      res.status(400).json({ error: 'Le nouveau propriétaire doit être membre du groupe' })
      return
    }
    await pool.query('UPDATE message_groups SET owner_id = ? WHERE id = ?', [newOwnerId, groupId])
    broadcastGroup(memberIds, 'group_updated', groupId)
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors du transfert du groupe' })
  }
})

// Suppression du groupe (propriétaire) : ses messages et leurs fichiers S3 disparaissent aussi.
router.delete('/message-groups/:id', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const groupId = Number(req.params.id)
    const check = await ownedGroup(groupId, user.id)
    if ('error' in check) {
      res.status(check.error as number).json({ error: check.message })
      return
    }
    const memberIds = await groupMemberIds(groupId)
    const [messages] = await pool.query<any[]>('SELECT id, audio_key, attachment_key FROM messages WHERE group_id = ?', [groupId])
    await deleteMessages(messages)
    await pool.query('DELETE FROM message_groups WHERE id = ?', [groupId])
    broadcastGroup(memberIds.filter((id) => id !== user.id), 'group_deleted', groupId)
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la suppression du groupe' })
  }
})

// Historique d'un groupe (membres uniquement) : 200 derniers messages, avec le nom de l'auteur.
router.get('/message-groups/:id/messages', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    const groupId = Number(req.params.id)
    if (!(await groupMemberIds(groupId)).includes(user.id)) {
      res.status(403).json({ error: "Vous n'êtes pas membre de ce groupe" })
      return
    }
    const [rows] = await pool.query<any[]>(
      `SELECT * FROM (
         SELECT m.*, u.first_name AS sender_first_name, u.last_name AS sender_last_name
         FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE m.group_id = ?
         ORDER BY m.id DESC
         LIMIT 200
       ) recent
       ORDER BY id ASC`,
      [groupId]
    )
    res.json(await withMediaUrls(rows))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des messages du groupe' })
  }
})

// Marque le groupe comme lu jusqu'au dernier message.
router.put('/message-groups/:id/read', async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }
    await pool.query(
      `UPDATE message_group_members
       SET last_read_message_id = (SELECT MAX(id) FROM messages WHERE group_id = ?)
       WHERE group_id = ? AND user_id = ?`,
      [req.params.id, req.params.id, user.id]
    )
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour du groupe' })
  }
})

export default router
