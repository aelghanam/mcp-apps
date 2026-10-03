/**
 * Vocabulary for the `cap-mcp-apps` CDS plugin action UI annotations.
 *
 * Apply on unbound service actions:
 *
 * ```cds
 * annotate CatalogService.submitOrder with @mcp.apps.Action: {
 *   placement: #Row,
 *   label: 'Submit Order',
 *   entities: [Books] // CDS type references (not CXL `(Books)`)
 * };
 * ```
 *
 * - `placement` uses CDS enums (`#Toolbar` / `#Row`) → CSN `{ "#": "Row" }`
 * - `entities` uses CDS **type references** (same form as `Association to Books`)
 *   → CSN `{ "=": "Books" }`. Do **not** use CXL parentheses here: `(Books)` is an
 *   element-path expression and is resolved in the action parameter scope.
 */
namespace mcp.apps;

type Placement : String enum {
  Toolbar;
  Row;
}

type Action {
  placement : Placement;
  label     : String;
  /**
   * Service entities for which this action appears in the MCP query App.
   * Omit to show for every queried entity.
   * In CDL: `entities: [Books, ListOfBooks]` (type references).
   */
  entities  : many String;
}
