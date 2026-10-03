'use strict'

/**
 * Bundle the MCP App into a single self-contained HTML file.
 * Hosts with strict CSP often block CDN imports; inlining avoids that.
 *
 * Important:
 * - Use a function replacer so `$&` / `$1` inside the bundle are NOT
 *   treated as String.replace substitution patterns.
 * - Escape `</script` so the HTML parser cannot close the script early.
 */
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')

const root = path.join(__dirname)
const srcDir = path.join(root, 'src')
const outFile = path.join(root, 'assets', 'query-table.html')

function escapeForInlineScript(js) {
  return js.replace(/<\/(script)/gi, '<\\/$1')
}

async function build() {
  fs.mkdirSync(path.dirname(outFile), { recursive: true })

  const result = await esbuild.build({
    entryPoints: [path.join(srcDir, 'main.js')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    logLevel: 'info',
    loader: {
      '.json': 'json',
      '.css': 'text',
      '.svg': 'dataurl',
      '.woff': 'dataurl',
      '.woff2': 'dataurl'
    }
  })

  const js = escapeForInlineScript(result.outputFiles[0].text)
  const template = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8')

  const html = template.replace(
    /<script type="module" src="\.\/main\.js"><\/script>/,
    () => `<script type="module">\n${js}\n</script>`
  )

  fs.writeFileSync(outFile, html, 'utf8')
  console.log(`Wrote ${outFile} (${Buffer.byteLength(html)} bytes)`)
}

build().catch((err) => {
  console.error(err)
  process.exit(1)
})
