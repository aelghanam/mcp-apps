# cap-mcp-apps

CDS plugin for CAP Node.js. It enriches [`@cap-js/mcp`](https://www.npmjs.com/package/@cap-js/mcp) **query** tool results with an MCP App (UI5 Web Components table) when the host supports MCP Apps.

CAP loads it automatically. A consuming app only needs this package in `dependencies`. There is no `server.js` protocol override.

## Install

```bash
npm add @cap-js/mcp cap-mcp-apps
```

From GitHub before it is published to npm:

```json
{
  "dependencies": {
    "cap-mcp-apps": "github:aelghanam/mcp-apps"
  }
}
```

Annotate services with `@mcp` as usual. On `cds watch` / `cds serve`, CAP detects `cds-plugin.js`, merges this package's `cds` configuration, and loads the plugin.

The plugin contributes the annotation vocabulary in `vocab/` through:

```json
"cds": {
  "requires": {
    "cap-mcp-apps-vocab": {
      "model": "cap-mcp-apps/vocab"
    }
  }
}
```

Peer packages (`@sap/cds`, `@cap-js/mcp`, `express`) resolve from the consuming app. `.npmrc` sets `omit=peer` so a nested `@sap/cds` is not installed inside this package.

## Configuration

Query-table enrichment is on by default. To keep the stock `@cap-js/mcp` adapter, set:

```json
{
  "cds": {
    "mcp": {
      "apps": {
        "queryTable": false
      }
    }
  }
}
```

When `queryTable` is `false`, this plugin does not override `protocols.mcp.impl`.

## Action buttons (`@mcp.apps.Action`)

Unbound service actions can be shown in the MCP App UI. The annotation shape is declared in `vocab/index.cds` (`mcp.apps.Action` / `mcp.apps.Placement`).

```cds
annotate MyService.ping with @mcp.apps.Action: {
  placement: #Toolbar,
  label: 'Ping'
};

annotate MyService.submitOrder with @mcp.apps.Action: {
  placement: #Row,
  label: 'Submit Order',
  entities: [Books, ListOfBooks]
};
```

| Field | CDL form | CSN | Meaning |
|-------|----------|-----|---------|
| `placement` | `#Toolbar` / `#Row` | `{ "#": "…" }` | Below the table, or on each row |
| `label` | string | string | Button text (defaults to the action name) |
| `entities` | `[Books, …]` type refs | `[{ "=": "Books" }, …]` | Optional. Omit to show for every queried entity. |

Use type references `[Books]`, not element expressions `(Books)`. Parentheses are CXL paths resolved in the action scope and fail to compile for entity names.

Input forms are inferred from CDS parameters: no parameters calls immediately, scalars become inputs, structured or `many` parameters use a JSON textarea.

The App invokes the existing MCP `call` tool via `app.callServerTool`. After a successful action it re-runs the last `query` (`structuredContent.queryArgs`). A **Refresh** button in the header does the same.

Only actions the current MCP user may call (`@requires` / `@restrict`) are included.

## Logging

```js
const LOG = cds.log('cap-mcp-apps')
```

```json
{
  "cds": {
    "log": {
      "[development]": {
        "levels": {
          "cap-mcp-apps": "debug"
        }
      }
    }
  }
}
```

## Develop this plugin

`src/` is the App UI. `npm run build` bundles it into `assets/query-table.html`, which the adapter serves at runtime. UI5 Web Components and esbuild are devDependencies of this package.

```bash
npm install
npm run build
```

Link it into a CAP app with `"cap-mcp-apps": "file:../cap-mcp-apps"`, then run `cds watch` in that app.

## License

[PolyForm Small Business 1.0.0](https://polyformproject.org/licenses/small-business/1.0.0). Use is free for an individual, and for an organization with fewer than 100 people and under the license's revenue cap (1,000,000 USD in 2019 dollars, adjusted for inflation). Larger organizations are not covered and need a separate commercial license from the copyright holder.

The CDS annotation namespace stays `mcp.apps` (`@mcp.apps.Action`). That name is the annotation API, not the npm package name.
