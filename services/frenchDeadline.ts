// Conversion déterministe d'une échéance dite en français ("vendredi", "demain", "fin du mois",
// "dans 2 semaines", "le 15", "15 novembre", "15/11"...) en date YYYY-MM-DD, relative au jour
// de la réunion à Paris. Plus fiable que de laisser le modèle d'IA calculer les dates.

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Date du jour à Paris, en UTC minuit (calculs de jours sans effet de fuseau). */
export function parisToday(now = new Date()): Date {
  const [y, m, d] = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(now).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0))

export function resolveFrenchDeadline(expression: string, today = parisToday()): string | null {
  const text = normalize(expression)
  if (!text) return null
  const dow = today.getUTCDay()
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()

  if (/apres[ -]demain/.test(text)) return iso(addDays(today, 2))
  if (/demain/.test(text)) return iso(addDays(today, 1))
  if (/aujourd hui|ce soir|ce midi|dans la journee|tout de suite|immediatement/.test(text)) return iso(today)

  const inMatch = text.match(/dans (\d+|un|une|deux|trois) (jour|semaine|mois)/)
  if (inMatch) {
    const n = { un: 1, une: 1, deux: 2, trois: 3 }[inMatch[1] as 'un'] ?? Number(inMatch[1])
    if (inMatch[2] === 'jour') return iso(addDays(today, n))
    if (inMatch[2] === 'semaine') return iso(addDays(today, 7 * n))
    return iso(new Date(Date.UTC(y, m + n, Math.min(today.getUTCDate(), lastDayOfMonth(y, m + n).getUTCDate()))))
  }

  if (/fin du mois prochain/.test(text)) return iso(lastDayOfMonth(y, m + 1))
  if (/fin (du|de ce) mois/.test(text)) return iso(lastDayOfMonth(y, m))
  if (/(debut du )?mois prochain/.test(text)) return iso(new Date(Date.UTC(y, m + 1, 1)))
  if (/fin (de )?(la |cette )?semaine/.test(text)) return iso(addDays(today, dow <= 5 ? 5 - dow : 6))
  if (/semaine prochaine/.test(text) && !WEEKDAYS.some((w) => text.includes(w))) return iso(addDays(today, ((8 - dow) % 7) || 7))

  const weekday = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(text))
  if (weekday >= 0) {
    let delta = (weekday - dow + 7) % 7 || 7
    if (/en huit|semaine (d )?apres/.test(text)) delta += 7
    return iso(addDays(today, delta))
  }

  // "15 novembre", "le 3 mars 2027"
  const named = text.match(/(\d{1,2})(?:er)? (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?: (\d{4}))?/)
  if (named) {
    const month = MONTHS.indexOf(named[2])
    let year = named[3] ? Number(named[3]) : y
    if (!named[3] && Date.UTC(year, month, Number(named[1])) < today.getTime()) year += 1
    return iso(new Date(Date.UTC(year, month, Number(named[1]))))
  }
  // "15/11", "15/11/2026"
  const numeric = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/)
  if (numeric) {
    let year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : y
    const month = Number(numeric[2]) - 1
    if (!numeric[3] && Date.UTC(year, month, Number(numeric[1])) < today.getTime()) year += 1
    return iso(new Date(Date.UTC(year, month, Number(numeric[1]))))
  }
  // "le 15" : ce mois-ci, ou le mois suivant si le jour est passé
  const dayOnly = text.match(/\ble (\d{1,2})\b/)
  if (dayOnly) {
    const day = Number(dayOnly[1])
    const candidate = new Date(Date.UTC(y, m, day))
    return iso(candidate.getTime() >= today.getTime() ? candidate : new Date(Date.UTC(y, m + 1, day)))
  }
  return null
}
