'use strict'

const LOG = require('@sap/cds').log('cap-mcp-apps')

const ANNO = '@mcp.apps.Action'
const ANNO_PLACEMENT = '@mcp.apps.Action.placement'
const ANNO_LABEL = '@mcp.apps.Action.label'
const ANNO_ENTITIES = '@mcp.apps.Action.entities'

/**
 * Normalize CDS enum / string placement to 'Toolbar' | 'Row' | null.
 * Accepts #Toolbar, { "#": "Toolbar" }, "Toolbar", etc. (CSN enum form).
 */
function normalizePlacement(raw) {
  if (raw == null) return null
  if (typeof raw === 'string') {
    const s = raw.replace(/^#/, '')
    if (s === 'Toolbar' || s === 'Row') return s
    return null
  }
  if (typeof raw === 'object' && raw['#'] != null) {
    return normalizePlacement(String(raw['#']))
  }
  return null
}

/**
 * Extract a definition name from a CAP CSN annotation value.
 * Handles type references `{ "=": "Books" }`, path refs `{ ref: [...] }`,
 * value literals `{ val }`, and plain strings — per CDS annotation CSN rules.
 */
function csnName(item) {
  if (item == null) return null
  if (typeof item === 'string') return item.replace(/^#/, '') || null
  if (typeof item === 'number' || typeof item === 'boolean') return String(item)
  if (typeof item !== 'object') return null

  // Type / artifact reference — preferred for entity lists in CDL: `Books`
  if (typeof item['='] === 'string') return item['='].replace(/^#/, '') || null

  // CXL path / expression ref — e.g. `{ ref: ['CatalogService','Books'] }`
  if (Array.isArray(item.ref) && item.ref.length) {
    return item.ref
      .map((seg) => (typeof seg === 'string' ? seg : seg?.id))
      .filter(Boolean)
      .join('.')
  }

  // Literal value token `{ val: 'Books' }`
  if (item.val != null && (typeof item.val === 'string' || typeof item.val === 'number')) {
    return String(item.val)
  }

  // Enum-like `{ "#": "Books" }` (unusual for entities, accepted for robustness)
  if (item['#'] != null) return String(item['#']).replace(/^#/, '') || null

  return null
}

/**
 * Normalize `@mcp.apps.Action.entities` to local / qualified name strings.
 * CDL form: `entities: [Books, ListOfBooks]` (CDS type references).
 * @returns {string[] | null} null = unrestricted (show for any query entity)
 */
function normalizeEntities(raw) {
  if (raw == null) return null
  const list = Array.isArray(raw) ? raw : [raw]
  const names = list.map(csnName).filter(Boolean)
  return names.length ? names : null
}

function localEntityName(name) {
  if (!name || typeof name !== 'string') return null
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1) : name
}

/**
 * Whether an action with optional entities filter applies to the current query entity.
 * Unrestricted (null/empty entities) → always. Scoped + unknown query entity → hide.
 */
function actionAppliesToEntity(allowedEntities, queryEntity) {
  if (!allowedEntities || allowedEntities.length === 0) return true
  if (!queryEntity) return false
  const qLocal = localEntityName(queryEntity)
  return allowedEntities.some((a) => {
    const aLocal = localEntityName(a)
    return a === queryEntity || aLocal === qLocal || a === qLocal || aLocal === queryEntity
  })
}

function paramType(p) {
  if (!p) return 'string'
  if (p.items) return 'json'
  if (p.elements || p.type === 'cds.Map') return 'json'
  const t = typeof p.type === 'string' ? p.type : ''
  if (t.includes('Boolean')) return 'boolean'
  if (t.includes('Integer') || t.includes('Int64') || t.includes('Decimal') || t.includes('Double')) {
    return 'number'
  }
  if (t.includes('Date') || t.includes('Timestamp')) return 'date'
  if (t.includes('String') || t.includes('UUID')) return 'string'
  // Association / type refs (including { ref: [...] }) → scalar for form
  if (p.target || (p.type && typeof p.type === 'object')) return 'string'
  if (t && !t.startsWith('cds.')) return 'string'
  return 'string'
}

function buildParamMeta(action) {
  const params = action.params || {}
  return Object.entries(params).map(([name, p]) => ({
    name,
    type: paramType(p),
    // CDS params default to optional; for App forms require an explicit opt-out
    // so we do not auto-invoke with incomplete payloads (e.g. book without quantity).
    optional: !!(p['@mcp.apps.optional'] || p.default !== undefined) &&
      !(p.notNull || p['@mandatory'])
  }))
}

/**
 * Read @mcp.apps.Action whether nested or flattened by the CDS compiler
 * (@mcp.apps.Action.placement / .label / .entities).
 */
function readActionConfig(action) {
  const nested = action[ANNO]
  if (nested === false) return null
  if (nested != null && typeof nested === 'object') {
    return {
      placement: nested.placement,
      label: nested.label,
      entities: nested.entities
    }
  }
  if (
    action[ANNO_PLACEMENT] != null ||
    action[ANNO_LABEL] != null ||
    action[ANNO_ENTITIES] != null
  ) {
    return {
      placement: action[ANNO_PLACEMENT],
      label: action[ANNO_LABEL],
      entities: action[ANNO_ENTITIES]
    }
  }
  if (nested === true) return { placement: null, label: null, entities: null }
  return null
}

/**
 * Collect unbound actions annotated with @mcp.apps.Action.
 * @param {Record<string, object>} actions - localName → CSN action (from checkAuthorization)
 * @param {string | null} [queryEntity] - local or qualified entity from the current query
 * @returns {Array<{ name, label, placement, params, entities }>}
 */
function collectAnnotatedActions(actions = {}, queryEntity = null) {
  const list = []
  for (const [name, action] of Object.entries(actions)) {
    const cfg = readActionConfig(action)
    if (!cfg) continue

    const placement = normalizePlacement(cfg.placement)
    if (!placement) {
      LOG.debug('Skipping @mcp.apps.Action without valid placement', { action: name, cfg })
      continue
    }

    const entities = normalizeEntities(cfg.entities)
    if (!actionAppliesToEntity(entities, queryEntity)) {
      LOG.debug('Skipping @mcp.apps.Action for entity', {
        action: name,
        entities,
        queryEntity
      })
      continue
    }

    const label = cfg.label || action['@title'] || name

    list.push({
      name,
      label: String(label),
      placement,
      params: buildParamMeta(action),
      ...(entities ? { entities } : {})
    })
  }
  return list
}

/**
 * Enrich a successful query tool result with MCP App action metadata
 * and enough context for the App to re-run the same query (refresh).
 */
function enrichQueryResult(result, { actions, callToolName, queryToolName, queryArgs, entity } = {}) {
  if (!result || result.isError) return result
  const annotated = collectAnnotatedActions(actions, entity)
  if (!result.structuredContent || typeof result.structuredContent !== 'object') {
    return result
  }
  return {
    ...result,
    structuredContent: {
      ...result.structuredContent,
      ...(entity != null ? { entity } : {}),
      actions: annotated,
      callToolName: callToolName || 'call',
      queryToolName: queryToolName || 'query',
      ...(queryArgs != null ? { queryArgs } : {})
    }
  }
}

module.exports = {
  ANNO,
  normalizePlacement,
  normalizeEntities,
  csnName,
  actionAppliesToEntity,
  localEntityName,
  collectAnnotatedActions,
  enrichQueryResult,
  buildParamMeta,
  readActionConfig
}
