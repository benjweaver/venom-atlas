<script setup lang="ts">
// The map. It draws GeoJSON sources on a plain background — no tile server,
// no API key, nothing to pay for or rotate:
//
//   countries      every country, shaded by how many species live there
//   subdivisions   the selected country's states/provinces, shaded the same way
//   lakes, rivers  major fresh water, for context
//   range          where the selected species lives, drawn over both
//   records        for aquatic species, dots where it has actually been
//                  recorded — the sea or river, not the whole country
//
// Everything it shows comes in through props, and clicks go out as a `select`
// event. It holds no app state of its own, so App.vue stays the one place that
// decides what is selected.
import {
  Map as MapLibre,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
} from 'maplibre-gl'
// MapLibre 6 starts its worker from a URL computed at runtime, which no bundler
// can follow — so the build never emits the file and the map stays blank.
// `?worker&url` makes Vite bundle the worker (and the chunk it shares with the
// main library) and hands back its URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { bbox, frameBox, loadWater, type BBox, type RecordPoints, type Regions } from '@/lib/geo'
import { HEAT_STEPS } from '@/lib/heat'
import { isSubdivision } from '@/lib/regions'
import { theme } from '@/lib/theme'

const props = defineProps<{
  countries: Regions
  countryCounts: Map<string, number>
  subdivisions: Regions | null
  subdivisionCounts: Map<string, number>
  selected: string | null
  range: Regions | null
  /** Record grid of the selected species. */
  records: RecordPoints | null
  aquatic: boolean
}>()

const emit = defineEmits<{ select: [code: string | null] }>()

const container = ref<HTMLDivElement>()
const tooltip = ref<{ x: number; y: number; name: string; detail: string } | null>(null)
let map: MapLibre | undefined
// Set once the style has loaded. Until then MapLibre rejects changes, and the
// 'load' handler applies the current props anyway, so updates just wait.
let ready = false
const WORLD: [number, number, number, number] = [-160, -50, 175, 72]
const EMPTY: Regions = { type: 'FeatureCollection', features: [] }
setWorkerUrl(workerUrl)

// Colours come from CSS custom properties so light/dark lives in one place
// (style.css). MapLibre paints on a canvas and can't read CSS itself, so they
// are read here and re-applied when the theme changes.
function palette() {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return {
    ocean: v('--map-ocean'),
    land: v('--map-land'),
    border: v('--map-border'),
    heat: [1, 2, 3, 4, 5].map((i) => v(`--heat-${i}`)),
    // Water species keep the blues; land species get the greens.
    range: v(props.aquatic ? '--map-range' : '--map-range-land'),
    selected: v('--map-selected'),
    water: v('--map-water'),
    records: v(props.aquatic ? '--map-records' : '--map-records-land'),
  }
}

function heatPaint(c: ReturnType<typeof palette>, dimmed: boolean) {
  if (dimmed) return c.land
  return [
    'step',
    ['coalesce', ['get', 'count'], 0],
    c.land,
    ...HEAT_STEPS.flatMap((step, i) => [step, c.heat[i]]),
  ] as unknown as string
}

function withCounts(regions: Regions, counts: Map<string, number>): Regions {
  return {
    ...regions,
    features: regions.features.map((f) => ({
      ...f,
      properties: { ...f.properties, count: counts.get(f.properties.code) ?? 0 },
    })),
  }
}

function source(id: string): GeoJSONSource | undefined {
  return map?.getSource<GeoJSONSource>(id)
}

function applyPalette() {
  if (!map || !ready) return
  const c = palette()
  const dimmed = !!props.range
  map.setPaintProperty('background', 'background-color', c.ocean)
  map.setPaintProperty('countries-fill', 'fill-color', heatPaint(c, dimmed))
  map.setPaintProperty('subdivisions-fill', 'fill-color', heatPaint(c, dimmed))
  map.setPaintProperty('countries-line', 'line-color', c.border)
  map.setPaintProperty('subdivisions-line', 'line-color', c.border)
  map.setPaintProperty('range-fill', 'fill-color', c.range)
  // With dots, they carry the detail and the range fades back: faint for a
  // water species (the land isn't where it lives), lighter for a land one.
  const opacity = !props.records ? 0.55 : props.aquatic ? 0.12 : 0.28
  // Places known without records (checklists, review) are fainter and dashed.
  map.setPaintProperty('range-fill', 'fill-opacity', [
    'case',
    ['==', ['get', 'recorded'], false],
    opacity * 0.5,
    opacity,
  ])
  map.setPaintProperty('range-unrecorded-line', 'line-color', c.range)
  map.setPaintProperty('lakes-fill', 'fill-color', c.water)
  map.setPaintProperty('rivers-line', 'line-color', c.water)
  map.setPaintProperty('records-circle', 'circle-color', c.records)
  map.setPaintProperty('records-circle', 'circle-stroke-color', c.ocean)
  map.setPaintProperty('range-line', 'line-color', c.range)
  map.setPaintProperty('selected-line', 'line-color', c.selected)
  map.setPaintProperty('selected-sub-line', 'line-color', c.selected)
}

function flyTo(box: BBox | null) {
  if (!ready) return
  map?.fitBounds(box ?? WORLD, { padding: 32, maxZoom: 6, duration: 700 })
}

function frameSelection() {
  const code = props.selected
  if (!code) return flyTo(bbox(props.range?.features ?? []))
  const source = isSubdivision(code) ? props.subdivisions : props.countries
  const feature = source?.features.find((f) => f.properties.code === code)
  // A state whose outline hasn't loaded yet is framed when it arrives.
  if (feature) flyTo(frameBox(feature))
}

function updateSelectedOutline() {
  if (!ready) return
  map?.setFilter('selected-line', ['==', ['get', 'code'], props.selected ?? ''])
}

onMounted(() => {
  const c = palette()
  map = new MapLibre({
    container: container.value!,
    bounds: WORLD,
    fitBoundsOptions: { padding: 16 },
    attributionControl: { compact: true, customAttribution: 'Boundaries: Natural Earth' },
    dragRotate: false,
    pitchWithRotate: false,
    style: {
      version: 8,
      sources: {
        countries: {
          type: 'geojson',
          data: withCounts(props.countries, props.countryCounts),
          promoteId: 'code',
        },
        subdivisions: { type: 'geojson', data: EMPTY, promoteId: 'code' },
        range: { type: 'geojson', data: EMPTY },
        lakes: { type: 'geojson', data: EMPTY },
        rivers: { type: 'geojson', data: EMPTY },
        records: { type: 'geojson', data: EMPTY },
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': c.ocean } },
        {
          id: 'countries-fill',
          type: 'fill',
          source: 'countries',
          paint: {
            'fill-color': heatPaint(c, false),
            'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.75, 1],
          },
        },
        {
          id: 'subdivisions-fill',
          type: 'fill',
          source: 'subdivisions',
          paint: {
            'fill-color': heatPaint(c, false),
            'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.75, 1],
          },
        },
        {
          id: 'lakes-fill',
          type: 'fill',
          source: 'lakes',
          paint: { 'fill-color': c.water },
        },
        {
          id: 'rivers-line',
          type: 'line',
          source: 'rivers',
          // Only the biggest rivers when zoomed out (lower rank = bigger).
          filter: [
            'step',
            ['zoom'],
            ['<=', ['get', 'rank'], 3],
            3,
            ['<=', ['get', 'rank'], 6],
            5,
            true,
          ],
          paint: {
            'line-color': c.water,
            'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 6, 1.6],
          },
        },
        {
          id: 'range-fill',
          type: 'fill',
          source: 'range',
          paint: { 'fill-color': c.range, 'fill-opacity': 0.55 },
        },
        {
          id: 'countries-line',
          type: 'line',
          source: 'countries',
          paint: { 'line-color': c.border, 'line-width': 0.6 },
        },
        {
          id: 'subdivisions-line',
          type: 'line',
          source: 'subdivisions',
          paint: { 'line-color': c.border, 'line-width': 0.5 },
        },
        {
          id: 'range-line',
          type: 'line',
          source: 'range',
          filter: ['!=', ['get', 'recorded'], false],
          paint: { 'line-color': c.range, 'line-width': 1.2 },
        },
        {
          id: 'range-unrecorded-line',
          type: 'line',
          source: 'range',
          filter: ['==', ['get', 'recorded'], false],
          paint: { 'line-color': c.range, 'line-width': 1.2, 'line-dasharray': [2, 2] },
        },
        {
          id: 'records-circle',
          type: 'circle',
          source: 'records',
          paint: {
            'circle-color': c.records,
            // Faint for a single record, solid where records pile up, so a
            // state full of dots still shows where the hotspots are.
            'circle-opacity': [
              'interpolate',
              ['linear'],
              ['ln', ['get', 'n']],
              0,
              0.3,
              2.3,
              0.65,
              4.6,
              0.95,
            ],
            'circle-stroke-color': c.ocean,
            'circle-stroke-width': 0.5,
            // Grows with zoom, and a little with how many records a cell has.
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              1,
              ['interpolate', ['linear'], ['ln', ['get', 'n']], 0, 1.8, 6, 3.5],
              6,
              ['interpolate', ['linear'], ['ln', ['get', 'n']], 0, 5, 6, 9],
            ],
          },
        },
        {
          id: 'selected-line',
          type: 'line',
          source: 'countries',
          filter: ['==', ['get', 'code'], ''],
          paint: { 'line-color': c.selected, 'line-width': 2.5 },
        },
        {
          id: 'selected-sub-line',
          type: 'line',
          source: 'subdivisions',
          filter: ['==', ['get', 'code'], ''],
          paint: { 'line-color': c.selected, 'line-width': 2.5 },
        },
      ],
    },
  })
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

  map.on('load', () => {
    ready = true
    source('countries')?.setData(withCounts(props.countries, props.countryCounts))
    loadWater().then((water) => {
      source('lakes')?.setData(water?.lakes ?? EMPTY)
      source('rivers')?.setData(water?.rivers ?? EMPTY)
    })
    syncSubdivisions()
    syncRange()
    updateSelectedOutline()
    if (props.selected) frameSelection()
  })

  // Hover: highlight the region under the pointer and show its name and count.
  // States take priority over the country they sit in.
  let hovered: { source: string; id: string } | null = null
  const setHover = (next: typeof hovered) => {
    if (hovered) map!.setFeatureState(hovered, { hover: false })
    hovered = next
    if (hovered) map!.setFeatureState(hovered, { hover: true })
  }

  // A record dot's count: on hover with a mouse, on tap on a touch screen.
  const showDot = (n: number, point: { x: number; y: number }) => {
    tooltip.value = {
      x: point.x,
      y: point.y,
      name: `${n} ${n === 1 ? 'record' : 'records'}`,
      detail: 'within about 20 km',
    }
  }

  map.on('mousemove', (e: MapMouseEvent) => {
    const [dot] = map!.queryRenderedFeatures(e.point, { layers: ['records-circle'] })
    if (dot) {
      setHover(null)
      showDot(dot.properties.n as number, e.point)
      map!.getCanvas().style.cursor = ''
      return
    }
    const [hit] = map!.queryRenderedFeatures(e.point, {
      layers: ['subdivisions-fill', 'countries-fill'],
    })
    if (!hit) {
      setHover(null)
      tooltip.value = null
      map!.getCanvas().style.cursor = ''
      return
    }
    const code = hit.properties.code as string
    if (hovered?.id !== code) setHover({ source: hit.source, id: code })
    tooltip.value = {
      x: e.point.x,
      y: e.point.y,
      name: hit.properties.name as string,
      detail: `${(hit.properties.count as number) ?? 0} species`,
    }
    map!.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseout', () => {
    setHover(null)
    tooltip.value = null
  })

  // A tap on a place opens it. A tap on a record dot at sea shows its count
  // (so tapping around a sea species' dots doesn't close it), and a tap on
  // empty sea means "step out", which App.vue handles.
  map.on('click', (e: MapMouseEvent) => {
    const [hit] = map!.queryRenderedFeatures(e.point, {
      layers: ['subdivisions-fill', 'countries-fill'],
    })
    if (hit) return emit('select', hit.properties.code as string)
    const [dot] = map!.queryRenderedFeatures(e.point, { layers: ['records-circle'] })
    if (dot) return showDot(dot.properties.n as number, e.point)
    tooltip.value = null
    emit('select', null)
  })
  // A tapped dot's count goes away once the map moves.
  map.on('movestart', () => (tooltip.value = null))
})

onBeforeUnmount(() => {
  map?.remove()
})

function syncSubdivisions() {
  if (!ready) return
  const subs = props.subdivisions
  source('subdivisions')?.setData(subs ? withCounts(subs, props.subdivisionCounts) : EMPTY)
  map?.setFilter('selected-sub-line', ['==', ['get', 'code'], props.selected ?? ''])
}

function syncRange() {
  if (!ready) return
  source('range')?.setData(props.range ?? EMPTY)
  source('records')?.setData(props.records ?? EMPTY)
  applyPalette()
}

watch(
  () => props.countryCounts,
  (counts) => ready && source('countries')?.setData(withCounts(props.countries, counts)),
)
watch(() => [props.subdivisions, props.subdivisionCounts], syncSubdivisions)
watch(() => props.records, syncRange)
// Water and land species are coloured differently (blue and green).
watch(() => props.aquatic, applyPalette)
// Light/dark: the tokens in style.css have already switched by the time this
// runs (watchers run after theme.ts has set <html data-theme>).
watch(() => theme.resolved, applyPalette)
watch(
  () => props.range,
  () => {
    syncRange()
    // With no place selected, frame the species' range; otherwise stay put.
    if (!props.selected) flyTo(bbox(props.range?.features ?? []))
  },
)
watch(
  () => [props.selected, props.subdivisions] as const,
  ([code, subs], [prevCode, prevSubs]) => {
    updateSelectedOutline()
    syncSubdivisions()
    // Re-frame when the selection changes, and again when a state's outline
    // arrives after its country was already chosen.
    if (code !== prevCode || (subs !== prevSubs && code && isSubdivision(code))) {
      if (code || !props.range) frameSelection()
    }
  },
)
</script>

<template>
  <div class="relative h-full w-full">
    <div ref="container" class="h-full w-full" />
    <div
      v-if="tooltip"
      class="pointer-events-none absolute z-10 rounded-md bg-(--surface) px-2 py-1 text-xs whitespace-nowrap text-(--ink) shadow-md ring-1 ring-(--line)"
      :style="{ left: `${tooltip.x + 12}px`, top: `${tooltip.y + 12}px` }"
    >
      <span class="font-semibold">{{ tooltip.name }}</span>
      <span class="text-(--muted)"> · {{ tooltip.detail }}</span>
    </div>
  </div>
</template>
