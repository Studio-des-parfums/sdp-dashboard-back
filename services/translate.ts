// Traduction automatique de noms (notes olfactives, ateliers, ...) saisis en français vers les
// autres langues supportées, via l'API OpenAI. Utilisé par routes/ingredients.ts et
// routes/ateliers.ts à la création/modification d'une entrée.

const TARGET_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'anglais' },
  { code: 'pt', label: 'portugais' },
  { code: 'ru', label: 'russe' },
  { code: 'ar', label: 'arabe' },
  { code: 'es', label: 'espagnol' },
]

function getApiKey(): string | null {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    console.warn('OPENAI_API_KEY not set — translation will be skipped')
    return null
  }
  return key
}

// Traduit un nom (français) vers toutes les langues cibles, selon le contexte fourni (utilisé
// dans le prompt système pour guider le ton/vocabulaire : parfumerie, nom d'atelier, etc.).
// Retourne un objet { en: "...", pt: "...", ... } ; {} si la clé API est absente ou en cas
// d'erreur (l'entrée reste alors utilisable, seulement sans traductions).
async function translateName(nameFr: string, context: string, systemPrompt: string): Promise<Record<string, string>> {
  const apiKey = getApiKey()
  if (!apiKey || !nameFr.trim()) return {}

  const languagesList = TARGET_LANGUAGES.map((l) => `"${l.code}" (${l.label})`).join(', ')

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Traduis le ${context} suivant : "${nameFr}". Langues cibles : ${languagesList}.`,
          },
        ],
      }),
    })

    if (!response.ok) {
      console.error('OpenAI translation request failed', response.status, await response.text().catch(() => ''))
      return {}
    }

    const data = await response.json() as any
    const content = data?.choices?.[0]?.message?.content
    if (!content) return {}

    const parsed = JSON.parse(content)
    const result: Record<string, string> = {}
    for (const { code } of TARGET_LANGUAGES) {
      if (typeof parsed[code] === 'string' && parsed[code].trim()) {
        result[code] = parsed[code].trim()
      }
    }
    return result
  } catch (err) {
    console.error('OpenAI translation error', err)
    return {}
  }
}

export async function translateNoteName(nameFr: string): Promise<Record<string, string>> {
  return translateName(
    nameFr,
    'nom de note olfactive',
    'Tu traduis des noms de notes olfactives (parfumerie) du français vers plusieurs langues. ' +
      'Réponds uniquement avec un objet JSON dont les clés sont les codes de langue fournis et les valeurs ' +
      'les traductions, concises et idiomatiques pour un contexte de parfumerie (pas de traduction littérale maladroite).'
  )
}

export async function translateAtelierName(nameFr: string): Promise<Record<string, string>> {
  return translateName(
    nameFr,
    "nom d'atelier de création de parfum",
    "Tu traduis des noms d'ateliers de création de parfum sur-mesure (contexte boutique de luxe à Paris) du français " +
      'vers plusieurs langues. Réponds uniquement avec un objet JSON dont les clés sont les codes de langue fournis et ' +
      'les valeurs les traductions, élégantes et idiomatiques pour un contexte de parfumerie de luxe (pas de traduction ' +
      'littérale maladroite ; les noms évocateurs/poétiques doivent rester évocateurs dans la langue cible).'
  )
}
