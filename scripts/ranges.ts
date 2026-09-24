// npm run ranges                      — fetch + show proposals for species GBIF hasn't been asked about yet
// npm run ranges -- <slug> [<slug>…]   — just these species
// npm run ranges -- --all              — every species
//   --refresh   re-fetch from GBIF instead of using data/gbif.json
//   --write     write the proposed regions into the species files
//
// Without --write nothing in data/species changes: you get a diff per species,
// with record counts, to review first. Reject a place for good with
// `gbif.exclude` in the species file; see scripts/gbif-range.ts for the rules.
//
// Raw counts are cached in data/gbif.json (committed), so a proposal can be
// re-derived and reviewed without the network, and the site can link each
// species to its GBIF page.
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { parse } from 'yaml'

import { speciesSchema, type SpeciesFile } from '../src/data/schema.ts'
import { diffRegions, proposeRegions, SUBDIVIDED, type GbifCounts } from './gbif-range.ts'
import { knownRegions, ROOT, speciesFiles } from './species-loader.ts'

const API = 'https://api.gbif.org/v1'
const CACHE_FILE = join(ROOT, 'data', 'gbif.json')
const GADM_FILE = join(ROOT, 'data', 'gadm-iso.json')

// GADM ids start with the ISO 3166-1 alpha-3 code ("USA.3_1" is Arizona).
const ISO3: Record<string, string> = {
  USA: 'US',
  CAN: 'CA',
  MEX: 'MX',
  AUS: 'AU',
  BRA: 'BR',
  ARG: 'AR',
  IND: 'IN',
  CHN: 'CN',
  ZAF: 'ZA',
  JPN: 'JP',
}

// Record types that can stand for a wild animal in a place. Excluded:
// LIVING_SPECIMEN (zoos, collections) and FOSSIL_SPECIMEN.
const BASIS = [
  'HUMAN_OBSERVATION',
  'MACHINE_OBSERVATION',
  'PRESERVED_SPECIMEN',
  'MATERIAL_SAMPLE',
  'MATERIAL_CITATION',
  'OBSERVATION',
  'OCCURRENCE',
]

// Only records from 1950 on, so populations wiped out long ago (timber
// rattlesnakes in Maine) don't count as current range.
const SINCE = 1950

export interface CachedRange extends GbifCounts {
  key: number
  name: string
  fetched: string
  /** Records that couldn't be placed on our map (codes we don't draw). */
  unmapped: Record<string, number>
}

const readJson = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}
const writeSorted = (file: string, data: Record<string, unknown>) =>
  writeFileSync(
    file,
    JSON.stringify(
      Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b))),
      null,
      2,
    ) + '\n',
  )

// ── GBIF API ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function get<T>(path: string, params: [string, string | number][]): Promise<T> {
  const url = new URL(API + path)
  for (const [k, v] of params) url.searchParams.append(k, String(v))
  for (let attempt = 1; ; attempt++) {
    await sleep(150)
    let res: Response
    let body: T
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'venom-atlas range sync' } })
      // Reading the body is inside the try too: a connection can drop mid-response.
      body = res.ok ? ((await res.json()) as T) : (undefined as T)
    } catch (e) {
      // Dropped connections happen on long runs; retry them like a 5xx.
      if (attempt === 5) throw e
      await sleep(2000 * attempt)
      continue
    }
    if (res.ok) return body
    if (attempt === 5 || (res.status !== 429 && res.status < 500)) {
      throw new Error(`${url}: HTTP ${res.status}`)
    }
    await sleep(2000 * attempt)
  }
}

interface Match {
  usageKey?: number
  acceptedUsageKey?: number
  canonicalName?: string
  matchType: 'EXACT' | 'FUZZY' | 'HIGHERRANK' | 'NONE'
  status?: string
  kingdom?: string
}

async function matchTaxon(name: string): Promise<{ key: number; name: string }> {
  const m = await get<Match>('/species/match', [
    ['name', name],
    ['kingdom', 'Animalia'],
  ])
  if (m.matchType !== 'EXACT' || m.kingdom !== 'Animalia' || !m.usageKey) {
    throw new Error(
      `GBIF has no exact match for "${name}" (got ${m.matchType}${m.canonicalName ? `: ${m.canonicalName}` : ''}) — set gbif.name`,
    )
  }
  // Old names resolve to the currently accepted taxon, whose records include
  // the ones filed under the synonym.
  return { key: m.acceptedUsageKey ?? m.usageKey, name: m.canonicalName ?? name }
}

interface Facets {
  facets: { field: string; counts: { name: string; count: number }[] }[]
}

async function occurrenceFacets(extra: [string, string | number][]) {
  const params: [string, string | number][] = [
    ['limit', 0],
    ['facet', 'country'],
    ['facet', 'gadmLevel1Gid'],
    ['facetLimit', 1000],
    ['hasCoordinate', 'true'],
    ['hasGeospatialIssue', 'false'],
    ['occurrenceStatus', 'PRESENT'],
    ['year', `${SINCE},*`],
    ...BASIS.map((b): [string, string] => ['basisOfRecord', b]),
    ...extra,
  ]
  const data = await get<Facets>('/occurrence/search', params)
  const facet = (field: string) =>
    Object.fromEntries(
      (data.facets.find((f) => f.field === field)?.counts ?? []).map((c) => [c.name, c.count]),
    )
  return { countries: facet('COUNTRY'), gadm: facet('GADM_LEVEL_1_GID') }
}

// ── GADM → our map ────────────────────────────────────────────────────────
//
// GBIF tags records with GADM state ids; our map uses ISO 3166-2 codes on
// Natural Earth outlines. Rather than match names ("Québec" vs "Quebec"), a
// GADM id is resolved by taking some records tagged with it and checking which
// of our outlines their coordinates fall in. The answer is cached in
// data/gadm-iso.json, so each id is looked up once, ever.

type Ring = [number, number][]
interface GeoFeature {
  properties: { code: string }
  geometry:
    { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }
}

function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function contains(f: GeoFeature, point: [number, number]): boolean {
  const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  return polygons.some(
    ([outer, ...holes]) => inRing(point, outer) && !holes.some((h) => inRing(point, h)),
  )
}

const admin1 = new Map<string, GeoFeature[]>()
function outlines(country: string): GeoFeature[] {
  if (!admin1.has(country)) {
    const file = join(ROOT, 'public', 'geo', 'admin1', `${country}.json`)
    admin1.set(country, readJson<{ features: GeoFeature[] }>(file, { features: [] }).features)
  }
  return admin1.get(country)!
}

const gadmCache = readJson<Record<string, string | null>>(GADM_FILE, {})

async function resolveGadm(gid: string): Promise<string | null> {
  if (gid in gadmCache) return gadmCache[gid]
  const country = ISO3[gid.split('.')[0]]
  let code: string | null = null
  if (country) {
    const data = await get<{ results: { decimalLatitude: number; decimalLongitude: number }[] }>(
      '/occurrence/search',
      [
        ['gadmGid', gid],
        ['hasCoordinate', 'true'],
        ['hasGeospatialIssue', 'false'],
        ['limit', 100],
      ],
    )
    const votes = new Map<string, number>()
    for (const r of data.results) {
      const hit = outlines(country).find((f) =>
        contains(f, [r.decimalLongitude, r.decimalLatitude]),
      )
      if (hit) votes.set(hit.properties.code, (votes.get(hit.properties.code) ?? 0) + 1)
    }
    const located = [...votes.values()].reduce((a, b) => a + b, 0)
    const [best, n] = [...votes].sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
    // A clear majority, or the GADM and Natural Earth units don't correspond.
    if (best && n >= located * 0.6) code = best
  }
  gadmCache[gid] = code
  writeSorted(GADM_FILE, gadmCache)
  return code
}

async function fetchRange(name: string, regions: Set<string>): Promise<CachedRange> {
  const taxon = await matchTaxon(name)
  const { countries, gadm } = await occurrenceFacets([['taxonKey', taxon.key]])

  const result: CachedRange = {
    key: taxon.key,
    name: taxon.name,
    fetched: new Date().toISOString().slice(0, 10),
    total: 0,
    countries: {},
    subdivisions: {},
    unmapped: {},
  }
  for (const [code, n] of Object.entries(countries)) {
    result.total += n
    if (regions.has(code)) result.countries[code] = n
    else result.unmapped[code] = n
  }
  for (const [gid, n] of Object.entries(gadm)) {
    if (!SUBDIVIDED.has(ISO3[gid.split('.')[0]] ?? '')) continue
    const code = await resolveGadm(gid)
    if (code) result.subdivisions[code] = (result.subdivisions[code] ?? 0) + n
    else result.unmapped[gid] = n
  }
  return result
}

// ── Species files ─────────────────────────────────────────────────────────

/** Replaces the `regions:` list in a species file, leaving everything else as written. */
export function replaceRegions(yaml: string, regions: string[]): string {
  const block = /^regions:\n(?:[ \t]+-[^\n]*\n?)+/m
  if (!block.test(yaml)) throw new Error('no `regions:` list found to replace')
  return yaml.replace(block, `regions:\n${regions.map((r) => `  - ${r}\n`).join('')}`)
}

async function main() {
  const args = process.argv.slice(2)
  const flags = new Set(args.filter((a) => a.startsWith('--')))
  const only = args.filter((a) => !a.startsWith('--'))
  const cache = readJson<Record<string, CachedRange>>(CACHE_FILE, {})
  const regions = knownRegions()
  let failures = 0
  let changed = 0

  const fmt = (codes: string[], counts: GbifCounts) =>
    codes.map((c) => `${c}(${counts.subdivisions[c] ?? counts.countries[c] ?? 0})`).join(' ')

  for (const file of speciesFiles()) {
    const slug = basename(file, '.yaml')
    const wanted = only.length ? only.includes(slug) : flags.has('--all') || !cache[slug]
    if (!wanted) continue

    const raw = readFileSync(file, 'utf8')
    const parsed = speciesSchema.safeParse(parse(raw))
    if (!parsed.success) {
      console.warn(`✗ ${slug}: invalid file — run: npm run validate`)
      failures++
      continue
    }
    const species: SpeciesFile = parsed.data
    if (species.gbif?.manual) continue

    if (!cache[slug] || flags.has('--refresh')) {
      try {
        cache[slug] = await fetchRange(species.gbif?.name ?? species.scientificName, regions)
        writeSorted(CACHE_FILE, cache)
      } catch (e) {
        console.warn(`✗ ${slug}: ${(e as Error).message}`)
        failures++
        continue
      }
    }

    const counts = cache[slug]
    const proposed = proposeRegions(counts, species.gbif)
    if (!proposed.length) {
      console.warn(`✗ ${slug}: too few GBIF records (${counts.total}) — set gbif.manual: true`)
      failures++
      continue
    }
    const diff = diffRegions(species.regions, proposed)
    if (!diff.added.length && !diff.removed.length) {
      console.log(`= ${slug}: unchanged (${proposed.length} regions, ${counts.total} records)`)
      continue
    }
    changed++
    console.log(`~ ${slug}: ${counts.total} records`)
    if (diff.added.length) console.log(`    + ${fmt(diff.added, counts)}`)
    if (diff.removed.length) console.log(`    - ${fmt(diff.removed, counts)}`)
    if (flags.has('--write')) writeFileSync(file, replaceRegions(raw, proposed))
  }

  if (changed && !flags.has('--write')) {
    console.log(`\n${changed} species would change. Review, then re-run with --write.`)
  }
  if (failures) process.exit(1)
}

// Only when run directly, so tests can import replaceRegions.
if (import.meta.filename === process.argv[1]) await main()
