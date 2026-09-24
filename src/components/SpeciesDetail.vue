<script setup lang="ts">
import { computed } from 'vue'

import type { Species } from '@/data/schema'
import { GROUP_LABELS } from '@/data/taxonomy'
import { countryOf, isSubdivision } from '@/lib/regions'

import DangerBadge from './DangerBadge.vue'

const props = defineProps<{ species: Species; regionName: (code: string) => string }>()
defineEmits<{ back: []; region: [code: string] }>()

// "United States: Arizona, New Mexico · Mexico" — states grouped under their
// country so a long range stays scannable.
const where = computed(() => {
  const byCountry = new Map<string, string[]>()
  for (const code of props.species.regions) {
    const country = countryOf(code)
    const list = byCountry.get(country) ?? []
    if (isSubdivision(code)) list.push(code)
    byCountry.set(country, list)
  }
  return [...byCountry]
    .map(([country, subs]) => ({ country, subs }))
    .sort((a, b) => props.regionName(a.country).localeCompare(props.regionName(b.country)))
})

const wikipedia = computed(
  () =>
    `https://en.wikipedia.org/wiki/${encodeURIComponent(
      (props.species.wikipedia ?? props.species.scientificName).replace(/ /g, '_'),
    )}`,
)
</script>

<template>
  <article>
    <button
      type="button"
      class="mb-3 text-sm text-(--muted) hover:text-(--ink)"
      @click="$emit('back')"
    >
      ← Back
    </button>

    <figure v-if="species.image" class="-mx-4 mb-4">
      <img
        :src="species.image.src"
        :alt="species.name"
        class="aspect-[4/3] w-full bg-(--surface-2) object-cover"
      />
      <figcaption class="px-4 pt-1 text-[11px] text-(--muted)">
        Photo:
        <a :href="species.image.page" target="_blank" rel="noopener" class="underline">
          {{ species.image.artist }}
        </a>
        ·
        <a
          v-if="species.image.licenseUrl"
          :href="species.image.licenseUrl"
          target="_blank"
          rel="noopener"
          class="underline"
          >{{ species.image.license }}</a
        >
        <template v-else>{{ species.image.license }}</template>
      </figcaption>
    </figure>

    <p class="text-xs tracking-wide text-(--muted) uppercase">{{ GROUP_LABELS[species.group] }}</p>
    <h2 class="text-2xl leading-tight font-bold">{{ species.name }}</h2>
    <p class="text-sm text-(--muted) italic">{{ species.scientificName }}</p>
    <DangerBadge :level="species.danger" class="mt-2" />

    <p class="mt-4">{{ species.summary }}</p>

    <dl class="mt-4 space-y-3 text-sm">
      <div>
        <dt class="font-semibold">Venom</dt>
        <dd class="text-(--muted)">{{ species.venom }}</dd>
      </div>
      <div>
        <dt class="font-semibold">Habitat</dt>
        <dd class="text-(--muted)">{{ species.habitat }}</dd>
      </div>
      <div v-if="species.size">
        <dt class="font-semibold">Size</dt>
        <dd class="text-(--muted)">{{ species.size }}</dd>
      </div>
      <div>
        <dt class="font-semibold">Where it's found</dt>
        <dd class="mt-1 space-y-1">
          <div v-for="{ country, subs } in where" :key="country">
            <button
              type="button"
              class="text-(--accent) hover:underline"
              @click="$emit('region', country)"
            >
              {{ regionName(country) }}</button
            ><template v-if="subs.length">
              <span class="text-(--muted)">: </span>
              <template v-for="(code, i) in subs" :key="code">
                <button
                  type="button"
                  class="text-(--ink) hover:text-(--accent) hover:underline"
                  @click="$emit('region', code)"
                >
                  {{ regionName(code) }}</button
                ><span v-if="i < subs.length - 1" class="text-(--muted)">, </span>
              </template>
            </template>
          </div>
        </dd>
      </div>
    </dl>

    <p v-if="species.gbifKey" class="mt-3 text-[11px] text-(--muted)">
      Range based on occurrence records from
      <a
        :href="`https://www.gbif.org/species/${species.gbifKey}`"
        target="_blank"
        rel="noopener"
        class="underline"
        >GBIF</a
      >, reviewed by hand.
    </p>

    <a
      :href="wikipedia"
      target="_blank"
      rel="noopener"
      class="mt-5 inline-block text-sm text-(--accent) hover:underline"
    >
      Read more on Wikipedia →
    </a>
  </article>
</template>
