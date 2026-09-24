// The shape of one species file in data/species/*.yaml.
//
// This is the only definition. The build validates every file against it
// (scripts/species-loader.ts), and the app takes its types from it, so a field
// can't be added to the data without the UI's types knowing about it.
import { z } from 'zod'

import { GROUPS } from './taxonomy.ts'

// "US" is a whole country; "US-AZ" is a state/province. Whether a code
// actually exists on the map is checked by the loader, which knows the
// boundary files — the schema only checks the format.
export const regionCode = z
  .string()
  .regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/, 'expected an ISO code like "AU" or "US-AZ"')

export const speciesSchema = z
  .object({
    name: z.string().min(1),
    scientificName: z.string().min(1),
    group: z.enum(GROUPS),
    danger: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    summary: z.string().min(1).max(400),
    venom: z.string().min(1),
    habitat: z.string().min(1),
    size: z.string().optional(),
    // Wikipedia article title used to find a photo. Defaults to scientificName.
    wikipedia: z.string().optional(),
    // A specific Wikimedia Commons file to use instead ("Crotalus atrox 1.jpg"),
    // or "none" when no freely licensed photo exists.
    photo: z.string().optional(),
    regions: z.array(regionCode).min(1),
    // Lives in the water. Its places are then exactly the territories whose
    // waters it has been recorded in (see scripts/gbif-range.ts).
    aquatic: z.enum(['marine', 'freshwater']).optional(),
    // How `npm run ranges` treats this species. See scripts/gbif-range.ts.
    gbif: z
      .object({
        // Name to look up on GBIF, when scientificName doesn't match there.
        name: z.string().optional(),
        // Places GBIF has records for that aren't real range: captive animals,
        // misidentifications. A country code excludes all of its states.
        exclude: z.array(regionCode).optional(),
        // Places to keep even though GBIF has too few records there.
        include: z.array(regionCode).optional(),
        // Don't propose ranges for this species at all; `regions` is maintained by hand.
        manual: z.literal(true).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type SpeciesFile = z.infer<typeof speciesSchema>

// Written by `npm run images` into data/images.json. Every photo must carry its
// author and licence — Wikimedia's free licences require attribution.
export const imageSchema = z
  .object({
    src: z.url(),
    page: z.url(),
    artist: z.string(),
    license: z.string(),
    licenseUrl: z.url().optional(),
  })
  .strict()

export type SpeciesImage = z.infer<typeof imageSchema>

export interface Species extends SpeciesFile {
  slug: string
  image?: SpeciesImage
  /** GBIF taxon the range came from, for the "range data" link. */
  gbifKey?: number
  /** Has a record grid (dots on the map) at public/occurrence/<slug>.json. */
  records?: boolean
}
