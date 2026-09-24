# Project rules

## Warnings are errors

This project builds with warnings escalated to errors. A clean build emits
nothing, and it stays that way.

Configured in: `eslint --max-warnings 0` in `package.json`; `vite build`'s chunk
size warning is kept meaningful by `build.chunkSizeWarningLimit` in
`vite.config.ts` (set just above MapLibre, the one chunk that can't be split).

Check everything CI checks:

```bash
npm run check
```

**Fix the cause, don't silence it.** Suppressing a warning — a blanket ignore, a
downgraded diagnostic group, a disabled rule — is a last resort. If it is
genuinely unavoidable, scope it as narrowly as possible, say why in a comment,
and say how to undo it.

## Data

- One species per file in `data/species/`, named after the scientific name.
  The schema is `src/data/schema.ts`; the loader (`scripts/species-loader.ts`)
  is the only thing that reads the YAML, and both the build and
  `npm run validate` go through it.
- `data/images.json`, `data/gbif.json`, `data/gadm-iso.json` and `public/geo/`
  are generated (`npm run images`, `npm run ranges`, `npm run boundaries`) and
  committed. Don't hand-edit them; fix the script.
- `regions` is normally written by `npm run ranges --write`. To correct it,
  use `gbif.exclude` / `gbif.include` in the species file rather than editing
  `regions` directly, or the next `--write` undoes the fix.
- Aquatic species (`aquatic: marine | freshwater`) take their places from
  their GBIF record dots, each tagged with the territory GBIF attributes it to:
  a territory is listed exactly when it has a dot, and the site only draws
  dots for listed territories. No `gbif.include` on them; errors go in
  `gbif.exclude`, which removes the territory and its dots.
- Scope is medically significant venomous animals: things whose bite or
  sting can seriously harm a person. Not poisonous animals.
- Region codes are ISO 3166 as they appear in `public/geo/`. A species lists a
  country or that country's states, never both.
- Accuracy matters more than coverage: leave a region out rather than guess.
