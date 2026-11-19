# alex [![Build Status](https://travis-ci.com/errata-ai/alex.svg?branch=master)](https://travis-ci.com/errata-ai/alex) ![Vale version](https://img.shields.io/badge/vale-%3E%3D%20v3.28.1-blue.svg) ![license](https://img.shields.io/github/license/mashape/apistatus.svg)

> [`alex`](https://github.com/get-alex/alex): Catch insensitive, inconsiderate writing.

This repository contains a [Vale-compatible](https://github.com/errata-ai/vale) implementation of the guidelines enforced by the `alex` ([LICENSE](https://github.com/get-alex/alex/blob/main/license)) linter.

## Getting Started

To get started, add the package to your configuration file (as shown below) and then run `vale sync`.

```ini
StylesPath = styles
MinAlertLevel = suggestion

Packages = alex

[*]
BasedOnStyles = alex
```

## Rules

The rules are generated from the word lists that `alex` 11.0.1 ships
(`retext-equality` 6.6.0 and `cuss` 2.2.0), and they match the way `alex`
does:

- Whole words, with case, hyphens, and apostrophes ignored: `able-bodied`
  and `man's best friend` match `ablebodied` and `mans best friend`.
- A word set off as a literal is skipped: `"crazy"`, `(master)`, or
  `Simple: ...`.
- `he` and `she` are reported unless they sit together, as in `he or she`
  and `his/her`.
- Every phrase is reported, so `master plan` raises both `master` and
  `master plan`. That is why a category has up to three rules: its words,
  its `Phrases`, and the `Nested` phrases that contain other phrases.
- Tables and front matter are not read.

| Rules | Source |
| ----- | ------ |
| `Ablist`, `Condescending`, `Gendered`, `LGBTQ`, `Press`, `Race`, `Slogans`, `Suicide` | One per `retext-equality` category. |
| `GenderedPerson` | `her`, `him`, `boy`, `girl`: the phrases `alex` qualifies with "when referring to a person". |
| `ProfanityLikely`, `ProfanityMaybe`, `ProfanityUnlikely` | `cuss`, by how sure it is. |

`alex` reads `profanitySureness` from its own configuration. Here, turn the
rules off instead:

```ini
# profanitySureness: 1
alex.ProfanityUnlikely = NO

# profanitySureness: 2
alex.ProfanityUnlikely = NO
alex.ProfanityMaybe = NO
```

## Differences from alex

The style reports what `alex` reports, at the same line and column, except:

- `alex` skips the last word of a paragraph that ends in a period when the
  next block starts with a lower-case letter. The style reports it.
- `alex` reads the tables in an HTML file. The style skips tables in every
  format.
- `alex` misplaces a word on the continuation lines of a list item or block
  quote, and counts a character outside the BMP as two columns. Vale reports
  where the word is.
- In a chain of four or more paired words (`he or she or he or she`), the
  last one is reported.
- A pair goes unrecognized when one of its words is written with a hyphen,
  as in `fire-man and firewoman`.
- `noBinary` is not supported.

## Development

```console
$ cd script
$ npm install
$ npm run generate   # rewrite alex/*.yml and fixtures/phrases.md
$ cd ..
$ ./test.sh          # compare with the golden file, then with alex itself
```

To move to a newer `alex`, change its version in `script/package.json` and
run the same steps. `script/compare.mjs` takes any Markdown, HTML, or text
files and prints each finding the two tools disagree on.
