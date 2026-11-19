// Writes ../fixtures/phrases.md: every phrase the original alex knows, in a
// few positions each, so compare.mjs exercises all of them.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {cuss} from 'cuss'
import {patterns} from 'retext-equality/lib/en.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const fill = (s) => s.replace(/\*/g, 'America')

const out = ['# Phrases', '']

for (const pattern of patterns) {
  const phrases = Object.keys(pattern.inconsiderate).map(fill)
  for (const p of phrases) {
    out.push(`We saw ${p} there. ${cap(p)} is here. They said "${p}" twice.`, '')
  }

  if (pattern.type === 'or') {
    const type = (t) => phrases.filter((p) => pattern.inconsiderate[p] === t)
    const [a, b] = pattern.categories.map(type)
    if (a.length > 0 && b.length > 0) {
      out.push(
        `Ask the ${a[0]} or ${b[0]} first. Ask the ${b[0]}/${a[0]} next. The ${a[0]}, then the ${b[0]}.`,
        ''
      )
    }
  }
}

out.push('# Profanities', '')
for (const word of Object.keys(cuss)) {
  out.push(`We saw ${word} there.`, '')
}

fs.mkdirSync(path.join(here, '..', 'fixtures'), {recursive: true})
fs.writeFileSync(path.join(here, '..', 'fixtures', 'phrases.md'), out.join('\n'))
