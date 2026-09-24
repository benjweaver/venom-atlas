// npm run validate — checks every species file without building the site.
// Stricter than the build: a species without a credited photo fails here, so
// CI catches a forgotten `npm run images` while local dev keeps working.
import { DataError, loadSpecies } from './species-loader.ts'

try {
  const species = loadSpecies()
  const missing = species.filter((s) => !s.image).map((s) => s.slug)
  if (missing.length) {
    throw new DataError(missing.map((slug) => `${slug}: no photo — run: npm run images`))
  }
  console.log(`✓ ${species.length} species valid`)
} catch (e) {
  console.error(e instanceof DataError ? e.message : e)
  process.exit(1)
}
