import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

// ══════════════════════════════════════════════════════════════════════════════
// Fixtures stables
// ══════════════════════════════════════════════════════════════════════════════

const { mockQuery, mockConnection, defaultQueryImplementation } = vi.hoisted(() => {
  const FAKE_ADMIN_USER = {
    id: 1,
    email: 'admin@sdp.fr',
    first_name: 'Super',
    last_name: 'Admin',
    role_id: 1,
    role_name: 'admin',
    is_active: 1,
  }

  const FAKE_NORMAL_USER = {
    id: 2,
    email: 'user@sdp.fr',
    first_name: 'John',
    last_name: 'Doe',
    role_id: 2,
    role_name: 'staff',
    is_active: 1,
  }

  const FAKE_PROJECT = {
    id: 1,
    name: 'Studio Core',
    slug: 'sdp-core',
    description: 'Projet principal',
    color: '#ff0000',
    status: 'active',
    created_at: '2024-01-01',
  }

  const FAKE_ATELIER = {
    id: 1,
    is_active: 1,
    coffret_id: 1,
    description: 'Atelier Découverte',
    volume_ml: 50,
    translations: JSON.stringify({ fr: 'Découverte', en: 'Discovery' }),
  }

  const FAKE_COFFRET = {
    id: 1,
    is_active: 1,
    translations: JSON.stringify({ fr: 'Coffret Prestige', en: 'Prestige Box' }),
  }

  const FAKE_INGREDIENT = {
    id: 1,
    code: 'ROS-01',
    name: 'Rose',
    category: 'heart',
    intensity: 'medium',
    is_active: 1,
    allergens: JSON.stringify(['Geraniol', 'Citronellol']),
    coffret_ids: JSON.stringify([1]),
    translations: JSON.stringify({ fr: 'Rose', en: 'Rose' }),
  }

  const FAKE_INGREDIENT_RULE = {
    id: 1,
    rule_type: 'max_dosage',
    source_ingredient_id: 1,
    max_drops: 10,
    percentage: null,
    is_active: 1,
    target_ids: JSON.stringify([2, 3]),
    bottle_sizes: JSON.stringify(['30ml', '50ml']),
  }

  const FAKE_OPTION = {
    id: 1,
    coffret_id: 1,
    translations: JSON.stringify({ fr: 'Flacon Gravé', en: 'Engraved Bottle' }),
  }

  const FAKE_TICKET = {
    id: 1,
    user_id: 1,
    project_id: 1,
    title: 'Bug affichage tablette',
    description: 'La liste ne se charge pas',
    status: 'open',
    priority: 'high',
    created_at: '2024-01-01',
    user_first_name: 'Super',
    user_last_name: 'Admin',
    user_email: 'admin@sdp.fr',
    project_name: 'Studio Core',
  }

  function defaultQueryImplementation(sql: string, params: any[] = []): any {
    const s = String(sql).toLowerCase()

    // Authentification et Utilisateurs avec rôles
    if (s.includes('from users u') && s.includes('join roles r')) {
      const email = params[0]
      if (email === 'admin@sdp.fr') return [[FAKE_ADMIN_USER]]
      if (email === 'user@sdp.fr') return [[FAKE_NORMAL_USER]]
      if (params.includes('alex')) {
        return [[{ id: 1, pseudo: 'alex', is_active: 1, role_name: 'parfumeur' }]]
      }
      return [[]]
    }

    if (s.includes('from users where pseudo =')) {
      const pseudo = params[0]
      if (pseudo === 'alex') return [[{ id: 1, pseudo: 'alex', is_active: 1, role_name: 'parfumeur' }]]
      return [[]]
    }

    if (s.includes('from users where email =')) {
      const email = params[0]
      if (email === 'admin@sdp.fr') return [[FAKE_ADMIN_USER]]
      if (email === 'user@sdp.fr') return [[FAKE_NORMAL_USER]]
      return [[]]
    }

    if (s.includes('from users where id =')) {
      const id = Number(params[0])
      if (id === 999 || id === 9999) return [[]]
      return [[FAKE_ADMIN_USER]]
    }

    if (s.includes('from user_projects')) {
      return [[]]
    }

    if (s.includes('from users')) {
      return [[FAKE_ADMIN_USER]]
    }

    if (s.includes('from roles')) {
      return [[{ id: 1, name: 'admin', description: 'Admin' }]]
    }

    // Projets
    if (s.includes('from projects where slug =')) {
      const slug = params[0]
      if (slug === 'sdp-core') return [[FAKE_PROJECT]]
      if (slug === 'secret-portal') return [[{ ...FAKE_PROJECT, id: 99, slug: 'secret-portal' }]]
      return [[]]
    }

    if (s.includes('from projects where id =')) {
      const id = Number(params[0])
      if (id === 999 || id === 9999) return [[]]
      return [[FAKE_PROJECT]]
    }

    if (s.includes('from projects')) {
      return [[FAKE_PROJECT]]
    }

    // Ateliers
    if (s.includes('from ateliers where id = ?') || s.includes('from ateliers a where a.id = ?')) {
      const id = Number(params[0])
      if (id === 999 || id === 9999) return [[]]
      return [[FAKE_ATELIER]]
    }

    if (s.includes('from ateliers')) {
      return [[FAKE_ATELIER]]
    }

    // Coffrets
    if (s.includes('from coffrets where id = ?') || s.includes('from coffrets c where c.id = ?')) {
      const id = Number(params[0])
      if (id === 999 || id === 9999) return [[]]
      return [[FAKE_COFFRET]]
    }

    if (s.includes('from coffrets')) {
      return [[FAKE_COFFRET]]
    }

    // Ingrédients
    if (s.includes('from ingredients where id = ?') || s.includes('from ingredients i where i.id = ?')) {
      const id = Number(params[0])
      if (id === 999 || id === 9999) return [[]]
      return [[FAKE_INGREDIENT]]
    }

    if (s.includes('from ingredients')) {
      return [[FAKE_INGREDIENT]]
    }

    // Règles d'ingrédients
    if (s.includes('from ingredient_rules where id = ?') || s.includes('from ingredient_rules r where r.id = ?')) {
      const id = Number(params[0])
      if (id === 999 || id === 9999) return [[]]
      return [[FAKE_INGREDIENT_RULE]]
    }

    if (s.includes('from ingredient_rules')) {
      return [[FAKE_INGREDIENT_RULE]]
    }

    // Options
    if (s.includes('from options where id = ?') || s.includes('from options o where o.id = ?')) {
      const id = Number(params[0])
      if (id === 999 || id === 9999) return [[]]
      return [[FAKE_OPTION]]
    }

    if (s.includes('from options')) {
      return [[FAKE_OPTION]]
    }

    // Support tickets
    if (s.includes('from support_tickets')) {
      return [[FAKE_TICKET]]
    }

    // Notifications & Conversations
    if (s.includes('from notifications')) {
      return [[]]
    }

    if (s.includes('from conversation')) {
      return [[]]
    }

    // INSERT
    if (s.startsWith('insert')) {
      return [{ insertId: 10, affectedRows: 1 }]
    }

    // UPDATE & DELETE
    if (s.startsWith('update') || s.startsWith('delete')) {
      const targetId = Number(params[params.length - 1])
      if (targetId === 999 || targetId === 9999) {
        return [{ affectedRows: 0 }]
      }
      return [{ affectedRows: 1 }]
    }

    return [[]]
  }

  const mockQuery = vi.fn().mockImplementation((sql, params) => Promise.resolve(defaultQueryImplementation(sql, params)))

  const mockConnection = {
    query: vi.fn().mockImplementation((sql, params) => Promise.resolve(defaultQueryImplementation(sql, params))),
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
  }

  return { mockQuery, mockConnection, defaultQueryImplementation }
})

vi.mock('../db', () => ({
  default: {
    query: mockQuery,
    getConnection: vi.fn().mockResolvedValue(mockConnection),
  },
}))

vi.mock('../services/s3', () => ({
  uploadAtelierImage: vi.fn().mockResolvedValue('https://s3.fake/image.png'),
  deleteAtelierImage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../services/translate', () => ({
  translateAtelierName: vi.fn().mockResolvedValue({ en: 'Workshop', es: 'Taller' }),
  translateCoffretName: vi.fn().mockResolvedValue({ en: 'Box', es: 'Caja' }),
  translateOptionName: vi.fn().mockResolvedValue({ en: 'Option', es: 'Opción' }),
  translateNoteName: vi.fn().mockResolvedValue({ en: 'Rose Note', es: 'Nota de Rosa' }),
}))

vi.mock('../services/email', () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordChangeConfirmation: vi.fn().mockResolvedValue(undefined),
}))

import pool from '../db'
import { app } from '../index'

// ══════════════════════════════════════════════════════════════════════════════
// Tests Suite Complète
// ══════════════════════════════════════════════════════════════════════════════

describe('SDP Dashboard Back API Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockImplementation((sql, params) => Promise.resolve(defaultQueryImplementation(sql, params)))
  })

  // ──────────────────────────────────────────────
  // 1. Healthcheck
  // ──────────────────────────────────────────────
  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/health')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ status: 'ok' })
    })
  })

  // ──────────────────────────────────────────────
  // 2. Dashboards / Projects
  // ──────────────────────────────────────────────
  describe('GET /api/projects', () => {
    it('returns projects accessible to user', async () => {
      const res = await request(app)
        .get('/api/projects')
        .set('x-user-email', 'admin@sdp.fr')

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body[0].slug).toBe('sdp-core')
    })

    it('returns 500 when database query fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB connection refused'))

      const res = await request(app).get('/api/projects')
      expect(res.status).toBe(500)
      expect(res.body).toHaveProperty('error')
    })
  })

  describe('GET /api/projects/:slug', () => {
    it('returns 404 when project not found', async () => {
      const res = await request(app).get('/api/projects/unknown-slug')
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Project not found' })
    })

    it('returns 403 when user does not have permission', async () => {
      const res = await request(app)
        .get('/api/projects/secret-portal')
        .set('x-user-email', 'user@sdp.fr')

      expect(res.status).toBe(403)
      expect(res.body).toHaveProperty('error')
    })
  })

  // ──────────────────────────────────────────────
  // 3. Ateliers
  // ──────────────────────────────────────────────
  describe('Ateliers Routes', () => {
    it('GET /api/ateliers returns list of parsed ateliers', async () => {
      const res = await request(app).get('/api/ateliers')
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
      expect(res.body[0].is_active).toBe(true)
      expect(res.body[0].translations.fr).toBe('Découverte')
    })

    it('PATCH /api/ateliers/:id returns 404 when not found', async () => {
      const res = await request(app)
        .patch('/api/ateliers/999')
        .send({ is_active: false })
      expect(res.status).toBe(404)
      expect(res.body).toHaveProperty('error')
    })

    it('POST /api/ateliers rejects when translations is missing (400)', async () => {
      const res = await request(app).post('/api/ateliers').send({})
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('translations')
    })

    it('POST /api/ateliers creates atelier successfully (201)', async () => {
      const res = await request(app)
        .post('/api/ateliers')
        .send({ translations: { fr: 'Atelier Privé' }, coffret_id: 1 })

      expect(res.status).toBe(201)
      expect(res.body.is_active).toBe(true)
    })

    it('DELETE /api/ateliers/:id deletes successfully (204)', async () => {
      const res = await request(app).delete('/api/ateliers/1')
      expect(res.status).toBe(204)
    })

    it('DELETE /api/ateliers/:id returns 204 (idempotent delete)', async () => {
      const res = await request(app).delete('/api/ateliers/9999')
      expect(res.status).toBe(204)
    })
  })

  // ──────────────────────────────────────────────
  // 4. Coffrets
  // ──────────────────────────────────────────────
  describe('Coffrets Routes', () => {
    it('GET /api/coffrets returns list of coffrets', async () => {
      const res = await request(app).get('/api/coffrets')
      expect(res.status).toBe(200)
      expect(res.body[0].translations.fr).toBe('Coffret Prestige')
    })

    it('POST /api/coffrets rejects empty translations (400)', async () => {
      const res = await request(app).post('/api/coffrets').send({ translations: {} })
      expect(res.status).toBe(400)
    })

    it('POST /api/coffrets creates coffret (201)', async () => {
      const res = await request(app)
        .post('/api/coffrets')
        .send({ translations: { fr: 'Nouveau Coffret' } })

      expect(res.status).toBe(201)
    })

    it('PATCH /api/coffrets/:id returns 404 when not found', async () => {
      const res = await request(app)
        .patch('/api/coffrets/9999')
        .send({ is_active: false })

      expect(res.status).toBe(404)
    })

    it('DELETE /api/coffrets/:id deletes coffret and returns 200 with deleted count', async () => {
      const res = await request(app).delete('/api/coffrets/9999')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ deleted_note_count: 0 })
    })
  })

  // ──────────────────────────────────────────────
  // 5. Ingredients
  // ──────────────────────────────────────────────
  describe('Ingredients Routes', () => {
    it('GET /api/ingredients returns list', async () => {
      const res = await request(app).get('/api/ingredients')
      expect(res.status).toBe(200)
      expect(res.body[0].code).toBe('ROS-01')
      expect(res.body[0].allergens).toContain('Geraniol')
    })

    it('PATCH /api/ingredients/:id returns 404 when not found', async () => {
      const res = await request(app)
        .patch('/api/ingredients/9999')
        .send({ is_active: false })
      expect(res.status).toBe(404)
    })

    it('POST /api/ingredients validates required fields (400)', async () => {
      const res = await request(app).post('/api/ingredients').send({})
      expect(res.status).toBe(400)
    })

    it('DELETE /api/ingredients/:id returns 204 (idempotent delete)', async () => {
      const res = await request(app).delete('/api/ingredients/9999')
      expect(res.status).toBe(204)
    })
  })

  // ──────────────────────────────────────────────
  // 6. Ingredient Rules
  // ──────────────────────────────────────────────
  describe('Ingredient Rules Routes', () => {
    it('GET /api/ingredient-rules returns rules list', async () => {
      const res = await request(app).get('/api/ingredient-rules')
      expect(res.status).toBe(200)
      expect(res.body[0].rule_type).toBe('max_dosage')
      expect(res.body[0].bottle_sizes).toContain('30ml')
    })

    it('PATCH /api/ingredient-rules/:id returns 404 when not found', async () => {
      const res = await request(app)
        .patch('/api/ingredient-rules/9999')
        .send({ is_active: false })
      expect(res.status).toBe(404)
    })

    it('DELETE /api/ingredient-rules/:id returns 204 (idempotent delete)', async () => {
      const res = await request(app).delete('/api/ingredient-rules/9999')
      expect(res.status).toBe(204)
    })
  })

  // ──────────────────────────────────────────────
  // 7. Options
  // ──────────────────────────────────────────────
  describe('Options Routes', () => {
    it('GET /api/options returns options list', async () => {
      const res = await request(app).get('/api/options')
      expect(res.status).toBe(200)
      expect(res.body[0].translations.fr).toBe('Flacon Gravé')
    })

    it('PATCH /api/options/:id returns 404 when not found', async () => {
      const res = await request(app)
        .patch('/api/options/9999')
        .send({ is_active: false })
      expect(res.status).toBe(404)
    })

    it('POST /api/options validates required translations (400)', async () => {
      const res = await request(app).post('/api/options').send({})
      expect(res.status).toBe(400)
    })

    it('DELETE /api/options/:id returns 204 (idempotent delete)', async () => {
      const res = await request(app).delete('/api/options/9999')
      expect(res.status).toBe(204)
    })
  })

  // ──────────────────────────────────────────────
  // 8. Auth & Users
  // ──────────────────────────────────────────────
  describe('Auth Routes', () => {
    it('GET /api/users/by-pseudo returns 400 when pseudo is missing', async () => {
      const res = await request(app).get('/api/users/by-pseudo')
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Pseudo requis' })
    })

    it('GET /api/users/by-pseudo returns 404 when pseudo not found', async () => {
      const res = await request(app).get('/api/users/by-pseudo?pseudo=inconnu')
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Pseudo introuvable' })
    })

    it('GET /api/users/by-pseudo returns user when found and active', async () => {
      const res = await request(app).get('/api/users/by-pseudo?pseudo=alex')
      expect(res.status).toBe(200)
      expect(res.body.pseudo).toBe('alex')
    })

    it('GET /api/users/me returns 401 when x-user-email is missing', async () => {
      const res = await request(app).get('/api/users/me')
      expect(res.status).toBe(401)
      expect(res.body).toEqual({ error: 'Email requis' })
    })

    it('GET /api/users/me returns 404 when user not in database', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set('x-user-email', 'ghost@sdp.fr')

      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Utilisateur non trouvé' })
    })

    it('GET /api/users/me returns user profile when found', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set('x-user-email', 'admin@sdp.fr')

      expect(res.status).toBe(200)
      expect(res.body.email).toBe('admin@sdp.fr')
    })
  })

  // ──────────────────────────────────────────────
  // 9. Support Tickets & Notifications
  // ──────────────────────────────────────────────
  describe('Support & Notifications', () => {
    it('GET /api/tickets returns 401 when unauthenticated', async () => {
      const res = await request(app).get('/api/tickets')
      expect(res.status).toBe(401)
      expect(res.body).toEqual({ error: 'Authentification requise' })
    })

    it('GET /api/tickets returns tickets for admin', async () => {
      const res = await request(app)
        .get('/api/tickets')
        .set('x-user-email', 'admin@sdp.fr')

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
      expect(res.body[0].title).toBe('Bug affichage tablette')
    })

    it('POST /api/tickets rejects when missing required fields (400)', async () => {
      const res = await request(app)
        .post('/api/tickets')
        .set('x-user-email', 'admin@sdp.fr')
        .send({ title: '' })

      expect(res.status).toBe(400)
      expect(res.body).toHaveProperty('error')
    })

    it('GET /api/notifications returns 401 when email header is missing', async () => {
      const res = await request(app).get('/api/notifications')
      expect(res.status).toBe(401)
    })

    it('GET /api/conversations returns 401 when email header is missing', async () => {
      const res = await request(app).get('/api/conversations')
      expect(res.status).toBe(401)
    })
  })

  // ──────────────────────────────────────────────
  // 10. Admin Guard & Protection
  // ──────────────────────────────────────────────
  describe('Admin Guard Protection (requireAdmin)', () => {
    it('returns 401 when x-user-email is omitted on admin routes', async () => {
      const res = await request(app).get('/api/users')
      expect(res.status).toBe(401)
      expect(res.body).toEqual({ error: 'Authentification requise' })
    })

    it('returns 403 when user is not an admin', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('x-user-email', 'user@sdp.fr')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Accès réservé aux administrateurs' })
    })

    it('allows access (200) when user has admin role', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('x-user-email', 'admin@sdp.fr')

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
    })

    it('allows GET /api/roles for admin user', async () => {
      const res = await request(app)
        .get('/api/roles')
        .set('x-user-email', 'admin@sdp.fr')

      expect(res.status).toBe(200)
      expect(res.body[0].name).toBe('admin')
    })
  })

  // ──────────────────────────────────────────────
  // 11. Crash Resilience & Error Handling
  // ──────────────────────────────────────────────
  describe('Crash Resilience & Global Error Handling', () => {
    it('returns 404 for unknown endpoints at root level without crashing', async () => {
      const res = await request(app).get('/non-existent-route-xyz')
      expect(res.status).toBe(404)
    })

    it('handles unexpected database crashes with 500 JSON without killing the process', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Fatal MySQL deadlock or crash'))

      const res = await request(app).get('/api/coffrets')
      expect(res.status).toBe(500)
      expect(res.body).toHaveProperty('error')
    })

    it('remains responsive and healthy after an error occurred', async () => {
      // 1ère requête : crash provoqué
      mockQuery.mockRejectedValueOnce(new Error('Simulated crash'))
      await request(app).get('/api/coffrets')

      // 2ème requête : le serveur répond toujours parfaitement
      const health = await request(app).get('/health')
      expect(health.status).toBe(200)
      expect(health.body).toEqual({ status: 'ok' })
    })
  })
})
