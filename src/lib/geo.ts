import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'

export interface RegionProps {
  code: string
  name: string
  continent?: string
  count?: number
}

export type Regions = FeatureCollection<Geometry, RegionProps>

const cache = new Map<string, Promise<Regions | null>>()

// Files live in public/geo; BASE_URL makes this work when the site is served
// from a sub-path (GitHub Pages project sites).
function load(path: string): Promise<Regions | null> {
  let pending = cache.get(path)
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}geo/${path}`).then((r) =>
      r.ok ? (r.json() as Promise<Regions>) : null,
    )
    cache.set(path, pending)
  }
  return pending
}

export async function loadCountries(): Promise<Regions> {
  const countries = await load('countries.json')
  if (!countries) throw new Error('countries.json is missing — run: npm run boundaries')
  return countries
}

/** States/provinces for one country, or null for countries Natural Earth doesn't subdivide. */
export function loadSubdivisions(country: string): Promise<Regions | null> {
  return load(`admin1/${country}.json`)
}

export type BBox = [west: number, south: number, east: number, north: number]

/**
 * Bounding box of some features. Countries that straddle the 180° meridian
 * (Russia, Fiji, the Aleutians) would otherwise get a box spanning the whole
 * planet, so the box is also measured with longitudes shifted into 0–360 and
 * the narrower of the two wins. MapLibre accepts an east edge beyond 180.
 */
export function bbox(features: Feature<Geometry>[]): BBox | null {
  let w = Infinity
  let e = -Infinity
  let w360 = Infinity
  let e360 = -Infinity
  let s = Infinity
  let n = -Infinity
  const visit = (coords: unknown): void => {
    if (typeof (coords as Position)[0] === 'number') {
      const [x, y] = coords as Position
      const x360 = x < 0 ? x + 360 : x
      w = Math.min(w, x)
      e = Math.max(e, x)
      w360 = Math.min(w360, x360)
      e360 = Math.max(e360, x360)
      s = Math.min(s, y)
      n = Math.max(n, y)
    } else {
      for (const c of coords as unknown[]) visit(c)
    }
  }
  for (const f of features) {
    if (f.geometry.type === 'GeometryCollection') {
      for (const g of f.geometry.geometries) if ('coordinates' in g) visit(g.coordinates)
    } else {
      visit(f.geometry.coordinates)
    }
  }
  if (w === Infinity) return null
  return e360 - w360 < e - w ? [w360, s, e360, n] : [w, s, e, n]
}

function polygons(geometry: Geometry): Position[][][] {
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

// Planar area of a ring, scaled by latitude so high-latitude islands don't
// outweigh their true size. Only used to compare parts of one country.
function ringArea(ring: Position[]): number {
  let sum = 0
  let lat = 0
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    lat += ring[i][1]
  }
  return (Math.abs(sum) / 2) * Math.cos(((lat / (ring.length - 1)) * Math.PI) / 180)
}

// Degrees of empty space between two boxes (0 if they touch or overlap),
// measured the short way round the antimeridian.
function gap(a: BBox, b: BBox): number {
  const lng = Math.min(
    ...[-360, 0, 360].map((shift) => Math.max(0, a[0] - (b[2] + shift), b[0] + shift - a[2])),
  )
  const lat = Math.max(0, a[1] - b[3], b[1] - a[3])
  return Math.max(lng, lat)
}

const polygonFeature = (coordinates: Position[][]): Feature<Geometry> => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates },
})

/**
 * The box to zoom to for one country or state. Framing every part of a
 * country is useless for France (French Guiana and Réunion would put the
 * camera over the Atlantic) or the US (Guam, Hawaii), so this frames the
 * largest landmass plus any part that is either big or close to it —
 * which keeps Tasmania, Corsica and Alaska but drops far-flung territories.
 */
export function frameBox(feature: Feature<Geometry>): BBox | null {
  const parts = polygons(feature.geometry)
  if (parts.length <= 1) return bbox([feature])
  const areas = parts.map((p) => ringArea(p[0]))
  const largest = Math.max(...areas)
  const main = bbox([polygonFeature(parts[areas.indexOf(largest)])])!
  const keep = parts.filter((part, i) => {
    if (areas[i] >= largest * 0.2) return true
    return gap(main, bbox([polygonFeature(part)])!) <= 5
  })
  return bbox(keep.map(polygonFeature))
}
