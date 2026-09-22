export type HeaderAction = 'mylistSearch' | 'settings'

export const getHeaderActions = (navActiveId: string): HeaderAction[] => {
  switch (navActiveId) {
    case 'nav_love':
      return ['mylistSearch', 'settings']
    case 'nav_discover':
    case 'nav_search':
      return ['settings']
    default:
      return []
  }
}
