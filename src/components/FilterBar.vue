<script setup lang="ts">
import { GROUP_LABELS, type Group } from '@/data/taxonomy'

const props = defineProps<{ available: Group[] }>()
const groups = defineModel<Group[]>('groups', { required: true })
const query = defineModel<string>('query', { required: true })

function toggle(group: Group) {
  groups.value = groups.value.includes(group)
    ? groups.value.filter((g) => g !== group)
    : props.available.filter((g) => g === group || groups.value.includes(g))
}
</script>

<template>
  <div class="space-y-2">
    <input
      v-model.trim="query"
      type="search"
      placeholder="Search species…"
      aria-label="Search species"
      class="w-full rounded-lg bg-(--surface-2) px-3 py-2 text-sm ring-1 ring-(--line) outline-none placeholder:text-(--muted) focus:ring-2 focus:ring-(--accent)"
    />
    <!-- Phones: one row that scrolls sideways (fading at the edge to show there's
         more), instead of three rows of chips. -->
    <div
      class="flex flex-wrap gap-1.5 max-md:-mx-4 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-4 max-md:py-0.5 max-md:[mask-image:linear-gradient(to_right,black_88%,transparent)] max-md:[scrollbar-width:none]"
      role="group"
      aria-label="Filter by animal group"
    >
      <button
        v-for="group in available"
        :key="group"
        type="button"
        :aria-pressed="groups.includes(group)"
        class="shrink-0 rounded-full px-2.5 py-1 text-xs ring-1 transition-colors"
        :class="
          groups.includes(group)
            ? 'bg-(--accent) text-white ring-(--accent)'
            : 'text-(--muted) ring-(--line) hover:text-(--ink)'
        "
        @click="toggle(group)"
      >
        {{ GROUP_LABELS[group] }}
      </button>
      <button
        v-if="groups.length"
        type="button"
        class="shrink-0 px-1 text-xs text-(--muted) underline hover:text-(--ink) max-md:order-first"
        @click="groups = []"
      >
        Clear
      </button>
    </div>
  </div>
</template>
