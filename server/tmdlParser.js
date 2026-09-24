import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const COLUMN_PROPS = new Set(['dataType','sourceColumn','formatString','isHidden','description','summarizeBy','displayFolder','sortByColumn'])
const MEASURE_PROPS = new Set(['formatString','displayFolder','description','isHidden','dataCategory'])
const TABLE_PROPS = new Set(['description','isHidden','dataCategory'])

function indentOf(line) {
  const m = line.match(/^[\t ]*/)?.[0] ?? ''
  return [...m].reduce((n, c) => n + (c === '\t' ? 4 : 1), 0)
}

function unquote(value = '') {
  const v = value.trim()
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    return v.slice(1, -1).replace(/''/g, "'").replace(/\"\"/g, '"')
  }
  return v
}

function parseBool(value) {
  if (String(value).toLowerCase() === 'true') return true
  if (String(value).toLowerCase() === 'false') return false
  return value
}

function splitProperty(line) {
  const t = line.trim()
  const idx = t.indexOf(':')
  if (idx <= 0) return null
  return [t.slice(0, idx).trim(), unquote(t.slice(idx + 1).trim())]
}

function parseObjectName(afterKeyword) {
  return unquote(afterKeyword.trim())
}

function normaliseExpression(lines) {
  return lines.join('\n').trim().replace(/\r/g, '')
}

export function parseTmdlText(text, source = 'model.tmdl') {
  const lines = text.replace(/\r/g, '').split('\n')
  const tables = []
  let table = null
  let current = null

  const flushCurrent = () => {
    if (!current || !table) return
    if (current.kind === 'measure') current.obj.expression = normaliseExpression(current.expressionLines)
    if (current.kind === 'column') table.columns.push(current.obj)
    if (current.kind === 'measure') table.measures.push(current.obj)
    current = null
  }

  const flushTable = () => {
    flushCurrent()
    if (table) tables.push(table)
    table = null
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('//')) continue
    const indent = indentOf(raw)

    const tableMatch = trimmed.match(/^table\s+(.+)$/)
    if (tableMatch && indent <= 1) {
      flushTable()
      table = { name: parseObjectName(tableMatch[1]), description: '', hidden: false, columns: [], measures: [], source }
      continue
    }
    if (!table) continue

    const columnMatch = trimmed.match(/^column\s+(.+)$/)
    if (columnMatch) {
      flushCurrent()
      current = {
        kind: 'column',
        indent,
        obj: { table: table.name, name: parseObjectName(columnMatch[1]), dataType: '', sourceColumn: '', formatString: '', hidden: false, description: '', summarizeBy: '' }
      }
      continue
    }

    const measureMatch = trimmed.match(/^measure\s+(.+?)\s*=\s*(.*)$/)
    if (measureMatch) {
      flushCurrent()
      current = {
        kind: 'measure',
        indent,
        obj: { table: table.name, name: parseObjectName(measureMatch[1]), expression: '', formatString: '', displayFolder: '', description: '', hidden: false },
        expressionLines: measureMatch[2] ? [measureMatch[2]] : []
      }
      continue
    }

    const prop = splitProperty(raw)
    if (current && prop && indent > current.indent) {
      const [key, rawValue] = prop
      const allowed = current.kind === 'column' ? COLUMN_PROPS : MEASURE_PROPS
      if (allowed.has(key)) {
        const value = parseBool(rawValue)
        if (key === 'isHidden') current.obj.hidden = value
        else current.obj[key] = value
        continue
      }
    }

    if (current?.kind === 'measure' && indent > current.indent) {
      current.expressionLines.push(trimmed)
      continue
    }

    if (prop && indent > 0 && TABLE_PROPS.has(prop[0])) {
      const [key, rawValue] = prop
      const value = parseBool(rawValue)
      if (key === 'isHidden') table.hidden = value
      else table[key] = value
    }
  }

  flushTable()
  return tables
}

export async function parseTmdlFolder(definitionPath) {
  const files = []
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && entry.name.endsWith('.tmdl')) files.push(full)
    }
  }
  await walk(definitionPath)

  const model = { name: path.basename(path.dirname(definitionPath)), compatibilityLevel: null, tables: [], relationships: [], roles: [] }
  for (const file of files.sort()) {
    const text = await fs.readFile(file, 'utf8')
    model.tables.push(...parseTmdlText(text, path.relative(definitionPath, file)))

    const compat = text.match(/compatibilityLevel:\s*(\d+)/)
    if (compat) model.compatibilityLevel = Number(compat[1])
  }

  const dedup = new Map()
  for (const t of model.tables) {
    if (!dedup.has(t.name)) dedup.set(t.name, t)
    else {
      const existing = dedup.get(t.name)
      existing.columns.push(...t.columns)
      existing.measures.push(...t.measures)
    }
  }
  model.tables = [...dedup.values()].sort((a,b) => a.name.localeCompare(b.name))
  for (const t of model.tables) {
    t.columns.sort((a,b) => a.name.localeCompare(b.name))
    t.measures.sort((a,b) => a.name.localeCompare(b.name))
  }
  model.fingerprint = fingerprintModel(model)
  return model
}

export function fingerprintModel(model) {
  const clone = structuredClone(model)
  delete clone.fingerprint
  return crypto.createHash('sha256').update(JSON.stringify(clone)).digest('hex')
}
