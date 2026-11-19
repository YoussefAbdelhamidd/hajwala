/** Critical first-paint assets — fetched once so the intro scene has no pop-in. */

export const CAR_URL = '/2014_nissan_ddsen.glb?v=logo-white1'
export const TOWER_URL = '/saudi__tower.glb'
export const MASCOT_ROOT = '/57dc3d0f-669e-4be7-a9ec-70d5a4e98508'
export const RESTAURANT_ROOT = '/restaurant'

const ASSET_URLS = [
  CAR_URL,
  TOWER_URL,
  `${MASCOT_ROOT}/base.obj`,
  `${MASCOT_ROOT}/texture_diffuse.png`,
  `${RESTAURANT_ROOT}/base.obj`,
  `${RESTAURANT_ROOT}/texture_diffuse.jpg`,
]

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
): Promise<void> {
  const total = ASSET_URLS.length + 1
  let finished = 0

  const tick = (label: BootLabelKey) => {
    finished += 1
    onProgress({ ratio: Math.min(0.92, finished / total), label })
  }

  onProgress({ ratio: 0.04, label: 'boot.tray' })

  await Promise.all(
    ASSET_URLS.map(url =>
      fetchAsset(url)
        .catch(() => fetch(url).then(r => r.arrayBuffer()))
        .then(() => {
          if (url.includes('nissan')) tick('boot.car')
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
