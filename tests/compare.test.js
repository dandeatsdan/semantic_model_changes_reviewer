import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTmdlFolder, parseTmdlFiles } from '../server/tmdlParser.js'
import { compareModels } from '../server/compare.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('detects added, removed and modified semantic objects', async () => {
  const ref = await parseTmdlFolder(path.join(root, 'samples/reference/definition'))
  const cand = await parseTmdlFolder(path.join(root, 'samples/candidate/definition'))
  const result = compareModels(ref, cand)

  assert.equal(result.summary.Added, 2)
  assert.equal(result.summary.Removed, 1)
  assert.equal(result.summary.Modified, 2)
  assert.equal(result.summary.total, 5)
  assert.ok(result.changes.some(c => c.objectPath === 'Sales[Net Sales]' && c.changeType === 'Modified'))
  assert.ok(result.changes.some(c => c.objectPath === 'Sales[Region]' && c.changeType === 'Added'))
  assert.ok(result.changes.some(c => c.objectPath === 'Sales[Legacy Margin]' && c.changeType === 'Removed'))
})

test('parses TMDL files selected from a PBIP project folder', async () => {
  const definition = path.join(root, 'samples/reference/definition')
  const modelText = await (await import('node:fs/promises')).readFile(path.join(definition, 'model.tmdl'), 'utf8')
  const salesText = await (await import('node:fs/promises')).readFile(path.join(definition, 'tables/Sales.tmdl'), 'utf8')
  const dateText = await (await import('node:fs/promises')).readFile(path.join(definition, 'tables/Date.tmdl'), 'utf8')

  const model = parseTmdlFiles([
    { path: 'Example/Example.SemanticModel/definition/model.tmdl', content: modelText },
    { path: 'Example/Example.SemanticModel/definition/tables/Sales.tmdl', content: salesText },
    { path: 'Example/Example.SemanticModel/definition/tables/Date.tmdl', content: dateText }
  ])

  assert.equal(model.name, 'Example')
  assert.equal(model.tables.length, 2)
  assert.ok(model.tables.some(t => t.name === 'Sales'))
  assert.ok(model.fingerprint)
})
