import './themes.js'
import '@ui5/webcomponents/dist/Table.js'
import '@ui5/webcomponents/dist/TableHeaderRow.js'
import '@ui5/webcomponents/dist/TableHeaderCell.js'
import '@ui5/webcomponents/dist/TableRow.js'
import '@ui5/webcomponents/dist/TableCell.js'
import '@ui5/webcomponents/dist/Button.js'
import '@ui5/webcomponents/dist/Dialog.js'
import '@ui5/webcomponents/dist/Input.js'
import '@ui5/webcomponents/dist/TextArea.js'
import '@ui5/webcomponents/dist/CheckBox.js'
import '@ui5/webcomponents/dist/Label.js'
import { setTheme } from '@ui5/webcomponents-base/dist/config/Theme.js'
import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps'

const titleEl = document.getElementById('title')
const summaryEl = document.getElementById('summary')
const statusEl = document.getElementById('status')
const tableEl = document.getElementById('table')
const toolbarEl = document.getElementById('toolbar')
const refreshBtn = document.getElementById('refresh-btn')
const dialogEl = document.getElementById('action-dialog')
const formEl = document.getElementById('action-form')
const cancelBtn = document.getElementById('action-cancel')
const confirmBtn = document.getElementById('action-confirm')

const MAX_COLUMNS = 12
const PREFERRED_COLUMNS = [
  'ID', 'id', 'code', 'title', 'name', 'subject', 'operation',
  'stock', 'price', 'author', 'genre', 'scCode', 'scSubject',
  'projectDefinition', 'unitOfMeasure', 'baselineQuanitity',
  'totalQuantityCompleted', 'latestSubmittedWorkDate'
]

/** @type {import('@modelcontextprotocol/ext-apps').App | null} */
let mcpApp = null
let pendingAction = null
let pendingRow = null
let lastCallToolName = 'call'
let lastQueryToolName = 'query'
/** @type {Record<string, unknown> | null} */
let lastQueryArgs = null
let refreshInFlight = false

function setStatus(text, isError = false) {
  statusEl.textContent = text
  statusEl.classList.toggle('error', isError)
}

function setRefreshEnabled(enabled) {
  refreshBtn.disabled = !enabled
}

function asRows(payload) {
  if (!payload) return []
  if (Array.isArray(payload.data)) return payload.data
  if (payload.data && typeof payload.data === 'object') return [payload.data]
  if (Array.isArray(payload)) return payload
  return []
}

function pickColumns(rows) {
  if (!rows.length) return []
  const keySet = new Set()
  for (const row of rows.slice(0, 50)) {
    if (row && typeof row === 'object') {
      Object.keys(row).forEach((k) => keySet.add(k))
    }
  }
  const keys = [...keySet]
  const preferred = PREFERRED_COLUMNS.filter((k) => keySet.has(k))
  const rest = keys.filter((k) => !preferred.includes(k) && !k.startsWith('_'))
  return [...preferred, ...rest].slice(0, MAX_COLUMNS)
}

function formatCell(value) {
  if (value == null) return ''
  if (typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value)
}

function mapHostTheme(theme) {
  if (!theme) return null
  const t = String(theme).toLowerCase()
  if (t.includes('dark')) return 'sap_horizon_dark'
  return 'sap_horizon'
}

function applyUi5Theme(hostTheme) {
  const ui5Theme = mapHostTheme(hostTheme) || 'sap_horizon'
  setTheme(ui5Theme)
}

function splitActions(actions = []) {
  return {
    toolbar: actions.filter((a) => a.placement === 'Toolbar'),
    row: actions.filter((a) => a.placement === 'Row')
  }
}

function prefillFromRow(paramName, row) {
  if (!row || typeof row !== 'object') return undefined
  if (row[paramName] !== undefined) return row[paramName]
  const lower = paramName.toLowerCase()
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase() === lower) return v
  }
  // Common unbound patterns: book ← ID
  if (lower === 'book' || lower === 'id') {
    if (row.ID !== undefined) return row.ID
    if (row.id !== undefined) return row.id
  }
  return undefined
}

function buildFormFields(params, row) {
  formEl.replaceChildren()
  for (const p of params) {
    const wrap = document.createElement('div')
    wrap.className = 'form-field'
    const label = document.createElement('ui5-label')
    label.textContent = p.name + (p.optional ? '' : ' *')
    label.setAttribute('for', `param-${p.name}`)
    wrap.appendChild(label)

    const prefill = prefillFromRow(p.name, row)
    let input
    if (p.type === 'boolean') {
      input = document.createElement('ui5-checkbox')
      input.checked = Boolean(prefill)
    } else if (p.type === 'json') {
      input = document.createElement('ui5-textarea')
      input.rows = 4
      input.value = prefill != null ? JSON.stringify(prefill, null, 2) : ''
    } else {
      input = document.createElement('ui5-input')
      input.type = p.type === 'number' ? 'Number' : 'Text'
      if (prefill != null) input.value = String(prefill)
    }
    input.id = `param-${p.name}`
    input.dataset.paramName = p.name
    input.dataset.paramType = p.type
    wrap.appendChild(input)
    formEl.appendChild(wrap)
  }
}

function readFormParameters(params) {
  const out = {}
  for (const p of params) {
    const el = formEl.querySelector(`#param-${CSS.escape(p.name)}`)
    if (!el) continue
    if (p.type === 'boolean') {
      out[p.name] = !!el.checked
    } else if (p.type === 'json') {
      const raw = el.value?.trim()
      if (!raw) {
        if (!p.optional) throw new Error(`Parameter ${p.name} is required`)
        continue
      }
      out[p.name] = JSON.parse(raw)
    } else if (p.type === 'number') {
      const raw = el.value?.trim()
      if (!raw) {
        if (!p.optional) throw new Error(`Parameter ${p.name} is required`)
        continue
      }
      out[p.name] = Number(raw)
    } else {
      const raw = el.value?.trim()
      if (!raw) {
        if (!p.optional) throw new Error(`Parameter ${p.name} is required`)
        continue
      }
      out[p.name] = raw
    }
  }
  return out
}

async function invokeCall(actionName, parameters) {
  if (!mcpApp?.callServerTool) {
    throw new Error('Host bridge does not support callServerTool')
  }
  setStatus(`Calling ${actionName}…`)
  const result = await mcpApp.callServerTool({
    name: lastCallToolName,
    arguments: {
      action: actionName,
      parameters: parameters || {}
    }
  })
  if (result?.isError) {
    const text = result.content?.map((c) => c.text).filter(Boolean).join('\n') || 'Action failed'
    throw new Error(text)
  }
  const text = result?.content?.map((c) => c.text).filter(Boolean).join('\n')
  setStatus(text || `Action ${actionName} completed.`)
  await refreshQuery({ keepStatus: true })
  return result
}

async function refreshQuery({ keepStatus = false } = {}) {
  if (!mcpApp?.callServerTool) {
    setStatus('Host bridge does not support callServerTool', true)
    return null
  }
  if (!lastQueryArgs || typeof lastQueryArgs !== 'object') {
    setStatus('Nothing to refresh yet. Run a query first.', true)
    return null
  }
  if (refreshInFlight) return null

  refreshInFlight = true
  setRefreshEnabled(false)
  if (!keepStatus) setStatus('Refreshing…')
  try {
    const result = await mcpApp.callServerTool({
      name: lastQueryToolName,
      arguments: lastQueryArgs
    })
    if (result?.isError) {
      const text = result.content?.map((c) => c.text).filter(Boolean).join('\n') || 'Refresh failed'
      throw new Error(text)
    }
    const payload = payloadFromToolResult(result)
    if (!payload) throw new Error('Refresh returned no structuredContent')
    renderTable(payload)
    if (keepStatus) {
      const current = statusEl.textContent || ''
      setStatus(current ? `${current} · Table refreshed.` : 'Table refreshed.')
    } else {
      setStatus('Table refreshed.')
    }
    return result
  } catch (err) {
    setStatus(err.message, true)
    return null
  } finally {
    refreshInFlight = false
    setRefreshEnabled(!!lastQueryArgs)
  }
}

async function runAction(action, row) {
  const params = action.params || []
  if (params.length === 0) {
    try {
      await invokeCall(action.name, {})
    } catch (err) {
      setStatus(err.message, true)
    }
    return
  }

  // Auto-call only when every parameter can be filled from the row.
  if (row) {
    const auto = {}
    let missing = false
    for (const p of params) {
      const v = prefillFromRow(p.name, row)
      if (v === undefined || v === null || v === '') {
        if (!p.optional) missing = true
      } else {
        auto[p.name] = p.type === 'number' ? Number(v) : v
      }
    }
    if (!missing) {
      try {
        await invokeCall(action.name, auto)
        return
      } catch (err) {
        setStatus(err.message, true)
        return
      }
    }
  }

  pendingAction = action
  pendingRow = row
  dialogEl.setAttribute('header-text', action.label || action.name)
  buildFormFields(params, row)
  dialogEl.open = true
}

function createActionButton(action, row) {
  const btn = document.createElement('ui5-button')
  btn.design = 'Transparent'
  btn.textContent = action.label || action.name
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation()
    runAction(action, row)
  })
  return btn
}

function renderToolbar(toolbarActions) {
  toolbarEl.replaceChildren()
  for (const action of toolbarActions) {
    const btn = document.createElement('ui5-button')
    btn.design = 'Emphasized'
    btn.textContent = action.label || action.name
    btn.addEventListener('click', () => runAction(action, null))
    toolbarEl.appendChild(btn)
  }
}

function renderTable(payload) {
  const rows = asRows(payload)
  const entity = payload?.entity || 'Result'
  const count = payload?.count ?? rows.length
  const columns = pickColumns(rows)
  const { toolbar, row: rowActions } = splitActions(payload?.actions || [])
  lastCallToolName = payload?.callToolName || 'call'
  if (payload?.queryToolName) lastQueryToolName = payload.queryToolName
  if (payload?.queryArgs && typeof payload.queryArgs === 'object') {
    lastQueryArgs = payload.queryArgs
  }
  setRefreshEnabled(!!lastQueryArgs && !!mcpApp?.callServerTool)

  titleEl.textContent = entity === 'Result' ? 'CAP Query Result' : String(entity)
  summaryEl.textContent = `${count} row${count === 1 ? '' : 's'}` +
    (columns.length ? ` · ${columns.length} column${columns.length === 1 ? '' : 's'}` : '')

  tableEl.replaceChildren()
  renderToolbar(toolbar)

  if (!columns.length && !rowActions.length) {
    tableEl.noDataText = 'No rows returned.'
    return
  }

  const headerRow = document.createElement('ui5-table-header-row')
  headerRow.slot = 'headerRow'
  for (const col of columns) {
    const cell = document.createElement('ui5-table-header-cell')
    cell.textContent = col
    headerRow.appendChild(cell)
  }
  if (rowActions.length) {
    const cell = document.createElement('ui5-table-header-cell')
    cell.textContent = 'Actions'
    headerRow.appendChild(cell)
  }
  tableEl.appendChild(headerRow)

  rows.forEach((row, index) => {
    const tr = document.createElement('ui5-table-row')
    tr.rowKey = String(row?.ID ?? row?.id ?? index)
    for (const col of columns) {
      const td = document.createElement('ui5-table-cell')
      td.textContent = formatCell(row?.[col])
      tr.appendChild(td)
    }
    if (rowActions.length) {
      const td = document.createElement('ui5-table-cell')
      const wrap = document.createElement('div')
      wrap.className = 'row-actions'
      for (const action of rowActions) {
        wrap.appendChild(createActionButton(action, row))
      }
      td.appendChild(wrap)
      tr.appendChild(td)
    }
    tableEl.appendChild(tr)
  })
}

function payloadFromToolResult(result) {
  if (!result || typeof result !== 'object') return null
  if (result.structuredContent) return result.structuredContent
  if (result.params?.structuredContent) return result.params.structuredContent
  if (Array.isArray(result.data) || result.count != null) return result
  return null
}

cancelBtn.addEventListener('click', () => {
  dialogEl.open = false
  pendingAction = null
  pendingRow = null
})

refreshBtn.addEventListener('click', () => {
  refreshQuery()
})

confirmBtn.addEventListener('click', async () => {
  if (!pendingAction) return
  confirmBtn.disabled = true
  try {
    const parameters = readFormParameters(pendingAction.params || [])
    dialogEl.open = false
    await invokeCall(pendingAction.name, parameters)
  } catch (err) {
    setStatus(err.message, true)
  } finally {
    confirmBtn.disabled = false
    pendingAction = null
    pendingRow = null
  }
})

const app = new App({ name: 'CAP Query Table', version: '0.2.0' })

function onToolResult(result) {
  try {
    const payload = payloadFromToolResult(result)
    if (!payload) {
      setStatus('Tool result received but no structuredContent found.', true)
      return
    }
    renderTable(payload)
    setStatus('Rendered from query structuredContent.')
  } catch (err) {
    setStatus(`Render error: ${err.message}`, true)
  }
}

app.addEventListener('toolresult', onToolResult)
app.ontoolresult = onToolResult

app.addEventListener('hostcontextchanged', (ctx) => {
  const theme = ctx?.theme
  if (theme) {
    applyDocumentTheme(theme)
    applyUi5Theme(theme)
  }
})

try {
  await app.connect()
  mcpApp = app
  const hostCtx = app.getHostContext()
  if (hostCtx?.theme) {
    applyDocumentTheme(hostCtx.theme)
    applyUi5Theme(hostCtx.theme)
  } else {
    applyUi5Theme('light')
  }
  setStatus('Connected. Waiting for tool result…')
} catch (err) {
  setStatus(`Bridge unavailable (${err.message}).`, true)
  applyUi5Theme('light')
  renderTable({
    entity: 'Books',
    count: 2,
    callToolName: 'call',
    actions: [
      { name: 'ping', label: 'Ping', placement: 'Toolbar', params: [] },
      {
        name: 'submitOrder',
        label: 'Submit Order',
        placement: 'Row',
        params: [
          { name: 'book', type: 'number', optional: false },
          { name: 'quantity', type: 'number', optional: false }
        ]
      }
    ],
    data: [
      { ID: 201, title: 'Wuthering Heights', author: 'Emily Brontë', stock: 12 },
      { ID: 207, title: 'Jane Eyre', author: 'Charlotte Brontë', stock: 11 }
    ]
  })
}
