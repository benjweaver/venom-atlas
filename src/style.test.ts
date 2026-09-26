// @vitest-environment node
//
// Every colour the app uses for text is at least 4.5:1 (WCAG AA) against what
// it sits on, in both themes. There's no hand-kept list of text colours: the
// test finds every token used for text in src/, so a new one is checked as
// soon as it's used.
//
// It reads files from disk, so it's type-checked with Node's types
// (tsconfig.node.json) rather than the browser's.
import { readdirSync, readFileSync } from 'node:fs'

const MIN = 4.5
const SURFACES = ['--bg', '--surface', '--surface-2']
// Text that sits on a coloured fill instead of a surface, and that fill.
const ON_FILL: Record<string, string> = {
  '--on-accent': '--accent', // a selected filter chip
  '--surface': '--ink', // InfoTip's bubble
}

const dir = new URL('.', import.meta.url)
const read = (file: string) => readFileSync(new URL(file, dir), 'utf8')

// ── The tokens, from style.css ────────────────────────────────────────────
type Tokens = Record<string, string>

const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '')
function declarations(block: RegExp): Tokens {
  const body = css.match(block)?.[1] ?? ''
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  )
}
const light = declarations(/:root\s*\{([^}]*)\}/)
// The dark block overrides; anything it leaves out keeps its light value.
const themes = {
  light,
  dark: { ...light, ...declarations(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/) },
}

// A token's colour as [r, g, b], following var() references.
function rgb(tokens: Tokens, name: string): number[] {
  const value = tokens[name]
  if (value === undefined) throw new Error(`${name} isn't defined in style.css`)
  const ref = value.match(/^var\((--[\w-]+)\)$/)
  if (ref) return rgb(tokens, ref[1])
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1]
  if (!hex) throw new Error(`${name} is ${value}; this test reads hex colours and var()`)
  const full = hex.length === 3 ? hex.replace(/./g, '$&$&') : hex
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
}

// WCAG 2's relative luminance and contrast ratio.
function luminance(color: number[]): number {
  const [r, g, b] = color.map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: number[], b: number[]): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}
// Text faded with an opacity modifier, as it looks over its background.
const over = (text: number[], alpha: number, bg: number[]) =>
  text.map((c, i) => c * alpha + bg[i] * (1 - alpha))

// ── Every token used for text, from the source ────────────────────────────
// Tailwind's text-(--x), with any variant before it (hover:, placeholder:, …)
// and a percentage opacity after it (/70).
const TEXT_CLASS = /text-\((?:color:)?(--[\w-]+)\)(?:\/(\d+))?/g
// `color: var(--x)`, in a stylesheet or a style binding. A name built in a
// template, like DangerBadge's `var(--danger-${level}-text)`, stands for every
// token it can make.
const COLOR_VAR = /(?<![\w-])color:\s*[`'"]?var\((--(?:[\w-]|\$\{[^}]*\})+)/g

const uses = new Map<string, { token: string; alpha: number }>()
function use(token: string, opacity?: string) {
  uses.set(opacity ? `${token}/${opacity}` : token, {
    token,
    alpha: opacity ? Number(opacity) / 100 : 1,
  })
}
const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(
  (file) => /\.(vue|ts|css)$/.test(file) && !file.endsWith('.test.ts'),
)
for (const file of files) {
  const code = read(file)
  for (const [, token, opacity] of code.matchAll(TEXT_CLASS)) use(token, opacity)
  for (const [, name] of code.matchAll(COLOR_VAR)) {
    const pattern = new RegExp(`^${name.replace(/\$\{[^}]*\}/g, '.+')}$`)
    const tokens = Object.keys(themes.dark).filter((token) => pattern.test(token))
    for (const token of tokens.length ? tokens : [name]) use(token)
  }
}

describe('text contrast', () => {
  it('finds the text colours', () => {
    // Guards the search itself: a class, and a colour built in a template.
    expect([...uses.keys()]).toEqual(
      expect.arrayContaining(['--muted', '--danger-1-text', '--danger-5-text']),
    )
  })

  for (const [theme, tokens] of Object.entries(themes)) {
    it(`keeps every text colour at ${MIN}:1 or more in the ${theme} theme`, () => {
      const failures: string[] = []
      for (const [label, { token, alpha }] of uses) {
        for (const fill of ON_FILL[token] ? [ON_FILL[token]] : SURFACES) {
          const bg = rgb(tokens, fill)
          const ratio = contrast(over(rgb(tokens, token), alpha, bg), bg)
          // Rounded down, so a failure never reads as "4.50:1".
          if (ratio < MIN) failures.push(`${label} on ${fill}: ${Math.floor(ratio * 100) / 100}:1`)
        }
      }
      expect(failures).toEqual([])
    })
  }
})
