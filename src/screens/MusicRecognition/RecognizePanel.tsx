import { useEffect, useRef, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import Waveform from '@/components/musicRecognition/Waveform'
import AfpWasmView from '@/components/musicRecognition/AfpWasmView'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { type EngineInfo } from '@/core/musicRecognition/engines'
import { createGuard } from '@/core/musicRecognition/limiter'
import { recognizeWithEngines } from '@/core/musicRecognition/provider'
import { isNcmEngineEnabled } from '@/core/musicRecognition/configStore'
import { isWasmReady } from '@/core/musicRecognition/wasmBridge'
import { LISTEN_SECONDS, NCM_SAMPLE_RATE, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS, decimateTo8k } from '@/core/musicRecognition/pcmSplitter'
import { createNcmEngine } from '@/core/musicRecognition/ncmEngine'
import { type Guard, type RecognizeOutcome, type RecognizedSong, type RecognizeReason } from '@/core/musicRecognition/types'
import { cancelRecord, isAudioRecordSupported, recordPcm, requestRecordPermission } from '@/utils/nativeModules/audioRecord'
import { getData, saveData } from '@/plugins/storage'
import { createStyle } from '@/utils/tools'
import ResultCard from './ResultCard'

type Phase = 'idle' | 'listening' | 'matching' | 'result' | 'error' | 'not_ready'

const MAX_PER_DAY = 30
const GUARD_STORAGE_KEY = 'musicRecognition.guard'

const guardStorage = {
  get: async() => {
    const value = await getData<string>(GUARD_STORAGE_KEY)
    return typeof value == 'string' ? value : null
  },
  set: async(value: string) => {
    await saveData(GUARD_STORAGE_KEY, value)
  },
}

const createGuardInstance = (): Guard => createGuard({ maxPerDay: MAX_PER_DAY, storage: guardStorage, now: Date.now })

export default ({ engine }: { engine: EngineInfo }) => {
  const t = useI18n()
  const theme = useTheme()
  const [phase, setPhase] = useState<Phase>(() => (engine.implemented && isAudioRecordSupported() ? 'idle' : 'not_ready'))
  const [remain, setRemain] = useState(LISTEN_SECONDS)
  const [song, setSong] = useState<RecognizedSong | null>(null)
  // 'denied' 是面板自己的状态（麦克风没给权限），不属于 provider 的 RecognizeReason；
  // 两者各用各的文案：权限缺失要教用户去设置里开，运营关停只该说「暂时不可用」。
  const [reason, setReason] = useState<RecognizeReason | 'denied' | null>(null)
  const tickRef = useRef<NodeJS.Timeout | null>(null)
  const cancelledRef = useRef(false)
  const isUnmountedRef = useRef(false)

  const clearTick = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
      clearTick()
      // 卸载时无论处于哪个阶段都通知原生停止：没有采集在跑时 cancel() 只是改一个布尔量
      cancelRecord()
    }
  }, [])

  const reset = () => {
    cancelledRef.current = true
    clearTick()
    cancelRecord()
    setSong(null)
    setReason(null)
    setRemain(LISTEN_SECONDS)
    setPhase('idle')
  }

  const errorText = (why: RecognizeReason | 'denied' | null): string => {
    switch (why) {
      case 'daily':
        return t('music_recognition_limited')
      case 'denied':
        return t('music_recognition_denied')
      case 'unsupported':
        return t('music_recognition_not_ready')
      case 'no_match':
        return t('music_recognition_no_match')
      default:
        return t('music_recognition_failed')
    }
  }

  const run = async() => {
    // 桥没就绪时连录音都别开始。顺序很关键：provider 是先 `guard.onAttempt()` 扣掉每日额度、
    // 再让引擎去 `fingerprintFromWasm` 抛「not ready」的。在那种 WebView 起不来的设备上
    // （被厂商禁用、系统 WebView 过旧、资产缺失），用户每次都要白等 8 秒录音、白扣 1/30 额度，
    // 最后只看到一句「识曲服务暂时没响应」。这里提前拒，把「这台设备用不了」说清楚，一克额度都不花。
    // 唯一误伤是「刚进页 1 秒内就点」——注入还没回 ready，会看到「识别还没接入」，再点一次就好；
    // 不要为此加轮询重试，那会把闸门挪到识别路径上去。
    if (!isWasmReady()) {
      setReason('unsupported')
      setPhase('error')
      return
    }
    cancelledRef.current = false
    setSong(null)
    setReason(null)
    setPhase('listening')
    setRemain(LISTEN_SECONDS)

    const granted = await requestRecordPermission()
    if (isUnmountedRef.current || cancelledRef.current) return
    if (!granted) {
      setReason('denied')
      setPhase('error')
      return
    }

    let left = LISTEN_SECONDS
    tickRef.current = setInterval(() => {
      left -= 1
      setRemain(left > 0 ? left : 0)
      if (left <= 0) clearTick()
    }, 1000)

    let pcm: Int16Array
    try {
      pcm = (await recordPcm(LISTEN_SECONDS)).pcm
    } catch {
      clearTick()
      if (!isUnmountedRef.current && !cancelledRef.current) {
        setReason('failed')
        setPhase('error')
      }
      return
    }
    clearTick()
    if (isUnmountedRef.current || cancelledRef.current) return

    setPhase('matching')
    // 一次采集多路输出：这里抽成引擎约定的 8kHz 识别窗口
    const window8k = decimateTo8k(pcm, NCM_SAMPLE_RATE, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS)
    let outcome: RecognizeOutcome
    try {
      // Ruling T5b/T7a：运营把 ncm 关掉时数组必须真的是空，让 provider 回 unsupported（页内说「暂时不可用」），
      // 既不能把关掉的引擎照样发出去，也不能伪装成「没听到歌」。
      const engines = (engine.implemented && await isNcmEngineEnabled()) ? [createNcmEngine()] : []
      outcome = await recognizeWithEngines(engines, window8k, createGuardInstance())
    } catch {
      // Ruling T5a：provider 里 check/onAttempt/onSuccess/onFailure 四处 await 都在 try 之外，
      // 闸门自己一抛就会冒到这里。不兜住的话 phase 永远停在「匹配中」，比报错更糟。
      if (isUnmountedRef.current || cancelledRef.current) return
      setReason('failed')
      setPhase('error')
      return
    }
    if (isUnmountedRef.current || cancelledRef.current) return

    if (outcome.ok) {
      setSong(outcome.song)
      setPhase('result')
    } else {
      setReason(outcome.reason)
      setPhase('error')
    }
  }

  const busy = phase == 'listening' || phase == 'matching'
  const statusText = phase == 'listening'
    ? `${t('music_recognition_listening')} ${remain}s`
    : phase == 'matching'
      ? t('music_recognition_matching')
      : phase == 'not_ready'
        ? t('music_recognition_not_ready')
        : phase == 'error'
          ? errorText(reason)
          : t('music_recognition_idle')

  return (
    <View style={styles.container}>
      <Text size={13} color={theme['c-font-label']} style={styles.desc}>{t(engine.descKey)}</Text>
      <TouchableOpacity
        style={[styles.disc, {
          borderColor: busy ? theme['c-primary'] : theme['c-300'],
          backgroundColor: busy ? theme['c-primary-background'] : theme['c-button-background'],
        }]}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={t('music_recognition')}
        onPress={() => {
          if (busy) {
            reset()
          } else {
            void run()
          }
        }}
      >
        <Waveform
          active={busy}
          bars={11}
          height={busy ? 44 : 30}
          color={busy ? theme['c-primary'] : theme['c-300']}
        />
      </TouchableOpacity>
      <Text size={16} style={styles.status}>{statusText}</Text>
      {
        phase == 'not_ready'
          ? <Text size={12} color={theme['c-font-label']} style={styles.hint}>{t('music_recognition_not_ready_desc')}</Text>
          : null
      }
      {
        busy
          ? (
              <TouchableOpacity style={styles.stopBtn} activeOpacity={0.8} accessibilityRole="button" onPress={reset}>
                <Text size={13} color={theme['c-primary-font']}>{t('music_recognition_stop')}</Text>
              </TouchableOpacity>
            )
          : null
      }
      {
        phase == 'result' && song
          ? <ResultCard song={song} onAgain={() => { void run() }} />
          : null
      }
      <View style={styles.footer}>
        <Text size={12} color={theme['c-font-label']} style={styles.footerText}>{t(engine.tipKey)}</Text>
        <Text size={12} color={theme['c-font-label']} style={styles.footerText}>{t('music_recognition_privacy')}</Text>
      </View>
      {engine.implemented ? <AfpWasmView /> : null}
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 20,
    paddingRight: 20,
  },
  desc: {
    marginBottom: 22,
    textAlign: 'center',
  },
  disc: {
    width: 168,
    height: 168,
    borderRadius: 84,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    marginTop: 24,
    textAlign: 'center',
    lineHeight: 22,
  },
  hint: {
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 18,
  },
  stopBtn: {
    marginTop: 18,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 6,
    paddingBottom: 6,
  },
  footer: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 18,
  },
  footerText: {
    textAlign: 'center',
    lineHeight: 18,
  },
})
