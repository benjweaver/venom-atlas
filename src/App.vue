<script setup lang="ts">
import allSpecies from 'virtual:species'
import { computed, defineAsyncComponent, reactive, ref, shallowRef, watch } from 'vue'

import FilterBar from '@/components/FilterBar.vue'
import MapLegend from '@/components/MapLegend.vue'
import PlaceNav from '@/components/PlaceNav.vue'
import SpeciesCard from '@/components/SpeciesCard.vue'
import SpeciesDetail from '@/components/SpeciesDetail.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import type { Species } from '@/data/schema'
import { GROUPS } from '@/data/taxonomy'
import {
  loadCountries,
  loadRecords,
  loadSubdivisions,
  wikipediaUrl,
  type RecordPoints,
  type Regions,
} from '@/lib/geo'
import {
  countryOf,
  countsByCountry,
  countsBySubdivision,
  isSubdivision,
  speciesIn,
  type Match,
} from '@/lib/regions'
import { useUrlState } from '@/lib/url-state'

// MapLibre is most of the JavaScript. Loading it separately lets the species
// list render straight away while the map is still downloading.
const AtlasMap = defineAsyncComponent(() => import('@/components/AtlasMap.vue'))

const view = useUrlState()

// Region code → display name and Wikidata id, filled in as boundary files load.
const names = reactive(new Map<string, string>())
const wikidata = new Map<string, string>()
function remember(regions: Regions | null) {
  for (const f of regions?.features ?? []) {
    names.set(f.properties.code, f.properties.name)
    if (f.properties.wikidata) wikidata.set(f.properties.code, f.properties.wikidata)
  }
}
const regionName = (code: string) => names.get(code) ?? code
const regionLink = (code: string) => wikipediaUrl(regionName(code), wikidata.get(code))

const countries = shallowRef<Regions | null>(null)
const loadError = ref<string | null>(null)
loadCountries()
  .then((c) => {
    remember(c)
    countries.value = c
  })
  .catch((e: Error) => (loadError.value = e.message))

// ── Filtering ─────────────────────────────────────────────────────────────
const available = GROUPS.filter((g) => allSpecies.some((s) => s.group === g))

function matchesQuery(s: Species, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return s.name.toLowerCase().includes(needle) || s.scientificName.toLowerCase().includes(needle)
}

const filtered = computed(() =>
  allSpecies.filter(
    (s) => (!view.groups.length || view.groups.includes(s.group)) && matchesQuery(s, view.query),
  ),
)

// ── Selected place ────────────────────────────────────────────────────────
const country = computed(() => (view.region ? countryOf(view.region) : null))
const subdivisions = shallowRef<Regions | null>(null)

watch(
  country,
  async (cc) => {
    if (!cc) return (subdivisions.value = null)
    const subs = await loadSubdivisions(cc)
    if (country.value !== cc) return // the user moved on while it loaded
    remember(subs)
    subdivisions.value = subs
  },
  { immediate: true },
)

const countryCounts = computed(() => countsByCountry(filtered.value))
const subdivisionCounts = computed(() =>
  subdivisions.value
    ? countsBySubdivision(
        filtered.value,
        subdivisions.value.features.map((f) => f.properties.code),
      )
    : new Map<string, number>(),
)

const listed = computed<Match[]>(() =>
  view.region
    ? speciesIn(filtered.value, view.region)
    : [...filtered.value]
        .sort((a, b) => b.danger - a.danger || a.name.localeCompare(b.name))
        .map((species) => ({ species, countryWide: false })),
)

// ── Selected species ──────────────────────────────────────────────────────
const selectedSpecies = computed(() => allSpecies.find((s) => s.slug === view.species) ?? null)
const range = shallowRef<Regions | null>(null)

// A species' range can mix whole countries with states from several
// countries, so its shape is assembled from whichever boundary files it needs.
watch(
  [selectedSpecies, countries],
  async ([species, all]) => {
    if (!species || !all) return (range.value = null)
    const codes = new Set(species.regions)
    const needed = [...new Set(species.regions.filter(isSubdivision).map(countryOf))]
    const subs = await Promise.all(needed.map(loadSubdivisions))
    if (selectedSpecies.value !== species) return
    subs.forEach(remember)
    const unrecorded = new Set(species.unrecorded ?? [])
    range.value = {
      type: 'FeatureCollection',
      features: [all, ...subs].flatMap(
        (r) =>
          r?.features
            .filter((f) => codes.has(f.properties.code))
            .map((f) => ({
              ...f,
              properties: { ...f.properties, recorded: !unrecorded.has(f.properties.code) },
            })) ?? [],
      ),
    }
  },
  { immediate: true },
)

// The species' record grid: dots where it has actually been recorded.
const records = shallowRef<RecordPoints | null>(null)
watch(
  selectedSpecies,
  async (species) => {
    records.value = null
    if (!species?.records) return
    const grid = await loadRecords(species.slug)
    if (selectedSpecies.value !== species || !grid) return
    // A dot is drawn only if its territory is in the species' list (or it's
    // on the high seas), so the dots and the places listed always agree. A
    // country listed whole covers dots tagged with any of its states.
    const listed = new Set(species.regions)
    const shown = (code: string | null) => !code || listed.has(code) || listed.has(code.slice(0, 2))
    records.value = { ...grid, features: grid.features.filter((f) => shown(f.properties.code)) }
  },
  { immediate: true },
)

// ── Navigation ────────────────────────────────────────────────────────────
function selectRegion(code: string | null) {
  view.region = code
  view.species = null
}

// A map click. Clicking a place opens it; clicking empty sea only lets go of
// the place, so an open species stays open. That matters for sea species,
// whose dots are exactly where people click.
function onMapSelect(code: string | null) {
  if (code) selectRegion(code)
  else view.region = null
}

const breadcrumb = computed(() => {
  const crumbs: { code: string | null; label: string }[] = [{ code: null, label: 'World' }]
  if (country.value) crumbs.push({ code: country.value, label: regionName(country.value) })
  if (view.region && isSubdivision(view.region)) {
    crumbs.push({ code: view.region, label: regionName(view.region) })
  }
  return crumbs
})

const countryTotal = countsByCountry(allSpecies).size

// Opening or leaving a species starts the panel at the top. On a phone the
// panel sits below the map, so scroll the page down to the navigation bar,
// which then sticks to the top of the screen.
const navBar = ref<HTMLElement>()
const content = ref<HTMLElement>()
const isPhone = () => !matchMedia('(min-width: 768px)').matches
watch(
  () => view.species,
  (slug) => {
    content.value?.scrollTo({ top: 0 })
    if (slug && isPhone()) navBar.value?.scrollIntoView({ behavior: 'smooth' })
  },
)
function showMap() {
  scrollTo({ top: 0, behavior: 'smooth' })
}

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.target instanceof HTMLInputElement) return
  if (view.species) view.species = null
  else if (view.region) selectRegion(null)
})
</script>

<template>
  <!-- Phones: map on top, then the panel, and the whole page scrolls.
       Wider screens: map and panel side by side, the panel scrolling on its own. -->
  <div class="md:flex md:h-full">
    <main class="relative h-[50vh] md:h-full md:flex-1">
      <AtlasMap
        v-if="countries"
        :countries="countries"
        :country-counts="countryCounts"
        :subdivisions="subdivisions"
        :subdivision-counts="subdivisionCounts"
        :selected="view.region"
        :range="range"
        :records="records"
        :aquatic="!!selectedSpecies?.aquatic"
        @select="onMapSelect"
      />
      <p v-else-if="loadError" class="p-6 text-sm text-(--accent)">{{ loadError }}</p>
      <MapLegend
        v-if="countries"
        :range="!!range"
        :records="!!records"
        :unrecorded="!!selectedSpecies?.unrecorded?.length"
        :aquatic="selectedSpecies?.aquatic"
        class="absolute top-3 left-3 md:top-auto md:bottom-8"
      />
    </main>

    <aside class="bg-(--surface) md:flex md:w-[420px] md:flex-col md:border-l md:border-(--line)">
      <header class="space-y-3 border-b border-(--line) p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h1 class="text-xl font-bold tracking-tight">
              <button type="button" @click="selectRegion(null)">
                Venom<span class="text-(--accent)">Atlas</span>
              </button>
            </h1>
            <p class="text-xs text-(--muted)">
              {{ allSpecies.length }} venomous animals across {{ countryTotal }} countries
            </p>
          </div>
          <ThemeToggle />
        </div>
        <FilterBar v-model:groups="view.groups" v-model:query="view.query" :available="available" />
      </header>

      <!-- Sticks to the top of the screen on phones as the page scrolls. -->
      <div ref="navBar" class="sticky top-0 z-20 md:static">
        <PlaceNav
          :crumbs="breadcrumb"
          :species="selectedSpecies?.name"
          @go="selectRegion"
          @close="view.species = null"
          @map="showMap"
        />
      </div>

      <div ref="content" class="p-4 md:min-h-0 md:flex-1 md:overflow-y-auto">
        <SpeciesDetail
          v-if="selectedSpecies"
          :species="selectedSpecies"
          :region-name="regionName"
          @region="selectRegion"
        />

        <template v-else>
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="text-lg font-semibold">
              {{ view.region ? regionName(view.region) : 'All species' }}
            </h2>
            <a
              v-if="view.region"
              :href="regionLink(view.region)"
              target="_blank"
              rel="noopener"
              class="shrink-0 text-xs text-(--accent) hover:underline"
            >
              Wikipedia →
            </a>
          </div>
          <p class="mb-3 text-sm text-(--muted)">
            <template v-if="!view.region && !listed.length">No species match.</template>
            <template v-else-if="!view.region"
              >Select a country on the map to narrow it down.</template
            >
            <template v-else-if="listed.length">
              {{ listed.length }} species recorded{{
                subdivisions && !isSubdivision(view.region) ? ' · click a state or province' : ''
              }}
            </template>
            <template v-else>No species recorded here yet.</template>
          </p>

          <ul class="-mx-2 space-y-1">
            <li v-for="{ species, countryWide } in listed" :key="species.slug">
              <SpeciesCard
                :species="species"
                :country-wide="countryWide"
                @open="view.species = species.slug"
              />
            </li>
          </ul>
        </template>
      </div>

      <footer class="border-t border-(--line) px-4 py-2 text-[11px] leading-snug text-(--muted)">
        For education only — not medical advice. If you're bitten or stung, call your local
        emergency number. Ranges are simplified and not exhaustive.
        <span class="mt-1 block">
          Made by
          <a
            href="https://github.com/benjweaver"
            target="_blank"
            rel="noopener"
            class="text-(--ink) hover:underline"
            >Ben Weaver</a
          >
        </span>
      </footer>
    </aside>
  </div>
</template>
