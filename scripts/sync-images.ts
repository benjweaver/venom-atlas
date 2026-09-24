// npm run images            — find a photo for every species that lacks one
// npm run images -- --all   — re-fetch every photo (e.g. to pick up a changed lead image)
// npm run images -- <slug>  — re-fetch one species
//
// Uses the lead image of the species' Wikipedia article, then looks the file
// up on Wikimedia Commons for its author and licence. Only freely licensed
// Commons files are accepted; an article whose lead image is a local fair-use
// upload is skipped with a message, and you can point `wikipedia:` in the
// species file at a different article.
//
// Results go to data/images.json, which is committed: builds never hit the
// network, and the credits shown on the site are reviewable in a diff.
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

import { parse } from 'yaml'

import { speciesSchema, type SpeciesImage } from '../src/data/schema.ts'
import { IMAGES_FILE, readImages, speciesFiles } from './species-loader.ts'

// Wikimedia asks API clients to identify themselves:
// https://meta.wikimedia.org/wiki/User-Agent_policy
const HEADERS = { 'User-Agent': 'venom-atlas/0.1 (image credit sync; build-time only)' }
// Commons serves a fixed set of thumbnail widths from cache; 960 is one of them.
const WIDTH = 960

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Requests go one at a time with a pause between them, and a 429 is retried
// after the delay the server asks for — Wikimedia rate-limits bursts hard.
// The slice of the MediaWiki query response this script reads.
interface ApiResponse {
  query?: {
    pages?: {
      missing?: boolean
      pageimage?: string
      imageinfo?: {
        url: string
        thumburl?: string
        descriptionurl: string
        extmetadata?: Record<string, { value: string } | undefined>
      }[]
    }[]
  }
}

async function api(host: string, params: Record<string, string>): Promise<ApiResponse> {
  const url = new URL(`https://${host}/w/api.php`)
  url.search = new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString()
  for (let attempt = 1; ; attempt++) {
    await sleep(500)
    const res = await fetch(url, { headers: HEADERS })
    if (res.ok) return (await res.json()) as ApiResponse
    if (res.status !== 429 || attempt === 5) throw new Error(`${url}: HTTP ${res.status}`)
    const wait = Number(res.headers.get('retry-after')) || 5 * attempt
    console.log(`  rate limited, waiting ${wait}s`)
    await sleep(wait * 1000)
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

async function leadImage(title: string): Promise<string | undefined> {
  const data = await api('en.wikipedia.org', {
    action: 'query',
    prop: 'pageimages',
    piprop: 'name',
    redirects: '1',
    titles: title,
  })
  return data.query?.pages?.[0]?.pageimage
}

async function commonsInfo(file: string): Promise<SpeciesImage | undefined> {
  const data = await api('commons.wikimedia.org', {
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: String(WIDTH),
    titles: `File:${file}`,
  })
  const page = data.query?.pages?.[0]
  const info = page?.imageinfo?.[0]
  if (!info || page?.missing) return undefined
  const meta = info.extmetadata ?? {}
  const license = meta.LicenseShortName?.value
  if (!license) return undefined
  return {
    src: info.thumburl ?? info.url,
    page: info.descriptionurl,
    artist: stripHtml(meta.Artist?.value ?? 'Unknown'),
    license: stripHtml(license),
    ...(meta.LicenseUrl?.value ? { licenseUrl: meta.LicenseUrl.value } : {}),
  }
}

// Drops credits for species that no longer exist, and sorts so diffs stay small.
function save() {
  const slugs = new Set(speciesFiles().map((f) => basename(f, '.yaml')))
  const sorted = Object.fromEntries(
    Object.entries(images)
      .filter(([slug]) => slugs.has(slug))
      .sort(([a], [b]) => a.localeCompare(b)),
  )
  writeFileSync(IMAGES_FILE, JSON.stringify(sorted, null, 2) + '\n')
}

const args = process.argv.slice(2)
const all = args.includes('--all')
const only = args.filter((a) => !a.startsWith('--'))
const images = readImages()
let failures = 0

for (const file of speciesFiles()) {
  const slug = basename(file, '.yaml')
  if (only.length ? !only.includes(slug) : !all && images[slug]) continue

  const species = speciesSchema.safeParse(parse(readFileSync(file, 'utf8')))
  if (!species.success) {
    console.warn(`✗ ${slug}: invalid file — run: npm run validate`)
    failures++
    continue
  }
  const title = species.data.wikipedia ?? species.data.scientificName

  const name = await leadImage(title)
  const image = name && (await commonsInfo(name))
  if (!image) {
    console.warn(
      name
        ? `✗ ${slug}: lead image of "${title}" (${name}) is not a free Commons file — set wikipedia: to another article`
        : `✗ ${slug}: no Wikipedia lead image for "${title}" — set wikipedia: to the article title`,
    )
    failures++
    continue
  }
  images[slug] = image
  save() // after each one, so an interrupted run keeps what it found
  console.log(`✓ ${slug}: ${name} (${image.license}, ${image.artist})`)
}

save()
if (failures) process.exit(1)
