'use strict'

const cds = require('@sap/cds')
const LOG = cds.log('cap-mcp-apps')

/**
 * When enabled, replace the stock MCP protocol adapter with one that
 * registers `query` as an MCP App tool (UI5 table for structuredContent).
 */
const appsCfg = cds.env.mcp?.apps
if (appsCfg?.queryTable !== false) {
  cds.env.protocols ??= {}
  cds.env.protocols.mcp = {
    ...cds.env.protocols.mcp,
    path: cds.env.protocols.mcp?.path || '/mcp',
    // Must be a function — string paths starting with '.' resolve under @sap/cds.
    impl: require('./lib/adapter')
  }
  LOG.info('Overriding protocols.mcp.impl with MCP Apps query table adapter')
} else {
  LOG.info('MCP Apps query table adapter disabled (cds.mcp.apps.queryTable=false)')
}
