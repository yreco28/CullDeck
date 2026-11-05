import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import electronPath from 'electron'

const server = await createServer({ configFile: 'vite.config.js' })
await server.listen()
server.printUrls()

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5199' }
})

const shutdown = async () => {
  try {
    await server.close()
  } finally {
    process.exit(0)
  }
}

child.on('exit', shutdown)
process.on('SIGINT', () => {
  child.kill()
  shutdown()
})
