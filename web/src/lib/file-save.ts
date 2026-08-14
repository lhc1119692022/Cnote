export function safeFileName(value: string, fallback = 'cnote-file') {
  const normalized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '')
  return normalized || fallback
}

export function extensionForMimeType(mimeType?: string) {
  const extensions: Record<string, string> = {
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
    'text/markdown': 'md',
    'text/plain': 'txt',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  }
  return mimeType ? extensions[mimeType.toLowerCase()] : undefined
}

export async function saveBlobToFile(
  blob: Blob,
  suggestedName: string,
  options?: { description?: string; extension?: string },
) {
  const fileName = safeFileName(suggestedName)
  const picker = (window as Window & {
    showSaveFilePicker?: (options: {
      suggestedName: string
      types?: Array<{ description: string; accept: Record<string, string[]> }>
    }) => Promise<{ createWritable: () => Promise<{ write: (value: Blob) => Promise<void>; close: () => Promise<void> }> }>
  }).showSaveFilePicker

  if (picker) {
    const extension = options?.extension || `.${fileName.split('.').pop() || 'bin'}`
    const handle = await picker({
      suggestedName: fileName,
      types: [{
        description: options?.description || 'Cnote 文件',
        accept: { [blob.type || 'application/octet-stream']: [extension.startsWith('.') ? extension : `.${extension}`] },
      }],
    })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return
  }

  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}