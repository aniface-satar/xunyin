import { getLoadScriptInfo, type InitParams, onScriptAction, sendAction, syncLoadScriptInfo, type ResponseParams, type UpdateInfoParams, type RequestParams } from '@/utils/nativeModules/userApi'
import { log, setUserApiList, setUserApiStatus } from '@/core/userApi'
import { checkUserApiUpdate, rollbackPendingUserApiUpdate, type UserApiUpdateOutcome } from '@/core/userApiUpdate'
import { planUserApiInit } from '@/core/userApiUpdate/verifyLoad'
import { planUpdateAlert } from '@/core/userApiUpdate/updateAlert'
import settingState from '@/store/setting/state'
import BackgroundTimer from 'react-native-background-timer'
import { fetchData } from './request'
import { getUserApiList, setUserApiVerifyPending } from '@/utils/data'
import { setApiSource } from '@/core/apiSource'
import { confirmDialog, openUrl, tipDialog, toast } from '@/utils/tools'


export default async(setting: LX.AppSetting) => {
  const syncUpdateSwitches = () => {
    const info = getLoadScriptInfo()
    if (!info) return
    // 事件过滤读的是加载快照；设置页改了总开关要立刻生效，不能等下次重启
    syncLoadScriptInfo(info.id, {
      allowShowUpdateAlert: settingState.setting['common.userApiAllowShowUpdateAlert'],
      autoUpdate: settingState.setting['common.userApiAutoUpdate'],
    })
  }
  const handleConfigUpdated: typeof global.state_event.configUpdated = (keys) => {
    if (!keys.includes('common.userApiAllowShowUpdateAlert') && !keys.includes('common.userApiAutoUpdate')) return
    syncUpdateSwitches()
  }
  global.state_event.on('configUpdated', handleConfigUpdated)

  const userApiRequestMap = new Map<string, { resolve: (value: ResponseParams['result']) => void, reject: (error: Error) => void, timeout: number }>()
  const scriptRequestMap = new Map<string, { request: Promise<any>, abort: () => void }>()

  const cancelRequest = (requestKey: string, message: string) => {
    const target = scriptRequestMap.get(requestKey)
    if (!target) return
    scriptRequestMap.delete(requestKey)
    target.abort()
  }
  const sendScriptRequest = (requestKey: string, url: string, options: RequestParams['options']) => {
    let req = fetchData(url, options)
    req.request.then(response => {
      // console.log(response)
      sendAction('response', {
        error: null,
        requestKey,
        response,
      })
    }).catch(err => {
      sendAction('response', {
        error: err.message,
        requestKey,
        response: null,
      })
    }).finally(() => {
      scriptRequestMap.delete(requestKey)
    })
    scriptRequestMap.set(requestKey, req)
  }
  const sendUserApiRequest = async(data: LX.UserApi.UserApiRequestParams) => {
    const handleApiUpdate = () => {
      const target = userApiRequestMap.get(data.requestKey)
      if (!target) return
      userApiRequestMap.delete(data.requestKey)
      BackgroundTimer.clearTimeout(target.timeout)
      target.reject(new Error('request failed'))
    }
    const requestPromise = new Promise<ResponseParams['result']>((resolve, reject) => {
      userApiRequestMap.set(data.requestKey, {
        resolve,
        reject,
        timeout: BackgroundTimer.setTimeout(() => {
          const target = userApiRequestMap.get(data.requestKey)
          if (!target) return
          userApiRequestMap.delete(data.requestKey)
          target.reject(new Error('request timeout'))
        }, 20_000),
      })
      sendAction('request', data)
    }).finally(() => {
      global.state_event.off('apiSourceUpdated', handleApiUpdate)
    })
    global.state_event.on('apiSourceUpdated', handleApiUpdate)
    return requestPromise
  }
  const handleUserApiResponse = ({ status, result, requestKey, errorMessage }: ResponseParams) => {
    const target = userApiRequestMap.get(requestKey)
    if (!target) return
    userApiRequestMap.delete(requestKey)
    BackgroundTimer.clearTimeout(target.timeout)
    if (status) target.resolve(result)
    else target.reject(new Error(errorMessage ?? 'failed'))
  }
  const handleStateChange = ({ status, errorMessage, info, loadFailed }: InitParams) => {
    // console.log(status, message, info)
    // 更新流程换上新脚本后会先自己加载验证一次。那次加载的成败只说明新脚本好不好，
    // 不代表应用级初始化：失败之后紧跟着就是回滚，不能让它把源判死
    const verifyLoad = (info as (LX.UserApi.UserApiInfo & { verify?: boolean }) | null)?.verify === true
    const plan = planUserApiInit({ verify: verifyLoad, status, hasErrorMessage: !!errorMessage, settled: global.lx.apiInitPromise[1] })
    // 验证加载失败时先别动全局状态：紧接着就是回滚，UI 跟着闪一次失败没有意义
    if (!verifyLoad || status) setUserApiStatus(status, errorMessage)
    if (!info || info.id !== settingState.setting['common.apiSource']) return
    if (status) {
      if (info.sources) {
        let apis: any = {}
        let qualitys: LX.QualityList = {}
        for (const [source, { actions, type, qualitys: sourceQualitys }] of Object.entries(info.sources)) {
          if (type != 'music') continue
          apis[source as LX.Source] = {}
          for (const action of actions) {
            switch (action) {
              case 'musicUrl':
                apis[source].getMusicUrl = (songInfo: LX.Music.MusicInfo, type: LX.Quality) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      // userApiRequestCancel(requestKey)
                    },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'musicUrl',
                        info: {
                          type,
                          musicInfo: songInfo,
                        },
                      },
                      // eslint-disable-next-line @typescript-eslint/promise-function-async
                    }).then(res => {
                      // console.log(res)
                      return { type, url: res.data.url }
                    }).catch(err => {
                      console.log(err.message)
                      throw err
                    }),
                  }
                }
                break
              case 'lyric':
                apis[source].getLyric = (songInfo: LX.Music.MusicInfo) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      // userApiRequestCancel(requestKey)
                    },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'lyric',
                        info: {
                          type,
                          musicInfo: songInfo,
                        },
                      },
                      // eslint-disable-next-line @typescript-eslint/promise-function-async
                    }).then(res => {
                      // console.log(res)
                      return res.data
                    }).catch(async err => {
                      console.log(err.message)
                      return Promise.reject(err)
                    }),
                  }
                }
                break
              case 'pic':
                apis[source].getPic = (songInfo: LX.Music.MusicInfo) => {
                  const requestKey = `request__${Math.random().toString().substring(2)}`
                  return {
                    canceleFn() {
                      // userApiRequestCancel(requestKey)
                    },
                    promise: sendUserApiRequest({
                      requestKey,
                      data: {
                        source,
                        action: 'pic',
                        info: {
                          type,
                          musicInfo: songInfo,
                        },
                      },
                      // eslint-disable-next-line @typescript-eslint/promise-function-async
                    }).then(res => {
                      // console.log(res)
                      return res.data
                    }).catch(async err => {
                      console.log(err.message)
                      return Promise.reject(err)
                    }),
                  }
                }
                break
              default:
                break
            }
          }
          qualitys[source as LX.Source] = sourceQualitys
        }
        global.lx.qualityList = qualitys
        global.lx.apis = apis
        global.state_event.apiSourceUpdated(settingState.setting['common.apiSource'])
      }
      // 这个源真的起来了：自动更新留下的「待验证」标记到此为止
      if (!verifyLoad) void setUserApiVerifyPending(info.id, false)
    } else if (!verifyLoad) {
      // 普通加载失败：可能只是脚本坏了，也可能是自动更新换上去、还没验证过的脚本。
      // 后者要退回更新前的备份（见 handleFailedInit）
      // 编译都没过的时候引擎原文只有 "unexpected end of string" 这种术语，先给用户一句人话
      const failedReason = loadFailed
        ? `${global.i18n.t('user_api_script_unreadable_tip')}\n${errorMessage}`
        : errorMessage
      void handleFailedInit(info, failedReason, plan.alert)
    }
    // 验证加载失败时不要结算：回滚后还有一次正常加载会给出真实结果，
    // 提前把 apiInitPromise 判成 false 会让整个源在后面所有请求里都报 source init failed
    if (plan.settle) global.lx.apiInitPromise[2](status)
    // 更新流程要靠这条事件确认「新脚本装得上、起得来」，起不来就退回备份
    if (info?.id) global.state_event.userApiInitResult({ id: info.id, status, errorMessage })
  }
  const showUpdateAlert = async({ name, log: updateLog, updateUrl }: UpdateInfoParams) => {
    const apiInfo = getLoadScriptInfo()
    if (!apiInfo) return
    // 这两个开关是设置页里的总开关，对所有自定义源和内置源一起生效
    const autoUpdate = settingState.setting['common.userApiAutoUpdate']
    const allowShowUpdateAlert = settingState.setting['common.userApiAllowShowUpdateAlert']
    let outcome: UserApiUpdateOutcome | null = null
    if (autoUpdate) {
      try {
        outcome = await checkUserApiUpdate(apiInfo.id, updateUrl)
      } catch (err: any) {
        outcome = { status: 'failed', reason: 'resolve_failed', message: err.message as string }
      }
      // 失败必须留得下痕迹：r_error 写的日志设置页能看，不受「调试日志」开关影响
      if (outcome.status == 'failed') log.r_error(`auto update user api failed: ${name}, ${outcome.message}`)
    }
    const plan = planUpdateAlert({ autoUpdate, allowShowUpdateAlert }, outcome, updateUrl)
    switch (plan.type) {
      case 'toast': {
        const toastName = outcome?.status == 'updated' ? outcome.name : name
        toast(global.i18n.t(plan.kind == 'updated' ? 'user_api_auto_update_success_tip' : 'user_api_auto_update_failed_tip', { name: toastName }), 'long')
        break
      }
      case 'confirm':
        void confirmDialog({
          message: `${global.i18n.t('user_api_update_alert', { name })}\n${updateLog}`,
          // selection: true,
          // showCancel: true,
          confirmButtonText: global.i18n.t('user_api_update_alert_open_url'),
          cancelButtonText: global.i18n.t('close'),
        }).then(confirm => {
          if (!confirm) return
          setTimeout(() => {
            void openUrl(plan.url)
          }, 300)
        })
        break
      case 'tip':
        void tipDialog({
          message: `${global.i18n.t('user_api_update_alert', { name })}\n${updateLog}`,
          // selection: true,
          btnText: global.i18n.t('ok'),
        })
        break
      default:
        break
    }
  }

  onScriptAction((event) => {
    // console.log('script actuon: ', event)
    switch (event.action) {
      case 'init':
        if ((event as unknown as { errorMessage?: string }).errorMessage) event.data.errorMessage = (event as unknown as { errorMessage: string }).errorMessage
        handleStateChange(event.data)
        break
      case 'response':
        handleUserApiResponse(event.data)
        break
      case 'request':
        sendScriptRequest(event.data.requestKey, event.data.url, event.data.options)
        break
      case 'cancelRequest':
        cancelRequest(event.data, 'request canceled')
        break
      case 'showUpdateAlert':
        void showUpdateAlert(event.data)
        break
      case 'log':
        switch ((event as unknown as { type: keyof typeof log }).type) {
          case 'log':
          case 'info':
            log.info((event as unknown as { log: string }).log)
            break
          case 'error':
            log.error((event as unknown as { log: string }).log)
            break
          case 'warn':
            log.warn((event as unknown as { log: string }).log)
            break
          default:
            break
        }
        break
      default:
        break
    }
  })

  setUserApiList(await getUserApiList())
}

/**
 * 当前源初始化失败后的处理。
 *
 * 先试保命那一跳：「自动更新写进这个源、还没被验证过」的脚本（非当前源更新时没法当场验证，
 * 见 rollbackPendingUserApiUpdate）退回更新前的备份，再按完整流程重装一次 ——
 * apiInitPromise 会换成新的，成败由这次加载重新结算，用户只看到一句「已退回」。
 *
 * 没有可退的备份才是真的失败，这时才弹「初始化失败」。
 */
const handleFailedInit = async(apiInfo: LX.UserApi.UserApiInfo, errorMessage: string, alert: boolean) => {
  if (await rollbackPendingUserApiUpdate(apiInfo.id)) {
    // 回滚要走盘，期间用户可能已经切到别的源了，别把他拽回来
    if (settingState.setting['common.apiSource'] != apiInfo.id) return
    toast(global.i18n.t('user_api_init_rolled_back_tip', { name: apiInfo.name }), 'long')
    setApiSource(apiInfo.id)
    return
  }
  if (!alert) return
  void tipDialog({
    message: `${global.i18n.t('user_api__init_failed_alert', { name: apiInfo.name })}\n${errorMessage}`,
    // selection: true,
    btnText: global.i18n.t('ok'),
  })
}
