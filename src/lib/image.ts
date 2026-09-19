export const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode that image'))
    img.src = src
  })

export const fileToDataUrl = (file: File | Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('Could not read that file'))
    fr.readAsDataURL(file)
  })

export const dataUrlToBytes = (dataUrl: string): Uint8Array => {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** HEIC and friends are not PDF-embeddable: everything becomes PNG or JPEG. */
export async function normaliseImage(file: File): Promise<{ src: string; mime: 'image/png' | 'image/jpeg'; w: number; h: number }> {
  const raw = await fileToDataUrl(file)
  const img = await loadImage(raw)
  const keep = file.type === 'image/png' || file.type === 'image/jpeg'
  if (keep && img.naturalWidth <= 4000 && img.naturalHeight <= 4000) {
    return { src: raw, mime: file.type as 'image/png' | 'image/jpeg', w: img.naturalWidth, h: img.naturalHeight }
  }
  const scale = Math.min(1, 4000 / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return { src: canvas.toDataURL('image/png'), mime: 'image/png', w: canvas.width, h: canvas.height }
}
