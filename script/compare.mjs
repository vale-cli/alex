// Runs the original alex and this style over the same files and reports
// where they disagree.
//
//   node compare.mjs [-v] <file>...
//
// Set VALE to test a particular binary. Exits 1 on any difference.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {markdown, text, html} from 'alex'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const verbose = args[0] === '-v' && args.shift()
const files = args.map((f) => path.resolve(f))

const byExt = {'.md': markdown, '.txt': text, '.html': html}
const squash = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase()
const kind = (name) => (/profanit/i.test(name) ? 'profanity' : 'equality')

function original(file) {
  const run = byExt[path.extname(file)] || text
  return run(fs.readFileSync(file, 'utf8')).messages.map((m) => ({
    line: m.line,
    col: m.column,
    text: squash(m.actual),
    kind: kind(m.source)
  }))
}

function vale(list) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-'))
  const config = path.join(dir, '.vale.ini')
  fs.writeFileSync(
    config,
    `StylesPath = ${path.join(here, '..')}\nMinAlertLevel = suggestion\n\n[*]\nBasedOnStyles = alex\n`
  )
  const result = spawnSync(
    process.env.VALE || 'vale',
    ['--no-global', '--no-exit', '--output=JSON', `--config=${config}`, ...list],
    {encoding: 'utf8', maxBuffer: 1 << 30}
  )
  fs.rmSync(dir, {recursive: true})
  if (result.status !== 0 || !result.stdout.trim().startsWith('{')) {
    throw new Error(result.stderr || result.stdout)
  }
  const out = {}
  for (const [file, alerts] of Object.entries(JSON.parse(result.stdout))) {
    out[path.resolve(file)] = alerts.map((a) => ({
      line: a.Line,
      col: a.Span[0],
      text: squash(a.Match),
      kind: kind(a.Check)
    }))
  }
  return out
}

const key = (a) => `${a.line}:${a.col} ${a.kind} "${a.text}"`

// Multiset difference: what is in `a` and not in `b`.
function minus(a, b) {
  const counts = new Map()
  for (const x of b) counts.set(key(x), (counts.get(key(x)) || 0) + 1)
  return a.filter((x) => {
    const n = counts.get(key(x)) || 0
    if (n > 0) counts.set(key(x), n - 1)
    return n === 0
  })
}

// alex places a word wrongly on the continuation lines of a list item or
// block quote (it loses the indentation), and counts a character outside
// the BMP as two columns. The same word a line or a few columns away is the
// same finding.
function shifted(missing, extra) {
  const pairs = []
  for (const m of [...missing]) {
    const i = extra.findIndex(
      (e) => e.kind === m.kind && e.text === m.text && Math.abs(e.line - m.line) <= 1
    )
    if (i === -1) continue
    pairs.push([m, extra[i]])
    extra.splice(i, 1)
    missing.splice(missing.indexOf(m), 1)
  }
  return pairs
}

const ours = vale(files)
let failed = false
const total = {alex: 0, vale: 0, missing: 0, extra: 0, shifted: 0}

for (const file of files) {
  const want = original(file)
  const got = ours[file] || []
  const missing = minus(want, got)
  const extra = minus(got, want)
  const moved = shifted(missing, extra)
  const name = path.relative(process.cwd(), file)
  const bad = missing.length + extra.length > 0

  total.alex += want.length
  total.vale += got.length
  total.missing += missing.length
  total.extra += extra.length
  total.shifted += moved.length

  if (bad || verbose) {
    console.log(
      `${bad ? 'FAIL' : 'ok  '} ${name}: alex ${want.length}, vale ${got.length}, missing ${missing.length}, extra ${extra.length}, shifted ${moved.length}`
    )
  }
  if (bad) failed = true

  for (const m of missing) console.log(`  - ${key(m)}`)
  for (const m of extra) console.log(`  + ${key(m)}`)
  if (verbose) {
    for (const [m, e] of moved) console.log(`  ~ ${key(m)} at ${e.line}:${e.col}`)
  }
}

console.log(
  `${files.length} files: alex ${total.alex}, vale ${total.vale}, missing ${total.missing}, extra ${total.extra}, shifted ${total.shifted}`
)
process.exit(failed ? 1 : 0)
