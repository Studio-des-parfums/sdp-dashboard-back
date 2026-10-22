import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Bucket partagé avec sdp-ocr-back (mêmes credentials AWS) : les fichiers
// clients OCR restent privés, seul le préfixe ateliers/ est rendu public
// en lecture via une bucket policy scopée (voir server/migrations/027).
const BUCKET = process.env.AWS_S3_BUCKET || ''
const REGION = process.env.AWS_S3_REGION || 'eu-west-3'
const ATELIERS_PREFIX = 'ateliers/'
// Images d'options (ex: Ruban, Champagne, Flacon murano) : même bucket, préfixe dédié
// public en lecture — voir server/migrations/029 pour la bucket policy associée.
const OPTIONS_PREFIX = 'options/'

function getClient(): S3Client {
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  })
}

function publicUrl(key: string): string {
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`
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
  const prefix = publicUrl(ATELIERS_PREFIX)
  if (!imageUrl.startsWith(prefix)) return
  const key = `${ATELIERS_PREFIX}${imageUrl.slice(prefix.length)}`

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
  const prefix = publicUrl(OPTIONS_PREFIX)
  if (!imageUrl.startsWith(prefix)) return
  const key = `${OPTIONS_PREFIX}${imageUrl.slice(prefix.length)}`

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
