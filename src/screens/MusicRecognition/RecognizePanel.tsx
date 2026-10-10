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
  // 两者各用各的文案：权限缺失要教用户去设置里开，服务侧的失败只说「暂时没响应」。
  const [reason, setReason] = useState<RecognizeReason | 'denied' | null>(null)
  const tickRef = useRef<NodeJS.Timeout | null>(null)
  // 作废在途识别用的是「只增不减的批次号」，不是一个布尔开关：布尔量会被下一轮开头清零，
  // 上一轮迟到的结果就能在新一轮录音进行中把 phase 与 song 抢过去。
  const runSeqRef = useRef(0)
  const isUnmountedRef = useRef(false)

  const clearTick = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }

  useEffect(() => {
    isUnmountedRef.current = false
    // 运营配置在挂载时预热一次。`run()` 里的 `isNcmEngineEnabled()` 排在 8 秒录音**之后**，
    // 冷缓存时它要串行走最多 5 个镜像、每个 4s 超时（≈20s），那段时间全落在「正在匹配」里，
    // 看起来像识别卡住。只在本面板挂载时热，从不进识曲页的设备一笔配置请求都不会发。
    // 不接返回值也不兜错：findNcmEngine 内部已经把失败兜成 DEFAULT_CONFIG。
    void isNcmEngineEnabled()
    return () => {
      isUnmountedRef.current = true
      clearTick()
      // 卸载时无论处于哪个阶段都通知原生停止：没有采集在跑时 cancel() 只是改一个布尔量
      cancelRecord()
    }
  }, [])

  const reset = () => {
    // 作废当前这一轮：它回来时发现自己的批次号落后了，就不会再动任何状态
    runSeqRef.current += 1
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
        // 到这里只剩两种来源：运营把引擎全关、这台设备的桥起不来。两者都是「现在不通、
        // 过会儿再试」；「识别还没接入」描述的是功能不存在，说给已经接入的引擎听是假话。
        return t('music_recognition_failed')
      case 'no_match':
        return t('music_recognition_no_match')
      default:
        return t('music_recognition_failed')
    }
  }

  const run = async() => {
    // 未接入的引擎标签留在它自己的 not_ready 画面上：那里除了同一句文案，还带着
    // music_recognition_not_ready_desc 的解释行。点一下圆盘不该把「有说明的状态」变成「没说明的错误」。
    if (!engine.implemented) return
    // 没有原生采集通路的设备上 requestRecordPermission() 回 false 的原因和「用户拒绝」是同一个，
    // 不先分辨就会说出一句永远照不做的「去系统设置里允许」。挂载时已经知道真相，这里照实退回。
    if (!isAudioRecordSupported()) {
      setPhase('not_ready')
      return
    }
    // 桥没就绪时连录音都别开始。顺序很关键：provider 是先 `guard.onAttempt()` 扣掉每日额度、
    // 再让引擎去 `fingerprintFromWasm` 抛「not ready」的。在那种 WebView 起不来的设备上
    // （被厂商禁用、系统 WebView 过旧、资产缺失），用户每次都要白等 8 秒录音、白扣 1/30 额度，
    // 最后只看到一句「识曲服务暂时没响应」。这里提前拒，同一句话不用等 8 秒、一克额度都不花。
    // 唯一误伤是「刚进页 1 秒内就点」——注入还没回 ready，会看到「暂时没响应」，再点一次就好；
    // 不要为此加轮询重试，那会把闸门挪到识别路径上去。
    if (!isWasmReady()) {
      setReason('unsupported')
      setPhase('error')
      return
    }
    const seq = ++runSeqRef.current
    setSong(null)
    setReason(null)
    setPhase('listening')
    setRemain(LISTEN_SECONDS)

    const granted = await requestRecordPermission()
    if (isUnmountedRef.current || seq !== runSeqRef.current) return
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
      // 被作废的一轮什么都不碰，包括倒计时：tickRef 是面板级唯一的一根，迟到的一轮清掉它，
      // 正在录的那一轮秒数就会冻住。reset() 已经清过自己那根了，这里跳过不会留下野 interval。
      if (isUnmountedRef.current || seq !== runSeqRef.current) return
      clearTick()
      setReason('failed')
      setPhase('error')
      return
    }
    if (isUnmountedRef.current || seq !== runSeqRef.current) return
    clearTick()

    setPhase('matching')
    // 一次采集多路输出：这里抽成引擎约定的 8kHz 识别窗口
    const window8k = decimateTo8k(pcm, NCM_SAMPLE_RATE, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS)
    let outcome: RecognizeOutcome
    try {
      // Ruling T5b/T7a：运营把 ncm 关掉时数组必须真的是空，让 provider 回 unsupported（页内说「暂时没响应」），
      // 既不能把关掉的引擎照样发出去，也不能伪装成「没听到歌」。
      const engines = (engine.implemented && await isNcmEngineEnabled()) ? [createNcmEngine()] : []
      outcome = await recognizeWithEngines(engines, window8k, createGuardInstance())
    } catch {
      // Ruling T5a：provider 里 check/onAttempt/onSuccess/onFailure 四处 await 都在 try 之外，
      // 闸门自己一抛就会冒到这里。不兜住的话 phase 永远停在「匹配中」，比报错更糟。
      if (isUnmountedRef.current || seq !== runSeqRef.current) return
      setReason('failed')
      setPhase('error')
      return
    }
    if (isUnmountedRef.current || seq !== runSeqRef.current) return

    if (outcome.ok) {
      setSong(outcome.song)
      setPhase('result')
    } else {
      setReason(outcome.reason)
      setPhase('error')
    }
  }

  const busy = phase == 'listening' || phase == 'matching'
  // 状态文案没有 result 这一支：命中后由结果卡片说话，这里再顶一句「点击开始识别」像是识别没生效
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
        accessibilityLabel={busy ? t('music_recognition_stop') : t('music_recognition')}
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
      {phase == 'result' ? null : <Text size={16} style={styles.status}>{statusText}</Text>}
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
