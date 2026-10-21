import { action, state } from '@/store/userApi'
import settingState from '@/store/setting/state'
import { addUserApi, getUserApiScript, removeUserApi as removeUserApiFromStore, setUserApiUpdateUrl as setUserApiUpdateUrlFromStore } from '@/utils/data'
import { destroy, loadScript } from '@/utils/nativeModules/userApi'
import { checkScriptSyntax } from '@/core/userApiUpdate/syntaxCheck'
import { log as writeLog } from '@/utils/log'


/**
 * @param options.verify 更新流程的验证加载：成功之前不动全局状态，也不把 UI 拨到「初始化中」，
 * 免得验证失败弹一次「初始化失败」、随后回滚成功又弹回来
 */
export const setUserApi = async(apiId: string, options?: { verify?: boolean }) => {
  if (!options?.verify) {
    global.lx.qualityList = {}
    setUserApiStatus(false, 'initing')
  }

  const target = state.list.find(api => api.id === apiId)
  if (!target) throw new Error('api not found')
  const script = await getUserApiScript(target.id)
  // 更新开关现在是全局设置：加载快照里也放全局值，
  // 脚本运行时触发的 updateAlert 才能按总开关决定要不要处理
  loadScript({
    ...target,
    script,
    allowShowUpdateAlert: settingState.setting['common.userApiAllowShowUpdateAlert'],
    autoUpdate: settingState.setting['common.userApiAutoUpdate'],
    verify: options?.verify,
  })
}

export const destroyUserApi = () => {
  destroy()
}


export const setUserApiStatus: typeof action['setStatus'] = (status, message) => {
  action.setStatus(status, message)
}

export const setUserApiList: typeof action['setUserApiList'] = (list) => {
  action.setUserApiList(list)
}

export const importUserApi = async(script: string, updateUrl?: string) => {
  // 导入进来的脚本连编译都过不了时别入库：那会让这个源从此停在「初始化失败」上，
  // 而且盘上那份坏脚本和更新地址的内容一模一样，自动更新再也不会来救它
  const syntax = checkScriptSyntax(script)
  if (!syntax.ok) throw new Error(global.i18n.t('user_api_import_syntax_failed_tip', { message: syntax.message }))
  const info = await addUserApi(script, updateUrl)
  action.addUserApi(info)
}

export const removeUserApi = async(ids: string[]) => {
  const list = await removeUserApiFromStore(ids)
  action.setUserApiList(list)
}

export const setUserApiUpdateUrl = async(id: string, url: string) => {
  await setUserApiUpdateUrlFromStore(id, url)
  action.setUserApiUpdateUrl(id, url)
}

export const log = {
  r_info(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    writeLog.info(...params)
  },
  r_warn(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    writeLog.warn(...params)
  },
  r_error(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    writeLog.error(...params)
  },
  log(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    if (global.lx.isEnableUserApiLog) writeLog.info(...params)
  },
  info(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    if (global.lx.isEnableUserApiLog) writeLog.info(...params)
  },
  warn(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    if (global.lx.isEnableUserApiLog) writeLog.warn(...params)
  },
  error(...params: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    if (global.lx.isEnableUserApiLog) writeLog.error(...params)
  },
}
