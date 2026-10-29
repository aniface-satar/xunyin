import { type SearchType } from '@/store/search/state'

// 顺序即标签顺序，也是搜索结果 PagerView 的页码
export const SEARCH_TYPES: readonly SearchType[] = [
  'music',
  'album',
  'songlist',
  'artist',
]
