// Exposes the validated species list to the app as `virtual:species`.
//
// Validation happens inside the build, so bad data fails `vite build` (and
// shows Vite's error overlay in dev) instead of shipping. Editing a YAML file
// reloads the page.
import type { Plugin } from 'vite'

import {
  GBIF_FILE,
  GRID_DIR,
  IMAGES_FILE,
  loadSpecies,
  SPECIES_DIR,
  speciesFiles,
} from './species-loader.ts'

// Everything the species module is built from. A change to any of them rebuilds it.
const INPUTS = [SPECIES_DIR, IMAGES_FILE, GBIF_FILE, GRID_DIR]

const ID = 'virtual:species'
const RESOLVED = '\0' + ID

export function speciesPlugin(): Plugin {
  return {
    name: 'venom-atlas:species',
    resolveId(id) {
      return id === ID ? RESOLVED : undefined
    },
    load(id) {
      if (id !== RESOLVED) return
      // Files, not the directory: Vite resolves watched paths as imports in dev.
      // Added and deleted files are caught by the server watcher below.
      for (const file of speciesFiles()) this.addWatchFile(file)
      this.addWatchFile(IMAGES_FILE)
      this.addWatchFile(GBIF_FILE)
      return `export default ${JSON.stringify(loadSpecies())}`
    },
    configureServer(server) {
      server.watcher.add(INPUTS)
      const reload = (file: string) => {
        if (!INPUTS.some((input) => file.startsWith(input))) return
        const mod = server.moduleGraph.getModuleById(RESOLVED)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('change', reload)
      server.watcher.on('add', reload)
      server.watcher.on('unlink', reload)
    },
  }
}
