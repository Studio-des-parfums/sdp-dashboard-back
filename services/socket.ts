import type { Server as HttpServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import pool from '../db'

let io: SocketIOServer | null = null

// Association utilisateur <-> socket(s). Un même utilisateur peut avoir
// plusieurs onglets/fenêtres ouverts en même temps.
const userSockets = new Map<number, Set<string>>()

async function getUserByEmail(email: string) {
  const [rows] = await pool.query<any[]>(
    `SELECT u.id, u.email, u.first_name, u.last_name
     FROM users u
     WHERE u.email = ? AND u.is_active = TRUE`,
    [email]
  )
  return rows[0] || null
}

export function initSocket(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
  })

  io.on('connection', async (socket) => {
    const email = socket.handshake.auth?.email || socket.handshake.query?.email
    if (!email || typeof email !== 'string') {
      socket.disconnect(true)
      return
    }

    const user = await getUserByEmail(email)
    if (!user) {
      socket.disconnect(true)
      return
    }

    socket.data.userId = user.id
    if (!userSockets.has(user.id)) userSockets.set(user.id, new Set())
    userSockets.get(user.id)!.add(socket.id)

    socket.on('disconnect', () => {
      const sockets = userSockets.get(user.id)
      if (sockets) {
        sockets.delete(socket.id)
        if (sockets.size === 0) userSockets.delete(user.id)
      }
    })
  })

  return io
}

export function getIO() {
  if (!io) throw new Error('Socket.IO not initialized')
  return io
}

export function emitToUser(userId: number, event: string, payload: unknown) {
  const sockets = userSockets.get(userId)
  if (!sockets || sockets.size === 0 || !io) return
  for (const socketId of sockets) {
    io.to(socketId).emit(event, payload)
  }
}

export function isUserOnline(userId: number) {
  return userSockets.has(userId)
}
