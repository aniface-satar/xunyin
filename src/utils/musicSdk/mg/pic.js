import { getMusicInfo } from './musicInfo'

export default {
  async getPic(songInfo) {
    const info = await getMusicInfo(songInfo.copyrightId ?? songInfo.songmid)
    return info.img
  },
}
