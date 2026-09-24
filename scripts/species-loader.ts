// Reads and validates every species file. Shared by the Vite plugin (dev and
// build) and `npm run validate`, so the checks CI runs are exactly the checks
// the dev server runs.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { parse } from 'yaml'
import { z } from 'zod'

import { imageSchema, speciesSchema, type Species } from '../src/data/schema.ts'

export const ROOT = join(import.meta.dirname, '..')
export const SPECIES_DIR = join(ROOT, 'data', 'species')
export const IMAGES_FILE = join(ROOT, 'data', 'images.json')
export const GBIF_FILE = join(ROOT, 'data', 'gbif.json')
const GEO_DIR = join(ROOT, 'public', 'geo')

export class DataError extends Error {
  readonly problems: string[]
  constructor(problems: string[]) {
    super(`species data has ${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
    this.problems = problems
  }
}

/** Every region code the map can draw: countries plus each country's subdivisions. */
export function knownRegions(): Set<string> {
  const codes = new Set<string>()
  const countries = JSON.parse(readFileSync(join(GEO_DIR, 'countries.json'), 'utf8'))
  for (const f of countries.features) codes.add(f.properties.code)
  for (const file of readdirSync(join(GEO_DIR, 'admin1'))) {
    const admin1 = JSON.parse(readFileSync(join(GEO_DIR, 'admin1', file), 'utf8'))
    for (const f of admin1.features) codes.add(f.properties.code)
  }
  return codes
}

export function readImages(): Record<string, z.infer<typeof imageSchema>> {
  if (!existsSync(IMAGES_FILE)) return {}
  return z.record(z.string(), imageSchema).parse(JSON.parse(readFileSync(IMAGES_FILE, 'utf8')))
}

/** GBIF taxon keys from `npm run ranges`, used to link each species to its records. */
export function readGbifKeys(): Record<string, number> {
  if (!existsSync(GBIF_FILE)) return {}
  const cache = z
    .record(z.string(), z.looseObject({ key: z.number() }))
    .parse(JSON.parse(readFileSync(GBIF_FILE, 'utf8')))
  return Object.fromEntries(Object.entries(cache).map(([slug, { key }]) => [slug, key]))
}

export function speciesFiles(): string[] {
  return readdirSync(SPECIES_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => join(SPECIES_DIR, f))
}

/**
 * Parses and checks every file, collecting all problems before throwing so a
 * contributor sees the full list at once rather than one error per run.
 */
export function loadSpecies(regions = knownRegions()): Species[] {
  const images = readImages()
  const gbifKeys = readGbifKeys()
  const problems: string[] = []
  const species: Species[] = []

  for (const file of speciesFiles()) {
    const slug = basename(file, '.yaml')
    const where = `data/species/${slug}.yaml`

    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      problems.push(`${where}: file name must be lowercase-with-dashes`)
    }

    let raw: unknown
    try {
      raw = parse(readFileSync(file, 'utf8'))
    } catch (e) {
      problems.push(`${where}: invalid YAML — ${(e as Error).message.split('\n')[0]}`)
      continue
    }

    const result = speciesSchema.safeParse(raw)
    if (!result.success) {
      for (const issue of result.error.issues) {
        problems.push(`${where}: ${issue.path.join('.') || '(root)'} — ${issue.message}`)
      }
      continue
    }

    const data = result.data
    const seen = new Set<string>()
    for (const code of data.regions) {
      if (seen.has(code)) problems.push(`${where}: region ${code} is listed twice`)
      seen.add(code)
      if (!regions.has(code)) problems.push(`${where}: unknown region code ${code}`)
    }
    for (const code of [...(data.gbif?.exclude ?? []), ...(data.gbif?.include ?? [])]) {
      if (!regions.has(code)) problems.push(`${where}: unknown region code ${code} in gbif`)
    }
    // Listing "US" and "US-AZ" together is ambiguous: is it the whole country
    // or just Arizona? The map would show the whole country, so say which.
    for (const code of data.regions) {
      if (code.includes('-') && seen.has(code.slice(0, 2))) {
        problems.push(
          `${where}: lists both ${code.slice(0, 2)} and ${code} — use the country or its states, not both`,
        )
      }
    }

    species.push({ ...data, slug, image: images[slug], gbifKey: gbifKeys[slug] })
  }

  if (problems.length) throw new DataError(problems)
  return species
}
