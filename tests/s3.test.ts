import { describe, it, expect, vi, beforeEach } from 'vitest'

// Client S3 simulé : on vérifie les clés envoyées, sans réseau.
const { send, getSignedUrl } = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue({}),
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/obj'),
}))
vi.mock('@aws-sdk/client-s3', async (orig) => {
  const real: any = await orig()
  return { ...real, S3Client: class { send = send } }
})
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }))

import { deleteAtelierImage, deleteOptionImage, getPublicFileUrl } from '../services/s3'

const sentKey = () => send.mock.calls[0][0].input.Key

describe('Stockage R2 : clés des images publiques', () => {
  beforeEach(() => { send.mockClear(); getSignedUrl.mockClear() })

  it('retrouve la clé depuis une ancienne URL S3', async () => {
    await deleteAtelierImage('https://file-aglae-ocr.s3.eu-west-3.amazonaws.com/ateliers/abc.png')
    expect(sentKey()).toBe('ateliers/abc.png')
  })
  it('retrouve la même clé depuis une URL /api/files', async () => {
    await deleteAtelierImage('https://back.example/api/files/ateliers/abc.png')
    expect(sentKey()).toBe('ateliers/abc.png')
  })
  it('gère le préfixe options/', async () => {
    await deleteOptionImage('https://back.example/api/files/options/x/y.jpg')
    expect(sentKey()).toBe('options/x/y.jpg')
  })
  it('ne supprime rien pour une URL étrangère ou un autre préfixe', async () => {
    await deleteAtelierImage('https://ailleurs.example/image.png')
    await deleteAtelierImage('https://back.example/api/files/options/y.jpg')
    expect(send).not.toHaveBeenCalled()
  })
  it('signe les préfixes publics', async () => {
    expect(await getPublicFileUrl('ateliers/a.png')).toBe('https://signed.example/obj')
    expect(await getPublicFileUrl('options/b.png')).toBe('https://signed.example/obj')
  })
  it('refuse les fichiers privés et les remontées de dossier', async () => {
    expect(await getPublicFileUrl('messages/files/secret.pdf')).toBeNull()
    expect(await getPublicFileUrl('ateliers/../messages/x')).toBeNull()
    expect(await getPublicFileUrl('clients/ocr.pdf')).toBeNull()
    expect(getSignedUrl).not.toHaveBeenCalled()
  })
})
