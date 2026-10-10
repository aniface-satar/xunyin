import type { Message } from '@/lang'

export type EngineId = 'ncm' | 'shazam'

type LangKey = keyof Message

export interface EngineInfo {
  id: EngineId
  nameKey: LangKey
  descKey: LangKey
  tipKey: LangKey
  /** 该引擎的识别链路是否已接通；未接通时面板保持「识别还没接入」 */
  implemented: boolean
}

export const ENGINES: EngineInfo[] = [
  {
    id: 'ncm',
    nameKey: 'music_recognition_engine_ncm',
    descKey: 'music_recognition_ncm_desc',
    tipKey: 'music_recognition_ncm_tip',
    implemented: true,
  },
  {
    id: 'shazam',
    nameKey: 'music_recognition_engine_shazam',
    descKey: 'music_recognition_shazam_desc',
    tipKey: 'music_recognition_shazam_tip',
    implemented: false,
  },
]

export const DEFAULT_ENGINE_ID: EngineId = 'ncm'

export const getEngine = (id: EngineId): EngineInfo => {
  const engine = ENGINES.find(e => e.id == id)
  if (engine) return engine
  return ENGINES[0]
}
