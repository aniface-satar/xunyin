const FAVORITE_LIST_ID = 'love'

export const buildAddModalLists = (
  userLists: LX.List.UserListInfo[],
  favoriteName: string,
  sourceListId = '',
  { isMove = false }: { isMove?: boolean } = {},
): LX.List.MyListInfo[] => {
  const favoriteList = !isMove && sourceListId != FAVORITE_LIST_ID
    ? [{
        id: FAVORITE_LIST_ID,
        name: favoriteName,
        locationUpdateTime: null,
      }]
    : []

  return [
    ...favoriteList,
    ...userLists.filter(listInfo => listInfo.id != sourceListId),
  ]
}
