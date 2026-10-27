# 权限说明表（原生版 1.2.0）

> 以 `android-native/app/src/main/AndroidManifest.xml` 与 `aapt2 dump badging` 实测结果为准
> （2026-10-27，包名 `cn.toside.music.mobile`，versionCode 89005）。

## 一、权限清单

| 权限 | 授予方式 | 触发时机 | 用途 | 拒绝后果 |
|:--|:--|:--|:--|:--|
| `INTERNET` | 安装即授（普通权限） | 搜索、取播放直链、拉歌词与封面 | 唯一的上网权限，全部请求直连音源站点 | 无法搜索与播放线上歌曲 |
| `ACCESS_NETWORK_STATE` | 安装即授 | 播放前判断网络类型 | 由 Media3/AndroidX 依赖引入，用于判断是否可发起请求 | 无影响（仅降级判断能力） |
| `WAKE_LOCK` | 安装即授 | 播放期间 | 熄屏后保持 CPU 与解码不断流 | 熄屏易被系统挂起，播放中断 |
| `FOREGROUND_SERVICE` | 安装即授 | 播放中 / 开启桌面歌词 | 以前台服务身份运行，避免被后台清理 | 后台播放与桌面歌词不可用 |
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | 安装即授 | 播放中 | 播放器前台服务类型（Android 14+ 必需） | 无法创建播放前台服务 |
| `FOREGROUND_SERVICE_SPECIAL_USE` | 安装即授 | 开启桌面歌词 | 桌面歌词浮窗的前台身份，用途已在 Manifest 声明 `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` | 桌面歌词无法常驻 |
| `POST_NOTIFICATIONS` | 运行时询问（Android 13+） | 首次播放时 | 显示播放控制通知（含锁屏/通知栏控制） | 只能在前台播放，通知栏无控制项 |
| `SYSTEM_ALERT_WINDOW` | 需跳系统设置单独授权 | 设置里打开「桌面歌词」时 | 在其他应用上绘制歌词浮窗 | 桌面歌词不显示，其余功能不受影响 |
| `cn.toside.music.mobile.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | 应用自用（AndroidX 自动生成） | — | 限制动态广播只在本应用内传递 | 无影响 |

## 二、通过系统选择器访问、不申请权限的能力

| 能力 | 实现方式 | 说明 |
|:--|:--|:--|
| 导入 / 导出 `.lxmc`、`.json` 歌单 | SAF（`OpenDocument` / `CreateDocument`） | 只拿到用户当场选中的那一个文件，应用没有存储目录的常驻访问权 |
| 本地曲库 | SAF 目录授权（`OpenDocumentTree`） | 授权按用户选择的目录持久化，可随时在系统设置里撤销 |
| 保存分享卡到相册 | `MediaStore` | Android 10+ 免存储权限写相册 |
| 分享图片给其他应用 | `FileProvider`（只暴露 `cacheDir/share_cache`） | 一次性 URI 授权，其他应用拿不到别的路径 |

## 三、明确不申请的权限

`RECORD_AUDIO`（无听歌识曲）、`CAMERA`、`ACCESS_FINE_LOCATION`、`ACCESS_COARSE_LOCATION`、
`READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` / `READ_MEDIA_AUDIO`、`READ_CONTACTS`、
`READ_PHONE_STATE`、`QUERY_ALL_PACKAGES`、`REQUEST_INSTALL_PACKAGES`。

## 四、两个需要在发布说明里点明的行为

1. **`usesCleartextTraffic="true"`**：部分音源站点仅提供 http，故未禁用明文流量；
   应用不对这些请求做中间人加密保护，敏感数据（本应用不收集）不受影响。
2. **`allowBackup="true"`**：若用户开启了系统「自动备份」，歌单与设置可能被上传到其个人
   云备份空间（由系统与账号服务商执行，应用本身不上传任何数据）。卸载重装可由此恢复；
   不想被备份可在系统设置里对本应用关闭备份。
