import type { Message } from '@/lang'

export type EngineId = 'ncm' | 'shazam'

type LangKey = keyof Message

export interface EngineInfo {
  id: EngineId
  /** 结果分区的标题 */
  nameKey: LangKey
  /** 该引擎的识别链路是否已接通；未接通时面板停在 not_ready 态（「这台手机用不了识曲」）且圆盘无动作 */
  implemented: boolean
}

export const ENGINES: EngineInfo[] = [
  {
    id: 'ncm',
    nameKey: 'music_recognition_engine_ncm',
    implemented: true,
  },
  {
    id: 'shazam',
    nameKey: 'music_recognition_engine_shazam',
    implemented: true,
  },
]

export const DEFAULT_ENGINE_ID: EngineId = 'ncm'

export const getEngine = (id: EngineId): EngineInfo => {
  const engine = ENGINES.find(e => e.id == id)
  if (engine) return engine
  return ENGINES[0]
}
