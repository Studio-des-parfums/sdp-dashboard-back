import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import request from 'supertest'

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))
vi.mock('../db', () => ({ default: { query: mockQuery, getConnection: vi.fn() } }))

import { app } from '../index'

const KEY = 'test-service-key'
const user = { id: 1, email: 'a@sdp.fr', first_name: 'A', last_name: 'B', role_name: 'admin' }

describe('API interne utilisateurs', () => {
  beforeEach(() => {
    process.env.INTERNAL_API_KEY = KEY
    mockQuery.mockReset()
    mockQuery.mockResolvedValue([[user], []])
  })
  afterAll(() => { delete process.env.INTERNAL_API_KEY })

  it('refuse sans clé, même avec un email admin', async () => {
    const res = await request(app).get('/api/internal/users').set('x-user-email', 'a@sdp.fr')
    expect(res.status).toBe(401)
    expect(mockQuery).not.toHaveBeenCalled()
  })
  it('refuse une mauvaise clé', async () => {
    const res = await request(app).get('/api/internal/users').set('x-service-key', 'mauvaise')
    expect(res.status).toBe(401)
  })
  it('reste fermée si la clé serveur manque', async () => {
    delete process.env.INTERNAL_API_KEY
    const res = await request(app).get('/api/internal/users').set('x-service-key', 'undefined')
    expect(res.status).toBe(503)
  })
  it('trouve un utilisateur par email', async () => {
    const res = await request(app).get('/api/internal/users/by-email').query({ email: 'a@sdp.fr' }).set('x-service-key', KEY)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(user)
  })
  it('renvoie 404 pour un email inconnu', async () => {
    mockQuery.mockResolvedValue([[], []])
    const res = await request(app).get('/api/internal/users/by-email').query({ email: 'x@sdp.fr' }).set('x-service-key', KEY)
    expect(res.status).toBe(404)
  })
  it('liste les utilisateurs actifs', async () => {
    const res = await request(app).get('/api/internal/users').set('x-service-key', KEY)
    expect(res.status).toBe(200)
    expect(mockQuery.mock.calls[0][0]).toContain('is_active = TRUE')
  })
  it('filtre par ids', async () => {
    await request(app).get('/api/internal/users').query({ ids: '1,2' }).set('x-service-key', KEY).expect(200)
    expect(mockQuery.mock.calls[0][1]).toEqual([[1, 2]])
  })
  it('rejette des ids invalides', async () => {
    const res = await request(app).get('/api/internal/users').query({ ids: '1;DROP' }).set('x-service-key', KEY)
    expect(res.status).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })
})
