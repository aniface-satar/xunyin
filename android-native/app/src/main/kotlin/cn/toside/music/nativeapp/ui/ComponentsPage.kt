package cn.toside.music.nativeapp.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.ButtonAppearance
import com.moriafly.salt.ui.Item
import com.moriafly.salt.ui.ItemSlider
import com.moriafly.salt.ui.ItemSpacer
import com.moriafly.salt.ui.ItemSwitcher
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Switcher
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.screen.BasicScreen

/**
 * B0 组件抽查页：SaltUI 全家桶渲染验证（验收项）。
 *
 * 覆盖：BasicScreen（需 UnstableSaltUiApi）、Button（Filled/Subtle/Plain）、
 * ItemSlider、Item/ItemSwitcher、Switcher、Text。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun ComponentsPage(onBack: () -> Unit) {
    BasicScreen(
        onBack = onBack,
        title = "组件抽查",
    ) { paddingValues ->
        var sliderValue by remember { mutableFloatStateOf(0.5f) }
        var switchState by remember { mutableStateOf(false) }
        var itemSwitchState by remember { mutableStateOf(true) }
        var clickCount by remember { mutableStateOf(0) }

        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(paddingValues),
        ) {
            Text(
                text = "Button · 已点击 $clickCount 次",
                modifier = Modifier.padding(horizontal = 16.dp),
                color = SaltTheme.colors.subText,
            )
            Spacer(Modifier.height(8.dp))
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = { clickCount++ },
                    text = "Filled",
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = { clickCount++ },
                    text = "Subtle",
                    appearance = ButtonAppearance.Subtle,
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = { clickCount++ },
                    text = "Plain",
                    appearance = ButtonAppearance.Plain,
                    modifier = Modifier.weight(1f),
                )
            }

            Spacer(Modifier.height(16.dp))
            ItemSpacer()
            ItemSlider(
                value = sliderValue,
                onValueChange = { sliderValue = it },
                text = "ItemSlider 进度",
                sub = "${(sliderValue * 100).toInt()}%",
            )
            ItemSwitcher(
                state = itemSwitchState,
                onChange = { itemSwitchState = it },
                text = "ItemSwitcher 开关项",
            )
            ItemSwitcher(
                state = switchState,
                onChange = { switchState = it },
                text = "带副标题的开关项",
                sub = "sub 参数演示",
            )
            Item(onClick = { clickCount++ }, text = "普通 Item")
            ItemSpacer()

            Spacer(Modifier.height(16.dp))
            Text(
                text = "独立 Switcher（与上方开关项联动）",
                modifier = Modifier.padding(horizontal = 16.dp),
                color = SaltTheme.colors.subText,
            )
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.End,
            ) {
                Switcher(state = switchState, onChange = { switchState = it })
            }
        }
    }
}
