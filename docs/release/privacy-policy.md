# 隐私政策

**应用名称**：寻音（原生版）　**包名**：`cn.toside.music.mobile`
**生效日期**：2026 年 10 月 27 日　**版本**：1.2.0

本政策适用于本应用（下称「本应用」）。请在使用前阅读；继续使用即表示你已理解本政策。
一句话概括：**本应用不收集你的个人信息，也没有任何统计、广告或崩溃上报 SDK；你的数据只存在你自己的设备上。**

---

## 一、我们不收集什么

本应用**没有**账号体系，**没有**接入任何统计分析、崩溃上报、广告或推送 SDK，具体而言：

- 不收集设备标识符（IMEI、Android ID、OAID、MAC 等）、位置、通讯录、短信、相册内容；
- 不采集你的播放记录用于任何上传或画像计算；
- 不上传你的歌单、设置、搜索历史；
- 不申请与本应用功能无关的权限（见《权限说明表》）。

## 二、本应用会在什么时候联网、和谁通信

本应用是「播放器 + 音源脚本运行时」：你在应用内搜索、播放、查看歌词或封面时，应用会
**直接**向对应音源站点发起网络请求。这些站点**不是**本应用运营方的服务器，而是各音乐平台的
公开接口或你导入的脚本所指定的地址。

在此过程中，对方站点会像对待任何浏览器请求一样，收到你的 **IP 地址、请求时间、请求内容**
（如关键词、歌曲 ID）以及应用默认的 User-Agent。这些信息由对方站点按其自身隐私政策处理，
本应用无法控制，也不留存副本。

## 三、自定义音源脚本

本应用支持导入用户自行编写或获取的音源脚本（JavaScript，运行于内置 QuickJS）。脚本拥有与
应用本身相近的网络访问能力，其请求目标、携带内容、是否上报数据，**由脚本作者决定，本应用
不做审计也无法代为保证**。请只导入你信任的来源；来源不明的脚本可能向你未预期的服务器发送
请求。

## 四、数据存在哪里

| 数据 | 存放位置 | 是否离开设备 |
|:--|:--|:--|
| 歌单、收藏、试听列表 | 应用私有目录（DataStore） | 否 |
| 设置项、主题、桌面歌词位置 | 同上 | 否 |
| 播放历史、播放次数 | 同上 | 否 |
| 歌词与封面缓存 | 应用缓存目录，可在设置里一键清理 | 否 |
| 旧版（RN 版）迁移过来的歌单 | 首次启动时从旧版应用私有目录一次性读取后写入本应用 | 否 |

卸载应用会删除上述全部数据。**若你开启了系统的「自动备份」**，歌单与设置可能由系统上传到你
自己的云备份空间（由系统与你的账号服务商执行，本应用不上传）；可在系统设置中对本应用关闭备份。

## 五、权限

本应用申请的权限及其用途、拒绝后的影响，逐条列在《权限说明表》（`docs/release/permissions.md`）。
摘要：网络（播放必需）、前台服务与通知（后台播放与通知栏控制）、悬浮窗（仅桌面歌词）、
存储访问全部走系统文件选择器（不申请存储权限）。

## 六、第三方内容与版权

本应用**不提供、不存储、不上传任何音频内容**，也不内置任何音源服务。所有音频均来自你配置的
音源脚本所指向的第三方站点，播放行为发生在你的设备与那些站点之间。请确保你所使用的音源与
内容符合当地法律法规及各平台的服务条款；因使用第三方音源产生的纠纷由使用者自行承担。

## 七、未成年人

本应用不面向未成年人单独提供服务，也不收集任何年龄信息。未成年人应在监护人指导下使用。

## 八、政策变更

本政策随版本更新。涉及收集范围变化的变更会在应用内更新说明与发布公告中提示；继续使用即视为接受
更新后的政策。

## 九、联系方式

- 问题与建议：<https://github.com/aniface-satar/xunyin/issues>
- 本政策全文随源码一同公开，可随时查阅历史版本。

---

### 英文摘要（English Summary）

This app does not collect personal data. It has no account system, no analytics, no crash
reporting and no ad SDK. When you search or play, the app connects **directly** to third-party
music sites you have configured; those sites receive your IP address and request content under
their own privacy policies. All playlists, settings and history stay in the app's private
storage on your device and are deleted on uninstall. User-imported JavaScript sources run with
the app's network capability, and their behaviour is determined by their authors.
