package cn.toside.music.core.player

import org.junit.Assert.assertEquals
import org.junit.Test

/** 播放模式按钮轮转顺序：对照 RN MUSIC_TOGGLE_MODE_LIST。 */
class TogglePlayMethodTest {
    @Test
    fun cyclesInSettingOrder() {
        assertEquals(TogglePlayMethod.RANDOM, TogglePlayMethod.next(TogglePlayMethod.LIST_LOOP))
        assertEquals(TogglePlayMethod.LIST, TogglePlayMethod.next(TogglePlayMethod.RANDOM))
        assertEquals(TogglePlayMethod.SINGLE_LOOP, TogglePlayMethod.next(TogglePlayMethod.LIST))
        assertEquals(TogglePlayMethod.NONE, TogglePlayMethod.next(TogglePlayMethod.SINGLE_LOOP))
        assertEquals(TogglePlayMethod.LIST_LOOP, TogglePlayMethod.next(TogglePlayMethod.NONE))
    }
}
