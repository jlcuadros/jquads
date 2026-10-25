/**
 * Hands a text file to the user (📂 → ⭐ Favoritas → "Descargar PGN",
 * José 2026-10-25). On the iPhone: the share sheet with the file ("Save to
 * Files", Mail, other apps…); elsewhere, or if sharing files isn't possible:
 * an ordinary download.
 */
export async function shareFile(text: string, filename: string, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  // application/vnd.chess-pgn is PGN's registered media type.
  const file = new File([text], filename, { type: 'application/vnd.chess-pgn' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled' // the user closed the sheet
      // any other error: fall back to a download
    }
  }
  const url = URL.createObjectURL(file)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'downloaded'
}
