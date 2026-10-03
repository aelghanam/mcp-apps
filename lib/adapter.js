'use strict'

/**
 * MCP protocol adapter that mirrors @cap-js/mcp/lib but registers `query`
 * as an MCP App tool and serves a ui:// HTML table for structuredContent.
 *
 * Compatible with both @cap-js/mcp layouts:
 * - consolidated `lib/tools.js` (exports registrars + getInstructions)
 * - split modules (`lib/tools/*`, `lib/utils/tools-shared`) + thin tools.js shim
 */
const cds = require('@sap/cds')
const express = require('express')
const fs = require('node:fs')
const path = require('node:path')
const { McpServer, createMcpHandler } = require('@modelcontextprotocol/server')
const { toNodeHandler } = require('@modelcontextprotocol/node')

const tools = require('@cap-js/mcp/lib/tools')
const {
  createGenericReadToolDefinition,
  executeGenericReadTool
} = tools

const getInstructions =
  tools.getInstructions ??
  require('@cap-js/mcp/lib/utils/tools-shared').getInstructions

const registerDescribeTool =
  tools.registerDescribeTool ??
  require('@cap-js/mcp/lib/tools/describe').registerDescribeTool

const registerCallActionTool =
  tools.registerCallActionTool ??
  require('@cap-js/mcp/lib/tools/call').registerCallActionTool

const registerPerActionTools =
  tools.registerPerActionTools ??
  require('@cap-js/mcp/lib/tools/call').registerPerActionTools

const { getDescription } = require('@cap-js/mcp/lib/utils/cds-to-schema')
const { checkAuthorization } = require('@cap-js/mcp/lib/auth')
const { resolvePrefix } = require('@cap-js/mcp/lib/utils/service-name')
const { enrichQueryResult, localEntityName } = require('./action-meta')

const LOG = cds.log('cap-mcp-apps')

const QUERY_TABLE_RESOURCE_URI = 'ui://cap-query-table/index.html'
const QUERY_TABLE_HTML_PATH = path.join(__dirname, '../assets/query-table.html')

const QUERY_TABLE_UI_META = {
  prefersBorder: true
}

/**
 * Resolve the queried entity local name from MCP query args (CQL or CQN mode).
 */
function resolveQueryEntity(srv, args = {}) {
  if (args.entity) return localEntityName(String(args.entity))

  const rawCql = args.cql ?? args.sql
  if (!rawCql) return null

  try {
    const cqn = cds.parse.cql(String(rawCql).replace(/\n/g, ' '))
    const fromRef = cqn.SELECT?.from?.ref?.[0]
    const targetName = typeof fromRef === 'string' ? fromRef : fromRef?.id
    if (!targetName) return null
    // Strip service prefix when present (CatalogService.Books → Books)
    if (srv?.name && targetName.startsWith(srv.name + '.')) {
      return targetName.slice(srv.name.length + 1)
    }
    return localEntityName(targetName)
  } catch (err) {
    LOG.debug('Could not resolve query entity from CQL', { error: err.message })
    return null
  }
}

const registerActionTool = cds.env.mcp?.per_action_tool
  ? registerPerActionTools
  : registerCallActionTool

// ext-apps is ESM-only; cache the dynamic import for the process lifetime.
let appsHelpersPromise
function loadAppsHelpers() {
  if (!appsHelpersPromise) {
    appsHelpersPromise = import('@modelcontextprotocol/ext-apps/server')
  }
  return appsHelpersPromise
}

function registerQueryAppTool(server, srv, entities, actions, prefix, apps) {
  const entityNames = Object.keys(entities)
  if (entityNames.length === 0) {
    LOG.debug('No entities to register query app tool for', { service: srv.name })
    return
  }

  const def = createGenericReadToolDefinition(entityNames, srv.name, prefix)
  const callToolName = prefix + 'call'

  apps.registerAppTool(
    server,
    def.name,
    {
      description:
        def.description +
        ' Results are also shown in an MCP App HTML table when the host supports MCP Apps.',
      inputSchema: def.inputSchema,
      annotations: def.annotations,
      _meta: {
        ui: {
          resourceUri: QUERY_TABLE_RESOURCE_URI
        }
      }
    },
    async (args) => {
      const result = await executeGenericReadTool(srv, entities, args)
      const entity = resolveQueryEntity(srv, args)
      return enrichQueryResult(result, {
        actions,
        callToolName,
        queryToolName: def.name,
        queryArgs: args || {},
        entity
      })
    }
  )

  LOG.debug('Registered query MCP App tool', { tool: def.name, service: srv.name })
}

function registerQueryTableResource(server, apps) {
  apps.registerAppResource(
    server,
    'CAP Query Table',
    QUERY_TABLE_RESOURCE_URI,
    {
      title: 'CAP Query Table',
      description: 'UI5 Web Components table for CAP MCP query structuredContent.',
      _meta: {
        ui: QUERY_TABLE_UI_META
      }
    },
    async (uri) => {
      const html = fs.readFileSync(QUERY_TABLE_HTML_PATH, 'utf8')
      return {
        contents: [
          {
            uri: typeof uri === 'string' ? uri : uri.href,
            mimeType: apps.RESOURCE_MIME_TYPE,
            text: html,
            _meta: { ui: QUERY_TABLE_UI_META }
          }
        ]
      }
    }
  )
}

module.exports = function McpProtocolAdapter(srv) {
  if (!(srv instanceof cds.ApplicationService)) {
    LOG.debug('Skipping non-ApplicationService', { service: srv.name })
    return null
  }

  const router = express.Router()

  // Stateless transport: GET must return 405 (not Express 404) for Streamable HTTP clients.
  router.get('/', (_req, res) => {
    res
      .set('Allow', 'POST')
      .status(405)
      .json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null
      })
  })

  router.post('/', async (req, res) => {
    try {
      const apps = await loadAppsHelpers()

      let requestService = srv
      if (cds?.context?.model?.definitions) {
        requestService = cds.context.model.definitions[srv.name] ?? srv
      }

      const { entities, actions, error } = checkAuthorization(requestService)
      if (error) {
        const { code } = error
        LOG.debug('Authorization failed', { service: srv.name, code })
        return res.status(code).json({
          jsonrpc: '2.0',
          error: {
            code: code === 401 ? -32001 : -32003,
            message: `Authorization error (${code}): Not authorized to access ${srv.name}.`
          },
          id: req.body?.id || null
        })
      }

      const prefix = resolvePrefix(srv.definition)

      const factory = () => {
        try {
          const server = new McpServer(
            {
              name: srv.name,
              version: '1.0.0',
              description: getDescription(srv.definition) || `MCP server for ${srv.name}`
            },
            {
              instructions: getInstructions(srv.definition, null, prefix)
            }
          )

          const entityCount = Object.keys(entities).length
          const actionCount = Object.keys(actions).length
          if (entityCount > 0 || actionCount > 0) {
            registerDescribeTool(server, srv, entities, actions, prefix)
            registerQueryAppTool(server, srv, entities, actions, prefix, apps)
            registerActionTool(server, srv, actions, prefix)
            registerQueryTableResource(server, apps)
          } else {
            server.server.registerCapabilities({ tools: { listChanged: false } })
            server.server.setRequestHandler('tools/list', () => ({ tools: [] }))
            LOG.debug('Registered empty tool list', { service: srv.name })
            return server
          }

          // Do not call registerCapabilities after App resource registration —
          // it can wipe the resources capability that registerAppResource added.
          return server
        } catch (err) {
          LOG.error('MCP server factory failed', {
            service: srv.name,
            error: err.message,
            stack: err.stack
          })
          throw err
        }
      }

      const handler = createMcpHandler(factory)
      await toNodeHandler(handler)(req, res, req.body)
    } catch (err) {
      LOG.error('MCP request failed', { service: srv.name, error: err.message })
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal error: ' + err.message
          },
          id: req.body?.id || null
        })
      }
    }
  })

  LOG.info('MCP Apps adapter initialized', { service: srv.name })
  router.router = router
  return router
}
