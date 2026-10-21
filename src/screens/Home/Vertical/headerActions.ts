export type HeaderAction = 'download' | 'settings'

export const getHeaderActions = (navActiveId: string): HeaderAction[] => {
  switch (navActiveId) {
    case 'nav_love':
      return ['download', 'settings']
    case 'nav_discover':
    case 'nav_search':
      return ['settings']
    default:
      return []
  }
}
