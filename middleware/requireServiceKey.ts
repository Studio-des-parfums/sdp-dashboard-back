import { createHash, timingSafeEqual } from 'crypto'
import { Request, Response, NextFunction } from 'express'

const digest = (value: string) => createHash('sha256').update(value).digest()

/**
 * Réserve une route aux autres backends SDP (header x-service-key = INTERNAL_API_KEY).
 * Refuse tout si la clé n'est pas configurée côté serveur.
 */
export function requireServiceKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.INTERNAL_API_KEY
  if (!expected) {
    res.status(503).json({ error: 'API interne non configurée' })
    return
  }
  const provided = req.headers['x-service-key']
  if (typeof provided !== 'string' || !timingSafeEqual(digest(provided), digest(expected))) {
    res.status(401).json({ error: 'Clé de service invalide' })
    return
  }
  next()
}
