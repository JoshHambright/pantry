/**
 * Barcode scanning from the phone camera.
 *
 * Chrome on Android has a native BarcodeDetector that is fast and costs no
 * bundle weight. Safari does not, so ZXing is loaded lazily as a fallback —
 * only on the devices that actually need it.
 */

export type BarcodeStopper = () => void

interface DetectedBarcode {
  rawValue: string
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf']

function nativeDetector(): BarcodeDetectorConstructor | null {
  const candidate = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector
  return candidate ?? null
}

export function isNativeScanningAvailable(): boolean {
  return nativeDetector() !== null
}

/** A UPC-E code expands to UPC-A, which is what product databases are keyed by. */
export function normaliseBarcode(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  // A 13-digit EAN for a US product is a UPC-A with a leading zero.
  if (digits.length === 13 && digits.startsWith('0')) return digits.slice(1)
  return digits
}

export interface ScanHandlers {
  onResult: (code: string) => void
  onError: (message: string) => void
}

/**
 * Start scanning into `video`. Returns a stopper that releases the camera —
 * always call it, or the phone keeps the torch-adjacent camera LED on.
 */
export async function startBarcodeScanner(
  video: HTMLVideoElement,
  handlers: ScanHandlers,
): Promise<BarcodeStopper> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    })
  } catch {
    handlers.onError('No camera access. Check the site permissions and that this page is on HTTPS.')
    return () => {}
  }

  video.srcObject = stream
  video.setAttribute('playsinline', 'true')
  await video.play().catch(() => {})

  const stopTracks = () => {
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
  }

  const Native = nativeDetector()
  if (Native) {
    const detector = new Native({ formats: FORMATS })
    let running = true
    let frame = 0

    const tick = async () => {
      if (!running) return
      // Every third frame is plenty and leaves the phone some battery.
      frame += 1
      if (frame % 3 === 0 && video.readyState >= 2) {
        try {
          const found = await detector.detect(video)
          const first = found[0]
          if (first?.rawValue) {
            running = false
            stopTracks()
            handlers.onResult(normaliseBarcode(first.rawValue))
            return
          }
        } catch {
          // A single failed frame is not worth reporting; keep looking.
        }
      }
      requestAnimationFrame(() => void tick())
    }
    void tick()

    return () => {
      running = false
      stopTracks()
    }
  }

  // Fallback: ZXing, imported only when the platform gives us no choice.
  try {
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    const reader = new BrowserMultiFormatReader()
    const controls = await reader.decodeFromVideoElement(video, (result) => {
      if (result) {
        controls.stop()
        stopTracks()
        handlers.onResult(normaliseBarcode(result.getText()))
      }
    })
    return () => {
      controls.stop()
      stopTracks()
    }
  } catch {
    stopTracks()
    handlers.onError('Barcode scanning is not supported in this browser')
    return () => {}
  }
}
