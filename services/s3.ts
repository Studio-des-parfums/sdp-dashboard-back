import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

// Bucket partagé avec sdp-ocr-back (mêmes credentials AWS) : les fichiers
// clients OCR restent privés, seul le préfixe ateliers/ est rendu public
// en lecture via une bucket policy scopée (voir server/migrations/027).
const BUCKET = process.env.AWS_S3_BUCKET || ''
const REGION = process.env.AWS_S3_REGION || 'eu-west-3'
const ATELIERS_PREFIX = 'ateliers/'

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
