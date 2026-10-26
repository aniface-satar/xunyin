package cn.toside.music.nativeapp.ui.settings

import android.os.Build
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.nativeapp.util.SystemSettings
import com.moriafly.salt.ui.Item
import com.moriafly.salt.ui.ItemSpacer
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.screen.BasicScreen

/**
 * 后台播放帮助页（w3-A 任务 5 建议 3 的落地）：按厂商给出白名单设置步骤。
 *
 * 内容照搬 `w3-A.md` 任务 5 的厂商白名单表；[Build.MANUFACTURER] 命中的厂商
 * 排在最前面并加「你的设备」标记。电池优化豁免入口沿用设置页已有的
 * [SystemSettings.requestIgnoreBatteryOptimization]（必须用户点击触发，不自动弹）。
 *
 * 厂商开关名随系统版本有差异，这里的路径名是指导性的，真机核对见 lane 报告清单 ②。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun BackgroundPlayHelpPage(onBack: () -> Unit) {
    val context = LocalContext.current
    val manufacturer = remember { Build.MANUFACTURER.lowercase() }
    val guides =
        remember(manufacturer) {
            // 命中当前厂商的排最前，其余按固定顺序跟上
            VENDOR_GUIDES.sortedByDescending { manufacturer in it.matchers }
        }
    BasicScreen(onBack = onBack, title = "后台播放帮助") { padding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(padding),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ItemSpacer()
            Text(
                text =
                    "如果遇到锁屏后音乐停止、桌面歌词消失等问题，多半是系统把应用在后台清掉了。" +
                        "在下面找到你的手机品牌，把列出的开关打开即可。不同系统版本的菜单名称可能略有差异。",
                color = SaltTheme.colors.subText,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            guides.forEach { guide ->
                val isMine = manufacturer in guide.matchers
                Text(
                    text = if (isMine) "${guide.vendor}（你的设备）" else guide.vendor,
                    color = if (isMine) SaltTheme.colors.highlight else SaltTheme.colors.subText,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
                guide.steps.forEachIndexed { index, step ->
                    Item(
                        onClick = {},
                        text = step,
                        tag = "${index + 1}",
                    )
                }
            }
            ItemSpacer()
            Item(
                onClick = {
                    if (!SystemSettings.requestIgnoreBatteryOptimization(context)) {
                        Toast.makeText(context, "这台设备的系统没有这个设置页", Toast.LENGTH_SHORT).show()
                    }
                },
                text = "申请忽略电池优化",
                sub = "系统级的通用手段，与上面的厂商开关配合使用",
            )
            ItemSpacer()
        }
    }
}

/** 单个厂商的白名单步骤（照搬 w3-A 任务 5 调研表）。 */
private data class VendorGuide(
    val vendor: String,
    val matchers: Set<String>,
    val steps: List<String>,
)

private val VENDOR_GUIDES =
    listOf(
        VendorGuide(
            vendor = "小米 / 红米（MIUI / HyperOS）",
            matchers = setOf("xiaomi", "redmi"),
            steps =
                listOf(
                    "设置 → 应用设置 → 应用管理 → 本应用 → 省电策略 → 无限制",
                    "自启动：设置 → 应用设置 → 本应用 → 打开自启动",
                    "最近任务：下拉本应用卡片 → 加锁",
                ),
        ),
        VendorGuide(
            vendor = "华为 / 荣耀（EMUI / MagicOS）",
            matchers = setOf("huawei", "honor"),
            steps =
                listOf(
                    "设置 → 应用 → 应用启动管理 → 本应用 → 改为手动管理",
                    "打开「允许自启动」「允许关联启动」「允许后台活动」三项",
                ),
        ),
        VendorGuide(
            vendor = "OPPO / 一加 / realme（ColorOS）",
            matchers = setOf("oppo", "oneplus", "realme"),
            steps =
                listOf(
                    "设置 → 应用管理 → 本应用 → 允许自启动、允许后台运行",
                    "耗电管理 → 允许后台高耗电",
                ),
        ),
        VendorGuide(
            vendor = "vivo / iQOO（OriginOS）",
            matchers = setOf("vivo", "iqoo"),
            steps =
                listOf(
                    "设置 → 应用管理 → 本应用 → 自启动打开",
                    "电池 → 后台耗电管理 → 允许后台高耗电",
                ),
        ),
        VendorGuide(
            vendor = "三星（One UI）",
            matchers = setOf("samsung"),
            steps =
                listOf(
                    "设置 → 电池 → 后台使用限制 → 把本应用从「休眠应用」移除",
                ),
        ),
        VendorGuide(
            vendor = "原生 Android / 其他品牌",
            matchers = emptySet(),
            steps =
                listOf(
                    "设置 → 应用 → 本应用 → 电池 → 不受限制",
                ),
        ),
    )
