import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Bucket partagé avec sdp-ocr-back (mêmes credentials AWS) : les fichiers
// clients OCR restent privés, seul le préfixe ateliers/ est rendu public
// en lecture via une bucket policy scopée (voir server/migrations/027).
const BUCKET = process.env.AWS_S3_BUCKET || ''
const REGION = process.env.AWS_S3_REGION || 'eu-west-3'
// Stockage compatible S3 autre qu'AWS (Cloudflare R2) : endpoint du compte, région 'auto'.
const ENDPOINT = process.env.AWS_S3_ENDPOINT || ''
// Bucket privé (R2) : les images publiques (ateliers/, options/) sont servies par ce backend
// via /api/files/<clé> (redirection vers une URL signée). Valeur = URL publique de ce backend.
const FILES_BASE_URL = (process.env.FILES_BASE_URL || '').replace(/\/$/, '')
const ATELIERS_PREFIX = 'ateliers/'
// Images d'options (ex: Ruban, Champagne, Flacon murano) : même bucket, préfixe dédié
// public en lecture — voir server/migrations/029 pour la bucket policy associée.
const OPTIONS_PREFIX = 'options/'

function getClient(): S3Client {
  return new S3Client({
    region: REGION,
    ...(ENDPOINT ? { endpoint: ENDPOINT, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  })
}

function publicUrl(key: string): string {
  if (FILES_BASE_URL) return `${FILES_BASE_URL}/api/files/${key}`
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`
}

// Clé de stockage d'une image publique à partir de son URL, quel que soit le format
// (URL S3 historique ou URL /api/files/ de ce backend).
function keyFromPublicUrl(imageUrl: string, prefix: string): string | null {
  const markers = [`/api/files/${prefix}`, `.amazonaws.com/${prefix}`]
  for (const marker of markers) {
    const i = imageUrl.indexOf(marker)
    if (i !== -1) return prefix + imageUrl.slice(i + marker.length)
  }
  return null
}

// Préfixes publics : seules ces images peuvent être lues sans authentification via /api/files.
export const PUBLIC_PREFIXES = [ATELIERS_PREFIX, OPTIONS_PREFIX]
const PUBLIC_FILE_URL_TTL_SECONDS = 3600

export async function getPublicFileUrl(key: string): Promise<string | null> {
  if (!PUBLIC_PREFIXES.some((p) => key.startsWith(p)) || key.includes('..')) return null
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: PUBLIC_FILE_URL_TTL_SECONDS })
}

export async function uploadAtelierImage(
  atelierId: number,
  fileBuffer: Buffer,
  originalFilename: string,
  contentType: string
): Promise<string> {
  const ext = originalFilename.split('.').pop()?.toLowerCase() || 'jpg'
  const key = `${ATELIERS_PREFIX}${atelierId}_${Date.now()}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    })
  )

  return publicUrl(key)
}

export async function deleteAtelierImage(imageUrl: string): Promise<void> {
  const key = keyFromPublicUrl(imageUrl, ATELIERS_PREFIX)
  if (!key) return

  await getClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

export async function uploadOptionImage(
  optionId: number,
  fileBuffer: Buffer,
  originalFilename: string,
  contentType: string
): Promise<string> {
  const ext = originalFilename.split('.').pop()?.toLowerCase() || 'jpg'
  const key = `${OPTIONS_PREFIX}${optionId}_${Date.now()}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    })
  )

  return publicUrl(key)
}

export async function deleteOptionImage(imageUrl: string): Promise<void> {
  const key = keyFromPublicUrl(imageUrl, OPTIONS_PREFIX)
  if (!key) return

  await getClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

// Messages vocaux : préfixe privé (pas de bucket policy publique) — conversations entre
// collègues, lues uniquement via une URL pré-signée à durée limitée.
const VOICE_PREFIX = 'messages/voice/'
const VOICE_URL_TTL_SECONDS = 3600

export async function uploadVoiceMessage(senderId: number, fileBuffer: Buffer, contentType: string): Promise<string> {
  const ext = contentType.includes('mp4') ? 'm4a' : contentType.includes('ogg') ? 'ogg' : 'webm'
  const key = `${VOICE_PREFIX}${senderId}_${Date.now()}.${ext}`
  await getClient().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: fileBuffer, ContentType: contentType }))
  return key
}

export async function getVoiceMessageUrl(key: string): Promise<string> {
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: VOICE_URL_TTL_SECONDS })
}

// Pièces jointes des messages (images, PDF) : préfixe privé, URL pré-signées d'aperçu
// (inline) et de téléchargement (nom d'origine).
const MESSAGE_FILES_PREFIX = 'messages/files/'

export async function uploadMessageAttachment(senderId: number, fileBuffer: Buffer, filename: string, contentType: string): Promise<string> {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const key = `${MESSAGE_FILES_PREFIX}${senderId}_${Date.now()}_${safeName}`
  await getClient().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: fileBuffer, ContentType: contentType }))
  return key
}

export async function getMessageAttachmentUrls(key: string, filename: string, contentType: string): Promise<{ url: string; download_url: string }> {
  const encoded = encodeURIComponent(filename)
  const sign = (disposition: string) =>
    getSignedUrl(
      getClient(),
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: `${disposition}; filename*=UTF-8''${encoded}`,
      }),
      { expiresIn: VOICE_URL_TTL_SECONDS }
    )
  const [url, download_url] = await Promise.all([sign('inline'), sign('attachment')])
  return { url, download_url }
}

/** Supprime le fichier d'un message (vocal ou pièce jointe) — préfixe messages/ uniquement. */
export async function deleteMessageFile(key: string): Promise<void> {
  if (!key.startsWith('messages/')) return
  await getClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}
