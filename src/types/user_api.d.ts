declare namespace LX {
  namespace UserApi {
    type UserApiSourceInfoType = 'music'
    type UserApiSourceInfoActions = 'musicUrl' | 'lyric' | 'pic'

    interface UserApiSourceInfo {
      name: string
      type: UserApiSourceInfoType
      actions: UserApiSourceInfoActions[]
      qualitys: LX.Quality[]
    }

    type UserApiSources = Record<LX.Source, UserApiSourceInfo>


    interface UserApiInfo {
      id: string
      name: string
      description: string
      // script: string
      // 旧版逐源开关，保留字段兼容已存数据；是否弹窗/自动更新现在由
      // common.userApiAllowShowUpdateAlert / common.userApiAutoUpdate 总开关统一决定
      allowShowUpdateAlert: boolean
      autoUpdate: boolean
      author: string
      homepage: string
      version: string
      // 更新地址：updateUrl 是用户在设置里自己填的（最准，优先用），scriptUpdateUrl 是从脚本头部注释里读的
      updateUrl: string
      scriptUpdateUrl: string
      // 上次自动检查更新的时间戳，0 表示从没查过
      lastCheckAt: number
      // 自动更新写进脚本时它还不是当前源，没法当场验证；等它第一次真正加载，
      // 起不来就退回更新前的备份（见 core/userApiUpdate 的 rollbackPendingUserApiUpdate）
      verifyPending?: boolean
      // 随应用内置的源；online / local 都可以在作者提供更新地址时检查更新
      builtin?: 'online' | 'local'
      // 本地内置源上一次跟随应用包写入的脚本版本；用来区分「应用带的新脚本」
      // 和「用户自己检查更新换上的脚本」，避免重启时把运行时更新覆盖回旧版
      builtinVersion?: string
      sources?: UserApiSources
    }

    interface UserApiStatus {
      status: boolean
      message?: string
      apiInfo?: UserApiInfo
    }

    interface UserApiUpdateInfo {
      name: string
      description: string
      log: string
      updateUrl?: string
    }

    interface UserApiRequestParams {
      requestKey: string
      data: any
    }
    interface UserApiRequestParams {
      requestKey: string
      data: any
    }
    type UserApiRequestCancelParams = string
    type UserApiSetApiParams = string

    interface UserApiSetAllowUpdateAlertParams {
      id: string
      enable: boolean
    }

    interface ImportUserApi {
      apiInfo: UserApiInfo
      apiList: UserApiInfo[]
    }

  }
}
