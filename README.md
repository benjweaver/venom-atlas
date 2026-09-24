# Venom Atlas

An interactive world map of venomous animals. Click a country to see what lives
there, click a state or province to narrow it down, and click an animal to see
its photo, what its venom does, and its full range on the map.

**Vue 3 · TypeScript · MapLibre GL · Tailwind · Vite.** It's a static site with
no server, database or API keys, and it deploys anywhere that serves files.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # everything CI runs: validate, lint, typecheck, test, build
```

## What's in scope

**Medically significant venomous animals:** species whose bite or sting can
seriously harm a person. That means the snakes, scorpions and spiders behind
real envenomations, plus the insects, jellyfish, fish and molluscs that send
people to hospital. It doesn't try to list every venomous species (almost
all spiders are technically venomous), and it leaves out poisonous animals
like poison dart frogs, which don't inject anything.

## Adding or editing a species

All content lives in `data/species/`, one YAML file per species. That's the
only place to edit.

```bash
npm run new -- "Latrodectus geometricus"    # 1. creates data/species/latrodectus-geometricus.yaml
#                                              2. fill in the text fields and a rough list of regions
npm run images -- latrodectus-geometricus   # 3. photo + credits from Wikimedia Commons
npm run ranges -- latrodectus-geometricus   # 4. GBIF's view of the range, as a diff: review it
npm run ranges -- latrodectus-geometricus --write   # 5. accept it
npm run validate
```

A species file:

```yaml
name: Western diamondback rattlesnake
scientificName: Crotalus atrox
group:
  snake # snake · lizard · spider · scorpion · centipede · insect
  # jellyfish · mollusc · fish · mammal · other
danger:
  4 # 1 painful · 2 medically significant · 3 serious
  # 4 potentially fatal · 5 extremely dangerous
summary: >-
  One or two sentences for the card.
venom: >-
  What the venom does to a person.
habitat: >-
  Where it lives.
size: Typically 1–1.5 m # optional
wikipedia: Article title # optional; defaults to scientificName
photo: Some file.jpg # optional: a specific Commons file, or "none"
regions: # ISO 3166 codes, normally written by `npm run ranges`
  - US-AZ #   a state/province...
  - MX #   ...or a whole country
gbif: # optional: steer `npm run ranges`
  exclude: [CA] #   GBIF records here aren't real range (captive, misidentified)
  include: [US-NM] #   real range that GBIF under-records
  name: Other name #   the name GBIF files it under, if different
  manual: true #   GBIF is no use for this species; keep regions by hand
```

**Regions.** Countries are listed whole, except the big ones, which are listed
by state/province: US, Canada, Mexico, Brazil, Argentina, Australia, India,
China, South Africa and Japan. Don't list a country and its states together,
because it's ambiguous and the validator rejects it. A country-level species still
shows up when someone clicks a state, labelled "recorded country-wide".

To find a code, open `public/geo/admin1/<COUNTRY>.json`, or click the region
in the running app and read it from the URL (`?r=US-AZ`).

**What the validator catches**, in dev (as an error overlay), in the build, and
in CI: unknown fields, typos in `group`, danger outside 1–5, unknown region codes
(including in `gbif:`), duplicate regions, and a country listed alongside its
own states. In CI it also catches a species with no credited photo, or one whose
range was never checked against GBIF.

## Ranges from GBIF

[GBIF](https://www.gbif.org) collects billions of open records of "this
animal was seen or collected here" from museums, surveys and apps like
iNaturalist. `npm run ranges` asks it where each species has been recorded,
turns the counts into a proposed list of regions, and shows how that differs
from the file. Nothing changes until you add `--write`.

```
~ crotalus-atrox: 25537 records
    + US-AR(36) US-KS(27)
    - MX-SIN(12)
```

The numbers are record counts. That's the evidence you're reviewing.

**The rules** (`scripts/gbif-range.ts`):

- Only wild-type records count: no zoo animals or fossils, nothing flagged
  with a location problem, and only records from 1950 on, so long-extinct
  local populations don't show.
- A place needs a minimum number of records. That minimum is 2 for species GBIF
  has little data on, scaling up to 5 for well-recorded ones, and the place also
  needs at least 0.02% of the species' records. That drops the stray zoo escapee
  or mislabelled specimen without dropping thinly-recorded countries.
- State-level data comes from GBIF's GADM tags, matched to this map's
  outlines by where the records' coordinates fall. The matches are cached in
  `data/gadm-iso.json`.

**What it can't do.** Records follow people. Western Europe, the US and
Australia are densely recorded, while much of Africa and South Asia is thin.
So a proposal can _drop_ a place where the animal certainly lives because
nobody has uploaded a record from there. That's what `gbif.include` is for.
The opposite also happens (a pet-trade escape with enough records), and
`gbif.exclude` handles it. Use them rather than editing `regions` by
hand, or the next `--write` will undo your fix.

```bash
npm run ranges                  # species not yet checked
npm run ranges -- --all         # re-derive every proposal from the cached counts
npm run ranges -- --all --refresh --write   # re-fetch everything from GBIF and accept
```

Counts are cached in `data/gbif.json` (committed), so proposals can be
reviewed and re-derived without the network. The site links each species to
its GBIF page.

## Photos

`npm run images` takes the lead image of each species' Wikipedia article and
looks it up on Wikimedia Commons for the author and licence. Only freely
licensed Commons files are accepted, and every photo is shown with its credit,
as those licences require. Results go to `data/images.json` (committed), so
builds never touch the network.

- `npm run images` fetches photos only for species that don't have one yet
- `npm run images -- <slug>` re-fetches one species
- `npm run images -- --all` re-fetches everything

If an article's lead image is a poor photo or not free, point `wikipedia:`
at another article, or replace that entry in `data/images.json` with any
Commons file (keep the credit fields).

Images are served from Wikimedia's CDN. To self-host them instead, download
them into `public/` and change `src`.

## Deploying

`npm run build` produces `dist/`, a folder of static files.

**GitHub Pages (set up already).** `.github/workflows/ci.yml` checks every
push and PR, and deploys `main` once deployment is switched on. It's off by
default, because Pages on a private repo needs a paid plan. To switch it on, go
to repo **Settings → Pages → Source: GitHub Actions**, then run
`gh variable set DEPLOY_PAGES --body true`. The workflow sets `BASE_PATH=/<repo>/` because project sites
are served from a sub-path. With a custom domain, set it to `/`.

**Cloudflare Pages / Netlify / Vercel.** Connect the repo, set build command
`npm run build` and output directory `dist`. No `BASE_PATH` is needed.

There are no client-side routes, because view state lives in the query string
(`?r=US-AZ&s=crotalus-atrox`). No host needs rewrite rules, and every view is a
shareable link.

## How it fits together

```
data/species/*.yaml ──┐
data/images.json ─────┼─► scripts/species-loader.ts ─► validate ─► virtual:species ─► App.vue
public/geo/*.json ────┘       (zod schema + region-code checks)          (Vite plugin)
      ▲
      └── npm run boundaries  (Natural Earth → simplified GeoJSON, committed)
```

| Path                             | What it is                                                                |
| -------------------------------- | ------------------------------------------------------------------------- |
| `src/data/schema.ts`             | The species schema: one definition for validation and for the app's types |
| `src/lib/regions.ts`             | Which species are in which place (pure, unit-tested)                      |
| `src/lib/geo.ts`                 | Loads boundaries on demand; works out where to point the camera           |
| `src/components/AtlasMap.vue`    | MapLibre map. Draws GeoJSON on a plain background, with no tile server    |
| `scripts/vite-plugin-species.ts` | Validates the data as part of the build; reloads dev on YAML edits        |
| `scripts/build-boundaries.ts`    | Regenerates `public/geo/` from Natural Earth                              |
| `public/geo/countries.json`      | Every country (≈380 kB), loaded up front                                  |
| `public/geo/admin1/<CC>.json`    | One country's states/provinces, loaded when it's opened                   |

**Boundaries** come from [Natural Earth](https://www.naturalearthdata.com/)
(public domain): 1:50m countries and 1:10m states/provinces, simplified.
`npm run boundaries` rebuilds them (it downloads about 45 MB once, into
`.cache/`). France's overseas departments are split out into their own regions
so that "FR" means metropolitan France.

## Known limits

- Ranges are simplified to whole countries or states, and they're only as good
  as GBIF's records plus human review (see above).
- Marine species are assigned to the coastal countries/states where they're
  encountered.
- Only venomous animals (ones that inject toxins) are included, not poisonous
  ones like poison dart frogs.
- Not medical advice. The footer says so, and it should stay there.
