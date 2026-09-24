import crypto from 'node:crypto'

const TABLE_PROPS = ['description','hidden']
const COLUMN_PROPS = ['dataType','sourceColumn','formatString','hidden','description','summarizeBy']
const MEASURE_PROPS = ['expression','formatString','displayFolder','description','hidden']

function stableId(input) {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16)
}

function flat(model) {
  const map = new Map()
  for (const table of model.tables ?? []) {
    map.set(`Table|${table.name}`, { objectType: 'Table', objectPath: table.name, objectName: table.name, object: table, props: TABLE_PROPS })
    for (const c of table.columns ?? []) {
      map.set(`Column|${table.name}[${c.name}]`, { objectType: 'Column', objectPath: `${table.name}[${c.name}]`, objectName: c.name, object: c, props: COLUMN_PROPS })
    }
    for (const m of table.measures ?? []) {
      map.set(`Measure|${table.name}[${m.name}]`, { objectType: 'Measure', objectPath: `${table.name}[${m.name}]`, objectName: m.name, object: m, props: MEASURE_PROPS })
    }
  }
  return map
}

function norm(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value.replace(/\r/g, '').trim()
  return value
}

export function compareModels(reference, candidate) {
  const ref = flat(reference)
  const cand = flat(candidate)
  const keys = [...new Set([...ref.keys(), ...cand.keys()])].sort()
  const changes = []

  for (const key of keys) {
    const r = ref.get(key)
    const c = cand.get(key)
    const base = c ?? r
    if (!r) {
      changes.push(makeChange(base, 'Added', [], null, c.object))
      continue
    }
    if (!c) {
      changes.push(makeChange(base, 'Removed', [], r.object, null))
      continue
    }
    const propertyChanges = []
    for (const p of r.props) {
      const before = norm(r.object[p])
      const after = norm(c.object[p])
      if (before !== after) propertyChanges.push({ property: p, reference: before, candidate: after })
    }
    if (propertyChanges.length) changes.push(makeChange(base, 'Modified', propertyChanges, r.object, c.object))
  }

  const counts = changes.reduce((a, x) => { a[x.changeType] = (a[x.changeType] ?? 0) + 1; return a }, { Added:0, Modified:0, Removed:0 })
  return { changes, summary: { total: changes.length, ...counts } }
}

function makeChange(base, changeType, propertyChanges, referenceObject, candidateObject) {
  const identity = `${base.objectType}|${base.objectPath}|${changeType}`
  return {
    id: stableId(identity),
    objectType: base.objectType,
    objectPath: base.objectPath,
    objectName: base.objectName,
    changeType,
    propertyChanges,
    referenceObject,
    candidateObject,
    reviewStatus: 'Unreviewed',
    reviewComment: '',
    reviewedAt: null
  }
}
