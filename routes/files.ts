import { Router, Request, Response } from 'express'
import { getPublicFileUrl } from '../services/s3'

// Images publiques (ateliers/, options/) d'un bucket privé : redirection vers une URL signée.
// Volontairement sans authentification, comme les anciennes URL S3 publiques (le catalogue
// les affiche hors connexion, ex. Nono). Les autres préfixes (messages/…) sont refusés.
const router = Router()

router.get(/^\/files\/(.+)$/, async (req: Request, res: Response) => {
  try {
    const key = decodeURIComponent((req.params as any)[0] as string)
    const url = await getPublicFileUrl(key)
    if (!url) {
      res.status(404).json({ error: 'Fichier introuvable' })
      return
    }
    // Cache court côté navigateur : l'URL signée expire au bout d'une heure.
    res.set('Cache-Control', 'public, max-age=600')
    res.redirect(302, url)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération du fichier' })
  }
})

export default router
