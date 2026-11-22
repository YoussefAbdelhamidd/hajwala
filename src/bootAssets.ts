/** Critical first-paint assets — fetched once so the intro scene has no pop-in. */

/** Works with Vite `base: './'` when the game is hosted in a subfolder (CrazyGames). */
export function publicUrl(path: string) {
  const base = import.meta.env.BASE_URL || './'
  return `${base}${path.replace(/^\//, '')}`
}

/** Default tray runner — garage may swap this at boot. */
export const CAR_URL = publicUrl('tray_runner.glb?v=debrand3')
export const TOWER_URL = publicUrl('saudi__tower.glb')
export const MASCOT_ROOT = publicUrl('57dc3d0f-669e-4be7-a9ec-70d5a4e98508')
export const RESTAURANT_ROOT = publicUrl('restaurant')

/** Boot only pulls the selected car + scenery — garage/traffic load after Start. */
function coreAssetUrls(carUrl: string) {
  return [
    carUrl,
    TOWER_URL,
    `${MASCOT_ROOT}/base.obj`,
    `${MASCOT_ROOT}/texture_diffuse.jpg`,
    `${RESTAURANT_ROOT}/base.obj`,
    `${RESTAURANT_ROOT}/texture_diffuse.jpg`,
  ]
}

export type BootLabelKey =
  | 'boot.tray'
  | 'boot.car'
  | 'boot.towers'
  | 'boot.chicken'
  | 'boot.kitchen'
  | 'boot.table'
  | 'boot.road'
  | 'boot.almost'

export type BootProgress = {
  /** 0–1 overall boot progress */
  ratio: number
  label: BootLabelKey
}

function fetchAsset(url: string) {
  return fetch(url, { cache: 'force-cache' }).then(res => {
    if (!res.ok) throw new Error(`Failed to load ${url}`)
    return res.arrayBuffer()
  })
}

/**
 * Prefetch binary assets + the GameScene module.
 * Progress: ~85% assets, last ~15% reserved for the scene module / onReady.
 */
export async function preloadBootAssets(
  onProgress: (progress: BootProgress) => void,
  carUrl: string = CAR_URL,
): Promise<void> {
  const assetUrls = coreAssetUrls(carUrl)
  const total = assetUrls.length + 1
  let finished = 0

  const tick = (label: BootLabelKey) => {
    finished += 1
    onProgress({ ratio: Math.min(0.92, finished / total), label })
  }

  onProgress({ ratio: 0.04, label: 'boot.tray' })

  await Promise.all(
    assetUrls.map(url =>
      fetchAsset(url)
        .catch(() => fetch(url).then(r => r.arrayBuffer()))
        .then(() => {
          if (
            url.includes('tray_runner') || url.includes('/cars/') || url === carUrl
          ) tick('boot.car')
          else if (url.includes('tower')) tick('boot.towers')
          else if (url.includes('57dc3d0f')) tick('boot.chicken')
          else if (url.includes('restaurant')) tick('boot.kitchen')
          else tick('boot.table')
        }),
    ),
  )

  onProgress({ ratio: 0.88, label: 'boot.road' })
  await import('./GameScene')
  onProgress({ ratio: 0.94, label: 'boot.almost' })
}
