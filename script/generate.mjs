// Generates the rules in ../alex from the word lists the original alex ships:
// retext-equality (insensitive phrases) and cuss (profanities).
//
//   npm install && node generate.mjs
//
// The versions come from package.json, so the rules track whatever alex
// release is pinned there.
import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import yaml from 'js-yaml'
import pluralize from 'pluralize'
import {cuss} from 'cuss'
import {patterns} from 'retext-equality/lib/en.js'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, '..', 'alex')

const version = (name) => {
  const entry = require.resolve(name)
  const root = entry.slice(0, entry.lastIndexOf(name) + name.length)
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    .version
}

const versions = {
  alex: version('alex'),
  equality: version('retext-equality'),
  cuss: version('cuss')
}

// ---------------------------------------------------------------------------
// Matching
//
// alex compares whole words after lower-casing them and removing hyphens and
// apostrophes, so `able-bodied` and `man's` match `ablebodied` and `mans`. A
// word runs across the symbols below when letters sit on both sides, which
// is why `crazy_talk` and `crazy.talk` are each one word and match nothing.

const W = String.raw`[\pL\pN]`
const INNER = String.raw`[-&'’.:=?@_·‐‑‧]`
const WORD = `(?>${W}+(?:${INNER}+${W}+)*)`

// A word is skipped when it is set off as a literal: wrapped in a pair of
// delimiters, or split from its sentence by a dash, colon, or semicolon.
// Each pair is [closer, openers].
const pairs = [
  [',', ','],
  ['-', '-'],
  ['–', '–'],
  ['—', '—'],
  ['"', '"'],
  ["'", "'"],
  ['’', '[‘‚’]'],
  ['‚', '’'],
  ['”', '[“”„]'],
  ['“', '„'],
  ['»', '«'],
  ['«', '»'],
  ['›', '‹'],
  ['‹', '›'],
  [String.raw`\)`, String.raw`\(`],
  [String.raw`\]`, String.raw`\[`],
  [String.raw`\}`, String.raw`\{`],
  ['⟩', '⟨'],
  ['」', '「']
]

const escape = (s) => s.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&')

// Phrases that end in a period, like `o.c.d.`, are words of their own.
const dotted = patterns
  .flatMap((p) => Object.keys(p.inconsiderate))
  .filter((p) => p.endsWith('.') && !p.includes(' '))
  .map(escape)

// A hyphen right after a word is part of it, so only a spaced one closes.
const wrapped = pairs
  .map(([close, open]) =>
    String.raw`${close === '-' ? String.raw`(?<=\s)-` : close}(?<=${open}\s*\S+\s*.)`
  )
  .join('|')
const first = String.raw`(?<=(?:\A|[.!?…]\s+|\n\s*\n)[^\pL\pN]*)${WORD}(?:\s*[–—:;]|\s+-)`
const last = String.raw`(?<=(?:[–—:;]|(?<!${W})-)\s*)${WORD}[^.!?…\pL\pN]*(?:\z|[.!?…]|\n\s*\n)`

// Two short words around a slash are one word: `s/he`.
const slashed = String.raw`${W}{1,2}/(?:${W}{1,2})?(?!${W})|(?<=(?<!${W})${W}{1,2}/)${W}{1,2}(?!${W})`

// One group, so Vale checks it once per position rather than once per term.
const LEAD = String.raw`(?!(?<=&|${W}${INNER}*)|${slashed}|(?:(?:${dotted.join('|')})|${WORD})\s*(?:${wrapped})|${first}|${last})`

// A period that does not end the sentence belongs to the word before it:
// one followed by a lower-case word, with any inline code (which Vale masks
// with asterisks) skipped.
const LOWER = String.raw`["'”’)]*\s+(?:\*+\s+)?(?-i:\p{Ll})`
const TRAIL = String.raw`(?!${INNER}*${W}|\.${LOWER})`

// A hyphen left hanging on a word is part of it.
const END = `-?${TRAIL}`

// `apostrophes` keeps them significant: `he'll` is not `hell`.
function word(value, apostrophes) {
  const gap = apostrophes ? '-?' : "[-'’]?"
  return [...value]
    .map((c) => (c === "'" ? "['’]" : escape(c)))
    .join(gap)
}

function body(phrase, apostrophes = false) {
  // A phrase with capitals has to appear exactly as written.
  if (phrase !== phrase.toLowerCase()) {
    return `(?-i:${phrase.split(' ').map(escape).join('[ ]')})`
  }
  // A title such as `mrs.` keeps its period when capitalized; otherwise the
  // period has to be one that does not end the sentence.
  if (/^[a-z]{2,}\.$/.test(phrase)) {
    const rest = word(phrase.slice(1), apostrophes)
    const gap = apostrophes ? '-?' : "[-'’]?"
    return `(?:(?-i:${phrase[0].toUpperCase()})${gap}${rest}|${word(phrase, apostrophes)}(?=${LOWER}))`
  }
  return phrase
    .split(' ')
    .map((w) => (w === '*' ? WORD : word(w, apostrophes)))
    .join(String.raw`\s+`)
}

// A phrase can only match if each of its words can be a whole word.
const matchable = (phrase) =>
  phrase.split(' ').every((w) => w === '*' || /^[\p{L}\p{N}'.]+$/u.test(w))

// ---------------------------------------------------------------------------
// Pairs
//
// `he` and `she` are reported unless they sit next to each other, joined by
// nothing but spaces, a slash, or a word containing "and" or "or".

const JOINER = String.raw`[\s/]+(?:\b[\w'’-]*(?:and|or)[\w'’-]*\b[\s/]+)*`

const longest = (phrases) => [...phrases].sort((a, b) => b.length - a.length)

const any = (phrases, apostrophes) =>
  `(?:${longest(phrases)
    .map((p) => body(p, apostrophes))
    .join('|')})`

// A neighbor is matched as written: the engine caps the size of a pattern,
// and a hyphen inside the word next door is not worth what it costs.
const neighbor = (phrases) =>
  `(?:${longest(phrases)
    .map((p) => p.split(' ').map(escape).join(String.raw`\s+`).replace(/'/g, "['’]"))
    .join('|')})`

function paired(phrases, pattern) {
  const type = pattern.inconsiderate[phrases[0]]
  const all = Object.keys(pattern.inconsiderate).filter(matchable)
  const same = all.filter((p) => pattern.inconsiderate[p] === type)
  const other = all.filter((p) => pattern.inconsiderate[p] !== type)
  if (other.length === 0) return ''

  const theirs = neighbor(other)

  // The word before only pairs with this one if it has not already paired
  // with the word before it.
  const before = `(?<!(?<!\\b${neighbor(same)}${JOINER})\\b${theirs}${JOINER}${neighbor(phrases)}-?)`
  const after = `(?!${JOINER}${theirs}(?!${W}))`

  return before + after
}

// One term per pattern: its phrases share a suggestion.
function term(phrases, pattern) {
  if (pattern.type !== 'or') {
    return LEAD + any(phrases, pattern.apostrophe) + END
  }

  const types = [...new Set(phrases.map((p) => pattern.inconsiderate[p]))]
  const sides = types.map((type) => {
    const side = phrases.filter((p) => pattern.inconsiderate[p] === type)
    return any(side, pattern.apostrophe) + END + paired(side, pattern)
  })

  return `${LEAD}(?:${sides.join('|')})`
}

// ---------------------------------------------------------------------------
// Categories
//
// The published package drops the file each pattern came from, so read the
// sources at the same version.

function sources() {
  const dir = path.join(here, '.cache', `retext-equality-${versions.equality}`)
  if (!fs.existsSync(dir)) {
    execFileSync(
      'git',
      [
        'clone',
        '--quiet',
        '--depth=1',
        `--branch=${versions.equality}`,
        'https://github.com/retextjs/retext-equality.git',
        dir
      ],
      {stdio: 'inherit'}
    )
  }
  return path.join(dir, 'data', 'en')
}

function categories() {
  const dir = sources()
  const result = {}
  for (const file of fs.readdirSync(dir)) {
    const entries = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8'))
    for (const entry of entries) {
      const value = entry.inconsiderate
      const phrases =
        typeof value === 'string'
          ? [value]
          : Array.isArray(value)
            ? value
            : Object.keys(value)
      for (const phrase of phrases) result[phrase] = path.basename(file, '.yml')
    }
  }
  return result
}

const names = {
  ablist: 'Ablist',
  condescending: 'Condescending',
  gender: 'Gendered',
  lgbtq: 'LGBTQ',
  press: 'Press',
  race: 'Race',
  slogans: 'Slogans',
  suicide: 'Suicide'
}

// A condition becomes part of the message, so it needs its own rule.
const conditions = {'when referring to a person': 'Person'}

// ---------------------------------------------------------------------------
// Output

// alex does not read tables or front matter.
const SCOPE = '~table & ~frontmatter'

const header = (source) =>
  `# Generated by script/generate.mjs from ${source}. Do not edit.\n`

const dump = (rule) =>
  yaml.dump(rule, {lineWidth: -1, quotingType: '"', sortKeys: false})

function write(name, source, rule) {
  fs.writeFileSync(path.join(out, `${name}.yml`), header(source) + dump(rule))
  written.push(name)
}

const written = []

// Vale reports one match per position, and alex reports every phrase: both
// `master` and `master plan`. A phrase goes one rule above the phrases it
// contains, so each gets its say.
const suffixes = ['', 'Phrases', 'Nested']

function layers(phrases) {
  const words = (p) => ` ${p} `
  const depth = new Map()
  for (const p of [...phrases].sort((a, b) => a.length - b.length)) {
    const inside = phrases.filter((q) => q !== p && words(p).includes(words(q)))
    depth.set(p, Math.max(-1, ...inside.map((q) => depth.get(q))) + 1)
  }

  const result = []
  for (const [p, d] of depth) {
    if (d >= suffixes.length) throw new Error(`"${p}" is nested too deeply`)
    ;(result[d] ||= []).push(p)
  }
  return result
}

// One alternative per line, read with `(?x)`. The lines are grouped by first
// letter, each group closed off on its own.
function alternation(lines) {
  const groups = new Map()
  for (const line of lines) {
    const key = line[0]
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(line)
  }

  const blocks = [...groups.values()].map(
    (group) => `(?:\n      ${group.join('\n    | ')}\n    ) ${END}`
  )

  return `(?x) ${LEAD} (?:\n    ${blocks.join('\n  | ')}\n)`
}

function equality() {
  const category = categories()
  const groups = new Map()
  const skipped = []

  for (const pattern of patterns) {
    for (const phrase of Object.keys(pattern.inconsiderate)) {
      if (!matchable(phrase)) {
        skipped.push(phrase)
        continue
      }

      const file = category[phrase]
      if (!names[file]) throw new Error(`no category for "${phrase}"`)
      if (pattern.condition && !conditions[pattern.condition]) {
        throw new Error(`unnamed condition "${pattern.condition}"`)
      }

      const name = names[file] + (conditions[pattern.condition] || '')
      const key = [name, pattern.considerate ? 'swap' : 'avoid'].join('/')
      if (!groups.has(key)) {
        groups.set(key, {name, condition: pattern.condition, entries: []})
      }
      groups.get(key).entries.push({phrase, pattern})
    }
  }

  const source = `retext-equality ${versions.equality} (alex ${versions.alex})`

  for (const [key, group] of groups) {
    const swap = key.endsWith('/swap')
    const split = layers(group.entries.map((e) => e.phrase))

    split.forEach((phrases, index) => {
      // Only a category with both kinds of rule needs to tell them apart.
      const avoid = !swap && groups.has(`${group.name}/swap`) ? 'Avoid' : ''
      const name = group.name + avoid + suffixes[index]
      const entries = group.entries.filter((e) => phrases.includes(e.phrase))
      const condition = group.condition ? `, ${group.condition}` : ''

      if (!swap) {
        write(name, source, {
          extends: 'existence',
          message: `'%s' may be insensitive${condition}, try not to use it.`,
          link: 'https://github.com/retextjs/retext-equality#readme',
          level: 'warning',
          scope: SCOPE,
          ignorecase: true,
          nonword: true,
          tokens: [
            alternation(
              entries.map((e) => body(e.phrase, e.pattern.apostrophe))
            )
          ]
        })
        return
      }

      const rules = {}
      const terms = new Map()
      for (const {phrase, pattern} of entries) {
        if (!terms.has(pattern.id)) terms.set(pattern.id, {pattern, phrases: []})
        terms.get(pattern.id).phrases.push(phrase)
      }
      for (const {pattern, phrases} of terms.values()) {
        rules[term(phrases, pattern)] = Object.keys(pattern.considerate).join('|')
      }

      write(name, source, {
        extends: 'substitution',
        message: `'%[2]s' may be insensitive${condition}, use %[1]s instead.`,
        link: 'https://github.com/retextjs/retext-equality#readme',
        level: 'warning',
        scope: SCOPE,
        ignorecase: true,
        nonword: true,
        capitalize: true,
        action: {name: 'replace'},
        swap: rules
      })
    })
  }

  return skipped
}

function profanities() {
  // The same expansion retext-profanities does: every word, its singular,
  // and its plural, less the forms pluralize gets wrong.
  const ignore = ['children', 'dy', 'pro', 'remain', 'so', 'dice', 'fus']
  const literal = ['hell', 'whore']
  const words = {}
  const add = (key, value) => {
    if (!ignore.includes(key)) words[key] = value
  }
  for (const key of Object.keys(cuss)) {
    add(key, cuss[key])
    add(pluralize.singular(key), cuss[key])
    add(pluralize.plural(key), cuss[key])
  }

  const levels = [
    ['ProfanityUnlikely', "Be careful with '%s', it's profane in some cases."],
    ['ProfanityMaybe', "Reconsider using '%s', it may be profane."],
    ['ProfanityLikely', "Don't use '%s', it's profane."]
  ]
  const source = `cuss ${versions.cuss} (alex ${versions.alex})`

  levels.forEach(([base, message], sureness) => {
    const all = Object.keys(words)
      .filter((w) => words[w] === sureness && matchable(w))
      .sort()

    layers(all).forEach((phrases, index) => {
      const lines = phrases.map((w) =>
        literal.includes(w) ? word(w, true) : body(w)
      )

      write(base + suffixes[index], source, {
        extends: 'existence',
        message,
        link: 'https://github.com/retextjs/retext-profanities#readme',
        level: 'warning',
        scope: SCOPE,
        ignorecase: true,
        nonword: true,
        tokens: [alternation(lines)]
      })
    })
  })
}

for (const file of fs.readdirSync(out)) {
  if (file.endsWith('.yml')) fs.unlinkSync(path.join(out, file))
}

const skipped = equality()
profanities()

console.log(`wrote ${written.length} rules: ${written.sort().join(', ')}`)
if (skipped.length > 0) {
  console.log(`skipped (can never match a word): ${skipped.join('; ')}`)
}
