import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseTmdlFolder, parseTmdlFiles } from './tmdlParser.js'
import { compareModels } from './compare.js'
import { createStore } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const defaultDbPath = process.env.VERCEL
  ? path.join(os.tmpdir(), 'semantic-model-reviewer', 'reviews.db')
  : path.join(root, 'data', 'reviews.db')
const store = createStore(process.env.SMR_DB ?? defaultDbPath)

export function send(res, status, body, headers = {}) {
  const isBuffer = Buffer.isBuffer(body)
  const payload = isBuffer ? body : typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': isBuffer ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    ...headers
  })
  res.end(payload)
}

async function readBody(req, limit = 80 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error(`Request exceeds ${Math.round(limit / 1024 / 1024)} MB limit`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function json(req, limit = 30 * 1024 * 1024) {
  const b = await readBody(req, limit)
  return b.length ? JSON.parse(b.toString('utf8')) : {}
}

async function findDefinition(dir) {
  const matches = []
  async function walk(d) {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === 'definition') {
          const names = await fs.readdir(full)
          if (names.some(n => n.endsWith('.tmdl')) || names.includes('tables')) matches.push(full)
        }
        await walk(full)
      }
    }
  }
  await walk(dir)
  return matches.sort((a,b) => a.length - b.length)[0] ?? null
}

function cleanFileName(name) {
  return path.basename(name || 'semantic-model.zip').replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function parseZip(buffer, originalName) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'smr-'))
  try {
    const zipPath = path.join(tmp, cleanFileName(originalName))
    await fs.writeFile(zipPath, buffer)
    const outDir = path.join(tmp, 'unzipped')
    await fs.mkdir(outDir)
    const result = spawnSync('unzip', ['-q', zipPath, '-d', outDir], { encoding:'utf8' })
    if (result.status !== 0) throw new Error(`Unable to extract ZIP: ${result.stderr || 'invalid archive'}`)
    const definition = await findDefinition(outDir)
    if (!definition) throw new Error('No Power BI TMDL definition folder was found in this ZIP')
    const model = await parseTmdlFolder(definition)
    model.name = originalName?.replace(/\.zip$/i,'') || model.name
    return model
  } finally {
    await fs.rm(tmp, { recursive:true, force:true })
  }
}

function validateFolderPayload(body) {
  if (!Array.isArray(body.files) || !body.files.length) throw new Error('No TMDL files were supplied from the selected folder')
  if (body.files.length > 10000) throw new Error('Selected folder contains too many TMDL files')
  for (const file of body.files) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
      throw new Error('Invalid folder file payload')
    }
    if (!file.path.toLowerCase().endsWith('.tmdl')) throw new Error('Folder payload must contain TMDL files only')
  }
}

function reviewCsv(review) {
  const q = v => `"${String(v ?? '').replaceAll('"','""')}"`
  const rows = [['Change ID','Object Type','Object Path','Change Type','Review Status','Comment','Reviewed At']]
  for (const c of review.changes) rows.push([c.id,c.objectType,c.objectPath,c.changeType,c.reviewStatus,c.reviewComment,c.reviewedAt])
  return rows.map(r => r.map(q).join(',')).join('\n')
}

function reviewHtml(review) {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  const rows = review.changes.map(c => `<tr><td>${esc(c.objectType)}</td><td>${esc(c.objectPath)}</td><td>${esc(c.changeType)}</td><td>${esc(c.reviewStatus)}</td><td>${esc(c.reviewComment)}</td></tr>`).join('')
  return `<!doctype html><meta charset="utf-8"><title>${esc(review.id)} Semantic Model Review</title><style>body{font:14px Inter,Arial,sans-serif;color:#121000;margin:40px}h1{color:#003600}table{border-collapse:collapse;width:100%}th,td{border:1px solid #BBBCAA;padding:8px;text-align:left}th{background:#F7F7F7}.k{display:flex;gap:16px}.k div{border-top:3px solid #007F00;border:1px solid #BBBCAA;padding:12px 16px}</style><h1>Semantic Model Change Review</h1><p><b>${esc(review.name)}</b> · ${esc(review.id)} · ${esc(review.status)}</p><p>Reference: ${esc(review.reference.name)} (${esc(review.reference.fingerprint.slice(0,12))}…)</p><p>Candidate: ${esc(review.candidate.name)} (${esc(review.candidate.fingerprint.slice(0,12))}…)</p><div class="k"><div>${review.summary.total}<br><small>Total changes</small></div><div>${review.summary.Approved}<br><small>Approved</small></div><div>${review.summary.Rejected}<br><small>Rejected</small></div><div>${review.summary['Needs Review']}<br><small>Needs review</small></div></div><h2>Change register</h2><table><thead><tr><th>Type</th><th>Object</th><th>Change</th><th>Decision</th><th>Comment</th></tr></thead><tbody>${rows}</tbody></table>`
}

export async function handleApiRequest(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res,200,{ok:true})

  if (req.method === 'GET' && url.pathname === '/api/models/sample') {
    const kind = url.searchParams.get('kind')
    if (!['reference','candidate'].includes(kind)) {
      return send(res,400,{error:'Sample kind must be reference or candidate'})
    }
    const model = await parseTmdlFolder(path.join(root, 'samples', kind, 'definition'))
    model.name = kind === 'reference' ? 'Sample Sales — Reference' : 'Sample Sales — Candidate'
    return send(res,200,model)
  }

  if (req.method === 'POST' && url.pathname === '/api/models/parse-folder') {
    const body = await json(req, 50 * 1024 * 1024)
    validateFolderPayload(body)
    const model = parseTmdlFiles(body.files, body.modelName || body.projectName || 'Semantic Model')
    return send(res,200,model)
  }

  // Legacy ZIP parser remains server-side for compatibility, but is no longer exposed in the UI.
  if (req.method === 'POST' && url.pathname === '/api/models/parse') {
    const buffer = await readBody(req)
    const model = await parseZip(buffer, req.headers['x-file-name'])
    return send(res,200,model)
  }

  if (req.method === 'POST' && url.pathname === '/api/compare') {
    const body = await json(req)
    return send(res,200,compareModels(body.reference, body.candidate))
  }

  if (req.method === 'POST' && url.pathname === '/api/reviews') {
    const body = await json(req)
    const comparison = compareModels(body.reference, body.candidate)
    const review = store.create({ ...body, comparison })
    return send(res,201,review)
  }

  if (req.method === 'GET' && url.pathname === '/api/reviews') return send(res,200,store.list())

  const reviewMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)$/)
  if (req.method === 'GET' && reviewMatch) {
    const review = store.get(decodeURIComponent(reviewMatch[1]))
    return review ? send(res,200,review) : send(res,404,{error:'Review not found'})
  }
  if (req.method === 'DELETE' && reviewMatch) {
    const deleted = store.delete(decodeURIComponent(reviewMatch[1]))
    return deleted ? send(res,200,{deleted:true}) : send(res,404,{error:'Review not found'})
  }

  const changeMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/changes\/([^/]+)$/)
  if (req.method === 'PATCH' && changeMatch) {
    const body = await json(req)
    const allowed = ['Unreviewed','Approved','Rejected','Needs Review']
    if (!allowed.includes(body.status)) return send(res,400,{error:'Invalid review status'})
    const review = store.updateChange(decodeURIComponent(changeMatch[1]), decodeURIComponent(changeMatch[2]), body)
    return review ? send(res,200,review) : send(res,404,{error:'Review not found'})
  }

  const finalMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/finalise$/)
  if (req.method === 'POST' && finalMatch) {
    const review = store.finalise(decodeURIComponent(finalMatch[1]))
    return review ? send(res,200,review) : send(res,404,{error:'Review not found'})
  }

  const exportMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/export$/)
  if (req.method === 'GET' && exportMatch) {
    const review = store.get(decodeURIComponent(exportMatch[1]))
    if (!review) return send(res,404,{error:'Review not found'})
    const fmt = url.searchParams.get('format') ?? 'json'
    if (fmt === 'csv') return send(res,200,reviewCsv(review),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${review.id}.csv"`})
    if (fmt === 'html') return send(res,200,reviewHtml(review),{'Content-Type':'text/html; charset=utf-8','Content-Disposition':`attachment; filename="${review.id}.html"`})
    return send(res,200,JSON.stringify(review,null,2),{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="${review.id}.json"`})
  }
  return false
}

