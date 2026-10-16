// 一次性探针（spec §8）。Task 6 的正式 ShareCard 落地后整个 probe 目录删掉。
import { useRef, useState } from 'react'
import { Modal, StyleSheet, Text, TouchableOpacity, View, ImageBackground } from 'react-native'
import { captureRef } from 'react-native-view-shot'
// 默认导出：仓库里全部 react-native-fs 用法都是 `import RNFS from 'react-native-fs'`
import RNFS from 'react-native-fs'
import { defaultHeaders } from '@/components/common/Image'
import { usePlayMusicInfo } from '@/store/player/hook'
import { useWindowSize } from '@/utils/hooks'

const BLUR_RADIUS = 90

const toPath = (uri: string) => uri.replace(/^file:\/\//, '')

export default ({ onClose }: { onClose: () => void }) => {
  const shotRef = useRef<View>(null)
  const [state, setState] = useState('idle')
  const [report, setReport] = useState('')
  const { width, height } = useWindowSize()
  const musicInfo = usePlayMusicInfo()?.musicInfo

  const cover = musicInfo && 'progress' in musicInfo ? musicInfo.metadata.musicInfo.meta.picUrl : musicInfo?.meta.picUrl
  const uri = typeof cover == 'string' && cover.startsWith('/') ? `file://${cover}` : cover

  const shoot = async() => {
    setState('shooting')
    try {
      const out = await captureRef(shotRef, { format: 'png', quality: 1, result: 'tmpfile', fileName: 'lxprobe' })
      const path = toPath(out)
      const exists = await RNFS.exists(path)
      const size = exists ? (await RNFS.stat(path)).size : 0
      // 探针只验"拍没拍到"，尺寸与字节数就够判；不往保存目录写
      setReport(`uri=${out}\nexists=${exists} bytes=${size}`)
      setState('done')
    } catch (e) {
      setReport(`captureRef threw: ${String(e)}`)
      setState('failed')
    }
  }

  return (
    // Modal 永远 visible：关闭交给父组件把这层整个撤掉。
    // 反过来用 state 藏 Modal 的话，那枚入口按钮被全屏 Modal 挡在后面，再也点不到 → 探针只能拍一次。
    <Modal visible onRequestClose={onClose} transparent animationType="fade">
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {/* 被拍的就是这一层：它撑满 Modal，所以图里会不会带状态栏，一眼看得出来 */}
        <View ref={shotRef} collapsable={false} style={{ width, height }}>
          <ImageBackground
            blurRadius={BLUR_RADIUS}
            source={uri ? { uri, headers: defaultHeaders } : undefined}
            style={{ flex: 1 }}
          >
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <View style={{ width: width * 0.78, backgroundColor: '#FFF', borderRadius: 28, padding: 20 }}>
                <Text style={{ fontSize: 20, color: '#000' }}>寻音 - 探针</Text>
                <Text style={{ fontSize: 14, color: '#666' }}>{String(cover ?? 'no cover').slice(0, 60)}</Text>
              </View>
            </View>
          </ImageBackground>
        </View>
        <View style={styles.bar}>
          <TouchableOpacity style={styles.btn} onPress={shoot} disabled={state == 'shooting'}>
            <Text style={styles.btnText}>{state == 'shooting' ? '拍摄中' : '拍一张'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={onClose}>
            <Text style={styles.btnText}>关闭</Text>
          </TouchableOpacity>
        </View>
        {report ? <Text style={styles.report}>{report}</Text> : null}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', padding: 16, gap: 12 },
  btn: { paddingHorizontal: 18, paddingVertical: 10, backgroundColor: '#333', borderRadius: 8 },
  btnText: { color: '#FFF' },
  report: { color: '#FFF', paddingHorizontal: 16, fontSize: 11 },
})
