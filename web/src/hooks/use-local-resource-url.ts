import { useEffect, useState } from 'react'
import { loadLocalResourceUrl, revokeManagedObjectUrl } from '@/lib/resource-storage'

export function useLocalResourceUrl(resourceId?: string, currentUrl?: string) {
  const [resolvedUrl, setResolvedUrl] = useState(currentUrl || '')

  useEffect(() => {
    setResolvedUrl(currentUrl || '')
    if (!resourceId || currentUrl) return

    let active = true
    let loadedUrl: string | null = null
    void loadLocalResourceUrl(resourceId).then((url) => {
      loadedUrl = url
      if (active) setResolvedUrl(url || '')
      else revokeManagedObjectUrl(url || undefined)
    })
    return () => {
      active = false
      if (loadedUrl) revokeManagedObjectUrl(loadedUrl)
    }
  }, [currentUrl, resourceId])

  return resolvedUrl
}
