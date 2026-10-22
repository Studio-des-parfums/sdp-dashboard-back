import 'dotenv/config'
import mysql from 'mysql2/promise'

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'sdp_dashboard',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // La base distante coupe les connexions restées inactives (ECONNRESET à la requête suivante) :
  // on les maintient en vie et on ferme celles inactives depuis plus d'une minute.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  maxIdle: 2,
  idleTimeout: 60000,
})

export default pool
