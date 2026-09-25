const app = document.querySelector('#app')
const navNew = document.querySelector('#navNew')
const navReviews = document.querySelector('#navReviews')

let reference = null
let candidate = null
let current = null
let selectedId = null
let codeDiffMode = 'split'

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const cls = v => String(v).replaceAll(' ', '')

function toast(msg) {
  const e = document.createElement('div')
  e.className = 'toast'
  e.textContent = msg
  document.body.append(e)
  setTimeout(() => e.remove(), 2200)
}

async function api(url, opts = {}) {
  const r = await fetch(url, opts)
  const ct = r.headers.get('content-type') || ''
  const data = ct.includes('json') ? await r.json() : await r.text()
  if (!r.ok) throw new Error(data.error || data || r.statusText)
  return data
}

function setTab(tab) {
  navNew.classList.toggle('active', tab === 'new')
  navReviews.classList.toggle('active', tab === 'reviews')
}

navNew.onclick = () => { setTab('new'); renderNew() }
navReviews.onclick = () => { setTab('reviews'); renderReviews() }

function renderNew() {
  current = null
  selectedId = null
  reference = null
  candidate = null

  app.innerHTML = `
    <div class="section-head">
      <div>
        <h1>Start a semantic model review</h1>
        <div class="muted">
          Select the root PBIP project folder for the reference and candidate models.
          The app reads only the semantic model TMDL definition and ignores report, cache and editor files.
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <label class="small muted">Review name</label>
      <input id="reviewName" type="text" style="width:100%;margin-top:.35rem"
        placeholder="e.g. Group Actuals — September enhancement review">
    </div>

    <div class="upload-grid">
      ${modelPicker('ref', 'Reference model')}
      ${modelPicker('cand', 'Candidate model')}
    </div>

    <div class="panel small muted" style="margin-top:1rem">
      <b>Expected PBIP structure</b><br>
      Project root → <code>&lt;name&gt;.SemanticModel</code> → <code>definition</code> → <code>*.tmdl</code>.
      You can select the whole PBIP project folder, the <code>.SemanticModel</code> folder, or the
      <code>definition</code> folder itself. For a quick demo, use the bundled sample model instead.
    </div>

    <div style="margin-top:1rem;display:flex;justify-content:flex-end">
      <button id="startBtn" class="primary" disabled>Compare & start review</button>
    </div>
  `

  bindPicker('ref', 'reference')
  bindPicker('cand', 'candidate')
  document.querySelector('#startBtn').onclick = startReview
}

function modelPicker(prefix, title) {
  return `
    <div class="card upload-card" id="${prefix}Card">
      <h2>${title}</h2>
      <label class="file">
        Choose PBIP project folder
        <input id="${prefix}Folder" type="file" webkitdirectory directory multiple>
      </label>
      <div class="or-separator"><span>or</span></div>
      <button type="button" id="${prefix}Sample" class="secondary sample-button">
        Use sample data
      </button>
      <div id="${prefix}Meta" class="small muted" style="margin-top:.7rem">No model loaded</div>
    </div>
  `
}

function bindPicker(prefix, which) {
  document.querySelector('#' + prefix + 'Folder').onchange = e => loadFolder(e.target.files, which)
  document.querySelector('#' + prefix + 'Sample').onclick = () => loadSample(which)
}

function setModel(which, model, sourceName) {
  model._sourceName = sourceName
  if (which === 'reference') reference = model
  else candidate = model

  const prefix = which === 'reference' ? 'ref' : 'cand'
  const meta = document.querySelector('#' + prefix + 'Meta')
  const tableCount = model.tables.length
  const columnCount = model.tables.reduce((n, t) => n + t.columns.length, 0)
  const measureCount = model.tables.reduce((n, t) => n + t.measures.length, 0)

  meta.innerHTML = `
    <b>${esc(sourceName)}</b><br>
    ${tableCount} tables · ${columnCount} columns · ${measureCount} measures<br>
    Fingerprint ${model.fingerprint.slice(0, 12)}…
  `
  meta.closest('.upload-card').classList.add('ready')
  document.querySelector('#startBtn').disabled = !(reference && candidate)
}

function selectedRootName(files) {
  const first = files[0]
  const relative = first?.webkitRelativePath || first?.name || 'PBIP Project'
  return relative.split('/')[0] || 'PBIP Project'
}

function semanticDefinitionFiles(files) {
  const all = Array.from(files)
  const normal = file => (file.webkitRelativePath || file.name || '').replaceAll('\\', '/')

  const tmdl = all.filter(file => {
    const p = normal(file)
    if (!p.toLowerCase().endsWith('.tmdl')) return false
    const lower = p.toLowerCase()
    return lower.includes('.semanticmodel/definition/') ||
      lower.startsWith('definition/') ||
      lower.includes('/definition/')
  })

  if (!tmdl.length) {
    const hasBim = all.some(file => normal(file).toLowerCase().endsWith('/model.bim') || normal(file).toLowerCase() === 'model.bim')
    if (hasBim) {
      throw new Error('This PBIP uses model.bim (TMSL). Save or upgrade the semantic model using TMDL format so a definition folder is created.')
    }
    throw new Error('No TMDL semantic model definition was found. Select the PBIP project root, its .SemanticModel folder, or its definition folder.')
  }

  const semanticRoots = new Set()
  for (const file of tmdl) {
    const p = normal(file)
    const match = p.match(/^(.*?\.SemanticModel)\/definition\//i)
    if (match) semanticRoots.add(match[1])
  }
  if (semanticRoots.size > 1) {
    throw new Error('More than one SemanticModel definition was found in this folder. Select the specific .SemanticModel folder you want to review.')
  }

  return tmdl
}

async function loadFolder(fileList, which) {
  if (!fileList?.length) return
  const prefix = which === 'reference' ? 'ref' : 'cand'
  const meta = document.querySelector('#' + prefix + 'Meta')
  meta.textContent = 'Reading PBIP folder…'

  try {
    const files = semanticDefinitionFiles(fileList)
    const rootName = selectedRootName(Array.from(fileList))
    const payloadFiles = await Promise.all(files.map(async file => ({
      path: (file.webkitRelativePath || file.name).replaceAll('\\', '/'),
      content: await file.text()
    })))

    const model = await api('/api/models/parse-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName: rootName,
        files: payloadFiles
      })
    })

    const sourceName = `${rootName} (PBIP folder)`
    setModel(which, model, sourceName)
  } catch (e) {
    meta.textContent = e.message
    toast(e.message)
  }
}

async function loadSample(which) {
  const prefix = which === 'reference' ? 'ref' : 'cand'
  const meta = document.querySelector('#' + prefix + 'Meta')
  const button = document.querySelector('#' + prefix + 'Sample')
  meta.textContent = 'Loading sample model…'
  button.disabled = true

  try {
    const model = await api('/api/models/sample?kind=' + encodeURIComponent(which))
    const sourceName = which === 'reference'
      ? 'Sample Sales — Reference'
      : 'Sample Sales — Candidate'
    setModel(which, model, sourceName)
    toast(`${which === 'reference' ? 'Reference' : 'Candidate'} sample loaded`)
  } catch (e) {
    meta.textContent = e.message
    toast(e.message)
  } finally {
    button.disabled = false
  }
}

async function startReview() {
  try {
    const name = document.querySelector('#reviewName').value.trim() ||
      `${reference._sourceName} vs ${candidate._sourceName}`

    current = await api('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        name,
        reference,
        candidate,
        referenceName: reference._sourceName,
        candidateName: candidate._sourceName
      })
    })

    selectedId = current.changes[0]?.id
    renderReview()
  } catch (e) {
    toast(e.message)
  }
}

function summariseChanges(changes) {
  const summary = {
    total: changes.length,
    Added: 0,
    Modified: 0,
    Removed: 0,
    Approved: 0,
    Rejected: 0,
    'Needs Review': 0,
    Unreviewed: 0
  }

  for (const change of changes) {
    summary[change.changeType] = (summary[change.changeType] ?? 0) + 1
    summary[change.reviewStatus] = (summary[change.reviewStatus] ?? 0) + 1
  }

  return summary
}

function kpis(s) {
  const arr = [
    ['Total', s.total],
    ['Added', s.Added],
    ['Modified', s.Modified],
    ['Removed', s.Removed],
    ['Approved', s.Approved],
    ['Rejected', s.Rejected],
    ['Needs review', s['Needs Review']],
    ['Unreviewed', s.Unreviewed]
  ]
  return `<div class="kpis" id="kpiStrip">${arr.map(([l,v]) =>
    `<div class="kpi"><div class="label">${l}</div><div class="value">${v ?? 0}</div></div>`
  ).join('')}</div>`
}

function formatDaxForDisplay(expression) {
  const source = String(expression ?? '').replace(/\r/g, '').trim()
  if (!source) return ''

  // Preserve author-supplied line breaks. For single-line expressions, add
  // display-only line breaks after argument separators while respecting strings.
  if (source.includes('\n')) return source

  let output = ''
  let depth = 0
  let inString = false

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]

    if (ch === '"') {
      if (inString && source[i + 1] === '"') {
        output += '""'
        i++
        continue
      }
      inString = !inString
      output += ch
      continue
    }

    if (!inString && ch === '(') {
      depth++
      output += ch
      continue
    }

    if (!inString && ch === ')') {
      depth = Math.max(0, depth - 1)
      output += ch
      continue
    }

    if (!inString && ch === ',' && depth > 0) {
      output += ',\n' + '  '.repeat(Math.min(depth, 8))
      while (source[i + 1] === ' ') i++
      continue
    }

    output += ch
  }

  return output
}

const DAX_KEYWORDS = new Set([
  'VAR','RETURN','IF','SWITCH','TRUE','FALSE','BLANK','CALCULATE','CALCULATETABLE',
  'FILTER','ALL','ALLSELECTED','REMOVEFILTERS','KEEPFILTERS','VALUES','SELECTEDVALUE',
  'SUM','SUMX','AVERAGE','AVERAGEX','MIN','MAX','COUNT','COUNTROWS','DISTINCTCOUNT',
  'DIVIDE','COALESCE','RELATED','RELATEDTABLE','DATE','YEAR','MONTH','DAY','TODAY',
  'SAMEPERIODLASTYEAR','DATEADD','TOTALYTD','TOTALMTD','TOTALQTD','ISBLANK','HASONEVALUE',
  'CONCATENATEX','FORMAT','RANKX','TOPN'
])

function highlightDax(expression) {
  const source = formatDaxForDisplay(expression)
  let html = ''
  let i = 0

  while (i < source.length) {
    const rest = source.slice(i)

    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? source.length : end
      html += `<span class="dax-comment">${esc(source.slice(i, stop))}</span>`
      i = stop
      continue
    }

    if (source[i] === '"') {
      let j = i + 1
      while (j < source.length) {
        if (source[j] === '"' && source[j + 1] === '"') { j += 2; continue }
        if (source[j] === '"') { j++; break }
        j++
      }
      html += `<span class="dax-string">${esc(source.slice(i, j))}</span>`
      i = j
      continue
    }

    if (source[i] === "'") {
      let j = i + 1
      while (j < source.length) {
        if (source[j] === "'" && source[j + 1] === "'") { j += 2; continue }
        if (source[j] === "'") { j++; break }
        j++
      }
      html += `<span class="dax-table">${esc(source.slice(i, j))}</span>`
      i = j
      continue
    }

    if (source[i] === '[') {
      const end = source.indexOf(']', i + 1)
      const j = end === -1 ? source.length : end + 1
      html += `<span class="dax-reference">${esc(source.slice(i, j))}</span>`
      i = j
      continue
    }

    const number = rest.match(/^\d+(?:\.\d+)?/)
    if (number) {
      html += `<span class="dax-number">${number[0]}</span>`
      i += number[0].length
      continue
    }

    const word = rest.match(/^[A-Za-z_][A-Za-z0-9_.]*/)
    if (word) {
      const token = word[0]
      let look = i + token.length
      while (source[look] === ' ') look++
      const upper = token.toUpperCase()
      const className = DAX_KEYWORDS.has(upper)
        ? 'dax-keyword'
        : source[look] === '('
          ? 'dax-function'
          : ''
      html += className ? `<span class="${className}">${esc(token)}</span>` : esc(token)
      i += token.length
      continue
    }

    if ('+-*/=<>:&|'.includes(source[i])) {
      html += `<span class="dax-operator">${esc(source[i])}</span>`
      i++
      continue
    }

    html += esc(source[i])
    i++
  }

  return html
}

function codeLanguage(change, property) {
  if (property.property !== 'expression') return null
  if (['Measure','Calculated Column','Calculated Table','Calculation Item'].includes(change.objectType)) return 'dax'
  if (['Partition','Power Query Expression','Expression'].includes(change.objectType)) return 'm'
  return null
}

function formatCodeForDiff(value, language) {
  const source = String(value ?? '').replace(/\r/g, '').trim()
  return language === 'dax' ? formatDaxForDisplay(source) : source
}

function highlightCodeLine(line, language) {
  if (language === 'dax') return highlightDax(line)
  return esc(line)
}

function lineDiff(reference, candidate, language) {
  const left = formatCodeForDiff(reference, language).split('\n')
  const right = formatCodeForDiff(candidate, language).split('\n')
  const n = left.length
  const m = right.length

  // Avoid quadratic memory use for unusually large expressions.
  if (n * m > 120000) {
    return [
      ...left.map(text => ({ type:'remove', text })),
      ...right.map(text => ({ type:'add', text }))
    ]
  }

  const lcs = Array.from({ length:n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = left[i] === right[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const ops = []
  let i = 0
  let j = 0

  while (i < n && j < m) {
    if (left[i] === right[j]) {
      ops.push({ type:'context', text:left[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type:'remove', text:left[i++] })
    } else {
      ops.push({ type:'add', text:right[j++] })
    }
  }

  while (i < n) ops.push({ type:'remove', text:left[i++] })
  while (j < m) ops.push({ type:'add', text:right[j++] })
  return ops
}

function splitDiffRows(ops) {
  const rows = []
  let oldLine = 1
  let newLine = 1
  let i = 0

  while (i < ops.length) {
    if (ops[i].type === 'context') {
      rows.push({
        left:{ type:'context', text:ops[i].text, line:oldLine++ },
        right:{ type:'context', text:ops[i].text, line:newLine++ }
      })
      i++
      continue
    }

    const chunk = []
    while (i < ops.length && ops[i].type !== 'context') chunk.push(ops[i++])
    const removed = chunk.filter(op => op.type === 'remove')
    const added = chunk.filter(op => op.type === 'add')
    const count = Math.max(removed.length, added.length)

    for (let k = 0; k < count; k++) {
      rows.push({
        left: removed[k] ? { type:'remove', text:removed[k].text, line:oldLine++ } : null,
        right: added[k] ? { type:'add', text:added[k].text, line:newLine++ } : null
      })
    }
  }

  return rows
}

function renderDiffCell(cell, language, side) {
  if (!cell) {
    return `<div class="git-diff-cell empty ${side}">
      <span class="git-line-number"></span><span class="git-marker"></span><code></code>
    </div>`
  }

  const marker = cell.type === 'add' ? '+' : cell.type === 'remove' ? '−' : ' '
  return `<div class="git-diff-cell ${cell.type} ${side}">
    <span class="git-line-number">${cell.line}</span>
    <span class="git-marker">${marker}</span>
    <code>${highlightCodeLine(cell.text, language) || '&nbsp;'}</code>
  </div>`
}

function renderSplitDiff(ops, language) {
  const rows = splitDiffRows(ops)
  return `
    <div class="git-split-head">
      <div>Reference</div>
      <div>Candidate</div>
    </div>
    <div class="git-split-body">
      ${rows.map(row => `
        ${renderDiffCell(row.left, language, 'left')}
        ${renderDiffCell(row.right, language, 'right')}
      `).join('')}
    </div>
  `
}

function renderUnifiedDiff(ops, language) {
  let oldLine = 1
  let newLine = 1

  return `<div class="git-unified-body">${ops.map(op => {
    const oldNo = op.type === 'add' ? '' : oldLine++
    const newNo = op.type === 'remove' ? '' : newLine++
    const marker = op.type === 'add' ? '+' : op.type === 'remove' ? '−' : ' '
    return `<div class="git-unified-row ${op.type}">
      <span class="git-line-number old">${oldNo}</span>
      <span class="git-line-number new">${newNo}</span>
      <span class="git-marker">${marker}</span>
      <code>${highlightCodeLine(op.text, language) || '&nbsp;'}</code>
    </div>`
  }).join('')}</div>`
}

function renderCodeDiff(change, property, index) {
  const language = codeLanguage(change, property) || 'text'
  const ops = lineDiff(property.reference, property.candidate, language)
  const added = ops.filter(op => op.type === 'add').length
  const removed = ops.filter(op => op.type === 'remove').length
  const body = codeDiffMode === 'unified'
    ? renderUnifiedDiff(ops, language)
    : renderSplitDiff(ops, language)

  return `
    <div class="git-diff" data-diff-index="${index}">
      <div class="git-diff-toolbar">
        <div>
          <b>${esc(property.property)}</b>
          <span class="small muted">${language === 'dax' ? 'DAX' : language === 'm' ? 'Power Query M' : 'Code'} · </span>
          <span class="diff-stat add">+${added}</span>
          <span class="diff-stat remove">−${removed}</span>
        </div>
        <div class="diff-toggle" role="group" aria-label="Diff view">
          <button type="button" class="${codeDiffMode === 'split' ? 'active' : ''}" data-diff-mode="split">Split</button>
          <button type="button" class="${codeDiffMode === 'unified' ? 'active' : ''}" data-diff-mode="unified">Unified</button>
        </div>
      </div>
      <div class="git-diff-body" data-diff-body="${index}">${body}</div>
    </div>
  `
}

function renderCodeDiffBody(change, property) {
  const language = codeLanguage(change, property) || 'text'
  const ops = lineDiff(property.reference, property.candidate, language)
  return codeDiffMode === 'unified'
    ? renderUnifiedDiff(ops, language)
    : renderSplitDiff(ops, language)
}

function renderReview() {
  if (!current) return
  const selected = current.changes.find(c => c.id === selectedId) || current.changes[0]
  selectedId = selected?.id

  app.innerHTML = `
    <div class="section-head">
      <div>
        <h1>${esc(current.name)}</h1>
        <div class="muted">${esc(current.id)} · ${esc(current.status)} · autosaved decisions</div>
      </div>
      <div class="row">
        <button class="secondary" id="exportJson">Export JSON</button>
        <button class="secondary" id="exportCsv">Export CSV</button>
        <button class="secondary" id="exportHtml">Export report</button>
        <button class="primary" id="finalise">Finalise review</button>
      </div>
    </div>

    ${kpis(current.summary)}

    <div class="panel row" style="margin:1rem 0;align-items:flex-end">
      <div>
        <div class="small muted">Reference</div>
        <b>${esc(current.reference.name)}</b>
        <div class="small muted">${current.reference.fingerprint.slice(0,16)}…</div>
      </div>
      <div style="font-size:20px;color:var(--muted)">→</div>
      <div>
        <div class="small muted">Candidate</div>
        <b>${esc(current.candidate.name)}</b>
        <div class="small muted">${current.candidate.fingerprint.slice(0,16)}…</div>
      </div>
      <div class="grow"></div>
      <input id="search" type="search" placeholder="Search changes…">
      <select id="typeFilter" title="Object type">
        <option>All types</option>
        ${[...new Set(current.changes.map(c => c.objectType))].map(x => `<option>${x}</option>`).join('')}
      </select>
      <select id="changeFilter" title="Change type">
        <option>All changes</option>
        <option>Added</option>
        <option>Modified</option>
        <option>Removed</option>
      </select>
      <select id="statusFilter" title="Review status">
        <option>All statuses</option>
        <option>Unreviewed</option>
        <option>Needs Review</option>
        <option>Approved</option>
        <option>Rejected</option>
      </select>
    </div>

    <div class="review-layout">
      <div class="card change-list" id="changeList"></div>
      <div class="card" id="detail"></div>
    </div>
  `

  const unresolved = (current.summary.Unreviewed || 0) + (current.summary['Needs Review'] || 0)
  const finalise = document.querySelector('#finalise')
  finalise.disabled = current.status === 'Finalised' || unresolved > 0
  finalise.title = unresolved ? `${unresolved} changes are unresolved` : ''
  finalise.onclick = finaliseReview

  document.querySelector('#exportJson').onclick = () => download('json')
  document.querySelector('#exportCsv').onclick = () => download('csv')
  document.querySelector('#exportHtml').onclick = () => download('html')
  document.querySelector('#search').oninput = renderChangeList
  ;['typeFilter','changeFilter','statusFilter'].forEach(id => {
    document.querySelector('#' + id).oninput = renderFilteredState
  })

  renderFilteredState()
  renderDetail(selected)
}

function filtered(includeSearch = true) {
  const q = includeSearch ? (document.querySelector('#search')?.value || '').toLowerCase() : ''
  const t = document.querySelector('#typeFilter')?.value
  const ch = document.querySelector('#changeFilter')?.value
  const s = document.querySelector('#statusFilter')?.value

  return current.changes.filter(c =>
    (!q || c.objectPath.toLowerCase().includes(q)) &&
    (!t || t === 'All types' || c.objectType === t) &&
    (!ch || ch === 'All changes' || c.changeType === ch) &&
    (!s || s === 'All statuses' || c.reviewStatus === s)
  )
}

function renderFilteredState() {
  renderKpis()
  renderChangeList()
}

function renderKpis() {
  const existing = document.querySelector('#kpiStrip')
  if (!existing) return

  const wrapper = document.createElement('div')
  wrapper.innerHTML = kpis(summariseChanges(filtered(false)))
  existing.replaceWith(wrapper.firstElementChild)
}

function renderChangeList() {
  const el = document.querySelector('#changeList')
  if (!el) return
  const rows = filtered()

  el.innerHTML = rows.length ? rows.map(c => `
    <div class="change-row ${c.id === selectedId ? 'active' : ''}" data-id="${c.id}">
      <div class="row" style="justify-content:space-between">
        <b>${esc(c.objectName)}</b>
        <span class="badge ${cls(c.changeType)}">${c.changeType}</span>
      </div>
      <div class="small muted">${esc(c.objectType)} · ${esc(c.objectPath)}</div>
      <div style="margin-top:.35rem">
        <span class="badge ${cls(c.reviewStatus)}">${esc(c.reviewStatus)}</span>
      </div>
    </div>
  `).join('') : '<div class="muted" style="padding:1rem">No matching changes.</div>'

  if (!rows.length) {
    selectedId = null
    renderDetail(null)
  } else if (!rows.some(c => c.id === selectedId)) {
    selectedId = rows[0].id
    renderDetail(rows[0])
  }

  el.querySelectorAll('.change-row').forEach(row => {
    row.onclick = () => {
      selectedId = row.dataset.id
      renderChangeList()
      renderDetail(current.changes.find(c => c.id === selectedId))
    }
  })
}

function renderDetail(c) {
  const el = document.querySelector('#detail')
  if (!c) {
    el.innerHTML = '<div class="muted">No changes detected.</div>'
    return
  }

  const readonly = current.status === 'Finalised'
  let diffs = ''

  if (c.changeType === 'Modified') {
    const codeChanges = c.propertyChanges.filter(p => codeLanguage(c, p))
    const metadataChanges = c.propertyChanges.filter(p => !codeLanguage(c, p))

    diffs = [
      metadataChanges.length ? `
        <div class="diff-grid">
          <div class="h">Property</div>
          <div class="h">Reference</div>
          <div class="h">Candidate</div>
          ${metadataChanges.map(p => `
            <div class="prop">${esc(p.property)}</div>
            <div class="code">${esc(p.reference)}</div>
            <div class="code">${esc(p.candidate)}</div>
          `).join('')}
        </div>
      ` : '',
      ...codeChanges.map((p, index) => renderCodeDiff(c, p, index))
    ].join('')
  } else {
    const obj = c.changeType === 'Added' ? c.candidateObject : c.referenceObject
    const sideLabel = c.changeType === 'Added' ? 'Candidate' : 'Reference'

    if (c.objectType === 'Measure' && obj) {
      const metadata = [
        ['Format string', obj.formatString],
        ['Display folder', obj.displayFolder],
        ['Description', obj.description],
        ['Hidden', obj.hidden ? 'true' : 'false']
      ].filter(([, value]) => value !== undefined && value !== null && value !== '')

      diffs = `
        <div class="measure-block">
          <div class="measure-block-head">
            <span>DAX expression</span>
            <span class="small muted">${sideLabel}</span>
          </div>
          <pre class="code dax-code">${highlightDax(obj.expression)}</pre>
          ${metadata.length ? `
            <div class="measure-meta">
              ${metadata.map(([label, value]) => `
                <div><span class="small muted">${esc(label)}</span><br><b>${esc(value)}</b></div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `
    } else {
      diffs = `
        <div class="diff-grid">
          <div class="h">Object</div>
          <div class="h" style="grid-column:span 2">${sideLabel}</div>
          <div class="prop">Definition</div>
          <div class="code" style="grid-column:span 2">${esc(JSON.stringify(obj, null, 2))}</div>
        </div>
      `
    }
  }

  el.innerHTML = `
    <div class="detail-head">
      <div>
        <div class="small muted">${esc(c.objectType)}</div>
        <h2 style="font-size:1.25rem">${esc(c.objectPath)}</h2>
      </div>
      <span class="badge ${cls(c.changeType)}">${c.changeType}</span>
    </div>

    ${diffs}

    <hr style="border:0;border-top:1px solid var(--surface2);margin:1rem 0">

    <div class="small muted" style="margin-bottom:.45rem">Review decision</div>
    <div class="status-actions">
      ${['Approved','Rejected','Needs Review','Unreviewed'].map(s =>
        `<button class="secondary ${c.reviewStatus === s ? 'selected' : ''}" data-status="${s}" ${readonly ? 'disabled' : ''}>${s}</button>`
      ).join('')}
    </div>

    <label class="small muted" style="display:block;margin-top:1rem">Reviewer comment</label>
    <textarea id="comment" ${readonly ? 'disabled' : ''}>${esc(c.reviewComment)}</textarea>

    <div style="display:flex;justify-content:flex-end;margin-top:.5rem">
      <button class="primary" id="saveDecision" ${readonly ? 'disabled' : ''}>Save decision</button>
    </div>

    ${c.reviewedAt ? `<div class="small muted" style="margin-top:.6rem">Last reviewed ${new Date(c.reviewedAt).toLocaleString()}</div>` : ''}
  `

  const codeChanges = c.changeType === 'Modified'
    ? c.propertyChanges.filter(p => codeLanguage(c, p))
    : []

  el.querySelectorAll('[data-diff-mode]').forEach(button => {
    button.onclick = () => {
      codeDiffMode = button.dataset.diffMode
      el.querySelectorAll('[data-diff-mode]').forEach(x =>
        x.classList.toggle('active', x.dataset.diffMode === codeDiffMode)
      )
      codeChanges.forEach((property, index) => {
        const body = el.querySelector(`[data-diff-body="${index}"]`)
        if (body) body.innerHTML = renderCodeDiffBody(c, property)
      })
    }
  })

  let status = c.reviewStatus
  el.querySelectorAll('[data-status]').forEach(button => {
    button.onclick = () => {
      status = button.dataset.status
      el.querySelectorAll('[data-status]').forEach(x => x.classList.toggle('selected', x.dataset.status === status))
    }
  })

  document.querySelector('#saveDecision').onclick = () =>
    saveDecision(c, status, document.querySelector('#comment').value)
}

async function saveDecision(c, status, comment) {
  try {
    current = await api(`/api/reviews/${encodeURIComponent(current.id)}/changes/${c.id}`, {
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({status,comment})
    })
    selectedId = c.id
    renderReview()
    toast('Decision saved')
  } catch (e) {
    toast(e.message)
  }
}

async function finaliseReview() {
  if (!confirm('Finalise this review? A finalised review becomes read-only.')) return
  try {
    current = await api(`/api/reviews/${encodeURIComponent(current.id)}/finalise`, {method:'POST'})
    renderReview()
    toast('Review finalised')
  } catch (e) {
    toast(e.message)
  }
}

function download(fmt) {
  window.location = `/api/reviews/${encodeURIComponent(current.id)}/export?format=${fmt}`
}

async function renderReviews() {
  app.innerHTML = '<h1>Saved reviews</h1><div class="muted" style="margin-bottom:1rem">Open an in-progress review or inspect a finalised review.</div><div class="card">Loading…</div>'

  try {
    const reviews = await api('/api/reviews')
    app.innerHTML = `
      <div class="section-head">
        <div>
          <h1>Saved reviews</h1>
          <div class="muted">Persistent review workspaces</div>
        </div>
      </div>
      <div class="card">
        ${reviews.length ? `
          <table class="review-table">
            <thead><tr><th>Review</th><th>Status</th><th>Models</th><th>Progress</th><th>Updated</th><th class="action-col">Delete</th></tr></thead>
            <tbody>
              ${reviews.map(r => `
                <tr data-id="${r.id}" style="cursor:pointer">
                  <td><b>${esc(r.name)}</b><div class="small muted">${r.id}</div></td>
                  <td>${esc(r.status)}</td>
                  <td>${esc(r.reference.name)} → ${esc(r.candidate.name)}</td>
                  <td>${r.summary.Approved + r.summary.Rejected}/${r.summary.total} resolved</td>
                  <td>${new Date(r.updatedAt).toLocaleString()}</td>
                  <td class="action-col">
                    <button class="icon-button delete-review" data-delete-id="${r.id}" data-delete-name="${esc(r.name)}" title="Delete review" aria-label="Delete ${esc(r.name)}">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-.7 11H7.7L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"></path>
                      </svg>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<div class="muted">No saved reviews yet.</div>'}
      </div>
    `

    app.querySelectorAll('tr[data-id]').forEach(row => {
      row.onclick = async () => {
        current = await api('/api/reviews/' + encodeURIComponent(row.dataset.id))
        selectedId = current.changes[0]?.id
        renderReview()
      }
    })

    app.querySelectorAll('.delete-review').forEach(button => {
      button.onclick = async event => {
        event.stopPropagation()
        const id = button.dataset.deleteId
        const name = button.dataset.deleteName || id
        if (!confirm(`Delete saved review "${name}"? This permanently removes its saved decisions and comments from the local review database.`)) return

        try {
          await api('/api/reviews/' + encodeURIComponent(id), { method: 'DELETE' })
          toast('Review deleted')
          renderReviews()
        } catch (e) {
          toast(e.message)
        }
      }
    })
  } catch (e) {
    app.innerHTML = `<div class="card">${esc(e.message)}</div>`
  }
}

renderNew()
