import type { Track as RNTrack } from 'react-native-track-player'

declare global {
  namespace LX {
    namespace Player {
      interface MusicInfo {
        id: string | null
        pic: string | null | undefined
        lrc: string | null
        tlrc: string | null
        rlrc: string | null
        lxlrc: string | null
        rawlrc: string | null
        // url: string | null
        name: string
        singer: string
        album: string
      }

      interface LyricInfo extends LX.Music.LyricInfo {
        rawlrcInfo: LX.Music.LyricInfo
      }

      type PlayMusic = LX.Music.MusicInfo | LX.Download.ListItem

      type PlayMusicInfo = Readonly<{
        /**
         * 当前播放歌曲的列表 id
         */
        musicInfo: PlayMusic
        /**
          * 当前播放歌曲的列表 id
          */
        listId: string
        /**
          * 是否属于 “稍后播放”
          */
        isTempPlay: boolean
      }>

      interface TempPlaylistMeta {
        source: LX.OnlineSource
        sourceListId: string
        name: string
        author?: string
        img?: string
      }

      interface PlayHistoryItem {
        musicInfo: PlayMusic
        listId: string | null
        isTempPlay: boolean
        playTime: number
      }

      interface PlayInfo {
        /**
         * 当前正在播放歌曲 index
         */
        playIndex: number
        /**
        * 播放器的播放列表 id
        */
        playerListId: string | null
        /**
        * 播放器播放歌曲 index
        */
        playerPlayIndex: number
      }

      interface TempPlayListItem {
        /**
         * 播放列表id
         */
        listId: string | null
        /**
         * 歌曲信息
         */
        musicInfo: PlayMusic
        /**
         * 是否添加到列表顶部
         */
        isTop?: boolean
      }

      interface SavedPlayInfo {
        time: number
        maxTime: number
        listId: string
        index: number
      }

      interface PlaylistHistoryItem {
        /**
         * 临时列表 id，例如 wy__123 / board__wy__123
         */
        listId: string
        source: LX.OnlineSource
        /**
         * 用于打开详情页的源列表 id
         */
        sourceListId: string
        name: string
        author?: string
        img?: string
        playTime: number
      }

      interface Track extends RNTrack {
        musicId: string
        // original: PlayMusic
        // quality: LX.Quality
      }

    }
  }
}
