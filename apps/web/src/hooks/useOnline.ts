import { useEffect, useState } from 'react'

/**
 * Whether the browser thinks it can reach the network.
 *
 * `navigator.onLine` is famously optimistic — it reports true for a device
 * attached to a wifi network that has no route anywhere. That is tolerable
 * here: this drives a "you may be looking at saved data" banner, and the real
 * signal is a failed request, which the API client surfaces on its own. The
 * banner is the early warning, not the authority.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}
