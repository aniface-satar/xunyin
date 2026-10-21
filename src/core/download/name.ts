export const MAX_BASE_NAME_LENGTH = 100

const ILLEGAL_RXP = /[/\\:*?"<>|]/g
const TRAILING_RXP = /[.\s]+$/

export const sanitizeFileNamePart = (value: string): string => {
  return value
    .replace(ILLEGAL_RXP, ' ')
    .replace(TRAILING_RXP, '')
    .trim()
    .replace(/\s{2,}/g, ' ')
}

export const buildDownloadBaseName = (
  template: LX.AppSetting['download.fileName'],
  musicInfo: { name: string, singer: string },
): string => {
  const name = sanitizeFileNamePart(musicInfo.name ?? '')
  const singer = sanitizeFileNamePart(musicInfo.singer ?? '')

  let base: string
  switch (template) {
    case '歌手 - 歌名':
      base = singer && name ? `${singer} - ${name}` : singer || name
      break
    case '歌名':
      base = name
      break
    case '歌名 - 歌手':
    default:
      base = name && singer ? `${name} - ${singer}` : name || singer
      break
  }
  if (!base) base = 'unknown'
  return base.slice(0, MAX_BASE_NAME_LENGTH)
}
