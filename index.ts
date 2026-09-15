import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import dashboardRoutes from './routes/dashboards'
import authRoutes from './routes/auth'
import adminRoutes from './routes/admin'
import ticketRoutes from './routes/tickets'
import notificationRoutes from './routes/notifications'
import messageRoutes from './routes/messages'
import ingredientRoutes from './routes/ingredients'
import ingredientRuleRoutes from './routes/ingredient-rules'
import coffretRoutes from './routes/coffrets'
import atelierRoutes from './routes/ateliers'
import { initSocket } from './services/socket'

const app = express()
const PORT = Number(process.env.PORT) || 3001

app.use(cors({ origin: '*' }))
app.use(express.json())

// Les routers sans middleware de garde global sont montés avant adminRoutes :
// adminRoutes applique requireAdmin() à toute requête entrant dans /api,
// donc il doit passer en dernier pour ne pas bloquer les autres routes.
app.use('/api', dashboardRoutes)
app.use('/api', authRoutes)
app.use('/api', ticketRoutes)
app.use('/api', notificationRoutes)
app.use('/api', messageRoutes)
app.use('/api', ingredientRoutes)
app.use('/api', ingredientRuleRoutes)
app.use('/api', coffretRoutes)
app.use('/api', atelierRoutes)
app.use('/api', adminRoutes)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

const httpServer = createServer(app)
initSocket(httpServer)

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
