import http from 'node:http'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleApiRequest, send } from './httpApp.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const publicDir = path.join(root, 'public')
const port = Number(process.env.PORT ?? 5174)

async function staticFile(req,res,url) {
  let rel = decodeURIComponent(url.pathname)
  if (rel === '/') rel = '/index.html'
  const full = path.resolve(publicDir, '.' + rel)
  if (!full.startsWith(publicDir) || !fssync.existsSync(full) || fssync.statSync(full).isDirectory()) return false
  const ext = path.extname(full)
  const types = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml' }
  res.writeHead(200,{'Content-Type':types[ext] ?? 'application/octet-stream'})
  fssync.createReadStream(full).pipe(res)
  return true
}

const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApiRequest(req,res,url)
      if (handled !== false) return
      return send(res,404,{error:'API route not found'})
    }
    if (await staticFile(req,res,url)) return
    const html = await fs.readFile(path.join(publicDir,'index.html'))
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'})
    res.end(html)
  } catch (err) {
    console.error(err)
    send(res, err.code === 'UNRESOLVED_CHANGES' ? 409 : 400, { error: err.message })
  }
})

server.listen(port, () => console.log(`Semantic Model Reviewer running at http://localhost:${port}`))
