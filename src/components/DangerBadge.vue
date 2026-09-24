<script setup lang="ts">
import { DANGER_LABELS, type Danger } from '@/data/taxonomy'

defineProps<{ level: Danger }>()
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 text-xs font-medium"
    :style="{ color: `var(--danger-${level})` }"
    :title="`Danger ${level} of 5`"
  >
    <span class="flex gap-0.5" aria-hidden="true">
      <span
        v-for="i in 5"
        :key="i"
        class="h-1.5 w-2.5 rounded-full"
        :style="{ background: i <= level ? `var(--danger-${level})` : 'var(--line)' }"
      />
    </span>
    {{ DANGER_LABELS[level] }}
  </span>
</template>
