import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function assetManifestPlugin(): Plugin {
  return {
    name: 'mousekeeper-asset-manifest',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .map((fileName) => `/${fileName}`)
        .toSorted()
      this.emitFile({
        type: 'asset',
        fileName: 'asset-manifest.json',
        source: JSON.stringify({ version: 1, assets }, null, 2)
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), assetManifestPlugin()]
})
