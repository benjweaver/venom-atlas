<script setup lang="ts">
import { HEAT_STEPS, heatLabel } from '@/lib/heat'

defineProps<{
  range: boolean
  records: boolean
  /** The species has places listed without any records. */
  unrecorded?: boolean
  aquatic?: 'marine' | 'freshwater'
}>()
</script>

<template>
  <div
    class="rounded-lg bg-(--surface)/90 px-3 py-2 text-[11px] text-(--muted) shadow-sm ring-1 ring-(--line) backdrop-blur"
  >
    <template v-if="records">
      <div class="flex flex-col gap-1">
        <span class="inline-flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-full bg-(--map-records)" />
          {{
            aquatic === 'marine'
              ? 'Recorded at sea or on the shore'
              : aquatic === 'freshwater'
                ? 'Recorded in rivers and lakes'
                : 'Where it has been recorded'
          }}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="h-3 w-3 rounded-sm bg-(--map-range) opacity-40" /> Places it's found in
        </span>
        <span v-if="unrecorded" class="inline-flex items-center gap-1.5">
          <span class="h-3 w-3 rounded-sm border border-dashed border-(--map-range)" />
          Known range, no records
        </span>
      </div>
    </template>
    <template v-else-if="range">
      <span class="inline-flex items-center gap-1.5">
        <span class="h-3 w-3 rounded-sm bg-(--map-range) opacity-70" /> Where this species lives
      </span>
    </template>
    <template v-else>
      <div class="mb-1 font-medium text-(--ink)">Species recorded</div>
      <div class="flex flex-wrap gap-x-2 gap-y-1">
        <span class="flex items-center gap-1">
          <span
            class="h-3 w-3 rounded-sm ring-1 ring-(--line) ring-inset"
            :style="{ background: 'var(--map-land)' }"
          />
          None
        </span>
        <span v-for="(_, i) in HEAT_STEPS" :key="i" class="flex items-center gap-1">
          <span class="h-3 w-3 rounded-sm" :style="{ background: `var(--heat-${i + 1})` }" />
          {{ heatLabel(i) }}
        </span>
      </div>
    </template>
  </div>
</template>
