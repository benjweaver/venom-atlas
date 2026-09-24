<script setup lang="ts">
import { HEAT_STEPS, heatLabel } from '@/lib/heat'

defineProps<{ range: boolean }>()
</script>

<template>
  <div
    class="rounded-lg bg-(--surface)/90 px-3 py-2 text-[11px] text-(--muted) shadow-sm ring-1 ring-(--line) backdrop-blur"
  >
    <template v-if="range">
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
