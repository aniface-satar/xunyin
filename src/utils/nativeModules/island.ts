import { NativeModules, Platform } from 'react-native'

const { IslandModule } = NativeModules

export interface IslandSupportInfo {
  brand: string
  manufacturer: string
  model: string
  sdkInt: number
  isOppoFamily: boolean
  isHonorFamily: boolean
  isVivoFamily: boolean
  supportsMediaCapsule: boolean
  supportsFluidCloudIntent: boolean
}

export interface FluidCloudResult {
  code: number
  message: string
  data?: string
  raw?: string
}

export interface FluidCloudCapsule {
  /** 胶囊左侧图标（URL 或本地资源 id 字符串） */
  leftImg?: string
  /** 胶囊右侧文本，例如「接驾中」 */
  rightText?: string
  legacyImg?: string
  legacyText?: string
}

export interface FluidCloudPrimary {
  title: string[]
  content?: string
  rightImg?: string
  clickAction?: string
  miniImg?: string
}

export interface FluidCloudIntent {
  /** 意图名称，需与 OPPO 侧申请的配置一致 */
  intentName: string
  /** 本次共享记录的唯一 id，创建后刷新/销卡都要沿用同一个值 */
  identifier: string
  /** 卡片 ID，由 OPPO 分配，每个入口对应一个 serviceId */
  serviceId: Record<string, string>
  entityName: string
  entityId: string
  milestone: { code: number, text: string }
  capsule?: FluidCloudCapsule
  primary?: FluidCloudPrimary
  secondaryData?: Record<string, unknown>
  extra?: Record<string, unknown>
}

const notSupported = (): never => {
  throw new Error('IslandModule is only available on Android')
}

const getModule = () => {
  if (Platform.OS !== 'android' || IslandModule == null) return null
  return IslandModule as {
    getSupportInfo: () => Promise<IslandSupportInfo>
    shareFluidCloudIntent: (intentData: string) => Promise<FluidCloudResult>
    dismissFluidCloudIntent: (identifier: string) => Promise<FluidCloudResult>
    isFluidCloudSupported: () => Promise<boolean>
  }
}

/** 当前设备是否支持媒体胶囊（MediaSession 驱动的灵动胶囊/音乐流体云） */
export const supportsMediaCapsule = async(): Promise<boolean> => {
  const mod = getModule()
  if (mod == null) return false
  const info = await mod.getSupportInfo()
  return info.supportsMediaCapsule
}

/** 读取当前设备的灵动胶囊 / 原子岛 / 流体云支持情况 */
export const getIslandSupportInfo = async(): Promise<IslandSupportInfo> => {
  const mod = getModule()
  if (mod == null) return notSupported()
  return mod.getSupportInfo()
}

/** OPPO 端侧「意图共享」能力是否可用（IntelligentIntent Provider 是否存在） */
export const isFluidCloudSupported = async(): Promise<boolean> => {
  const mod = getModule()
  if (mod == null) return false
  return mod.isFluidCloudSupported()
}

const sendFluidCloud = async(intent: FluidCloudIntent, actionStatus: 0 | 1 | 2): Promise<FluidCloudResult> => {
  const mod = getModule()
  if (mod == null) return notSupported()
  // OPPO 的端侧接口只接受一整个 IntelligentIntent JSON 字符串，
  // actionStatus 0/1/2 分别代表 创卡 / 刷新 / 销卡。
  const payload = {
    intentName: intent.intentName,
    identifier: intent.identifier,
    timestamp: Date.now(),
    serviceId: intent.serviceId,
    intentAction: { actionStatus },
    intentEntity: {
      entityName: intent.entityName,
      entityId: intent.entityId,
      milestone: intent.milestone,
      capsule: intent.capsule,
      primary: intent.primary,
      secondaryData: intent.secondaryData,
    },
    extra: intent.extra,
  }
  return mod.shareFluidCloudIntent(JSON.stringify(payload))
}

/** 在 OPPO ColorOS 流体云上创建一个实时活动卡片 */
export const createFluidCloud = async(intent: FluidCloudIntent) => sendFluidCloud(intent, 0)

/** 刷新已创建的流体云卡片 */
export const updateFluidCloud = async(intent: FluidCloudIntent) => sendFluidCloud(intent, 1)

/** 结束（销卡）已创建的流体云卡片 */
export const endFluidCloud = async(identifier: string): Promise<FluidCloudResult> => {
  const mod = getModule()
  if (mod == null) return notSupported()
  return mod.dismissFluidCloudIntent(identifier)
}
