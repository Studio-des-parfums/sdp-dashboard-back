import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import request from 'supertest'

// Base simulée par motif SQL : chaque test décrit les lignes renvoyées.
const { mockQuery, getPublicFileUrl, deleteMessages } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  getPublicFileUrl: vi.fn(),
  deleteMessages: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../db', () => ({ default: { query: mockQuery, getConnection: vi.fn() } }))
vi.mock('../services/s3', () => ({
  getPublicFileUrl,
  uploadAtelierImage: vi.fn(), deleteAtelierImage: vi.fn(),
  uploadOptionImage: vi.fn(), deleteOptionImage: vi.fn(),
  uploadVoiceMessage: vi.fn(), getVoiceMessageUrl: vi.fn(),
  uploadMessageAttachment: vi.fn(), getMessageAttachmentUrls: vi.fn(), deleteMessageFile: vi.fn(),
}))
vi.mock('../services/messageCleanup', () => ({ deleteMessages }))

import { app } from '../index'

const ADMIN = { id: 1, email: 'admin@sdp.fr', first_name: 'A', last_name: 'D', role_name: 'admin' }
const STAFF = { id: 2, email: 'user@sdp.fr', first_name: 'U', last_name: 'S', role_name: 'staff' }

type Rule = [RegExp, (params: any[]) => any]
let rules: Rule[] = []
function db(extra: Rule[] = []) {
  rules = [
    ...extra,
    [/from users u\s+join roles r.*where u\.email = \?/is, (p) => [[ADMIN, STAFF].filter((u) => u.email === p[0])]],
    [/^\s*(insert)/i, () => [{ insertId: 42, affectedRows: 1 }]],
    [/^\s*(update|delete)/i, () => [{ affectedRows: 1 }]],
  ]
}
const calls = () => mockQuery.mock.calls.map((c) => [String(c[0]).replace(/\s+/g, ' ').trim(), c[1]] as [string, any[]])

beforeEach(() => {
  mockQuery.mockReset()
  mockQuery.mockImplementation(async (sql: string, params: any[] = []) => {
    const rule = rules.find(([re]) => re.test(String(sql)))
    return rule ? rule[1](params) : [[]]
  })
  getPublicFileUrl.mockReset()
  deleteMessages.mockClear()
  db()
})

// ─────────────── 1. Départ d'un utilisateur ───────────────
describe("Départ d'un utilisateur", () => {
  it('désactive le compte sans supprimer la ligne et retire ses équipes', async () => {
    const res = await request(app).delete('/api/users/7').set('x-user-email', ADMIN.email)
    expect(res.status).toBe(200)
    const sql = calls().map((c) => c[0])
    expect(sql).toContain('UPDATE users SET is_active = FALSE WHERE id = ?')
    expect(sql).toContain('DELETE FROM user_teams WHERE user_id = ?')
    expect(sql.some((s) => /^DELETE FROM users\b/i.test(s))).toBe(false)
  })
  it('est réservé aux admins', async () => {
    const res = await request(app).delete('/api/users/7').set('x-user-email', STAFF.email)
    expect(res.status).toBe(403)
    expect(calls().some((c) => c[0].startsWith('UPDATE users'))).toBe(false)
  })
})

// ─────────────── 2. Espaces Polux ───────────────
describe('Espaces Polux', () => {
  it('crée le projet kind=polux avec un slug polux-<nom>', async () => {
    db([[/from projects where id = \?/i, () => [[{ id: 42, slug: 'polux-equipe-ete', kind: 'polux' }]]]])
    const res = await request(app).post('/api/polux-workspaces').set('x-user-email', ADMIN.email).send({ name: '  Équipe Été ' })
    expect(res.status).toBe(201)
    const insert = calls().find((c) => c[0].startsWith('INSERT INTO projects'))!
    expect(insert[0]).toContain("'polux'")
    expect(insert[1].slice(0, 2)).toEqual(['Équipe Été', 'polux-equipe-ete'])
  })
  it('refuse un nom vide', async () => {
    const res = await request(app).post('/api/polux-workspaces').set('x-user-email', ADMIN.email).send({ name: ' !! ' })
    expect(res.status).toBe(400)
  })
  it('refuse un doublon (409)', async () => {
    db([[/select 1 from projects where slug/i, () => [[{ 1: 1 }]]]])
    const res = await request(app).post('/api/polux-workspaces').set('x-user-email', ADMIN.email).send({ name: 'Ventes' })
    expect(res.status).toBe(409)
    expect(calls().some((c) => c[0].startsWith('INSERT'))).toBe(false)
  })
  it('la suppression ne peut jamais viser Polux principal ni un autre type de projet', async () => {
    await request(app).delete('/api/polux-workspaces/1').set('x-user-email', ADMIN.email).expect(200)
    const del = calls().find((c) => c[0].startsWith('DELETE FROM projects'))!
    expect(del[0]).toContain("kind = 'polux'")
    expect(del[0]).toContain("slug <> 'polux'")
  })
  it('création et suppression réservées aux admins', async () => {
    await request(app).post('/api/polux-workspaces').set('x-user-email', STAFF.email).send({ name: 'X' }).expect(403)
    await request(app).delete('/api/polux-workspaces/3').set('x-user-email', STAFF.email).expect(403)
  })
})

// ─────────────── 3. Images publiques /api/files ───────────────
describe('GET /api/files/*', () => {
  it('redirige vers une URL signée sans authentification', async () => {
    getPublicFileUrl.mockResolvedValue('https://signed.example/a')
    const res = await request(app).get('/api/files/ateliers/a%20b.png')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://signed.example/a')
    expect(getPublicFileUrl).toHaveBeenCalledWith('ateliers/a b.png')
  })
  it('renvoie 404 pour un fichier non public', async () => {
    getPublicFileUrl.mockResolvedValue(null)
    const res = await request(app).get('/api/files/messages/files/secret.pdf')
    expect(res.status).toBe(404)
    expect(res.headers.location).toBeUndefined()
  })
  it('renvoie 500 si le stockage échoue', async () => {
    getPublicFileUrl.mockRejectedValue(new Error('R2 down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await request(app).get('/api/files/ateliers/a.png')
    expect(res.status).toBe(500)
  })
})

// ─────────────── 5. API interne utilisée par Polux ───────────────
describe('API interne (Polux)', () => {
  const KEY = 'test-service-key'
  beforeEach(() => { process.env.INTERNAL_API_KEY = KEY })
  afterAll(() => { delete process.env.INTERNAL_API_KEY })

  it('?all=1 renvoie aussi les anciens membres avec is_active booléen', async () => {
    db([[/from users order by/i, () => [[{ id: 1, is_active: 1 }, { id: 9, is_active: 0 }]]]])
    const res = await request(app).get('/api/internal/users?all=1').set('x-service-key', KEY)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 1, is_active: true }, { id: 9, is_active: false }])
  })
  it('project-access exige un slug', async () => {
    await request(app).get('/api/internal/users/2/project-access').set('x-service-key', KEY).expect(400)
  })
  it('project-access : un admin a accès à tout espace', async () => {
    db([
      [/select email from users where id/i, () => [[{ email: ADMIN.email }]]],
      [/select id from projects where slug/i, () => [[{ id: 5 }]]],
    ])
    const res = await request(app).get('/api/internal/users/1/project-access?slug=polux-ventes').set('x-service-key', KEY)
    expect(res.body).toEqual({ has_access: true })
  })
  it('project-access : un membre sans ligne user_projects est refusé', async () => {
    db([
      [/select email from users where id/i, () => [[{ email: STAFF.email }]]],
      [/select id from projects where slug/i, () => [[{ id: 5 }]]],
    ])
    const res = await request(app).get('/api/internal/users/2/project-access?slug=polux-ventes').set('x-service-key', KEY)
    expect(res.body).toEqual({ has_access: false })
  })
  it('project-access : un membre autorisé passe', async () => {
    db([
      [/select email from users where id/i, () => [[{ email: STAFF.email }]]],
      [/select id from projects where slug/i, () => [[{ id: 5 }]]],
      [/from user_projects/i, () => [[{ 1: 1 }]]],
    ])
    const res = await request(app).get('/api/internal/users/2/project-access?slug=polux-ventes').set('x-service-key', KEY)
    expect(res.body).toEqual({ has_access: true })
  })
  it('project-access : utilisateur désactivé ou espace inconnu = refus', async () => {
    db([[/select email from users where id/i, () => [[]]]])
    const res = await request(app).get('/api/internal/users/9/project-access?slug=polux-ventes').set('x-service-key', KEY)
    expect(res.body).toEqual({ has_access: false })
  })
  it('project-access exige la clé de service', async () => {
    await request(app).get('/api/internal/users/1/project-access?slug=polux').expect(401)
  })
})

// ─────────────── 6. Confidentialité des messages ───────────────
describe('Messages : confidentialité', () => {
  it("un non-membre ne peut pas lire l'historique d'un groupe", async () => {
    db([[/from message_group_members where group_id = \?$/i, () => [[{ user_id: 1 }, { user_id: 3 }]]]])
    const res = await request(app).get('/api/message-groups/4/messages').set('x-user-email', STAFF.email)
    expect(res.status).toBe(403)
    expect(calls().some((c) => c[0].includes('FROM messages m'))).toBe(false)
  })
  it('un membre peut lire le groupe', async () => {
    db([[/from message_group_members where group_id = \?$/i, () => [[{ user_id: 2 }]]]])
    const res = await request(app).get('/api/message-groups/4/messages').set('x-user-email', STAFF.email)
    expect(res.status).toBe(200)
  })
  it("on ne peut pas supprimer le message de quelqu'un d'autre", async () => {
    db([[/from messages where id = \?/i, () => [[{ id: 5, sender_id: 1, receiver_id: 2, group_id: null }]]]])
    const res = await request(app).delete('/api/messages/5').set('x-user-email', STAFF.email)
    expect(res.status).toBe(403)
    expect(deleteMessages).not.toHaveBeenCalled()
  })
  it('on ne peut pas supprimer un message qui a déjà reçu une réponse', async () => {
    db([
      [/from messages where id = \?/i, () => [[{ id: 5, sender_id: 2, receiver_id: 1, group_id: null }]]],
      [/select 1 from messages where sender_id/i, () => [[{ 1: 1 }]]],
    ])
    const res = await request(app).delete('/api/messages/5').set('x-user-email', STAFF.email)
    expect(res.status).toBe(403)
    expect(deleteMessages).not.toHaveBeenCalled()
  })
  it('suppression de son propre message sans réponse', async () => {
    db([[/from messages where id = \?/i, () => [[{ id: 5, sender_id: 2, receiver_id: 1, group_id: null }]]]])
    const res = await request(app).delete('/api/messages/5').set('x-user-email', STAFF.email)
    expect(res.status).toBe(200)
    expect(deleteMessages).toHaveBeenCalledOnce()
  })
  it('un compte désactivé est traité comme non connecté', async () => {
    const res = await request(app).get('/api/message-groups/4/messages').set('x-user-email', 'parti@sdp.fr')
    expect(res.status).toBe(401)
  })
})
