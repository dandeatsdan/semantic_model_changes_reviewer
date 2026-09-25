import { handleApiRequest, send } from '../server/httpApp.js'

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
    const routed = req.query?.path
    const routePath = Array.isArray(routed) ? routed.join('/') : String(routed ?? '')

    if (routePath) {
      url.pathname = '/api/' + routePath.replace(/^\/+/, '')
      url.searchParams.delete('path')
    }

    const handled = await handleApiRequest(req, res, url)
    if (handled !== false) return
    return send(res, 404, { error: 'API route not found' })
  } catch (err) {
    console.error(err)
    return send(
      res,
      err.code === 'UNRESOLVED_CHANGES' ? 409 : 400,
      { error: err.message }
    )
  }
}
