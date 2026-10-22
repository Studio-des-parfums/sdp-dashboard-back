// Compte rendu IA d'une réunion à partir de sa transcription, via OpenAI (même clé et même
// approche que services/translate.ts). Le modèle renvoie un JSON structuré : résumé, sujets
// (qui a dit quoi et pourquoi), décisions, et tâches attribuées aux utilisateurs connus.

export type TaskPriority = 'basse' | 'moyenne' | 'haute' | 'urgente'

export interface MeetingSummary {
  titre: string
  resume: string
  sujets: Array<{ titre: string; points: Array<{ auteur: string | null; texte: string }> }>
  decisions: string[]
}

export interface DetectedTask {
  title: string
  description: string
  assigneeIds: number[]
  teamSlug: string | null
  /** YYYY-MM-DD */
  deadline: string | null
  priority: TaskPriority
}

export interface KnownUser {
  id: number
  name: string
  teams: string[]
}

import { resolveFrenchDeadline } from './frenchDeadline'

// Une transcription d'1h fait ~10 000 mots : on borne pour rester dans la fenêtre du modèle.
const MAX_TRANSCRIPT_CHARS = 120_000
const PRIORITIES: TaskPriority[] = ['basse', 'moyenne', 'haute', 'urgente']
const MODEL = process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini'

const isoDate = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(d)
const dayLabel = (d: Date) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)

/**
 * Date de la réunion (Paris) + calendrier des 6 semaines suivantes. Le modèle se trompe en
 * calculant lui-même "vendredi" ou "fin du mois" : il n'a plus qu'à lire la bonne ligne.
 */
function meetingCalendar(): { label: string; calendar: string } {
  const now = new Date()
  const days = Array.from({ length: 42 }, (_, i) => new Date(now.getTime() + i * 86_400_000))
  return {
    label: `${dayLabel(now)} (${isoDate(now)})`,
    calendar: days.map((d, i) => `${isoDate(d)} : ${dayLabel(d)}${i === 0 ? " (aujourd'hui)" : i === 1 ? ' (demain)' : ''}`).join('\n'),
  }
}

const SYSTEM_PROMPT = [
  "Tu rédiges le compte rendu d'une réunion interne d'entreprise, en français, à partir de sa transcription automatique (chaque ligne est \"Nom: propos\" ; la reconnaissance vocale peut contenir des erreurs).",
  'Réponds uniquement avec un objet JSON de la forme :',
  '{',
  '  "titre": string,                     // titre court de la réunion',
  '  "resume": string,                    // 3 à 6 phrases factuelles',
  '  "sujets": [{ "titre": string, "points": [{ "auteur": string | null, "texte": string }] }],',
  '  "decisions": string[],',
  '  "taches": [{ "titre": string, "description": string, "assignes": number[], "equipe": string | null, "echeance_texte": string | null, "echeance": string | null, "priorite": "basse" | "moyenne" | "haute" | "urgente" }]',
  '}',
  '',
  'Sujets : regroupe la discussion par sujet. Pour chaque point, indique qui l\'a dit (nom exact du participant) et explique ce qui a été dit ET pourquoi (raisons, arguments, contexte).',
  'Décisions : uniquement celles explicitement prises.',
  'Tâches : chaque chose demandée à quelqu\'un ou que quelqu\'un s\'engage à faire.',
  '- titre : l\'action à faire, courte et à l\'infinitif (ex. "Préparer les flyers du salon").',
  '- description : les précisions données (contexte, contenu attendu, contraintes, interlocuteurs) ; chaîne vide s\'il n\'y en a pas.',
  '- assignes : les identifiants (id) des utilisateurs concernés, pris dans la liste fournie. Reconnais les prénoms, noms, surnoms et les adresses directes ("Marine, il faut que tu..." → Marine). Plusieurs personnes si la tâche est demandée à plusieurs. Liste vide si personne n\'est clairement désigné. N\'utilise jamais un id absent de la liste.',
  '- equipe : l\'identifiant d\'équipe (ex. "graphisme") si la tâche est confiée à une équipe entière, sinon null.',
  '- echeance_texte : l\'expression exacte de l\'échéance telle que prononcée (ex. "vendredi", "demain", "fin du mois", "le 15 novembre"), sinon null.',
  '- echeance : date au format YYYY-MM-DD si une date ou un délai est mentionné, lue dans le calendrier fourni ("aujourd\'hui", "demain", "vendredi" = le premier vendredi après aujourd\'hui, "la semaine prochaine" = le lundi suivant, "fin du mois" = dernier jour du mois) ; sinon null. Ne calcule jamais une date toi-même : reprends-la telle quelle depuis le calendrier.',
  '- priorite : "urgente" si c\'est présenté comme urgent ou immédiat, "haute" si c\'est important ou prioritaire, "basse" si c\'est accessoire, sinon "moyenne".',
  "N'invente rien qui ne soit pas dans la transcription.",
].join('\n')

export async function summarizeMeeting(
  transcript: string,
  participants: string[],
  users: KnownUser[]
): Promise<{ summary: MeetingSummary; tasks: DetectedTask[] }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY manquante')
  const date = meetingCalendar()
  const userList = users.map((u) => `- id ${u.id} : ${u.name}${u.teams.length ? ` (équipes : ${u.teams.join(', ')})` : ''}`).join('\n')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `Date de la réunion : ${date.label}`,
            `Calendrier (pour les échéances) :\n${date.calendar}`,
            `Participants : ${participants.join(', ')}`,
            `Utilisateurs de l'entreprise (pour attribuer les tâches) :\n${userList}`,
            `Transcription :\n${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}`,
          ].join('\n\n'),
        },
      ],
    }),
  })
  if (!response.ok) throw new Error(`OpenAI ${response.status} : ${await response.text().catch(() => '')}`)
  const data = await response.json() as any
  const parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}')

  const knownIds = new Set(users.map((u) => u.id))
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const summary: MeetingSummary = {
    titre: str(parsed.titre) || 'Réunion',
    resume: str(parsed.resume),
    sujets: Array.isArray(parsed.sujets)
      ? parsed.sujets
          .filter((s: any) => s && str(s.titre))
          .map((s: any) => ({
            titre: str(s.titre),
            points: Array.isArray(s.points)
              ? s.points.filter((p: any) => p && str(p.texte)).map((p: any) => ({ auteur: str(p.auteur) || null, texte: str(p.texte) }))
              : [],
          }))
      : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map(str).filter(Boolean) : [],
  }
  const tasks: DetectedTask[] = Array.isArray(parsed.taches)
    ? parsed.taches
        .filter((t: any) => t && str(t.titre))
        .map((t: any) => ({
          title: str(t.titre).slice(0, 255),
          description: str(t.description),
          // On ne garde que des utilisateurs existants : l'IA ne doit pas pouvoir inventer d'id.
          assigneeIds: Array.isArray(t.assignes) ? [...new Set(t.assignes.map(Number).filter((id: number) => knownIds.has(id)))] as number[] : [],
          teamSlug: str(t.equipe) || null,
          // L'expression prononcée est convertie par le code (fiable) ; la date du modèle ne sert qu'en secours.
          deadline: resolveFrenchDeadline(str(t.echeance_texte)) ?? (/^\d{4}-\d{2}-\d{2}$/.test(str(t.echeance)) ? str(t.echeance) : null),
          priority: PRIORITIES.includes(t.priorite) ? t.priorite : 'moyenne',
        }))
    : []
  return { summary, tasks }
}
