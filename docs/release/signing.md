# 签名钥匙记录（原生版 1.2.0）

> 更新于 2026-10-27。凭据本身**不在本文件**，也不入库。

## 一、结论：本版沿用 RN 分发钥匙

原生版与 RN 版**同包名**（`cn.toside.music.mobile`），因此必须用**同一把钥匙**签名才能覆盖升级、
用户数据目录（含旧歌单）才会保留。已核验：

| 项 | 值 |
|:--|:--|
| 分发钥匙文件 | `android/app/debug.keystore`（仓库内，RN 版一直在用） |
| 别名 | `androiddebugkey` |
| 证书 SHA-256 | `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C` |
| 证据 | GitHub `v1.2.0` 的 `xunyin-v1.2.0-arm64-v8a.apk` 证书同为该指纹（`CN=Android Debug`） |

**已知风险（必须记录在案）**：这把钥匙是 Android 默认 debug 钥匙，口令 `android`，且已随公开仓库分发。
任何人拿到它都能签出「同包名、同签名」的包，装到用户机器上会被当成正常升级。这是 RN 版自始就存在的
问题，本次沿用并不会让它变差，但也不应视为可接受的长期状态。

**换钥匙的代价**：一旦换钥匙，所有已装用户的升级路径断裂——必须卸载重装，数据全丢，
且自动迁移失效。因此换钥匙只有两个时机可选：
1. 换包名（如 `cn.toside.music.mobile.native`）重新开始，作为 2.0；
2. 接受一次性「导出 lxmc → 卸载 → 装新包 → 导入」的迁移仪式。

## 二、本次另建了一把正式钥匙（本版未使用）

用于将来若走「换包名」路线时直接接上：

| 项 | 值 |
|:--|:--|
| 文件 | `C:/Users/30913/.keystores/xunyin-native-release.jks`（仓库外） |
| 别名 | `xunyin-native` |
| 算法 | RSA 4096 / SHA384withRSA / 有效期 10000 天 |
| 证书 SHA-256 | `46:DD:94:62:AE:C9:1C:10:53:C5:F7:4E:D1:91:D8:03:98:60:15:4F:8A:19:45:0F:40:72:06:9C:B8:02:A9:7D` |
| 口令存放 | `android-native/keystore.properties`（已 gitignore），**不入库** |

> 该文件与口令请自行做两份离线备份（U 盘 + 密码管理器）。丢钥匙 = 将来换包名后再也发不了升级包。

## 三、本版实际使用的签名配置

`android-native/app/build.gradle.kts` 的 `signingConfigs.release` 从
`android-native/keystore.properties` 读取（该文件已 gitignore）：

```properties
storeFile=C:/Users/30913/Documents/ChatGPT/music/android/app/debug.keystore
storePassword=android
keyAlias=androiddebugkey
keyPassword=android
```

也可用环境变量 `XUNYIN_STORE_FILE` / `XUNYIN_STORE_PASSWORD` / `XUNYIN_KEY_ALIAS` /
`XUNYIN_KEY_PASSWORD` 覆盖（CI 用）。两者都没有时 release 仍会构建，但产出未签名包。

## 四、校验方法

```bash
"$JAVA" -jar "$SDK/build-tools/36.1.0/lib/apksigner.jar" verify --print-certs app-release.apk
# 期望：Signer #1 certificate SHA-256 digest: fac61745dc09...3b9c
```
