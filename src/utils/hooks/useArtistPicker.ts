import { useCallback, useRef } from 'react'

import type { ArtistPickerSheetType } from '@/components/ArtistPickerSheet'
import { resolveArtistForMusic } from '@/core/artistResolve'
import { buildArtistCandidates } from '@/core/musicLinks'
import { toast } from '@/utils/tools'
import { useOpenMusicDetail } from './useOpenMusicDetail'

// 单歌手保持原行为直接跳详情；多歌手弹底部选择器，由用户挑一位
export const useArtistPicker = () => {
  const sheetRef = useRef<ArtistPickerSheetType>(null)
  const openMusicDetail = useOpenMusicDetail()
  const resolvingRef = useRef(false)

  const openArtist = useCallback((music: { source: LX.Source, singer: string }) => {
    if (music.source == 'local' || resolvingRef.current) return
    const names = buildArtistCandidates(music.singer)
    if (!names.length) return

    if (names.length > 1) {
      sheetRef.current?.show({
        source: music.source,
        names,
        onPick: item => {
          openMusicDetail({ type: 'artist', info: item })
        },
      })
      return
    }

    resolvingRef.current = true
    void resolveArtistForMusic(music).then(item => {
      resolvingRef.current = false
      if (item) openMusicDetail({ type: 'artist', info: item })
      else toast(global.i18n.t('artist_not_found'))
    })
  }, [openMusicDetail])

  return { sheetRef, openArtist }
}
