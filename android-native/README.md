# XunyinNative（寻音 · Kotlin + SaltUI 原生壳）

本目录是 `docs/kotlin-saltui-migration-feasibility.md` §七 分批迁移方案中的 **B0 工程骨架**。
原 RN 工程（`android/`、`src/`）保持不动，作为对照与回退。

## 版本锁定（B0 构建实证，2026-10-24 全绿）

| 组件 | 版本 | 说明 |
|:--|:--|:--|
| Gradle | 9.3.1 | 腾讯镜像 distributionUrl |
| Android Gradle Plugin | 9.1.1 | AGP 9 内建 Kotlin（Iskra），不再应用 kotlin-android 插件 |
| Kotlin | 2.4.20 | 由 SaltUI POM 对齐要求；AGP 9.1.1 内建的 KSP 为 2.2.x 世代 |
| Compose 编译器插件 | `org.jetbrains.kotlin.plugin.compose` 2.4.20 | 与 Kotlin 同版，继续显式应用 |
| Compose Multiplatform | 1.12.2 | 由 SaltUI 传递依赖；androidx.compose 1.12.1 实际参与编译 |
| SaltUI | `io.github.moriafly:salt-ui:3.0.0-beta03` | Apache 2.0，beta 锁版 |
| ktlint 插件 | `org.jlleitschuh.gradle.ktlint` 12.2.0 + ktlint 1.5.0 | marker 组已核实为 `.gradle.ktlint` |
| activity-compose / core-ktx | 1.12.2 / 1.17.0 | androidx 官方 |
| JDK | 21（toolchain target 17） | 本机 Android Studio JBR |
| SDK | minSdk 26 / compileSdk 37 / targetSdk 36 | compileSdk 37 为 SaltUI 传递依赖（haze 2.0.1、androidx.compose 1.12.1）的 AAR metadata 硬性要求 |

## 关键决策记录

1. **不接 `salt-ui-navigation`**（B0）：其依赖 navigation3 alpha + kotlinx-serialization，
   风险不必要。自写 `NavStack`（语义对齐 SaltNavigator：重复导航 no-op、topLevel 重置、
   back/forward 双栈），配 9 个 JUnit 用例锁死。B5 批次再评估换回。
2. **applicationId = `cn.toside.music.mobile.native`**：与 RN 版 `cn.toside.music.mobile`
   双装并存，服务 B7 的双通道并行发布。namespace = `cn.toside.music.nativeapp`。
3. **竖屏锁定**（AGENTS.md）：`AndroidManifest.xml` `android:screenOrientation="portrait"`，
   Compose 侧无横屏分支。
4. **hiddenapibypass 坑**（评估文档 §五）：SaltUI 传递依赖
   `org.lsposed:hiddenapibypass`，发 Google Play 需关闭依赖信息上报——
   `dependenciesInfo.includeInApk/includeInBundle = false` 已在 `app/build.gradle.kts` 落实。
5. **release 不启 R8**（B0 降险）：beta 库混淆规则留 B7 收官批补齐。release 未签名
   （`app-release-unsigned.apk`），正式签名密钥待定（B0 决策遗留，见进度文档）。
6. **主题**：Activity 层用系统 `android:Theme.Material.NoActionBar` + values-night
   （不引入 com.google.android.material）；Compose 层 `SaltTheme(SaltConfigs.default(isDarkTheme = …))`
   跟随系统深浅色。主题偏好持久化待 B1 数据层。
7. **图标**：minSdk 26 仅需 `mipmap-anydpi-v26` 自适应图标；前景为 Material
   `music_note` 矢量（Apache 2.0），无任何 Salt Player 闭源资源。

## B0 构建期实证发现（后续批次必读）

- **AGP 9 的破坏性变更**：`org.jetbrains.kotlin.android` 插件在 AGP 9.0+ 被禁用
  （内建 Kotlin），必须从 plugins 块移除；compose 编译器插件仍需显式应用。
- **compileSdk 必须 37**：SaltUI 3.0.0-beta03 的传递依赖（haze 2.0.1、
  androidx.compose.* 1.12.1、core 1.19.1）AAR metadata 要求 compileSdk ≥ 37 且
  AGP ≥ 9.1.0。原计划的 AGP 8.13.2 + compileSdk 36 组合不可行，已实证。
- **SaltUI 的 Compose 依赖不向下游传递**（implementation 方式）：本工程直接 import 的
  androidx.compose 库（foundation/ui/runtime 等 1.12.1）需在 app 模块显式声明。
- **SaltUI 的 `Slider` 是 internal API**：公开 API 用 `ItemSlider`（含 text/sub 行内展示）。
- **仓库顺序**：SaltUI 根 jar（KMP 元数据包装）在阿里云 public 镜像缺失，
  Maven Central 必须排在依赖解析仓库前列（`settings.gradle.kts` 已按此配置）。
- **ktlint 对 `.gradle.kts` 强制 2 空格缩进**：用 `ktlintFormat` 一键修复。

## 构建

```bash
cd android-native
gradlew.bat test ktlintCheck assembleDebug assembleRelease   # Windows
./gradlew test ktlintCheck assembleDebug assembleRelease     # Linux/macOS/CI
```

需要 `local.properties` 指向 Android SDK（`sdk.dir`），JDK 21。

## B0 验收清单

- [x] Gradle/KMP/Kotlin 2.x + Compose 1.12 + SaltUI 3.0.0-beta03 依赖接入
- [x] SaltTheme 骨架页 + 竖屏锁定 MainActivity + 导航骨架
- [x] CI（GitHub Actions）：test + ktlint + assembleRelease + artifact
- [x] 单测骨架：NavStack 9 用例（9/9 通过）
- [x] 本地构建全绿：test + ktlintCheck + assembleDebug（16.1 MB）+ assembleRelease（12.0 MB unsigned）
- [ ] **真机装包**，SaltUI 组件渲染正常（Button/Text/ItemSlider/ItemSwitcher/Switcher/BasicScreen 抽查）——需真机
- [ ] CI 绿（首次 push 后验证）

## 已知问题 / 后续批次

- SaltUI 3.0.0-beta03 为 beta：API 可能变动，升级前盯 release notes（风险登记表）。
- `Item` 系列在无 `ItemOuter` 容器时观感朴素——功能不受影响，观感 B4 调优。
- `BasicScreen` 需 `@OptIn(UnstableSaltUiApi::class)`（已处理）。
- R8/混淆、release 签名、`ItemOuter` 容器化、`salt-ui-navigation` 评估：B4/B5/B7 处理。
