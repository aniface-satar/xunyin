import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import Button, { type BtnType } from '@/components/common/Button'
import { createStyle } from '@/utils/tools'
import { type BoardItem } from '@/store/leaderboard/state'
import { Icon } from '@/components/common/Icon'
import { BorderRadius, BorderWidths } from '@/theme'
import { getBoardTopTracks } from '@/core/leaderboard'

interface BoardTrack {
  name: string
  singer: string
}

// index={index}
// longPressIndex={longPressIndex}
// activeId={activeId}
// showMenu={showMenu}
// onBoundChange={handleBoundChange}
export interface ListItemProps {
  item: BoardItem
  index: number
  longPressIndex: number
  activeId: string
  matrix?: boolean
  onShowMenu: (id: string, name: string, index: number, position: { x: number, y: number, w: number, h: number }) => void
  onBoundChange: (item: BoardItem) => void
}

export default ({ item, activeId, index, longPressIndex, matrix = false, onBoundChange, onShowMenu }: ListItemProps) => {
  const theme = useTheme()
  const buttonRef = useRef<BtnType>(null)
  const [topTracks, setTopTracks] = useState<BoardTrack[]>([])

  const setPosition = useCallback(() => {
    if (buttonRef.current?.measure) {
      buttonRef.current.measure((fx, fy, width, height, px, py) => {
        // console.log(fx, fy, width, height, px, py)
        onShowMenu(item.id, item.name, index, { x: Math.ceil(px), y: Math.ceil(py), w: Math.ceil(width), h: Math.ceil(height) })
      })
    }
  }, [index, item, onShowMenu])

  const active = activeId == item.id

  useEffect(() => {
    if (!matrix) return

    let isMounted = true
    getBoardTopTracks(item.id, 3).then(musicList => {
      if (!isMounted) return
      setTopTracks(musicList.map(({ name, singer }) => ({ name, singer })))
    }).catch(() => {
      if (isMounted) setTopTracks([])
    })

    return () => {
      isMounted = false
    }
  }, [item.id, matrix])

  return (
    <Button
      ref={buttonRef}
      style={matrix
        ? {
            ...styles.button,
            ...styles.matrixButton,
            backgroundColor: index == longPressIndex
              ? theme['c-button-background-active']
              : active
                ? theme['c-primary-background-active']
                : theme['c-content-background'],
            borderColor: theme['c-border-background'],
          }
        : {
            ...styles.button,
            ...(index == longPressIndex ? { backgroundColor: theme['c-button-background-active'] } : null),
          }}
      key={item.id} onLongPress={setPosition}
      onPress={() => { onBoundChange(item) }}
    >
      {
        active && !matrix
          ? <Icon style={styles.listActiveIcon} name="chevron-right" size={12} color={theme['c-primary-font']} />
          : null
      }
      {matrix ? (
        <>
          <Text
            style={styles.matrixBoardName}
            size={16}
            textBreakStrategy="simple"
            color={active ? theme['c-primary-font-active'] : theme['c-font']}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          <View style={styles.topTracks}>
            {[0, 1, 2].map(line => {
              const track = topTracks[line]
              return (
                <Text
                  key={line}
                  style={styles.matrixTopTrack}
                  size={12}
                  textBreakStrategy="simple"
                  color={theme['c-font-label']}
                  numberOfLines={1}
                >
                  {track ? `${line + 1}. ${track.name}-${track.singer}` : ''}
                </Text>
              )
            })}
          </View>
        </>
      ) : (
        <Text
          style={styles.listName}
          size={14}
          textBreakStrategy="simple"
          color={active ? theme['c-primary-font-active'] : theme['c-font']}
          numberOfLines={1}
        >
          {item.name}
        </Text>
      )}
    </Button>
  )
}

const styles = createStyle({
  button: {
    paddingLeft: 5,
    paddingRight: 10,
    paddingTop: 10,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  listActiveIcon: {
    // width: 18,
    marginLeft: 3,
    // paddingRight: 5,
    textAlign: 'center',
  },
  listName: {
    height: '100%',
    justifyContent: 'center',
    paddingLeft: 6,
    // backgroundColor: 'rgba(0,0,0,0.1)',
  },
  matrixButton: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    minHeight: 132,
    marginHorizontal: 6,
    marginBottom: 10,
    paddingLeft: 10,
    paddingRight: 8,
    paddingTop: 10,
    paddingBottom: 8,
    borderWidth: BorderWidths.normal,
    borderRadius: BorderRadius.normal,
  },
  matrixBoardName: {
    textAlign: 'center',
    lineHeight: 22,
    fontWeight: '700',
  },
  topTracks: {
    marginTop: 6,
  },
  matrixTopTrack: {
    lineHeight: 18,
  },
})
