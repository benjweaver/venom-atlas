// The selected place, species and filters live in the URL query string, so
// every view is a shareable link and the back button works — without a router
// or server-side rewrites, which keeps the site deployable to any static host.
//
//   ?r=US-AZ              a country or state
//   ?s=crotalus-atrox     a species
//   ?g=snake,spider       group filter
//   ?q=widow              search text
import { reactive, watch } from 'vue'

import { GROUPS, type Group } from '@/data/taxonomy'

export interface ViewState {
  region: string | null
  species: string | null
  groups: Group[]
  query: string
}

function read(): ViewState {
  const p = new URLSearchParams(location.search)
  const groups = (p.get('g') ?? '')
    .split(',')
    .filter((g): g is Group => (GROUPS as readonly string[]).includes(g))
  return { region: p.get('r'), species: p.get('s'), groups, query: p.get('q') ?? '' }
}

function toSearch(state: ViewState): string {
  const p = new URLSearchParams()
  if (state.region) p.set('r', state.region)
  if (state.species) p.set('s', state.species)
  if (state.groups.length) p.set('g', state.groups.join(','))
  if (state.query) p.set('q', state.query)
  const s = p.toString()
  return s ? `?${s}` : location.pathname
}

export function useUrlState(): ViewState {
  const state = reactive(read())
  let fromHistory = false

  // Navigating (place or species) adds a history entry; typing in the search
  // box or toggling filters replaces the current one, so Back doesn't replay
  // every keystroke.
  watch(
    () => [state.region, state.species] as const,
    () => {
      if (!fromHistory) history.pushState(null, '', toSearch(state))
    },
  )
  watch(
    () => [state.groups.join(','), state.query] as const,
    () => {
      if (!fromHistory) history.replaceState(null, '', toSearch(state))
    },
  )

  addEventListener('popstate', () => {
    fromHistory = true
    Object.assign(state, read())
    // Watchers run after this tick; clear the flag once they have.
    queueMicrotask(() => (fromHistory = false))
  })

  return state
}
