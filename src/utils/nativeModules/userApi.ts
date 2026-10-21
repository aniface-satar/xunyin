import { NativeEventEmitter, NativeModules } from 'react-native'

const { UserApiModule } = NativeModules

/**
 * verify 只活在 JS 侧：更新流程换上新脚本后会先自己加载一次验证，
 * 这次加载的成败不能算到应用级初始化头上（见 core/init/userApi 的 handleStateChange）。
 */
export type UserApiLoadInfo = LX.UserApi.UserApiInfo & { script: string, verify?: boolean }
let loadScriptInfo: (LX.UserApi.UserApiInfo & { verify?: boolean }) | null = null
// 每次加载一个序号：native 把它带在 init 事件里，用来分辨事件属于哪一次加载
let loadSeqCounter = 0
let currentLoadSeq = ''
export const loadScript = (info: UserApiLoadInfo) => {
  loadScriptInfo = info
  currentLoadSeq = `${++loadSeqCounter}`
  UserApiModule.loadScript({
    id: info.id,
    name: info.name,
    description: info.description,
    version: info.version ?? '',
    author: info.author ?? '',
    homepage: info.homepage ?? '',
    script: info.script,
    loadSeq: currentLoadSeq,
  })
}

export interface SendResponseParams {
  requestKey: string
  error: string | null
  response: {
    statusCode: number
    statusMessage: string
    headers: Record<string, string>
    body: any
  } | null
}
export interface SendActions {
  request: LX.UserApi.UserApiRequestParams
  response: SendResponseParams
}
export const sendAction = <T extends keyof SendActions>(action: T, data: SendActions[T]) => {
  UserApiModule.sendAction(action, JSON.stringify(data))
}

// export const clearAppCache = CacheModule.clearAppCache as () => Promise<void>

export interface InitParams {
  status: boolean
  errorMessage: string
  info: LX.UserApi.UserApiInfo
  /** 脚本在 native 侧连编译都没过（区别于脚本自己报的初始化失败） */
  loadFailed?: boolean
}

export interface ResponseParams {
  status: boolean
  errorMessage?: string
  requestKey: string
  result: any
}
export interface UpdateInfoParams {
  name: string
  log: string
  updateUrl: string
}
export interface RequestParams {
  requestKey: string
  url: string
  options: {
    method: string
    data: any
    timeout: number
    headers: any
    binary: boolean
  }
}
export type CancelRequestParams = string

export interface Actions {
  init: InitParams
  request: RequestParams
  cancelRequest: CancelRequestParams
  response: ResponseParams
  showUpdateAlert: UpdateInfoParams
  log: string
}
export type ActionsEvent = { [K in keyof Actions]: { action: K, data: Actions[K] } }[keyof Actions]

export const onScriptAction = (handler: (event: ActionsEvent) => void): () => void => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const eventEmitter = new NativeEventEmitter(UserApiModule)
  const eventListener = eventEmitter.addListener('api-action', event => {
    if (event.data) event.data = JSON.parse(event.data as string)
    if (event.action == 'init') {
      // 换脚本（更新验证 / 回滚 / 切源）时，上一次加载可能还留着一个 init 事件在队列里。
      // 带序号的必须对得上才算这次加载的结果；没带序号的是旧内核，照旧放行
      const eventLoadSeq = (event as unknown as { loadSeq?: string }).loadSeq ?? (event.data as { loadSeq?: string } | null)?.loadSeq
      if (eventLoadSeq != null && eventLoadSeq != currentLoadSeq) return
      if (event.data.info) event.data.info = { ...loadScriptInfo, ...event.data.info }
      else {
        // info 为空说明脚本在 native 侧连编译都没过（不是脚本自己报的初始化失败）：
        // 补上来源信息好让上层认得这是哪次加载，同时留个标记，两种失败的提示语不一样
        event.data.info = { ...loadScriptInfo }
        event.data.loadFailed = true
      }
    } else if (event.action == 'showUpdateAlert') {
      if (!loadScriptInfo?.allowShowUpdateAlert && !loadScriptInfo?.autoUpdate) return
    }
    handler(event as ActionsEvent)
  })

  return () => {
    eventListener.remove()
  }
}

export const getLoadScriptInfo = (): (LX.UserApi.UserApiInfo & { verify?: boolean }) | null => loadScriptInfo

/**
 * 设置页改了开关不需要重新加载脚本，但事件过滤和更新流程读的是这份加载快照；
 * 不同步的话，刚关掉的弹窗要等到下次重启才真的关上。
 */
export const syncLoadScriptInfo = (id: string, patch: Partial<Pick<LX.UserApi.UserApiInfo, 'allowShowUpdateAlert' | 'autoUpdate'>>) => {
  if (loadScriptInfo?.id !== id) return
  loadScriptInfo = { ...loadScriptInfo, ...patch }
}

export const destroy = () => {
  UserApiModule.destroy()
}
