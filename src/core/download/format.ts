export const MIN_HEAD_BYTES = 12

const asciiAt = (head: Uint8Array, offset: number, text: string) => {
  for (let index = 0; index < text.length; index++) {
    if (head[offset + index] !== text.charCodeAt(index)) return false
  }
  return true
}

export const sniffAudioFormat = (head: Uint8Array): LX.Download.FileExt | null => {
  if (head.length < MIN_HEAD_BYTES) return null

  if (asciiAt(head, 0, 'ID3')) return 'mp3'
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return 'mp3'
  if (asciiAt(head, 0, 'fLaC')) return 'flac'
  if (asciiAt(head, 0, 'OggS')) return 'ogg'
  if (asciiAt(head, 0, 'MAC ')) return 'ape'
  if (asciiAt(head, 4, 'ftyp')) return 'm4a'
  if (asciiAt(head, 0, 'RIFF') && asciiAt(head, 8, 'WAVE')) return 'wav'
  return null
}
