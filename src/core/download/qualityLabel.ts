import type { Message } from '@/lang'

export const getQualityLabel = (quality: LX.Quality, t: (key: keyof Message) => string) => {
  switch (quality) {
    case 'flac24bit':
      return t('quality_lossless_24bit')
    case 'flac':
      return t('quality_lossless')
    case '320k':
      return t('quality_high_quality')
    default:
      return quality
  }
}
