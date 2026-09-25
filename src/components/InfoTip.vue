<script setup lang="ts">
// A small bubble of explanation next to whatever is in the slot.
//
// With a mouse it shows on hover, with a keyboard on focus. Touch screens
// can't hover, so there a tap toggles it, unless `tap` is false: then the tap
// belongs to the thing itself (a button that does something) and the bubble
// is only a hover/focus label.
import { nextTick, onBeforeUnmount, ref, useId } from 'vue'

const props = withDefaults(defineProps<{ text: string; tap?: boolean }>(), { tap: true })
// The bubble is teleported, so there are two roots; classes go on the trigger.
defineOptions({ inheritAttrs: false })

const id = useId()
const open = ref(false)
const trigger = ref<HTMLElement>()
const bubble = ref<HTMLElement>()
const pos = ref({ left: 0, top: 0, below: false })

// Fixed-positioned above the trigger (below if there's no room), kept 8px
// inside the viewport so it's never cut off at a phone's edge.
async function place() {
  await nextTick()
  const t = trigger.value?.getBoundingClientRect()
  const b = bubble.value?.getBoundingClientRect()
  if (!t || !b) return
  const below = t.top < b.height + 12
  const left = Math.min(Math.max(8, t.left + t.width / 2 - b.width / 2), innerWidth - b.width - 8)
  pos.value = { left, top: below ? t.bottom + 6 : t.top - b.height - 6, below }
}

function show() {
  open.value = true
  place()
  addEventListener('scroll', hide, { capture: true, passive: true, once: true })
}
function hide() {
  open.value = false
}

// Mouse hovers; touch and pen taps (handled in onClick) so a tap doesn't both
// open it on "enter" and close it on "click".
function onEnter(e: PointerEvent) {
  if (e.pointerType === 'mouse') show()
}
function onLeave(e: PointerEvent) {
  if (e.pointerType === 'mouse') hide()
}
function onClick(e: MouseEvent) {
  if (!props.tap) return hide()
  // A click from a mouse already opened it on hover; keep it open.
  if ((e as PointerEvent).pointerType === 'mouse') return
  if (open.value) hide()
  else show()
}

function onOutside(e: PointerEvent) {
  if (open.value && !trigger.value?.contains(e.target as Node)) hide()
}
// Keyboard focus shows it; a tap that happens to focus a button doesn't (the
// tap has its own handling above).
function onFocus(e: FocusEvent) {
  if ((e.target as HTMLElement).matches(':focus-visible')) show()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') hide()
}
addEventListener('pointerdown', onOutside)
addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  removeEventListener('pointerdown', onOutside)
  removeEventListener('keydown', onKey)
  removeEventListener('scroll', hide, { capture: true })
})
</script>

<template>
  <span
    v-bind="$attrs"
    ref="trigger"
    class="inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-(--accent)"
    :tabindex="tap ? 0 : undefined"
    :aria-describedby="open ? id : undefined"
    @pointerenter="onEnter"
    @pointerleave="onLeave"
    @focusin="onFocus"
    @focusout="hide"
    @click="onClick"
  >
    <slot />
  </span>
  <Teleport to="body">
    <span
      v-if="open"
      :id="id"
      ref="bubble"
      role="tooltip"
      class="pointer-events-none fixed z-50 max-w-64 rounded-md bg-(--ink) px-2.5 py-1.5 text-xs leading-snug font-normal text-(--surface) normal-case shadow-lg"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
    >
      {{ text }}
    </span>
  </Teleport>
</template>
