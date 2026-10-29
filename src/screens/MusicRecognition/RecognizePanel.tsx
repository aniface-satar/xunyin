import { useEffect, useRef, useState } from 'react'
import { AppState, TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import Waveform from '@/components/musicRecognition/Waveform'
import ListeningRing from '@/components/musicRecognition/ListeningRing'
import ListeningRipples from '@/components/musicRecognition/ListeningRipples'
import AfpWasmView from '@/components/musicRecognition/AfpWasmView'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { BorderWidths } from '@/theme'
import { ENGINES, type EngineId } from '@/core/musicRecognition/engines'
import { createGuard } from '@/core/musicRecognition/limiter'
import { recognizeWithEngines } from '@/core/musicRecognition/provider'
import { isEngineEnabled } from '@/core/musicRecognition/configStore'
import { isWasmReady } from '@/core/musicRecognition/wasmBridge'
import { LISTEN_SECONDS } from '@/core/musicRecognition/pcmSplitter'
import { mergeSong, shouldResumeOnExit, shouldStartAnotherRound, songKey } from '@/core/musicRecognition/session'
import { createNcmEngine } from '@/core/musicRecognition/ncmEngine'
import { createShazamEngine } from '@/core/musicRecognition/shazamEngine'
import { createResolver, type Resolver } from '@/core/musicRecognition/resolve'
import { resolveDeps } from '@/core/musicRecognition/resolveDeps'
import { recognitionHistory } from '@/core/musicRecognition/historyStore'
import { pause, play } from '@/core/player/player'
import playerState from '@/store/player/state'
import { type Guard, type RecognizeEngine, type RecognizeHit, type RecognizeReason, type RecognizedSong } from '@/core/musicRecognition/types'
import { cancelRecord, isAudioRecordSupported, recordPcm, requestRecordPermission } from '@/utils/nativeModules/audioRecord'
import { getData, saveData } from '@/plugins/storage'
import { createStyle } from '@/utils/tools'
import ResultSections from './ResultSections'

// listening 覆盖整个会话（录音 + 那 1.4 秒的匹配都算），所以没有 matching 态：
// 一分钟里来回切两次文案，只会让「还在听」这件事看起来像卡住了。
type Phase = 'idle' | 'listening' | 'ended' | 'not_ready'

const GUARD_STORAGE_KEY = 'musicRecognition.guard'

// 圆盘的设计尺寸（未换算）：样式与涟漪共用这一个数，改大小不会只改到一半。
const DISC_SIZE = 168

// 两个引擎一起跑，所以数组按 ENGINES 的顺序装所有「这台设备现在真能跑」的引擎。
// 每道前置都在录音之前，一次麦克风灯都不该白亮：
// 1. 运营关停（配置里没这条或 enabled:false）—— 远端开关现在是单独关掉某个引擎的唯一杠杆，
//    因为界面上已经没有标签可切了；
// 2. ncm 的指纹要在隐藏 WebView 里算，桥起不来时别把它放进数组。那条「WebView 起不来的设备
//    （被厂商禁用、系统 WebView 过旧、资产缺失）用户每次白录 8 秒、白等一句失败」的老坑就留在这里挡。
//    Shazam 是纯 JS 签名，不吃这座桥，所以这个前置只对 ncm 成立。
// 两个都被剔掉才回空数组 -> provider 的 unsupported。
const createActiveEngines = async(): Promise<RecognizeEngine[]> => {
  const engines: RecognizeEngine[] = []
  if (await isEngineEnabled('ncm') && isWasmReady()) engines.push(createNcmEngine())
  if (await isEngineEnabled('shazam')) engines.push(createShazamEngine())
  return engines
}

const guardStorage = {
  get: async() => {
    const value = await getData<string>(GUARD_STORAGE_KEY)
    return typeof value == 'string' ? value : null
  },
  set: async(value: string) => {
    await saveData(GUARD_STORAGE_KEY, value)
  },
}

const createGuardInstance = (): Guard => createGuard({ storage: guardStorage, now: Date.now })

export default () => {
  const t = useI18n()
  const theme = useTheme()
  const [phase, setPhase] = useState<Phase>(() => (ENGINES.some(e => e.implemented) && isAudioRecordSupported() ? 'idle' : 'not_ready'))
  // 按引擎各存一份：同一段音频两个引擎都可能听到，结果页要分两个区展示。
  const [results, setResults] = useState<Record<string, RecognizedSong[]>>({})
  // 'denied' 是面板自己的状态（麦克风没给权限），不属于 provider 的 RecognizeReason；
  // 两者各用各的文案：权限缺失要教用户去设置里开，服务侧的失败只说「暂时没响应」。
  const [reason, setReason] = useState<RecognizeReason | 'denied' | null>(null)
  // 「一分钟到点」和「用户中途停止」结束时列表可能都是空的，但只有一种该说
  // 「听了一分钟，没认出来」—— 按下停止的人知道自己听了多久。
  const [timedOut, setTimedOut] = useState(false)
  // 作废在途识别用的是「只增不减的批次号」，不是一个布尔开关：布尔量会被下一轮开头清零，
  // 上一轮迟到的结果就能在新一轮录音进行中把 phase 与 songs 抢过去。
  const runSeqRef = useRef(0)
  const isUnmountedRef = useRef(false)
  // 按下圆盘时为识曲让路而暂停掉的那一首（存对象引用，见 shouldResumeOnExit）。
  // 没为识曲停过歌就是 null —— 用户在页面上自己按停的歌不在它的职责里。
  const pausedForRef = useRef<LX.Player.PlayMusic | null>(null)
  // 只喂给涟漪当节拍：每轮采集自增一次，没有任何判定读它。
  const [pulse, setPulse] = useState(0)

  const resolverRef = useRef<Resolver | null>(null)
  if (!resolverRef.current) resolverRef.current = createResolver(resolveDeps)
  const resolver = resolverRef.current
  // 本次按下听过的每一首的 songKey。后台解析是分批落定的，订阅回调只有拿着这张表
  // 才知道「刚才是哪几首落定了」，从而把历史行里的歌条补上。新一轮开始时清空。
  const sessionKeysRef = useRef(new Set<string>())
  // 解析在后台陆续落定，页面得有机会重渲染。版本号而不是快照：歌条内容仍以
  // resolver.get(key) 现取，这样同一首重复命中时不会有多余的中间态要维护。
  const [, setResolveTick] = useState(0)
  useEffect(() => resolver.subscribe(() => {
    // 查到的歌条回填进历史行：历史页要能直接点开播，靠的就是这一步。
    // attach 自己是幂等的（同一首歌条重复补不写盘），所以这里只管挨个交过去。
    for (const key of sessionKeysRef.current) {
      const entry = resolver.get(key)
      if (entry?.status == 'ready' && entry.musicInfo) void recognitionHistory.attach(key, entry.musicInfo)
    }
    setResolveTick(current => current + 1)
  }), [resolver])

  const addHit = (hit: RecognizeHit) => {
    const key = songKey(hit.song)
    // 同一首在一按下的好几分钟里被反复听到是常态（每轮两个引擎），只在第一次记行：
    // 重复写盘既没有新信息，又把「顶到最前」变成了每秒抖一次。
    if (!sessionKeysRef.current.has(key)) {
      sessionKeysRef.current.add(key)
      // 认出来就记，不等后台解析：解析可能整场都不落定，而「听到过这首歌」已经是历史。
      void recognitionHistory.add(hit.engineId, hit.song)
    }
    resolver.request(hit.engineId, hit.song)
    setResults(current => {
      const list = current[hit.engineId] ?? []
      // mergeSong 命中重复时回原引用，外层对象也保持原引用 => 整棵树不重渲染。
      const next = mergeSong(list, hit.song)
      return next === list ? current : { ...current, [hit.engineId]: next }
    })
  }

  useEffect(() => {
    isUnmountedRef.current = false
    // 运营配置在挂载时预热一次。`run()` 里的 `createActiveEngines()` 排在录音**之前**，
    // 冷缓存时它要串行走最多 5 个镜像、每个 4s 超时（≈20s），那段时间会变成「按下圆盘没反应」，
    // 比让「正在聆听」空转二十秒更难解释。只在本面板挂载时热，从不进识曲页的设备一笔配置请求都不会发。
    // 不接返回值也不兜错：findEngine 内部已经把失败兜成 DEFAULT_CONFIG。
    void isEngineEnabled('ncm')
    void isEngineEnabled('shazam')
    return () => {
      isUnmountedRef.current = true
      // 卸载时无论处于哪个阶段都通知原生停止：没有采集在跑时 cancel() 只是改一个布尔量
      cancelRecord()
      // 为识曲让路而按下的那次暂停，离开这一页就还回去。页头返回、硬件 BACK、切 tab（详情栈 reset）
      // 都收在这个出口；判定不成立时（用户自己在页内播了别的歌）一个字都不碰播放器。
      if (shouldResumeOnExit(pausedForRef.current, {
        isPlay: playerState.isPlay,
        loaded: playerState.playMusicInfo.musicInfo,
      })) play()
    }
  }, [])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', status => {
      if (status == 'active') return
      // 退到后台时安卓会把本应用的麦克风收成静音，接着录等于白烧轮次，直接收尾。
      // 已认出的歌留着：用户回来还能看到刚才听到了什么。
      // 后台解析也继续跑完（见 stopSession 那条注释）—— 停的是听，不是看。
      runSeqRef.current += 1
      cancelRecord()
      setReason(null)
      setTimedOut(false)
      setPhase(current => current == 'listening' ? 'ended' : current)
    })
    return () => { subscription.remove() }
  }, [])

  // 作废当前会话：它回来时发现自己的批次号落后了，就不会再动任何状态。
  // 列表不清 —— 「停止」停的是听，不是看。正在排队的解析也不撤：
  // 撤了会把行永久卡在「正在找…」，而那一行已经没有任何入口能再点它。
  const stopSession = () => {
    runSeqRef.current += 1
    cancelRecord()
    setReason(null)
    setTimedOut(false)
    setPhase('ended')
  }

  const endSession = (why: RecognizeReason | 'denied' | null, byTimeout: boolean) => {
    setReason(why)
    setTimedOut(byTimeout)
    setPhase('ended')
  }

  const errorText = (why: RecognizeReason | 'denied'): string => {
    switch (why) {
      case 'denied':
        return t('music_recognition_denied')
      default:
        // unsupported 到这里只剩两种来源：运营把两个引擎都关了、这台设备的桥起不来。
        // 两者都是「现在不通、过会儿再试」；「这台手机用不了识曲」描述的是功能不存在，
        // 说给已经接入的引擎听是假话。
        return t('music_recognition_failed')
    }
  }

  const run = async() => {
    // 没有原生采集通路的设备上 requestRecordPermission() 回 false 的原因和「用户拒绝」是同一个，
    // 不先分辨就会说出一句永远照不做的「去系统设置里允许」。挂载时已经知道真相，这里照实退回。
    if (!isAudioRecordSupported()) {
      setPhase('not_ready')
      return
    }
    // 冷却先于一切网络动作判定：它只读本地存储，而下面的 createActiveEngines
    // 冷缓存时要串行走最多 5 个镜像（≈20s）。更要紧的是它挡在录音之前 —— 刚连着失败过、
    // 正被退避挡住时，不该先白录 8 秒、白亮一次麦克风灯，才等到 provider 那句失败。
    // provider 里的 check() 不动：它仍是「闸门先于引擎」的权威判定，这里只是把同一个
    // 结论提前说给用户听，两次 check() 之间没有任何写入，判定不会变。
    // 批次号在闸门**之前**就分配，而不是等闸门跑完：读退避状态与冷缓存的运营配置可能在按下
    // 之后停上十几秒，那段时间圆盘看起来还是"能点"，第二次按下必须能把第一次那次彻底作废。
    // 否则两次 run 会各自一路走到录音，后起的那次撞上原生 EBUSY，整场会话开局就失败。
    const seq = ++runSeqRef.current
    const isStale = () => isUnmountedRef.current || seq !== runSeqRef.current
    // 按下即进 listening：盘面翻主色、声纹动起来，那两下之间没有间隔。
    // 冷启动时下面两道前置真的慢（首读 AsyncStorage 要等原生存储起来，运营配置冷缓存
    // 要串行探五个镜像），而它们又不能挪到录音之后 —— 于是把「已经接住这一下」的反馈
    // 与「真的开始录了」拆开：这一句只管前者，recordPcm 仍排在下面全部前置跑完之后，
    // 麦克风灯与请求一笔都没提前。空转的代价只在「闸门判成冷却 / 引擎被关停」那一两种
    // 收尾里，那段时间的文案本来就是「正在聆听」，一两秒后换成失败文案。
    setReason(null)
    setTimedOut(false)
    setPhase('listening')
    const guard = createGuardInstance()
    const gate = await guard.check()
    if (isStale()) return
    if (gate != 'allow') {
      endSession(gate, false)
      return
    }
    // 引擎在录音之前装配：运营关停、以及 ncm 专属的「这台设备的 WebView 桥起不来」，
    // 都属于「这台设备/这个引擎现在根本做不到」，提前拒连 8 秒都不用等。
    // （空数组走的是 provider 的 unsupported 早退，不碰退避计数，所以不算一次失败。）
    // 唯一误伤是「刚进页 1 秒内就点」——注入还没回 ready，会看到「暂时没响应」，再点一次就好；
    // 不要为此加轮询重试，那会把闸门挪到识别路径上去。
    let engines: RecognizeEngine[]
    try {
      engines = await createActiveEngines()
    } catch {
      if (isStale()) return
      endSession('failed', false)
      return
    }
    if (isStale()) return
    if (!engines.length) {
      endSession('unsupported', false)
      return
    }

    setResults({})
    // 本会话的命中表跟着结果一起清空：重新按下就是新的一次「听到」，
    // 历史里那一行该顶到最前、时间该刷新。
    sessionKeysRef.current = new Set()
    // phase 不在这里翻 —— 它在按下那一刻已经进了 listening（见 run() 开头那段）。
    // 每会话解析上限复位（已解析好的歌条留在缓存里，下一轮再听到同一首不重查）。
    resolver.beginSession()

    // 权限只问一次：会话内每轮都问等于每 8 秒弹一次系统框，且首轮已经拿到授权后不会再变。
    const granted = await requestRecordPermission()
    if (isStale()) return
    if (!granted) {
      endSession('denied', false)
      return
    }

    // 录的是麦克风收到的声音，自家喇叭还开着时第一个听到的就是它，第一轮很可能认成正在放的这首。
    // 停在权限之后而不是按下那一刻：冷却、引擎不可用、拒绝授权这三条早退都没开始录，不该动用户正在放的歌。
    // 先记下停的是哪一首，退出这一页时只把它接回去（见 shouldResumeOnExit）。
    // 再次按下时若已经停着（还是我们停的那首），这个记录保持不动，别把它擦成 null。
    if (playerState.isPlay) {
      pausedForRef.current = playerState.playMusicInfo.musicInfo
      await pause()
    }

    const startedAt = Date.now()
    // 到点只管「不再开新的一轮」，正在录的那一轮照常录满并送出去 —— 半路掐掉等于白录，
    // 所以会话真实时长会略过 60 秒。
    while (shouldStartAnotherRound(Date.now(), startedAt)) {
      try {
        // 涟漪跟着采集走，一轮一圈：看到第几圈就知道这是这一分钟里的第几次听。
        setPulse(current => current + 1)
        const captured = await recordPcm(LISTEN_SECONDS)
        if (isStale()) return
        const round = await recognizeWithEngines(engines, captured.pcm, captured.sampleRate, guard)
        if (isStale()) return
        // 两个引擎的命中都收：结果页分两个区，谁听到都算数。
        for (const hit of round.hits) addHit(hit)
        if (round.failure && round.failure != 'no_match') {
          endSession(round.failure, false)
          return
        }
      } catch {
        // 采集失败与 provider 抛出（Ruling T5a：闸门自己的三次 await 不在它的 try 里）
        // 都是「这一轮做不到」，不是「没听到歌」，所以都算失败收尾。
        if (isStale()) return
        endSession('failed', false)
        return
      }
      // no_match 什么都不显示：持续听的时候「这一轮没听出来」不是结论，只是过程。
    }
    if (isStale()) return
    endSession(null, true)
  }

  const busy = phase == 'listening'
  const heardCount = Object.values(results).reduce((count, list) => count + list.length, 0)
  // 页脚只留一句建议，按现场选：听到过带括号的歌名（DJ版、翻唱版那一类）就说「多半不是原曲」，
  // 其余时候说的是怎么听更容易认出来。半角与全角括号都算，因为两个源都这么写歌名。
  const heardBracketedTitle = Object.values(results).some(list => list.some(song => /[（(][^）)]+[）)]/.test(song.name)))
  const statusText = phase == 'listening'
    ? t('music_recognition_listening')
    : phase == 'not_ready'
      ? t('music_recognition_not_ready')
      : phase == 'ended'
        ? reason
          ? errorText(reason)
          : timedOut && !heardCount
            ? t('music_recognition_timeout')
            : t('music_recognition_idle')
        : t('music_recognition_idle')
  // 状态行下面只补状态说不全的那半句：空闲与结束说"该怎么开始"，设备做不到说清为什么。
  // 正在听的时候没有要交代的，留白 —— 那一秒一秒过去的话本身才是最吵的东西。
  const hintText = phase == 'not_ready'
    ? t('music_recognition_not_ready_desc')
    : busy
      ? null
      : t('music_recognition_desc')
  // 盘面不再跟着状态翻底色：原来「正在听」是把淡底整块涂成主色 —— 那一下看着像按钮被按下去
  // 锁死了，而且淡底与主色只差一圈 1px 描边（改之前两个 token 其实是同一个值），
  // 浅色主题下几乎看不出来，全靠声纹条变高才猜到「开始了」。
  // 现在三个状态共用淡底：静的那一层只负责说「这是个可以按的圆盘」，
  // 「已经在听」交给盘内一圈圈推出去的波纹去说（见 ListeningRipples）。
  const disc = phase == 'not_ready'
    ? { borderColor: theme['c-border-background'], barColor: theme['c-font-label'] }
    : busy
      // 听着的时候描边提到实色主色：关掉动效的用户没有波纹可看，这一圈描边加上状态文案与
      // 停止按钮，仍然是「已经开始」的静默证据。
      ? { borderColor: theme['c-primary'], barColor: theme['c-primary'] }
      : { borderColor: theme['c-primary-alpha-400'], barColor: theme['c-primary'] }

  return (
    <View style={styles.container}>
      <View style={styles.discWrap}>
        { busy ? <ListeningRing pulse={pulse} size={DISC_SIZE} color={theme['c-primary']} /> : null }
        <TouchableOpacity
          style={[styles.disc, { backgroundColor: theme['c-button-background'], borderColor: disc.borderColor }]}
          activeOpacity={0.8}
          disabled={phase == 'not_ready'}
          accessibilityRole="button"
          accessibilityLabel={busy ? t('music_recognition_stop') : t('music_recognition')}
          onPress={() => {
            if (busy) {
              stopSession()
            } else {
              void run()
            }
          }}
        >
          {
            // 只在聆听期间挂载：波纹是「正在听」的持续反馈，停下来就该立刻收，
            // 没有「按了停止还在扩」的中间态。
            busy
              ? <ListeningRipples size={DISC_SIZE} color={theme['c-primary-alpha-400']} />
              : null
          }
          <Waveform
            active={busy}
            bars={11}
            height={busy ? 44 : 30}
            color={disc.barColor}
          />
        </TouchableOpacity>
      </View>
      <Text size={16} style={styles.status}>{statusText}</Text>
      {
        hintText
          ? <Text size={12} color={theme['c-font-label']} style={styles.hint}>{hintText}</Text>
          : null
      }
      {
        busy
          ? (
              <TouchableOpacity
                style={[styles.stopBtn, { borderColor: theme['c-primary-alpha-400'] }]}
                activeOpacity={0.8}
                accessibilityRole="button"
                onPress={stopSession}
              >
                <Text size={13} color={theme['c-primary-font']}>{t('music_recognition_stop')}</Text>
              </TouchableOpacity>
            )
          : null
      }
      <ResultSections
        resolver={resolver}
        groups={ENGINES
          .map(engine => ({ engineId: engine.id as EngineId, titleKey: engine.nameKey, songs: results[engine.id] ?? [] }))
          .filter(group => group.songs.length)}
      />
      {
        // 这台设备做不到时，「怎么听更准」是废话，页脚让位给状态下面那句解释。
        phase == 'not_ready'
          ? null
          : (
              <View style={styles.footer}>
                <Text size={12} color={theme['c-font-label']} style={styles.footerText}>
                  {t(heardBracketedTitle ? 'music_recognition_tip_cover' : 'music_recognition_tip_env')}
                </Text>
              </View>
            )
      }
      <AfpWasmView />
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
  discWrap: {
    width: DISC_SIZE,
    height: DISC_SIZE,
  },
  disc: {
    width: DISC_SIZE,
    height: DISC_SIZE,
    // 半径不写成宽高的一半：createStyle 会换算宽高、不换算半径，写一半在大屏上就变成圆角方块。
    borderRadius: 9999,
    borderWidth: BorderWidths.normal2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    marginTop: 26,
    textAlign: 'center',
    lineHeight: 24,
  },
  hint: {
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 18,
  },
  stopBtn: {
    marginTop: 16,
    paddingLeft: 22,
    paddingRight: 22,
    paddingTop: 6,
    paddingBottom: 6,
    borderRadius: 9999,
    borderWidth: BorderWidths.normal1,
  },
  footer: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 16,
  },
  footerText: {
    textAlign: 'center',
    lineHeight: 18,
  },
})
