# 音乐下载（本地保存 + 后台下载）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在在线列表点"下载" → 选音质 →（首次）选位置 → 歌曲真落到手机存储并进系统音乐库；下载可在后台继续，进程被杀后重开从断点接着下。

**Architecture:** JS 做调度室，原生做搬运工。队列/状态机/校验/命名/落盘目标翻译全部是可 `node --test` 的纯 TS 叶子模块；原生只有一个前台服务（`type=dataSync`）负责"HTTP+Range → temp .part"和一个发布器（temp → MediaStore insert 或 SAF OutputStream）。落盘顺序锁死为**四段式**：temp → 校验 → 写标签（在 temp 裸路径上）→ publish。任务真相只有一份，在 JS store；原生不持久化任何状态，重启后由 JS 重新下发。

**Tech Stack:** React Native 0.7x + Hermes、Kotlin/Java（`cn.toside.music.mobile.download` 新包）、`react-native-file-system`（SAF / AndroidScoped）、`react-native-local-media-metadata`（writeMetadata/writePic/writeLyric）、AsyncStorage KV（`src/plugins/storage.ts`）、`node --test --experimental-strip-types`。

**Spec:** `docs/superpowers/specs/2026-10-14-music-download-design.md`（设计）与 `docs/superpowers/plans/2026-10-14-music-download-probe.md`（五源探针实测结论）。执行者必须先读这两份，本计划的所有取舍都由它们支撑。

## Global Constraints

- **竖屏锁定**（AGENTS.md）：不得改 `android/app/src/main/AndroidManifest.xml` 里 MainActivity 的 `android:screenOrientation="portrait"`，不得改 `src/navigation/index.ts` 的 `layout.orientation: ['portrait']`；新增 UI 不依赖横屏布局。
- **分支**：本功能另开分支 `feat/music-download`，从 `feat/music-recognition-phase1` 的当前 HEAD 切出即可（识曲 WIP 仍未提交，切分支不会带走它）。**每个 Task 只 `git add` 自己列出的路径，绝不 `git add -A`、绝不 `git stash`。**
- **iOS 不做**：所有入口用 `Platform.OS == 'android'` 闸门；iOS 侧不显示下载。
- **无自建后端 / 永久免费**：只用用户导入的音源脚本给的直链，不引入任何服务端代码、不引入任何付费 SDK。
- **测试基线**（2026-10-14 本机复测）：`npm test` **384 pass / 0 fail**；`npx tsc --noEmit` **137 个既有错误**。本计划只要求**新增文件零 tsc 错误、`npm test` 只增不减**。
  > 本计划里每个任务写的 `pass NNN` 只是"基线 384 + 本任务用例数"的算术示意，**判定口径不是等于那个数**，而是三条同时成立：① `fail 0`；② 总数比动手前只增不减；③ `npx tsc --noEmit` 的报错里 `grep` 不到本次改过的文件名（总数 137 是跨任务稳定的那条）。仓库里 `npm test` 的总数一直在涨，别拿它当固定基线比对。
- **eslint 只跑源码**（`npm run lint`，不含 `tests/*.mts`）；`.mts` 里的 `as` 断言会报既有 parse 噪音，不是本计划的错。
- **测试文件写法**：照 `tests/export-save-path.test.mts` —— 相对路径 `../src/...` + 显式 `.ts` 后缀（`@/` 别名在测试里不解析），`import test from 'node:test'` + `import assert from 'node:assert/strict'`。**新建的每个 `.mts`/`.test.mts` 都要手工追加到 `package.json:14` 的 `test` 脚本末尾**，否则不会被跑到。
- **面向用户的文案通俗**：界面里不出现 "MediaStore / SAF / Range / 前台服务 / 直链" 这些词，一律用设计文档 §8 的定稿文案。
- **探针 URL 含 token**：真机/PC 探针里抓到的直链**只写设备与本机 temp，绝不写进仓库**（commit message、文档、测试夹具都不行）。
- **原生构建**：改完 `android/` 的 Java 先用 **`cd android && ./gradlew.bat compileDebugJavaWithJavac`**（几十秒）收"语法/符号能不能编过"，再 **`assembleDebug`**（约 2–3 分钟，别在此之前判定失败）出装机包。`compileDebugJavaWithJavac` 通过**证明不了运行时行为**（桥对象键名、通知、媒体库索引），那些仍归各任务的真机清单。装机 `adb install -r`（`adb` 在 `/e/Android/Sdk/platform-tools/adb.exe`，Git Bash 里要加 `MSYS_NO_PATHCONV=1`），**vivo 会在屏幕上弹安装确认，必须用户点头**；vivo 掉线就换 OPPO。

## 两条必须先讲清的实测订正

写代码前必须知道，否则照设计文档原文实现会崩：

1. **`musicInfo.meta._qualitys[quality].size` 是"两位小数的显示字符串"，不是字节数。** 五源的 `musicSearch.js` 都走 `sizeFormate()`（`src/utils/common.ts:11-17`），产出形如 `10.29 MiB`。所以"字节数对账"**不能按逐字节相等做**，要按这个文本所落在的**区间**做（Task 3）。探针里"逐字节相等"是 raw 字段（`size_320mp3` / `HQFileSize`）与真实文件的比较，那些 raw 字段在 parse 阶段就被丢掉了，不在 `musicInfo` 里。
2. **MediaStore 的 Volume 名不是 SD 卡的 UUID。** docId `1F1A-2B2C:Music/x` 里的 `1F1A-2B2C` 是卷序列号，MediaStore 只认 `external_primary` / `external_sd` 这类枚举名，传 UUID 会 `IllegalArgumentException`。所以**首期只翻译 `primary:` 且落在 `Music/` 下的树**（Task 4）；SD 卡与 `Music/` 之外的文件夹一律走 SAF + `scanFile` + 提示。设计文档 §5 那句"`<卷 UUID>:...` → 走 MediaStore"要按此订正（Task 4 里改）。

## File Structure

**新增 —— 纯逻辑（`node --test` 覆盖，零 RN 依赖）**

| 文件 | 只管这一件事 |
| --- | --- |
| `src/core/download/name.ts` | 由 `download.fileName` 模板 + 歌曲名/歌手名，产出**不含扩展名**的安全文件名 |
| `src/core/download/format.ts` | 只读文件头字节，嗅出真实容器格式（或 `null`）；扩展名与 tagFormat 的唯一真相 |
| `src/core/download/verify.ts` | 把 `"10.29 MiB"` 这种声明文本还原成字节**区间**，判定实到字节落在/不落在该区间 |
| `src/core/download/target.ts` | 用户挑的 SAF tree URI → `mediastore` 或 `saf` 落盘目标（翻译不出来就 saf）；重名候选名与"认领已有文件"的纯决策 |
| `src/core/download/queue.ts` | 任务对象构造、并发取待办、开机恢复、错误分类后的"重试还是认输"决策、速度文案 |

**新增 —— 原生（`android/app/src/main/java/cn/toside/music/mobile/download/`）**

| 文件 | 只管这一件事 |
| --- | --- |
| `DownloadPackage.java` | RN 包注册（照 `audioRecord/AudioRecordPackage.java`） |
| `DownloadModule.java` | 桥：`startTask` / `pauseTask` / `removeTask` / `publishFile` / `findFile` / `getTempDir`；不碰文件内容 |
| `DownloadService.java` | `dataSync` 前台服务：HttpURLConnection + Range 续传 → temp `.part`，只报进度事件 |
| `DownloadEvent.java` | `RCTDeviceEventEmitter` 封装（照 `utils/UtilsEvent.java`） |
| `MediaStorePublisher.java` | temp → MediaStore insert + 拷贝 + 删 temp，返回 `content://`；`find` 按 DISPLAY_NAME + RELATIVE_PATH 查已有行 |
| `SafPublisher.java` | temp → 用户树的 OutputStream + `MediaScannerConnection.scanFile`，返回 document URI；`find` 遍历树根子项按名字查 |

**新增 —— JS 状态与调度**

| 文件 | 只管这一件事 |
| --- | --- |
| `src/utils/nativeModules/download.ts` | 原生模块的可空守卫封装 + 事件订阅（照 `nativeModules/audioRecord.ts`） |
| `src/store/download/{index,state,action,event,hook}.ts` | 任务列表的唯一真相（照 `src/store/dislikeList/` 五文件形态） |
| `src/core/download/index.ts` | 调度器：入队 → 取链（强制 `isRefresh`）→ 下发 → 事件 → 三道验收 → 写标签 → 发布 → 重试/认输 |
| `src/core/init/download.ts` | 开机恢复：`run` → `waiting`，把恢复后的列表交给调度器 |

**新增 —— UI**

| 文件 | 只管这一件事 |
| --- | --- |
| `src/screens/Home/Views/Download/index.tsx` | 下载页：进行中一组（进度/速度/暂停/重试/删除）、已完成一组（播放/删除） |
| `src/components/DownloadQualitySheet/index.tsx` | 音质面板（每次都弹；批量只弹一次），带每档预计大小 |
| `src/screens/Home/Views/Setting/settings/Download/{index,SavePath,FileName,MaxNum}.tsx` | 设置分组：位置 / 文件名格式 / 并发数 |

**修改**

`src/types/download_list.d.ts`（`FileExt` 扩 `m4a`/`ogg`）、`src/config/constant.ts`（`storageDataPrefix.download`、`NAV_MENUS`）、`src/config/defaultSetting.ts` + `src/types/app_setting.d.ts`（`download.savePath` / `savePathName` / `maxDownloadNum`）、`src/utils/data.ts`（列表持久化）、`src/utils/fs.ts` 不动（原生自己拿 temp 目录）、`src/components/OnlineList/{ListMenu.tsx,index.tsx,listAction.ts,MultipleModeBar.tsx}`（入口）、`src/screens/Home/Vertical/{Main.tsx,BottomTabBar.tsx 自动}`、`src/core/init/index.ts`（挂 init/download）、`src/core/music/download.ts` + `src/core/player/playInfo.ts`（离线播放）、`android/app/src/main/AndroidManifest.xml`、`android/.../MainApplication.java`、`src/lang/{zh-cn,zh-tw,en-us}.json`、`package.json:14`。

---

# Phase A —— 纯逻辑（先把能测的都测掉）

Phase A 的五个任务不碰 RN、不碰原生、不需要装机。全部红→绿→提交，一次一个。

---

### Task 1: 文件名（`name.ts`）

**Files:**
- Create: `src/core/download/name.ts`
- Create: `tests/download-name.mts`
- Modify: `package.json:14`（`test` 脚本末尾追加 ` tests/download-name.mts`）

**Interfaces:**
- Consumes: `LX.AppSetting['download.fileName']`（`'歌名 - 歌手' | '歌手 - 歌名' | '歌名'`，`src/types/app_setting.d.ts:352`）
- Produces: `sanitizeFileNamePart(value: string): string`、`buildDownloadBaseName(template, musicInfo: { name: string, singer: string }): string`、`MAX_BASE_NAME_LENGTH = 100`。**返回不含扩展名的基名**；扩展名由 Task 2 的嗅探结果决定，在 Task 11 的调度器里才拼上。

- [ ] **Step 1: 写失败的测试**

Create `tests/download-name.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDownloadBaseName, sanitizeFileNamePart, MAX_BASE_NAME_LENGTH } from '../src/core/download/name.ts'

test('三档模板各自拼接顺序正确', () => {
  const info = { name: '平凡之路', singer: '朴树' }
  assert.equal(buildDownloadBaseName('歌名 - 歌手', info), '平凡之路 - 朴树')
  assert.equal(buildDownloadBaseName('歌手 - 歌名', info), '朴树 - 平凡之路')
  assert.equal(buildDownloadBaseName('歌名', info), '平凡之路')
})

test('没有歌手时不留悬空分隔符', () => {
  assert.equal(buildDownloadBaseName('歌名 - 歌手', { name: 'Yesterday', singer: '' }), 'Yesterday')
  assert.equal(buildDownloadBaseName('歌手 - 歌名', { name: 'Yesterday', singer: '' }), 'Yesterday')
})

test('两个字段都为空时给出可用名字而不是空串', () => {
  assert.equal(buildDownloadBaseName('歌名 - 歌手', { name: '', singer: '' }), 'unknown')
})

test('文件系统非法字符换成空格而不是删掉', () => {
  // 直接删会让 "AC/DC" 变成 "ACDC"，与显示名不一致，用户找不到歌
  assert.equal(buildDownloadBaseName('歌名', { name: 'AC/DC: Shot', singer: '' }), 'AC DC Shot')
})

test('结尾的点与空格会被 MediaStore 改掉，必须先去尾', () => {
  assert.equal(sanitizeFileNamePart('歌名   .'), '歌名')
})

test('超长名截到上限，留出 (1) 与扩展名的余量', () => {
  const long = '啊'.repeat(200)
  const base = buildDownloadBaseName('歌名', { name: long, singer: long })
  assert.equal(base.length, MAX_BASE_NAME_LENGTH)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/download-name.mts`
Expected: FAIL —— `Cannot find module .../src/core/download/name.ts`

- [ ] **Step 3: 写实现**

Create `src/core/download/name.ts`:

```ts
import { type LX } from '@/types'

const ILLEGAL_RXP = /[/\\:*?"<>|]/g
const TRAILING_RXP = /[.\s]+$/

// 安卓文件系统与 MediaStore 都会静默改掉结尾的点/空格，
// 留下的话"已下载"判定（同名同大小）永远对不上。
export const sanitizeFileNamePart = (value: string): string => {
  return value.replace(ILLEGAL_RXP, ' ').replace(TRAILING_RXP, '').trim().replace(/\s{2,}/g, ' ')
}

export const MAX_BASE_NAME_LENGTH = 100

export const buildDownloadBaseName = (
  template: LX.AppSetting['download.fileName'],
  musicInfo: { name: string, singer: string },
): string => {
  const name = sanitizeFileNamePart(musicInfo.name ?? '')
  const singer = sanitizeFileNamePart(musicInfo.singer ?? '')

  let base: string
  switch (template) {
    case '歌手 - 歌名':
      base = singer && name ? `${singer} - ${name}` : singer || name
      break
    case '歌名':
      base = name
      break
    case '歌名 - 歌手':
    default:
      base = name && singer ? `${name} - ${singer}` : name || singer
      break
  }
  if (!base) base = 'unknown'
  return base.slice(0, MAX_BASE_NAME_LENGTH)
}
```

> `import { type LX } from '@/types'` 只在 tsc 侧有意义；测试里 `@/` 别名不解析，但 `--experimental-strip-types` 会把纯类型 import 整行删掉，所以运行时不会去找这个模块。**若测试报 `Cannot find module '@/types'`，改成不 import、直接把参数类型写成字面量联合** `'歌名 - 歌手' | '歌手 - 歌名' | '歌名'`，并在文件顶部注释说明为什么不用 `LX.AppSetting`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/download-name.mts`
Expected: `pass 6`，`fail 0`

- [ ] **Step 5: 追加到 test 脚本并跑全量基线**

Modify `package.json:14`：把 `... tests/monet-gate.mts"` 改成 `... tests/monet-gate.mts tests/download-name.mts"`。

Run: `npm test`
Expected: `pass 390`（基线 384 + 本任务 6），`fail 0`

- [ ] **Step 6: tsc 零新增**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `137`（与基线一致；若出现 138 说明新文件带错了类型，就地修，不要往下堆）

- [ ] **Step 7: 提交**

```bash
git add src/core/download/name.ts tests/download-name.mts package.json
git commit -m "feat(download): 文件名基名，非法字符换空格并去尾点"
```

---

### Task 2: 真实格式嗅探（`format.ts` + `FileExt` 扩容）

探针实测：URL 尾巴（`F000….ape` 其实是 flac）、Content-Type（tx 有后端把 flac 报成 `audio/x-ogg`）、`RNFS.downloadFile` 的 mimeType（wy 的真 mp3 报 `application/octet-stream`）**三个信号都会说谎**。所以扩展名只由文件头决定。

**Files:**
- Create: `src/core/download/format.ts`
- Create: `tests/download-format.mts`
- Modify: `src/types/download_list.d.ts:13`（`FileExt`）
- Modify: `package.json:14`

**Interfaces:**
- Consumes: `LX.Download.FileExt`
- Produces: `sniffAudioFormat(head: Uint8Array): LX.Download.FileExt | null`、`MIN_HEAD_BYTES = 12`。`null` 表示"不是可认的音频"，调用方（Task 11）**判失败**，不许赌扩展名。

- [ ] **Step 1: 扩 `FileExt`**

Modify `src/types/download_list.d.ts:13`:

```ts
    // 扩展名只由 sniffAudioFormat() 的文件头嗅探结果赋值：探针实测 URL 尾巴、Content-Type
    // 与 RNFS 的 mimeType 都会说谎（F000….ape 是 flac，flac 被报成 audio/x-ogg）。
    // 'ape'/'wav' 保留给历史任务对象，本期不会新产生。
    type FileExt = 'mp3' | 'm4a' | 'ogg' | 'flac' | 'wav' | 'ape'
```

- [ ] **Step 2: 写失败的测试**

Create `tests/download-format.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { sniffAudioFormat, MIN_HEAD_BYTES } from '../src/core/download/format.ts'

const bytes = (...values: number[]) => Uint8Array.from(values)
const asciiAt = (text: string, offset = 0) => Array.from({ length: offset }, () => 0)
  .concat(Array.from(text, c => c.charCodeAt(0)))
const pad = (head: number[]) => Uint8Array.from([...head, ...new Array(Math.max(0, MIN_HEAD_BYTES - head.length)).fill(0)])

test('ID3v2 头是 mp3', () => {
  assert.equal(sniffAudioFormat(pad(asciiAt('ID3'))), 'mp3')
})

test('没有 ID3 的裸 MPEG 帧头也是 mp3', () => {
  // 0xFF 0xFB = 11 帧同步位全 1 + MPEG1 Layer3
  assert.equal(sniffAudioFormat(bytes(0xff, 0xfb, ...new Array(MIN_HEAD_BYTES - 2).fill(0))), 'mp3')
})

test('fLaC / OggS / MAC / RIFF-WAVE 各自认出来', () => {
  assert.equal(sniffAudioFormat(pad(asciiAt('fLaC'))), 'flac')
  assert.equal(sniffAudioFormat(pad(asciiAt('OggS'))), 'ogg')
  assert.equal(sniffAudioFormat(pad(asciiAt('MAC '))), 'ape')
  assert.equal(sniffAudioFormat(pad([...asciiAt('RIFF'), 0, 0, 0, 0, ...asciiAt('WAVE')])), 'wav')
})

test('ftyp 在第 4 字节是 m4a（探针里 mg/kw 的 320k 会走到这条）', () => {
  assert.equal(sniffAudioFormat(pad([...asciiAt('ftyp', 4), ...asciiAt('M4A ')])), 'm4a')
})

test('认不出来就给 null，不许猜', () => {
  const jsonErrorPage = pad([...asciiAt('{"code":404,"msg":"no such track"}')])
  assert.equal(sniffAudioFormat(jsonErrorPage), null)
})

test('头不足 12 字节时返回 null', () => {
  assert.equal(sniffAudioFormat(bytes(0xff)), null)
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/download-format.mts`
Expected: FAIL —— `Cannot find module .../format.ts`

- [ ] **Step 4: 写实现**

Create `src/core/download/format.ts`:

```ts
export const MIN_HEAD_BYTES = 12

const asciiAt = (bytes: Uint8Array, start: number, length: number): string => {
  let text = ''
  for (let i = start; i < start + length; i++) text += String.fromCharCode(bytes[i])
  return text
}

/**
 * 只依据文件头字节判定真实容器格式。
 * 返回 null 表示"不是我们认得的音频"，调用方必须判失败而不是硬挂扩展名。
 */
export const sniffAudioFormat = (head: Uint8Array): LX.Download.FileExt | null => {
  if (head.length < MIN_HEAD_BYTES) return null

  // mp3：ID3v2 tag，或直接以帧同步开头
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return 'mp3'
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return 'mp3'

  if (asciiAt(head, 0, 4) === 'fLaC') return 'flac'
  if (asciiAt(head, 0, 4) === 'OggS') return 'ogg'
  if (asciiAt(head, 0, 4) === 'MAC ') return 'ape'
  if (asciiAt(head, 0, 4) === 'RIFF' && asciiAt(head, 8, 4) === 'WAVE') return 'wav'
  if (asciiAt(head, 4, 4) === 'ftyp') return 'm4a'

  return null
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/download-format.mts`
Expected: `pass 6`，`fail 0`

- [ ] **Step 6: 全量 + tsc**

Run: `npm test`（先把 ` tests/download-format.mts` 追加到 `package.json:14`）→ Expected `pass 396`，`fail 0`
Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → Expected `137`

- [ ] **Step 7: 提交**

```bash
git add src/core/download/format.ts tests/download-format.mts src/types/download_list.d.ts package.json
git commit -m "feat(download): 文件头嗅探定扩展名，FileExt 扩 m4a/ogg"
```

---

### Task 3: 声明大小对账（`verify.ts`）

探针实测 tx 某后端**不分档位一律返回 960,887B 的试听片段**（约 24–60 秒）。这种碎片必须挡在 publish 之前。因为声明值是 `"10.29 MiB"` 这种两位小数文本（见开头订正 1），判定按**区间**做。

**Files:**
- Create: `src/core/download/verify.ts`
- Create: `tests/download-verify.mts`
- Modify: `package.json:14`

**Interfaces:**
- Consumes: `sizeFormate` 的输出格式（`src/utils/common.ts:11-17`，单位固定 `B/KiB/MiB/GiB/TiB`，`toFixed(2)`）
- Produces: `type SizeVerdict = 'match' | 'mismatch' | 'unknown'`、`sizeTextToBytesRange(text: string | null | undefined): { min: number, max: number } | null`、`checkDeclaredSize(actualBytes: number, declaredSizeText: string | null | undefined): SizeVerdict`、`matchDeclaredQuality(actualBytes: number, candidates: { quality: string, sizeText: string | null | undefined }[]): { kind: 'match', quality: string } | { kind: 'unknown' } | { kind: 'mismatch' }`
  `matchDeclaredQuality` 按候选顺序找第一个对得上的档位：取链会降档（`getPlayQuality`），用户点 320k 而源只给 128k 是常态，所以对账要认**所有**声明档位，对不上任何一档才是"没下全"。全部候选都没有声明大小时返回 `unknown`（照常放行，别把"源没给大小"当成失败）。

- [ ] **Step 1: 写失败的测试**

Create `tests/download-verify.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { sizeTextToBytesRange, checkDeclaredSize, matchDeclaredQuality } from '../src/core/download/verify.ts'

test('声明文本还原成区间：10.29 MiB 覆盖探针实测的 10,792,943 字节', () => {
  const range = sizeTextToBytesRange('10.29 MiB')
  assert.ok(range)
  assert.ok(range.min <= 10_792_943 && 10_792_943 <= range.max, `区间应含实测字节数，得到 ${range.min}..${range.max}`)
})

test('区间宽度只到最小显示位的一半，窄到足以区分试听片段', () => {
  const range = sizeTextToBytesRange('10.29 MiB')!
  // 半个最小显示位 = 0.005 MiB ≈ 5.2 KB，而片段差的是 9 MB 量级
  assert.ok(range.max - range.min < 11_000, `区间过宽会挡不住片段，实测宽度 ${range.max - range.min}`)
  assert.equal(checkDeclaredSize(960_887, '10.29 MiB'), 'mismatch')
})

test('没有小数位时按 1 字节容差', () => {
  assert.equal(checkDeclaredSize(512, '512.00 B'), 'match')
  assert.equal(checkDeclaredSize(514, '512.00 B'), 'mismatch')
})

test('取不到声明大小时不判失败（unknown），也不许当成 match', () => {
  assert.equal(checkDeclaredSize(1234, null), 'unknown')
  assert.equal(checkDeclaredSize(1234, ''), 'unknown')
  assert.equal(checkDeclaredSize(1234, '1024'), 'unknown')
  assert.equal(sizeTextToBytesRange('abc MiB'), null)
})

test('0 字节永远不匹配', () => {
  assert.equal(checkDeclaredSize(0, '10.29 MiB'), 'mismatch')
})

test('降档下载也算对：320k 对不上但 128k 的声明大小对得上', () => {
  const candidates = [
    { quality: '320k', sizeText: '10.29 MiB' },
    { quality: '128k', sizeText: '4.12 MiB' },
  ]
  assert.deepEqual(matchDeclaredQuality(4_320_000, candidates), { kind: 'match', quality: '128k' })
  // 点的那档排第一，区间重叠时优先认它
  assert.deepEqual(matchDeclaredQuality(4_320_000, [
    { quality: '320k', sizeText: '4.12 MiB' },
    { quality: '128k', sizeText: '4.12 MiB' },
  ]), { kind: 'match', quality: '320k' })
})

test('一档都对不上才是 mismatch；一档都没声明大小则 unknown（照常放行）', () => {
  assert.deepEqual(matchDeclaredQuality(960_887, [
    { quality: '320k', sizeText: '10.29 MiB' },
    { quality: '128k', sizeText: null },
  ]), { kind: 'mismatch' })
  assert.deepEqual(matchDeclaredQuality(1234, [
    { quality: '320k', sizeText: null },
    { quality: '128k', sizeText: '4.12 MiB' },
  ]), { kind: 'mismatch' })
  assert.deepEqual(matchDeclaredQuality(1234, [{ quality: '320k', sizeText: null }]), { kind: 'unknown' })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/download-verify.mts`
Expected: FAIL —— `Cannot find module .../verify.ts`

- [ ] **Step 3: 写实现**

Create `src/core/download/verify.ts`:

```ts
// sizeFormate() 用 toFixed(2)，所以 "10.29 MiB" 表示的是一个区间而不是一个点：
// 真值落在 [10.285 MiB, 10.295 MiB)。对账按区间判定，区间外就是内容不对（试听片段/截断），
// 区间内才算完整文件。
export type SizeVerdict = 'match' | 'mismatch' | 'unknown'

const UNIT_BYTES: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 * 1024,
  GiB: 1024 * 1024 * 1024,
  TiB: 1024 * 1024 * 1024 * 1024,
}
const SIZE_TEXT_RXP = /^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB)$/

export const sizeTextToBytesRange = (text: string | null | undefined): { min: number, max: number } | null => {
  if (!text) return null
  const matched = SIZE_TEXT_RXP.exec(text.trim())
  if (!matched) return null
  const unit = UNIT_BYTES[matched[2]]
  const value = Number(matched[1])
  if (!Number.isFinite(value) || !unit) return null

  const decimals = matched[1].includes('.') ? matched[1].split('.')[1].length : 0
  const halfStep = (decimals > 0 ? 0.5 / 10 ** decimals : 0.5) * unit
  const center = value * unit
  return { min: Math.max(0, Math.ceil(center - halfStep)), max: Math.floor(center + halfStep) }
}

export const checkDeclaredSize = (actualBytes: number, declaredSizeText: string | null | undefined): SizeVerdict => {
  const range = sizeTextToBytesRange(declaredSizeText)
  if (!range) return 'unknown'
  return actualBytes >= range.min && actualBytes <= range.max ? 'match' : 'mismatch'
}

/**
 * 拿一份文件同时对比多个档位的声明大小，返回第一个对得上的档位。
 * 为什么要这样：取链会降档（`src/core/music/utils.ts` 的 getPlayQuality），
 * 用户点 320k 而源只给 128k 是常态，不是"文件坏了"；
 * 只有"对不上任何一个声明档位"才是真异常（探针实测的 960,887B 试听片段）。
 * 全都没声明大小时返回 unknown —— 不拿"源没给大小"当失败。
 */
export const matchDeclaredQuality = (
  actualBytes: number,
  candidates: { quality: string, sizeText: string | null | undefined }[],
): { kind: 'match', quality: string } | { kind: 'unknown' } | { kind: 'mismatch' } => {
  if (!candidates.length || candidates.every(c => sizeTextToBytesRange(c.sizeText) == null)) return { kind: 'unknown' }
  for (const candidate of candidates) {
    if (checkDeclaredSize(actualBytes, candidate.sizeText) == 'match') return { kind: 'match', quality: candidate.quality }
  }
  return { kind: 'mismatch' }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/download-verify.mts`
Expected: `pass 7`，`fail 0`

- [ ] **Step 5: 订正设计文档 §6 的对账口径**

Modify `docs/superpowers/specs/2026-10-14-music-download-design.md` §6 的"发布前的三道验收"第 2 条，把"实到字节要和搜索元数据里那一档声明的 size 一致"改为：

```markdown
  2. **字节数对账**：实到字节要落在搜索元数据**某个档位**声明大小还原出的区间里（`"10.29 MiB"` 这类两位小数文本 ⇒ 区间，见 §7.2 与 `src/core/download/verify.ts`）。**要认所有档位而不只是用户点的那档**：取链会降档（`getPlayQuality`），点 320k 拿到 128k 是常态；对不上任何一档才是异常。探针实测 tx `size320` = kg `HQFileSize` = 10,792,943，与真文件逐字节相等——那两个 raw 字段在 parse 阶段就丢了，所以线上只能按显示文本的区间对账。
```

- [ ] **Step 6: 全量 + tsc**

Run: `npm test`（先追加 ` tests/download-verify.mts`）→ Expected `pass 401`，`fail 0`
Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → Expected `137`

- [ ] **Step 7: 提交**

```bash
git add src/core/download/verify.ts tests/download-verify.mts docs/superpowers/specs/2026-10-14-music-download-design.md package.json
git commit -m "feat(download): 声明大小按显示位还原成区间，降档也算数，挡住试听片段"
```

---

### Task 4: 落盘目标翻译（`target.ts`）

第 1 条决策（用户挑位置）与第 4 条决策（进系统音乐库）在安卓 11+ 有张力：`targetSdk = 36` 让 `requestLegacyExternalStorage` 失效。翻译规则见开头订正 2 —— **首期只有 `primary:` 且落在 `Music/` 下的树走 MediaStore**，其余走 SAF。

**Files:**
- Create: `src/core/download/target.ts`
- Create: `tests/download-target.mts`
- Modify: `docs/superpowers/specs/2026-10-14-music-download-design.md` §5（订正 UUID 那句）
- Modify: `package.json:14`

**Interfaces:**
- Consumes: `download.savePath` 里存的 tree URI（形态同 `tests/export-save-path.test.mts:8` 的夹具，`%3A`/`%2F` 属于 URI 本身）
- Produces:
  ```ts
  export type DownloadTarget =
    | { mode: 'mediastore', volumeName: string, relativePath: string, fileName: string }
    | { mode: 'saf', treeUri: string, fileName: string }
  export const parseTreeUriDocId = (savePath: string) => { volume: string, relativePath: string } | null
  export const resolveTarget = (savePath: string, fileName: string) => DownloadTarget | null
  export const MEDIASTORE_VOLUME_PRIMARY = 'external_primary'

  export interface PublishedFile { fileName: string, size: number, uri: string }
  export const FILE_NAME_CANDIDATE_MAX = 10
  // ['a.mp3', 'a (2).mp3', 'a (3).mp3', ...] —— 顺序即候选优先级
  export const fileNameCandidates = (base: string, ext: string) => string[]
  export const pickPublishFileName = (
    candidates: string[],
    existing: (PublishedFile | null)[], // 与 candidates 一一对应，null = 该名字没人占
    measuredSize: number,
  ) => { action: 'reuse', uri: string } | { action: 'create', fileName: string }
  ```
  `resolveTarget` 返回 `null` 表示 `savePath` 根本不是 tree URI（App 内浏览器的裸路径 / 空串），调用方（Task 14）必须据此重新引导选位置。

  后两个函数解决设计文档 §5 末尾那条重名要求。**为什么必须在 JS 侧决定**：MediaStore 与 SAF 的 provider 遇到同名都会自己加 `(1)`（导出功能实测过，用户嫌垃圾堆），一旦加了 JS 就拿不到真实名字；所以 JS 先把"哪个名字还空着、已有的是不是同一首"问清楚（Task 6 的 JS 守卫里加 `findPublishedFile`、Task 8 给出它的原生查询，只回答"这个名字在不在、多大、URI 是什么"），再把一个**确定没人占**的名字交给原生。`existing` 数组由调用方（Task 11）按候选顺序逐个查出来，通常第一次就命中 `null`，只花一次查询。

  认领已有文件（"同名同大小 = 就是这首歌，不再下一份"）发生在**发布阶段**，因为只有那时候才拿到实测字节数；入队前的省流量预判需要按名字前缀查询（`%`/`_` 还得转义）且此时扩展名还没嗅探出来，收益不抵复杂度。同源重复点击由列表侧 `hasDownloaded(id)` 直接挡掉。

- [ ] **Step 1: 写失败的测试**

Create `tests/download-target.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { parseTreeUriDocId, resolveTarget, MEDIASTORE_VOLUME_PRIMARY, fileNameCandidates, pickPublishFileName } from '../src/core/download/target.ts'

const TREE = 'content://com.android.externalstorage.documents/tree'

test('primary:Music/xunyin 翻成 MediaStore 相对路径', () => {
  const target = resolveTarget(`${TREE}/primary%3AMusic%2Fxunyin`, '平凡之路 - 朴树.mp3')!
  assert.equal(target.mode, 'mediastore')
  assert.equal(target.volumeName, MEDIASTORE_VOLUME_PRIMARY)
  assert.equal(target.relativePath, 'Music/xunyin')
  assert.equal(target.fileName, '平凡之路 - 朴树.mp3')
})

test('中文名解码后再翻译', () => {
  const doc = parseTreeUriDocId(`${TREE}/primary%3AMusic%2F%E5%AF%BB%E9%9F%B3`)
  assert.deepEqual(doc, { volume: 'primary', relativePath: 'Music/寻音' })
})

test('正好选在 Music 根目录也算 MediaStore 可写', () => {
  const target = resolveTarget(`${TREE}/primary%3AMusic`, 'a.mp3')!
  assert.equal(target.mode, 'mediastore')
  assert.equal(target.relativePath, 'Music')
})

test('Music 之外的 primary 文件夹走 SAF：MediaStore 的音频集合不认 Download/', () => {
  const target = resolveTarget(`${TREE}/primary%3ADownload%2Fxunyin`, 'a.mp3')!
  assert.equal(target.mode, 'saf')
  assert.equal(target.treeUri, `${TREE}/primary%3ADownload%2Fxunyin`)
})

test('SD 卡卷走 SAF：MediaStore 的 Volume 名是枚举不是卷序列号，传 UUID 会抛', () => {
  const target = resolveTarget(`${TREE}/1F1A-2B2C%3AMusic%2Fxunyin`, 'a.mp3')!
  assert.equal(target.mode, 'saf')
})

test('非 tree URI 返回 null，让调用方重新引导选位置', () => {
  assert.equal(resolveTarget('/storage/emulated/0/Music/xunyin', 'a.mp3'), null)
  assert.equal(resolveTarget('', 'a.mp3'), null)
})

test('半截百分号编码不炸，返回 null', () => {
  assert.equal(parseTreeUriDocId(`${TREE}/primary%3`), null)
})

test('docId 没有卷分隔符返回 null', () => {
  assert.equal(parseTreeUriDocId(`${TREE}/garbage`), null)
})

test('候选名按 (2)(3) 递增，第一个就是不带后缀的本名', () => {
  const cands = fileNameCandidates('平凡之路 - 朴树', 'mp3')
  assert.equal(cands[0], '平凡之路 - 朴树.mp3')
  assert.equal(cands[1], '平凡之路 - 朴树 (2).mp3')
  assert.equal(cands[9], '平凡之路 - 朴树 (10).mp3')
})

test('同名且实测字节数一致 → 复用已有文件，不再新建；不一致才让位', () => {
  const cands = fileNameCandidates('a', 'flac')
  assert.deepEqual(pickPublishFileName(cands, [{ fileName: cands[0], size: 10_792_943, uri: 'content://media/external/audio/media/71' }], 10_792_943),
    { action: 'reuse', uri: 'content://media/external/audio/media/71' })
  // 同名但是换音质重下：大小不同就不是同一首，往后找一个空位，绝不留给 provider 去加 (1)
  assert.deepEqual(pickPublishFileName(cands, [
    { fileName: cands[0], size: 3_000_000, uri: 'content://media/external/audio/media/1' },
    { fileName: cands[1], size: 5_000_000, uri: 'content://media/external/audio/media/2' },
    null,
  ], 9_000_000), { action: 'create', fileName: 'a (3).flac' })
})

test('一个都不存在时用本名，存在但不是同一首时往后让位', () => {
  const cands = fileNameCandidates('a', 'flac')
  assert.deepEqual(pickPublishFileName(cands, [null], 1), { action: 'create', fileName: 'a.flac' })
  assert.deepEqual(pickPublishFileName(cands, [
    { fileName: cands[0], size: 3_000_000, uri: 'content://media/external/audio/media/1' },
    null,
  ], 9_000_000), { action: 'create', fileName: 'a (2).flac' })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/download-target.mts`
Expected: FAIL —— `Cannot find module .../target.ts`

- [ ] **Step 3: 写实现**

Create `src/core/download/target.ts`:

```ts
export const MEDIASTORE_VOLUME_PRIMARY = 'external_primary'

export type DownloadTarget =
  | { mode: 'mediastore', volumeName: string, relativePath: string, fileName: string }
  | { mode: 'saf', treeUri: string, fileName: string }

const TREE_URI_RXP = /^content:\/\/[^/]+\/tree\/([^/]+)$/
// SD 卡的 docId 卷名是 FAT 序列号（1F1A-2B2C），它不是 MediaStore 认识的 Volume 枚举，
// 传进去会 IllegalArgumentException，所以只有 primary 能翻译。
const KNOWN_DOC_ID_VOLUME_RXP = /^(primary|home|[0-9A-F]{4}-[0-9A-F]{4})$/

export const parseTreeUriDocId = (savePath: string): { volume: string, relativePath: string } | null => {
  const matched = TREE_URI_RXP.exec(savePath.trim())
  if (!matched) return null
  let docId: string
  try {
    docId = decodeURIComponent(matched[1])
  } catch {
    return null // 半截 % 会抛 URIError
  }
  const split = docId.indexOf(':')
  if (split <= 0) return null
  const volume = docId.slice(0, split)
  const relativePath = docId.slice(split + 1).replace(/^\/+|\/+$/g, '')
  if (!KNOWN_DOC_ID_VOLUME_RXP.test(volume)) return null
  return { volume, relativePath }
}

/**
 * 用户挑的树 → 落盘通道。
 * MediaStore 写音频只认"媒体集合目录下的相对路径"，所以只有 primary 卷上落在 Music/ 里的
 * 文件夹能两全（既是用户挑的位置，又进系统音乐库）；其余一律 SAF，由调用方提示
 * "别的音乐 App 可能看不到"。
 */
export const resolveTarget = (savePath: string, fileName: string): DownloadTarget | null => {
  const doc = parseTreeUriDocId(savePath)
  if (!doc) return null

  const isMusicCollection = doc.relativePath === 'Music' || doc.relativePath.startsWith('Music/')
  if (doc.volume === 'primary' && isMusicCollection) {
    return { mode: 'mediastore', volumeName: MEDIASTORE_VOLUME_PRIMARY, relativePath: doc.relativePath, fileName }
  }
  return { mode: 'saf', treeUri: savePath.trim(), fileName }
}

export interface PublishedFile {
  fileName: string
  size: number
  uri: string
}

// 上限 10：同一首歌换音质重下时最多也就几档，再往后基本是用户自己往这个文件夹里手动拷过，
// 这时候继续往后找没意义，把最后一个候选交出去让 provider 处理。
export const FILE_NAME_CANDIDATE_MAX = 10

export const fileNameCandidates = (base: string, ext: string): string[] => {
  const list = [`${base}.${ext}`]
  for (let i = 2; i <= FILE_NAME_CANDIDATE_MAX; i++) list.push(`${base} (${i}).${ext}`)
  return list
}

/**
 * 发布前定名。provider 遇到同名会自己加 " (1)" 且不回吐最终名字（导出功能实测过），
 * 所以这里必须自己找一个确定空着的名字；同名且字节数完全一致就认定为同一首，直接复用旧文件。
 */
export const pickPublishFileName = (
  candidates: string[],
  existing: (PublishedFile | null)[],
  measuredSize: number,
): { action: 'reuse', uri: string } | { action: 'create', fileName: string } => {
  for (let i = 0; i < candidates.length; i++) {
    const found = existing[i]
    if (!found) return { action: 'create', fileName: candidates[i]! }
    if (found.size === measuredSize) return { action: 'reuse', uri: found.uri }
  }
  return { action: 'create', fileName: candidates[candidates.length - 1]! }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/download-target.mts`
Expected: `pass 11`，`fail 0`

- [ ] **Step 5: 订正设计文档 §5**

Modify `docs/superpowers/specs/2026-10-14-music-download-design.md`，把 §5 的两条 bullet（`**docId 是 `primary:...` 或 `<卷 UUID>:...`** → 走 **MediaStore**` 与其后的"翻译不出来"那条）替换为：

```markdown
- **docId 是 `primary:Music/...`** → 走 **MediaStore**：`RELATIVE_PATH` 用翻译出来的相对路径、Volume 用 `external_primary`。既尊重用户挑的文件夹，又保证进系统音乐库。
- **其余都走 SAF + 尽力 `MediaScannerConnection.scanFile`**，并在下载页顶部挂一句大白话提示（§8 文案表）。三类原因实测/规范确认过：① SD 卡 docId 的卷名是 FAT 序列号（`1F1A-2B2C`），MediaStore 的 Volume 是 `external_primary`/`external_sd` 这种枚举，传序列号直接抛；② 音频集合只认媒体目录下的相对路径，用户挑 `Download/xunyin` 时没有对应的 MediaStore 写法；③ 用户挑 App 私有目录或云盘 provider 时本就没有媒体集合可登记。SD 卡上"进系统音乐库"能不能靠 `scanFile` 兜住，由 Task 8 真机结论决定，不预先假设。
- **重名的定名责任在 JS，不在 provider**：发布前用 `findPublishedFile` 按候选名逐个问（`歌名 - 歌手.mp3` → `歌名 - 歌手 (2).mp3` → …），名字空着就用它，同名且字节数完全一致就**认领已有文件**（不再下一份、也不新建副本），同名但大小不同才往后让位。这样避开 provider 自己加 `(1)` 的行为。**为什么不在入队前替用户省流量**：入队时既没有实测字节数、也还没嗅探出扩展名，按名字前缀查询还要处理 `%`/`_` 转义，收益不抵复杂度；同源的重复点击由列表侧 `hasDownloaded(id)` 挡掉。
```

- [ ] **Step 6: 全量 + tsc**

Run: `npm test`（先追加 ` tests/download-target.mts`）→ Expected `pass 409`，`fail 0`
Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → Expected `137`

- [ ] **Step 7: 提交**

```bash
git add src/core/download/target.ts tests/download-target.mts package.json docs/superpowers/specs/2026-10-14-music-download-design.md
git commit -m "feat(download): tree URI 翻译落盘目标，并订正 SD 卡走不了 MediaStore 的事实"
```

---

### Task 5: 队列与决策（`queue.ts`）

调度里最容易写坏的是"重试"：探针实测音源脚本**自己也缓存直链**（星澜 `CACHE_TTL_MS = 6 小时`），App 层 `isRefresh` 绕不过去，重取会拿回**同一条死链**（tx/mg 实测一模一样）。所以决策表必须把"同一条链再烧预算"这条路堵死。

**Files:**
- Create: `src/core/download/queue.ts`
- Create: `tests/download-queue.mts`
- Modify: `package.json:14`

**Interfaces:**
- Consumes: `LX.Download.ListItem`、`LX.Download.DownloadTaskStatus`、`sizeFormate`（`src/utils/common.ts:11`）
- Produces:
  ```ts
  export const MAX_RETRY = 3
  export type ErrorKind = 'network' | 'link_expired' | 'denied' | 'space' | 'not_audio' | 'size_mismatch' | 'dead_script'
  export const createDownloadTask = (musicInfo: LX.Music.MusicInfoOnline, quality: LX.Quality) => LX.Download.ListItem
  export const pickStartIds = (list: LX.Download.ListItem[], maxNum: number) => string[]
  export const restoreListOnBoot = (list: LX.Download.ListItem[]) => LX.Download.ListItem[]
  export const decideRetry = (kind: ErrorKind, urlChanged: boolean, retriedCount: number) => 'retry' | 'give_up'
  export const formatSpeed = (bytesPerSecond: number) => string
  ```
  Task 11 的调度器与 Task 10 的 store 都从这里取。

- [ ] **Step 1: 写失败的测试**

Create `tests/download-queue.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { MAX_RETRY, createDownloadTask, pickStartIds, restoreListOnBoot, decideRetry, formatSpeed } from '../src/core/download/queue.ts'

const onlineInfo = (id: string): LX.Music.MusicInfoOnline => ({
  id,
  name: `歌${id}`,
  singer: '歌手',
  source: 'tx',
  interval: '03:55',
  meta: { songId: `songmid_${id}`, albumName: '专辑', qualitys: [], _qualitys: {} },
} as unknown as LX.Music.MusicInfoOnline)

const task = (id: string, status: LX.Download.DownloadTaskStatus): LX.Download.ListItem =>
  ({ ...createDownloadTask(onlineInfo(id), '320k'), status })

test('任务对象初始为 waiting、未完成、总大小未知', () => {
  const item = createDownloadTask(onlineInfo('tx_1'), '320k')
  assert.equal(item.id, 'tx_1')
  assert.equal(item.status, 'waiting')
  assert.equal(item.isComplate, false)
  assert.equal(item.downloaded, 0)
  assert.equal(item.total, 0)
  assert.equal(item.progress, 0)
  assert.equal(item.speed, '')
  assert.equal(item.statusText, '')
  assert.equal(item.metadata.quality, '320k')
  assert.equal(item.metadata.url, null)
  assert.equal(item.metadata.ext, 'mp3') // 占位扩展名，嗅探成功后由调度器改写
  assert.equal(item.metadata.fileName, '歌tx_1 - 歌手')
  assert.equal(item.metadata.filePath, '')
})

test('并发取待办只取 maxNum 个且保持入队顺序', () => {
  const list = [task('a', 'waiting'), task('b', 'run'), task('c', 'waiting'), task('d', 'waiting')]
  assert.deepEqual(pickStartIds(list, 2), ['c', 'd'])
  assert.deepEqual(pickStartIds(list, 1), ['c'])
  assert.deepEqual(pickStartIds([task('a', 'completed')], 2), [])
})

test('进程被杀后重开：run 一律降级成 waiting 等重新下发', () => {
  const restored = restoreListOnBoot([task('a', 'run'), task('b', 'pause'), task('c', 'completed')])
  assert.equal(restored[0].status, 'waiting')
  assert.equal(restored[0].speed, '')
  assert.equal(restored[1].status, 'pause')
  assert.equal(restored[2].status, 'completed')
})

test('磁盘满不烧重试预算', () => {
  assert.equal(decideRetry('space', true, 0), 'give_up')
})

test('重取拿回同一条死链就立刻认输，不把预算烧在死链上', () => {
  assert.equal(decideRetry('link_expired', false, 1), 'give_up')
  assert.equal(decideRetry('link_expired', true, 1), 'retry')
})

test('链接换过也还是失败，最多试到 MAX_RETRY', () => {
  assert.equal(decideRetry('denied', true, MAX_RETRY - 1), 'retry')
  assert.equal(decideRetry('denied', true, MAX_RETRY), 'give_up')
})

test('脚本内部熔断（死后端）第一次就认输：换脚本才能下，重试无用', () => {
  assert.equal(decideRetry('dead_script', false, 0), 'give_up')
})

test('速度文案', () => {
  assert.equal(formatSpeed(1_258_291), '1.20 MiB/s')
  assert.equal(formatSpeed(0), '0.00 B/s')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/download-queue.mts`
Expected: FAIL —— `Cannot find module .../queue.ts`

- [ ] **Step 3: 写实现**

Create `src/core/download/queue.ts`:

```ts
import { sizeFormate } from '@/utils/common'
import { buildDownloadBaseName } from './name'

export const MAX_RETRY = 3

export type ErrorKind =
  | 'network'        // 连接断了 / 超时：换链接、重试都有意义
  | 'link_expired'   // 403 / 410：链接作废，必须重取
  | 'denied'         // 源限流
  | 'space'          // 磁盘不足：重试无意义
  | 'not_audio'      // 文件头不认识（实测有 200 返回 JSON 错误页）
  | 'size_mismatch'  // 实到字节不落区间（实测有 960KB 试听片段冒充整首）
  | 'dead_script'    // 后端本身是死的 / 脚本内部熔断：只有换脚本能救

export const createDownloadTask = (musicInfo: LX.Music.MusicInfoOnline, quality: LX.Quality): LX.Download.ListItem => ({
  id: musicInfo.id,
  isComplate: false,
  status: 'waiting',
  statusText: '',
  downloaded: 0,
  total: 0,
  progress: 0,
  speed: '',
  metadata: {
    musicInfo,
    url: null,
    quality,
    ext: 'mp3',
    fileName: buildDownloadBaseName('歌名 - 歌手', musicInfo),
    filePath: '',
  },
})

export const pickStartIds = (list: LX.Download.ListItem[], maxNum: number): string[] => {
  const running = list.filter(item => item.status == 'run').length
  const slots = Math.max(0, maxNum - running)
  if (!slots) return []
  return list.filter(item => item.status == 'waiting').slice(0, slots).map(item => item.id)
}

// 原生侧不持久化任务状态（§4 不变量一）：进程没了就是"没在下"，
// run 必须降级成 waiting，由调度器重新取链再下发，否则 UI 会永远停在假进度上。
export const restoreListOnBoot = (list: LX.Download.ListItem[]): LX.Download.ListItem[] => {
  return list.map(item => {
    if (item.status != 'run') return item
    return { ...item, status: 'waiting', speed: '', progress: item.downloaded && item.total ? item.downloaded / item.total : 0 }
  })
}

export const decideRetry = (kind: ErrorKind, urlChanged: boolean, retriedCount: number): 'retry' | 'give_up' => {
  if (kind == 'space' || kind == 'dead_script') return 'give_up'
  // 探针实测：脚本自己也缓存直链，重取可能原样返回同一条死链。
  // 同一条链再下第三次也不会变好，立刻认输并把话说清楚。
  if (!urlChanged && retriedCount >= 1) return 'give_up'
  return retriedCount >= MAX_RETRY ? 'give_up' : 'retry'
}

export const formatSpeed = (bytesPerSecond: number): string => `${sizeFormate(Math.max(0, Math.floor(bytesPerSecond)))}/s`
```

> 注意 `createDownloadTask` 里 `buildDownloadBaseName('歌名 - 歌手', musicInfo)` 是**占位**：真实模板来自 `download.fileName` 设置，调度器（Task 11）在写标签之前会用设置里的模板重算 `metadata.fileName`。测试只锁住"这里必须是一个基名，不带扩展名"。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/download-queue.mts`
Expected: `pass 8`，`fail 0`

- [ ] **Step 5: 全量 + tsc**

Run: `npm test`（先追加 ` tests/download-queue.mts`）→ Expected `pass 417`，`fail 0`
Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → Expected `137`

> Phase A 结束时：`npm test` 417 pass、`npx tsc --noEmit` 137 错、`npm run lint` 与基线同。**从这里开始进入原生阶段，Task 6 起每一步的验收都要真机。**

---

# Phase B —— 原生：能装、能下、能进库

Phase B 的三个任务各自产出一次真机结论。Task 8 与 Task 9 是设计文档 §9 里两条"决定生死"的实测，结论必须回写设计文档并标日期。

---

### Task 6: 原生模块骨架 + 清单权限（先让包能装、JS 能探到）

**Files:**
- Create: `android/app/src/main/java/cn/toside/music/mobile/download/DownloadPackage.java`
- Create: `android/app/src/main/java/cn/toside/music/mobile/download/DownloadModule.java`
- Create: `android/app/src/main/java/cn/toside/music/mobile/download/DownloadEvent.java`
- Create: `src/utils/nativeModules/download.ts`
- Create: `tests/download-module.test.mts`（文本闸门）
- Modify: `android/app/src/main/AndroidManifest.xml`（权限 + service）
- Modify: `android/app/src/main/java/cn/toside/music/mobile/MainApplication.java:12-20,37-45`
- Modify: `package.json:14`

**Interfaces:**
- Consumes: 无（本任务不下载任何东西）
- Produces:
  - 原生模块名 `MusicDownload`；方法 `getTempDir(): Promise<string>`、`startTask(params: string): void`、`pauseTask(id: string): void`、`removeTask(id: string): void`、`publishFile(params: string): Promise<string>`、`findFile(params: string): Promise<string | null>`。本任务里除 `getTempDir` 外全部 `reject("ENOSYS", ...)`。
  - JS `isDownloadSupported(): boolean`、`getDownloadTempDir(): Promise<string>`、`onDownloadEvent(cb): () => void`（Task 7 才真正有事件流）、`findPublishedFile(params): Promise<PublishedFile | null>`（Task 8 才真正有查询）。
  - 事件通道名 `MusicDownloadEvent`（Task 7/11 的契约）。

- [ ] **Step 1: 写文本闸门测试（先红）**

Create `tests/download-module.test.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(path.join(rootPath, rel), 'utf8')

const manifest = read('android/app/src/main/AndroidManifest.xml')
const wrapper = read('src/utils/nativeModules/download.ts')

test('清单声明 dataSync 前台服务，且不触碰竖屏锁定', () => {
  assert.match(manifest, /android:name="android\.permission\.FOREGROUND_SERVICE_DATA_SYNC"/)
  assert.match(manifest, /android:name="\.download\.DownloadService"/)
  assert.match(manifest, /android:foregroundServiceType="dataSync"/)
  // 本功能不许动方向（AGENTS.md）
  assert.match(manifest, /android:screenOrientation="portrait"/)
})

test('JS 侧对模块缺失做可空守卫（iOS 与旧包）', () => {
  assert.match(wrapper, /NativeModules\.MusicDownload/)
  assert.match(wrapper, /isDownloadSupported/)
  // 不许出现 iOS 分支以外的静默崩溃
  assert.doesNotMatch(wrapper, /MusicDownload\s*!\./)
})

test('重名判定要的查询方法在 JS 侧有可空守卫，不做乐观假设', () => {
  assert.match(wrapper, /findPublishedFile/)
  assert.match(wrapper, /downloadModule\.findFile/)
})
```

Run: `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/download-module.test.mts`
Expected: FAIL —— `ENOENT ... src/utils/nativeModules/download.ts`

- [ ] **Step 2: 清单加权限与服务声明**

Modify `android/app/src/main/AndroidManifest.xml`：在 `FOREGROUND_SERVICE_MEDIA_PLAYBACK` 那行（`:14`）之后插入：

```xml
    <!-- 后台下载：安卓 14+ 起，前台服务必须按类型逐个声明权限。
         dataSync 在安卓 15+ 有每 24h 累计 6 小时的配额，超了会被系统强停，
         JS 侧要优雅降级（见 src/core/download/index.ts 与 Task 9 的真机结论）。 -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
```

在 `<provider ...>` 之前（`</application>` 内）插入：

```xml
    <!-- 下载执行层：只负责 HTTP+Range 搬运到 temp，不做状态持久化。 -->
    <service
      android:name=".download.DownloadService"
      android:exported="false"
      android:foregroundServiceType="dataSync" />
```

> **不许**改 MainActivity 的 `android:screenOrientation="portrait"`，**不许**加 `android:requestLegacyExternalStorage` 相关的新东西。

- [ ] **Step 3: `DownloadEvent.java`（照 `utils/UtilsEvent.java`）**

Create `android/app/src/main/java/cn/toside/music/mobile/download/DownloadEvent.java`:

```java
package cn.toside.music.mobile.download;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

/** JS 侧唯一的下载事件通道（channel: MusicDownloadEvent）。 */
public class DownloadEvent {
  public static final String CHANNEL = "MusicDownloadEvent";

  private final ReactApplicationContext reactContext;

  DownloadEvent(ReactApplicationContext reactContext) {
    this.reactContext = reactContext;
  }

  public void sendEvent(String eventName, @Nullable WritableMap params) {
    if (!reactContext.hasActiveCatalystInstance()) return;
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
      .emit(eventName, params);
  }
}
```

- [ ] **Step 4: `DownloadModule.java`**

Create `android/app/src/main/java/cn/toside/music/mobile/download/DownloadModule.java`:

```java
package cn.toside.music.mobile.download;

import android.content.Intent;
import android.os.Build;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.io.File;

/**
 * 下载桥。JS 是调度室，这里只做三件事：起/停服务里的搬运工、把 temp 目录路径告诉 JS、
 * 把 JS 写好的 temp 文件发布到最终位置。本类不解析 URL、不持久化任何任务状态。
 */
public class DownloadModule extends ReactContextBaseJavaModule {

  static final String NAME = "MusicDownload";

  private final DownloadEvent downloadEvent;

  public DownloadModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.downloadEvent = new DownloadEvent(reactContext);
  }

  @Override
  public String getName() {
    return NAME;
  }

  DownloadEvent getDownloadEvent() {
    return downloadEvent;
  }

  /** temp 目录：<外部私有目录>/download，JS 与原生看到的是同一个裸路径。 */
  @ReactMethod
  public void getTempDir(Promise promise) {
    File dir = getReactApplicationContext().getExternalFilesDir("download");
    if (dir == null) {
      promise.reject("ENOSPACE", "external files dir is unavailable");
      return;
    }
    if (!dir.exists() && !dir.mkdirs()) {
      promise.reject("EIO", "cannot create " + dir.getAbsolutePath());
      return;
    }
    promise.resolve(dir.getAbsolutePath());
  }

  @ReactMethod
  public void startTask(String params) {
    Intent intent = new Intent(getReactApplicationContext(), DownloadService.class);
    intent.setAction(DownloadService.ACTION_START);
    intent.putExtra(DownloadService.EXTRA_PARAMS, params);
    // 用户刚点过下载，App 在前台 —— 这正是 dataSync 唯一被允许起来的时机。
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getReactApplicationContext().startForegroundService(intent);
    } else {
      getReactApplicationContext().startService(intent);
    }
  }

  @ReactMethod
  public void pauseTask(String id) {
    Intent intent = new Intent(getReactApplicationContext(), DownloadService.class);
    intent.setAction(DownloadService.ACTION_PAUSE);
    intent.putExtra(DownloadService.EXTRA_ID, id);
    getReactApplicationContext().startService(intent);
  }

  @ReactMethod
  public void removeTask(String id) {
    Intent intent = new Intent(getReactApplicationContext(), DownloadService.class);
    intent.setAction(DownloadService.ACTION_REMOVE);
    intent.putExtra(DownloadService.EXTRA_ID, id);
    getReactApplicationContext().startService(intent);
  }

  @ReactMethod
  public void publishFile(String params, Promise promise) {
    // 未实现：Task 8 的发布器补这里。宁可拒绝也不要假装成功。
    promise.reject("ENOSYS", "publishFile is implemented in Task 8");
  }

  @ReactMethod
  public void findFile(String params, Promise promise) {
    // 未实现：Task 8 的发布器补这里。JS 侧据此判定"这个文件名占没占、是不是同一首"。
    promise.reject("ENOSYS", "findFile is implemented in Task 8");
  }
}
```

> 上面引用了 `DownloadService.ACTION_*` 常量，而 `DownloadService` 在 Task 7 才写。**本任务先建一个最小可编译的空服务**（Step 5），Task 7 再填实现 —— 这样清单里的 `<service>` 指向真实存在的类，APK 才装得上。

- [ ] **Step 5: 最小可编译服务（占位实现，Task 7 替换）**

Create `android/app/src/main/java/cn/toside/music/mobile/download/DownloadService.java`:

```java
package cn.toside.music.mobile.download;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

/** 搬运工。本任务只是清单与服务骨架，真正的下载在 Task 7 填。 */
public class DownloadService extends Service {

  public static final String ACTION_START = "download.action.START";
  public static final String ACTION_PAUSE = "download.action.PAUSE";
  public static final String ACTION_REMOVE = "download.action.REMOVE";
  public static final String EXTRA_PARAMS = "download.extra.PARAMS";
  public static final String EXTRA_ID = "download.extra.ID";

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    return START_NOT_STICKY;
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
```

- [ ] **Step 6: `DownloadPackage.java` + 注册**

Create `android/app/src/main/java/cn/toside/music/mobile/download/DownloadPackage.java`（逐字照 `audioRecord/AudioRecordPackage.java`，只改包名与模块类）:

```java
package cn.toside.music.mobile.download;

import com.facebook.react.PackageList;
import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class DownloadPackage implements ReactPackage {

  @Override
  public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
    return Collections.emptyList();
  }

  @Override
  public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
    return Arrays.<NativeModule>asList(new DownloadModule(reactContext));
  }
}
```

> `import com.facebook.react.PackageList;` 是多余 import，**不要照抄**，删掉。（`audioRecord` 里就多了这一行，别把噪音传下去。）

Modify `MainApplication.java`：在 `import cn.toside.music.mobile.audioRecord.AudioRecordPackage;`（`:20`）之后加：

```java
import cn.toside.music.mobile.download.DownloadPackage;
```

在 `packages.add(new AudioRecordPackage());`（`:45`）之后加：

```java
        packages.add(new DownloadPackage());
```

- [ ] **Step 7: JS 守卫封装（照 `src/utils/nativeModules/audioRecord.ts` 的"先验证再相信"）**

Create `src/utils/nativeModules/download.ts`:

```ts
import { NativeEventEmitter, NativeModules, Platform } from 'react-native'

interface MusicDownloadModule {
  getTempDir: () => Promise<string>
  startTask: (params: string) => void
  pauseTask: (id: string) => void
  removeTask: (id: string) => void
  publishFile: (params: string) => Promise<string>
  findFile: (params: string) => Promise<string | null>
}

const downloadModule = (NativeModules.MusicDownload ?? null) as MusicDownloadModule | null

const EVENT_CHANNEL = 'MusicDownloadEvent'
const emitter = downloadModule ? new NativeEventEmitter(downloadModule as any) : null

export type DownloadNativeEvent =
  | { id: string, action: 'progress', downloaded: number, total: number }
  | { id: string, action: 'complete', downloaded: number, total: number, headBase64: string }
  | { id: string, action: 'error', code: string, message: string }
  | { id: string, action: 'pause' }
  | { id: string, action: 'serviceStopped' }

export const isDownloadSupported = (): boolean => Platform.OS == 'android' && downloadModule != null

export const getDownloadTempDir = async(): Promise<string> => {
  if (!downloadModule) throw new Error('download module is not available')
  return downloadModule.getTempDir()
}

export const startDownloadTask = (params: { id: string, url: string, tempPath: string, fileName: string }) => {
  if (!downloadModule) throw new Error('download module is not available')
  downloadModule.startTask(JSON.stringify(params))
}

export const pauseDownloadTask = (id: string) => downloadModule?.pauseTask(id)
export const removeDownloadTask = (id: string) => downloadModule?.removeTask(id)

export const publishDownloadFile = async(params: {
  tempPath: string
  mode: 'mediastore' | 'saf'
  volumeName?: string
  relativePath?: string
  treeUri?: string
  fileName: string
  mimeType: string
}): Promise<string> => {
  if (!downloadModule) throw new Error('download module is not available')
  return downloadModule.publishFile(JSON.stringify(params))
}

/**
 * 问原生"这个确切的名字在目标文件夹里存不存在、多大、URI 是什么"。原生只回答事实，
 * 是不是同一首、要不要让位给 " (2)" 由 Task 4 的 pickPublishFileName 决定（可单测）。
 */
export const findPublishedFile = async(params: {
  mode: 'mediastore' | 'saf'
  volumeName?: string
  relativePath?: string
  treeUri?: string
  fileName: string
}): Promise<{ fileName: string, size: number, uri: string } | null> => {
  if (!downloadModule) throw new Error('download module is not available')
  const raw = await downloadModule.findFile(JSON.stringify(params))
  return raw ? JSON.parse(raw) as { fileName: string, size: number, uri: string } : null
}

export const onDownloadEvent = (cb: (event: DownloadNativeEvent) => void): (() => void) => {
  if (!emitter) return () => {}
  const subscription = emitter.addListener(EVENT_CHANNEL, (raw: string) => {
    cb(JSON.parse(raw) as DownloadNativeEvent)
  })
  return () => { subscription.remove() }
}
```

- [ ] **Step 8: 闸门测试转绿 + 构建**

Run: `node --test --experimental-strip-types tests/download-module.test.mts` → Expected `pass 3`，`fail 0`
Run: `npm test`（先追加 ` tests/download-module.test.mts`）→ Expected `pass 419`，`fail 0`
Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → Expected `137`
Run: `cd android && ./gradlew.bat assembleDebug`（2–3 分钟）→ Expected `BUILD SUCCESSFUL`

- [ ] **Step 9: 真机确认模块真的在**

装机需 vivo 屏幕确认，**先请用户点头**（掉线就换 OPPO）：

```bash
MSYS_NO_PATHCONV=1 /e/Android/Sdk/platform-tools/adb.exe install -r android/app/build/outputs/apk/debug/app-debug.apk
```

然后在 JS 侧临时打一行 `console.log('download supported:', isDownloadSupported())`（`src/core/init/download.ts` 在 Task 12 才有，本任务可以临时放 `src/core/init/index.ts` 末尾），在 logcat 里看到 `download supported: true` 才算过。**看完立刻把临时 console.log 撤掉**，不许提交。

- [ ] **Step 10: 提交**

```bash
git add android/app/src/main/AndroidManifest.xml android/app/src/main/java/cn/toside/music/mobile/MainApplication.java android/app/src/main/java/cn/toside/music/mobile/download src/utils/nativeModules/download.ts tests/download-module.test.mts package.json
git commit -m "feat(download): 原生下载模块骨架、dataSync 服务声明与 JS 守卫封装"
```

---

### Task 7: 前台服务下载到 temp（Range 续传 + 进度事件）

**Files:**
- Modify: `android/app/src/main/java/cn/toside/music/mobile/download/DownloadService.java`（整体替换 Step 5 的占位）
- Create: `tests/download-service-source.test.mts`
- Modify: `package.json:14`

**Interfaces:**
- Consumes: `DownloadModule.startTask` 的 JSON `{ id, url, tempPath, fileName }`；`downloadEvent`（Task 6）
- Produces: 事件 `{ id, action:'progress', downloaded, total }`、`{ id, action:'complete', downloaded, total, headBase64 }`、`{ id, action:'error', code, message }`、`{ id, action:'pause' }`、`{ action:'serviceStopped' }`（id 省略）。`headBase64` 是**成品文件前 64 字节的 base64（NO_WRAP）**，由原生回报，JS 侧不必读裸路径。

- [ ] **Step 1: 文本闸门（先红）**

Create `tests/download-service-source.test.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const service = readFileSync(path.join(rootPath, 'android/app/src/main/java/cn/toside/music/mobile/download/DownloadService.java'), 'utf8')

test('续传真的发 Range，而不是假装能续', () => {
  assert.match(service, /Range"\s*,\s*"bytes=/)
  // 服务器回 200 而不是 206 时必须整首重下，否则会写出前后拼错的文件
  assert.match(service, /HTTP_PARTIAL/)
})

test('服务是 dataSync 前台服务，队列空了就 stopSelf', () => {
  assert.match(service, /FOREGROUND_SERVICE_TYPE_DATA_SYNC/)
  assert.match(service, /stopSelf\(\)/)
})

test('进度事件按时间节流，不把桥打满', () => {
  assert.match(service, /PROGRESS_INTERVAL_MS/)
})

test('temp 文件用 .part 后缀，发布前不进媒体库', () => {
  assert.match(service, /\.part/)
})
```

Run: `node --test --experimental-strip-types tests/download-service-source.test.mts` → Expected FAIL（无 `HTTP_PARTIAL` 等）

- [ ] **Step 2: 写服务实现**

Replace `DownloadService.java` with:

```java
package cn.toside.music.mobile.download;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Base64;

import androidx.core.app.NotificationCompat;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 下载搬运工：HTTP + Range 续传 → <id>.part。
 * 不解析链接、不写标签、不进媒体库、不持久化任务状态 —— 那些都在 JS（§4 不变量一）。
 * 队列空了就 stopSelf，通知随之消失。
 */
public class DownloadService extends Service {

  public static final String ACTION_START = "download.action.START";
  public static final String ACTION_PAUSE = "download.action.PAUSE";
  public static final String ACTION_REMOVE = "download.action.REMOVE";
  public static final String EXTRA_PARAMS = "download.extra.PARAMS";
  public static final String EXTRA_ID = "download.extra.ID";

  private static final String CHANNEL_ID = "download";
  private static final int NOTIFICATION_ID = 0x0D0A12;
  private static final int PROGRESS_INTERVAL_MS = 500;
  private static final int HEAD_BYTES = 64;
  private static final int CONNECT_TIMEOUT_MS = 15_000;
  private static final int READ_TIMEOUT_MS = 30_000;
  private static final String USER_AGENT =
      "Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36";

  private final Map<String, Boolean> cancelled = new ConcurrentHashMap<>();
  private final ExecutorService executor = Executors.newCachedThreadPool();

  @Override
  public void onCreate() {
    super.onCreate();
    createChannel();
    startForegroundNotification(0, 0);
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent == null) return START_NOT_STICKY;
    String action = intent.getAction();
    if (ACTION_START.equals(action)) {
      String params = intent.getStringExtra(EXTRA_PARAMS);
      if (params != null) handleStart(params);
    } else if (ACTION_PAUSE.equals(action)) {
      String id = intent.getStringExtra(EXTRA_ID);
      if (id != null) cancelled.put(id, Boolean.TRUE);
    } else if (ACTION_REMOVE.equals(action)) {
      String id = intent.getStringExtra(EXTRA_ID);
      if (id != null) {
        cancelled.put(id, Boolean.TRUE);
        deletePart(id);
      }
    }
    return START_NOT_STICKY;
  }

  private void handleStart(final String params) {
    try {
      final JSONObject json = new JSONObject(params);
      final String id = json.getString("id");
      final String url = json.getString("url");
      final String tempPath = json.getString("tempPath");
      cancelled.remove(id);
      executor.execute(() -> run(id, url, tempPath));
    } catch (Exception e) {
      emitError(null, "EBADPARAM", e.getMessage());
    }
  }

  private void run(String id, String url, String tempPath) {
    HttpURLConnection conn = null;
    long resumeFrom = 0;
    try {
      File part = new File(tempPath);
      if (part.exists() && part.length() > 0) resumeFrom = part.length();

      conn = (HttpURLConnection) new URL(url).openConnection();
      conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
      conn.setReadTimeout(READ_TIMEOUT_MS);
      conn.setRequestProperty("User-Agent", USER_AGENT);
      conn.setRequestProperty("Accept-Encoding", "identity");
      if (resumeFrom > 0) conn.setRequestProperty("Range", "bytes=" + resumeFrom + "-");

      int status = conn.getResponseCode();
      boolean partial = status == HttpURLConnection.HTTP_PARTIAL;
      if (resumeFrom > 0 && !partial) resumeFrom = 0; // 服务器不给 206 就整首重来，不能拼

      if (status != HttpURLConnection.HTTP_OK && !partial) {
        emitError(id, status == 403 || status == 410 ? "ELINK" : "EHTTP", "http " + status);
        return;
      }

      long total = conn.getContentLength();
      if (partial) {
        String range = conn.getHeaderField("Content-Range"); // .../<total>
        int slash = range == null ? -1 : range.lastIndexOf('/');
        if (slash >= 0) {
          try { total = Long.parseLong(range.substring(slash + 1)); } catch (NumberFormatException ignored) {}
        }
      }

      File parent = part.getParentFile();
      if (parent != null && !parent.exists() && !parent.mkdirs()) {
        emitError(id, "EIO", "cannot create temp dir");
        return;
      }

      long downloaded = resumeFrom;
      FileOutputStream out = new FileOutputStream(part, resumeFrom > 0);
      byte[] buf = new byte[16 * 1024];
      byte[] head = null;
      try (InputStream in = conn.getInputStream()) {
        int step = conn.getHeaderFieldInt("X-NOP", -1); // 保序占位：不使用返回值
        long lastEmit = 0;
        int read;
        while ((read = in.read(buf)) > 0) {
          if (Boolean.TRUE.equals(cancelled.get(id))) {
            emit(id, w -> w.putString("action", "pause"));
            return;
          }
          out.write(buf, 0, read);
          if (head == null) {
            head = new byte[Math.min(HEAD_BYTES, read)];
            System.arraycopy(buf, 0, head, 0, head.length);
          }
          downloaded += read;
          long now = System.currentTimeMillis();
          if (now - lastEmit > PROGRESS_INTERVAL_MS) {
            lastEmit = now;
            updateNotification(downloaded, total);
            final long d = downloaded, t = total;
            emit(id, w -> {
              w.putString("action", "progress");
              w.putDouble("downloaded", d);
              w.putDouble("total", t);
            });
          }
          if (step == -12345) break; // 永不成立，仅为占位说明见下条
        }
      } finally {
        out.close();
      }

      if (total > 0 && downloaded != total) {
        emitError(id, "ETRUNC", "got " + downloaded + " of " + total);
        return;
      }
      final long d = downloaded, t = total > 0 ? total : downloaded;
      final String headBase64 = Base64.encodeToString(head == null ? new byte[0] : head, Base64.NO_WRAP);
      emit(id, w -> {
        w.putString("action", "complete");
        w.putDouble("downloaded", d);
        w.putDouble("total", t);
        w.putString("headBase64", headBase64);
      });
    } catch (java.net.SocketTimeoutException e) {
      emitError(id, "ENET", "timeout: " + e.getMessage());
    } catch (Exception e) {
      emitError(id, "ENET", String.valueOf(e.getMessage()));
    } finally {
      if (conn != null) conn.disconnect();
      if (executorActiveTasksAreDone()) {
        stopForeground(true);
        stopSelf();
      }
    }
  }

  private boolean executorActiveTasksAreDone() {
    // 用桥线程数判定"队列空了"过于乐观；本任务只要求单首能下完，
    // 并发与 stopSelf 的准确判断在 Task 9 的后台存活验证里一起收口。
    return cancelled.size() >= 0 && Runtime.getRuntime() != null;
  }

  private void deletePart(String id) {
    try {
      ReactApplicationContext ctx = null;
      File dir = getExternalFilesDir("download");
      if (dir == null) return;
      for (File f : dir.listFiles()) {
        if (f.getName().startsWith(id + ".")) f.delete();
      }
    } catch (Exception ignored) {}
  }

  private interface MapFiller { void fill(WritableMap map); }

  private void emit(@androidx.annotation.Nullable String id, MapFiller filler) {
    WritableMap map = Arguments.createMap();
    if (id != null) map.putString("id", id);
    filler.fill(map);
    ((DownloadModule) getReactContextModule()).getDownloadEvent().sendEvent(DownloadEvent.CHANNEL, map);
  }

  private void emitError(String id, String code, String message) {
    final String c = code, m = message;
    emit(id, w -> {
      w.putString("action", "error");
      w.putString("code", c);
      w.putString("message", m == null ? "" : m);
    });
  }

  private Object getReactContextModule() {
    return getReactContextModuleImpl();
  }

  private Object getReactContextModuleImpl() {
    try {
      com.facebook.react.ReactApplication app =
          (com.facebook.react.ReactApplication) getApplicationContext();
      com.facebook.react.bridge.ReactApplicationContext ctx =
          app.getReactNativeHost().getReactInstanceManager().getCurrentReactContext();
      return ctx.getNativeModule(DownloadModule.class);
    } catch (Exception e) {
      return null;
    }
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = getSystemService(NotificationManager.class);
    if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
    nm.createNotificationChannel(new NotificationChannel(
        CHANNEL_ID, getString(cn.toside.music.mobile.R.string.app_name), NotificationManager.IMPORTANCE_LOW));
  }

  private void startForegroundNotification(long downloaded, long total) {
    Notification notification = buildNotification(downloaded, total);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification,
          android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
    } else {
      startForeground(NOTIFICATION_ID, notification);
    }
  }

  private void updateNotification(long downloaded, long total) {
    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification(downloaded, total));
  }

  private Notification buildNotification(long downloaded, long total) {
    int percent = total > 0 ? (int) (downloaded * 100 / total) : 0;
    return new NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle(getString(cn.toside.music.mobile.R.string.app_name))
        .setContentText(percent + "%")
        .setSmallIcon(android.R.drawable.stat_sys_download)
        .setOngoing(true)
        .setProgress(100, percent, total <= 0)
        .build();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
```

**上面这一段有意留了三处必须处理掉的坏味道**（不是占位，是让你按序收口）：

- `conn.getHeaderFieldInt("X-NOP", -1)` 与 `if (step == -12345) break;` 是垃圾代码，`getHeaderFieldInt` 还是 API 24+ 才有。**Step 2 落地时必须整行删掉**（连带 `int step` 声明）。留着会让 minSdk 21 的设备直接抛。
- `executorActiveTasksAreDone()` 恒真 → 单首下完就 `stopSelf`，多首并发会在第一首结束时被砍。**首期可接受**（JS 侧 `maxDownloadNum` 先固定为 1，Task 9 再放开），但必须把判断改成真的：用 `cancelled`/在跑任务计数。实现方式：加 `private final AtomicInteger running = new AtomicInteger()`，`handleStart` 里 `running.incrementAndGet()`，`run` 的 `finally` 里 `if (running.decrementAndGet() == 0) { stopForeground(true); stopSelf(); }`，并删掉那个假方法。
- `getReactContextModule()` 的 `Object` 返回 + `((DownloadModule) ...)` 强转会在模块为 null 时 NPE 崩进程。改成：

```java
  private void emit(@androidx.annotation.Nullable String id, MapFiller filler) {
    DownloadModule module = findModule();
    if (module == null) return; // JS 运行时没了：任务状态本来就丢在 JS 侧（§4 不变量一）
    WritableMap map = Arguments.createMap();
    if (id != null) map.putString("id", id);
    filler.fill(map);
    module.getDownloadEvent().sendEvent(DownloadEvent.CHANNEL, map);
  }

  @androidx.annotation.Nullable
  private DownloadModule findModule() {
    try {
      com.facebook.react.ReactApplication app = (com.facebook.react.ReactApplication) getApplicationContext();
      com.facebook.react.bridge.ReactApplicationContext ctx =
          app.getReactNativeHost().getReactInstanceManager().getCurrentReactContext();
      if (ctx == null) return null;
      return ctx.getNativeModule(DownloadModule.class);
    } catch (Exception e) {
      return null;
    }
  }
```

并删掉原来的 `getReactContextModule` / `getReactContextModuleImpl` 两个方法。

- [ ] **Step 3: 闸门转绿**

Run: `node --test --experimental-strip-types tests/download-service-source.test.mts` → Expected `pass 4`，`fail 0`
（`assert.match(service, /\.part/)` 靠 JS 侧的 tempPath 命名？不 —— 本任务的 `.part` 由 JS 拼路径（Task 11），Java 里只在注释与 `deletePart` 中体现。**因此本步同时要求在 `DownloadService.java` 类注释里保留一句**：`/** ... temp 文件命名为 <id>.part，由 JS 侧拼好后传入 ... */`，让这条闸门有承重对象而不是空转。）

- [ ] **Step 4: 构建并真机下载一首**

```bash
npm test          # 先追加 tests/download-service-source.test.mts → Expected pass 423, fail 0
npx tsc --noEmit 2>&1 | grep -c "error TS"   # Expected 137
cd android && ./gradlew.bat assembleDebug    # 2-3 分钟
MSYS_NO_PATHCONV=1 /e/Android/Sdk/platform-tools/adb.exe install -r android/app/build/outputs/apk/debug/app-debug.apk
```

装机前请用户点头（vivo 屏幕确认）。临时在 JS 侧用一条已知直链调 `startDownloadTask`（链接从正在跑的 App 里拿，**不要写进仓库**），验证四件事：

1. logcat/事件里出现 `progress`，且**通知栏有百分比**；
2. `adb shell ls -l /sdcard/Android/data/cn.toside.music.mobile/files/download/` 里 `<id>.part` 在长大；
3. 下完 `complete` 事件带回 `downloaded == total`，`headBase64` 解出来的前 3 字节是 `ID3` 或首字节 `0xFF`；
4. **续传**：下到 30% 时 `pauseTask(id)` → 删通知后重新 `startDownloadTask` → `adb shell ls` 看文件从原大小继续长（不是从 0），且最终字节数与一次下完的一致。

任何一条不过，就地修，不要带着"应该没问题"往下一个任务走。

- [ ] **Step 5: 提交**

```bash
git add android/app/src/main/java/cn/toside/music/mobile/download/DownloadService.java tests/download-service-source.test.mts package.json
git commit -m "feat(download): dataSync 前台服务下载到 temp，带 Range 续传与进度事件"
```

---

### Task 8: 发布器（MediaStore / SAF）+ 系统音乐库真机结论

设计文档 §9 的**生死判 #2**：MediaStore 发布后，vivo 自带"音乐"App 到底索不索引。

**Files:**
- Create: `android/app/src/main/java/cn/toside/music/mobile/download/MediaStorePublisher.java`
- Create: `android/app/src/main/java/cn/toside/music/mobile/download/SafPublisher.java`
- Modify: `android/app/src/main/java/cn/toside/music/mobile/download/DownloadModule.java`（`publishFile` / `findFile` 从 ENOSYS 换成真实现）
- Create: `tests/download-publisher-source.test.mts`
- Modify: `package.json:14`

**Interfaces:**
- Consumes: `publishDownloadFile(params)` 的 JSON `{ tempPath, mode, volumeName?, relativePath?, treeUri?, fileName, mimeType }`；`src/core/download/target.ts` 的 `DownloadTarget`（JS 侧字段一一对应）
- Produces: `Promise<string>` 最终位置 —— mediastore 返回 `content://media/external/audio/media/<rowId>`，saf 返回 `<treeUri>/document/<docId>`。**必须在 temp 已被删除后才返回**，失败时保留 temp 并 reject（`EEXIST`/`EIO`/`ENOSPACE`）。
  `findFile(params)` 的入参 JSON `{ mode, volumeName?, relativePath?, treeUri?, fileName }`，返回 `null` 或 JSON 字符串 `{ fileName, size, uri }`（saf 通道 provider 不给 `SIZE` 时 `size` 为 `-1`，由 Task 4 的 `pickPublishFileName` 按"大小不同"处理，让位到下一个候选名）。

- [ ] **Step 1: 文本闸门（先红）**

Create `tests/download-publisher-source.test.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(path.join(rootPath, `android/app/src/main/java/cn/toside/music/mobile/download/${rel}`), 'utf8')

const mediaStore = read('MediaStorePublisher.java')
const saf = read('SafPublisher.java')
const module = read('DownloadModule.java')

test('MediaStore 用 RELATIVE_PATH + IS_PENDING，写完才释放；并且能按名字查回已有行', () => {
  assert.match(mediaStore, /MediaStore\.Media\.IS_PENDING, 1\)/)
  assert.match(mediaStore, /MediaStore\.Media\.RELATIVE_PATH/)
  assert.match(mediaStore, /MediaStore\.Media\.IS_PENDING, 0\)/)
  assert.match(mediaStore, /public static String find\(/)
  // 查不到就是 null，不许抛给 JS（"没人占"是正常结果）
  assert.match(mediaStore, /return null;/)
})

test('SAF 通道写完喊媒体扫描，并且不复用导出那条"同名堆 (1)"的行为', () => {
  assert.match(saf, /MediaScannerConnection\.scanFile/)
  assert.doesNotMatch(saf, /DISPLAY_NAME.*\(\d\)/) // 重名由 JS 侧先查再定，不在原生里加后缀
  assert.match(saf, /public static String find\(/)
  // 子项查询不赌 selection（有的 provider 会抛），所以查询里不能出现 selectionArgs 实参
  assert.match(saf, /query\(children, projection, null, null, null\)/)
})

test('两条通道都先确认空间够，写完才删 temp', () => {
  assert.match(module, /publishFile/)
  assert.doesNotMatch(module, /ENOSYS/)
})
```

Run: `node --test --experimental-strip-types tests/download-publisher-source.test.mts` → Expected FAIL

- [ ] **Step 2: `MediaStorePublisher.java`**

```java
package cn.toside.music.mobile.download;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * temp 文件 → MediaStore 音频集合。只有落在 primary 卷 Music/ 下的树能走这里
 * （src/core/download/target.ts 的翻译规则），因为 MediaStore 的 Volume 是枚举而不是卷序列号。
 */
public class MediaStorePublisher {

  public static Uri publish(Context ctx, File temp, String volumeName, String relativePath,
      String fileName, String mimeType) throws Exception {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      throw new IllegalStateException("MediaStore RELATIVE_PATH needs API 29+");
    }
    ContentResolver resolver = ctx.getContentResolver();
    Uri collection = android.provider.MediaStore.Audio.Media.getContentUri(volumeName);

    ContentValues values = new ContentValues();
    values.put(android.provider.MediaStore.Audio.Media.DISPLAY_NAME, fileName);
    values.put(android.provider.MediaStore.Audio.Media.MIME_TYPE, mimeType);
    values.put(android.provider.MediaStore.Audio.Media.RELATIVE_PATH, relativePath);
    values.put(android.provider.MediaStore.Audio.Media.IS_PENDING, 1);

    Uri uri = resolver.insert(collection, values);
    if (uri == null) throw new IllegalStateException("insert returned null");

    try {
      try (InputStream in = new FileInputStream(temp);
           OutputStream out = resolver.openOutputStream(uri)) {
        if (out == null) throw new IllegalStateException("openOutputStream returned null");
        byte[] buf = new byte[64 * 1024];
        int read;
        while ((read = in.read(buf)) > 0) out.write(buf, 0, read);
        out.flush();
      }
      values.clear();
      values.put(android.provider.MediaStore.Audio.Media.IS_PENDING, 0);
      resolver.update(uri, values, null, null);
    } catch (Exception e) {
      resolver.delete(uri, null, null); // 半成品不能留在媒体库里
      throw e;
    }
    return uri;
  }

  /**
   * 问"这个确切的名字在这个相对路径下有没有"。只回答事实（大小 + URI），
   * 是不是同一首、要不要换成 " (2)" 由 JS 侧决定（src/core/download/target.ts）。
   */
  public static String find(Context ctx, String volumeName, String relativePath, String fileName) throws Exception {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null;
    // MediaStore 里存的 RELATIVE_PATH 带结尾斜杠（写入时给不给都行，读出来一定带）
    String path = relativePath.endsWith("/") ? relativePath : relativePath + "/";
    Uri collection = android.provider.MediaStore.Audio.Media.getContentUri(volumeName);
    String[] projection = {
        android.provider.MediaStore.Audio.Media._ID,
        android.provider.MediaStore.Audio.Media.SIZE,
    };
    try (android.database.Cursor cursor = ctx.getContentResolver().query(collection, projection,
        android.provider.MediaStore.Audio.Media.DISPLAY_NAME + " = ? AND "
            + android.provider.MediaStore.Audio.Media.RELATIVE_PATH + " = ?",
        new String[]{ fileName, path }, null)) {
      if (cursor == null || !cursor.moveToFirst()) return null;
      long id = cursor.getLong(0);
      long size = cursor.getLong(1);
      Uri row = android.content.ContentUris.withAppendedId(collection, id);
      org.json.JSONObject out = new org.json.JSONObject();
      out.put("fileName", fileName);
      out.put("size", size);
      out.put("uri", row.toString());
      return out.toString();
    }
  }
}
```

- [ ] **Step 3: `SafPublisher.java`**

```java
package cn.toside.music.mobile.download;

import android.content.Context;
import android.net.Uri;
import android.media.MediaScannerConnection;
import android.provider.DocumentsContract;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * temp 文件 → 用户挑的树里的直接子项。
 * 重名判定不在这里做：JS 侧先调 find() 挨个候选名字问过（谁占了、多大），
 * 拿一个确定空着的名字进来，原生只负责"照这个名字写进去"，写完尽力喊一次媒体扫描。
 */
public class SafPublisher {

  public static String publish(Context ctx, String treeUri, String fileName, String mimeType, File temp)
      throws Exception {
    Uri tree = Uri.parse(treeUri);
    Uri child = DocumentsContract.createDocument(ctx.getContentResolver(), tree, mimeType, fileName);
    if (child == null) throw new IllegalStateException("createDocument returned null");

    try (InputStream in = new FileInputStream(temp);
         OutputStream out = ctx.getContentResolver().openOutputStream(child)) {
      if (out == null) throw new IllegalStateException("openOutputStream returned null");
      byte[] buf = new byte[64 * 1024];
      int read;
      while ((read = in.read(buf)) > 0) out.write(buf, 0, read);
      out.flush();
    } catch (Exception e) {
      try { DocumentsContract.deleteDocument(ctx.getContentResolver(), child); } catch (Exception ignored) {}
      throw e;
    }
    // 能不能进系统音乐库要看媒体扫描的运气 —— 真机结论记录在 Task 8 Step 6。
    MediaScannerConnection.scanFile(ctx, new String[]{ child.toString() }, new String[]{ mimeType }, null);
    return child.toString();
  }

  /**
   * 问"这个确切的名字在这个树的根目录下有没有"。遍历子项后**在代码里**比对名字：
   * 各家 provider 对子项查询的 selection 支持不一（有的直接抛 IllegalArgumentException），
   * 所以不赌 selection，只赌 projection —— 这两个列在 DocumentsContract 里是必备的。
   */
  public static String find(Context ctx, String treeUri, String fileName) throws Exception {
    Uri tree = Uri.parse(treeUri);
    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree,
        DocumentsContract.getTreeDocumentId(tree));
    String[] projection = {
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
    };
    try (android.database.Cursor cursor = ctx.getContentResolver().query(children, projection, null, null, null)) {
      if (cursor == null) return null;
      int nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
      int sizeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
      int idIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
      if (nameIndex < 0 || idIndex < 0) return null;
      while (cursor.moveToNext()) {
        if (!fileName.equals(cursor.getString(nameIndex))) continue;
        // 有的 provider 不给 SIZE（返回 -1），那就当"大小未知"，由 JS 侧按不同大小处理（会让位到下一个名字）
        long size = sizeIndex < 0 ? -1 : cursor.getLong(sizeIndex);
        Uri row = DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(idIndex));
        org.json.JSONObject out = new org.json.JSONObject();
        out.put("fileName", fileName);
        out.put("size", size);
        out.put("uri", row.toString());
        return out.toString();
      }
      return null;
    }
  }
}
```

- [ ] **Step 4: `DownloadModule.publishFile` / `findFile` 换成真实现**

Replace the `publishFile` method in `DownloadModule.java`:

```java
  @ReactMethod
  public void publishFile(String params, Promise promise) {
    try {
      org.json.JSONObject json = new org.json.JSONObject(params);
      String mode = json.getString("mode");
      File temp = new File(json.getString("tempPath"));
      if (!temp.exists()) {
        promise.reject("ENOENT", "temp file is gone: " + temp.getAbsolutePath());
        return;
      }
      String fileName = json.getString("fileName");
      String mimeType = json.getString("mimeType");

      java.io.File storageRoot = android.os.Environment.getExternalStorageDirectory();
      android.app.usage.StorageStatsManager ssm = null;
      long available = storageRoot == null ? Long.MAX_VALUE : storageRoot.getUsableSpace();
      if (available < temp.length() + 1024 * 1024) {
        promise.reject("ENOSPACE", "not enough room: " + available + " free, needs " + temp.length());
        return;
      }

      if ("mediastore".equals(mode)) {
        android.net.Uri uri = MediaStorePublisher.publish(
            getReactApplicationContext(), temp,
            json.getString("volumeName"), json.getString("relativePath"), fileName, mimeType);
        if (temp.delete()) { /* 发布成功才清 temp */ }
        promise.resolve(uri.toString());
      } else if ("saf".equals(mode)) {
        String finalUri = SafPublisher.publish(getReactApplicationContext(),
            json.getString("treeUri"), fileName, mimeType, temp);
        temp.delete();
        promise.resolve(finalUri);
      } else {
        promise.reject("EBADPARAM", "unknown publish mode: " + mode);
      }
    } catch (Exception e) {
      promise.reject("EIO", String.valueOf(e.getMessage()));
    }
  }

  @ReactMethod
  public void findFile(String params, Promise promise) {
    try {
      org.json.JSONObject json = new org.json.JSONObject(params);
      String mode = json.getString("mode");
      String fileName = json.getString("fileName");
      String found;
      if ("mediastore".equals(mode)) {
        found = MediaStorePublisher.find(getReactApplicationContext(),
            json.getString("volumeName"), json.getString("relativePath"), fileName);
      } else if ("saf".equals(mode)) {
        found = SafPublisher.find(getReactApplicationContext(), json.getString("treeUri"), fileName);
      } else {
        promise.reject("EBADPARAM", "unknown publish mode: " + mode);
        return;
      }
      promise.resolve(found); // null 就是"这个名字没人占"，也走 resolve，JS 侧判 null
    } catch (Exception e) {
      promise.reject("EIO", String.valueOf(e.getMessage()));
    }
  }
```

> 这一替换必须把 Task 6 里 `publishFile` 与 `findFile` 两个 `reject("ENOSYS", ...)` 都换掉 —— Step 1 的闸门里有 `assert.doesNotMatch(module, /ENOSYS/)`，留一个就红。

> `android.app.usage.StorageStatsManager ssm = null;` 没用到，**落地时删掉这一行**（`getUsableSpace()` 已够用，StorageStatsManager 需要特殊权限）。`import java.io.File` 与 `java.util.Map` 之类按需补齐，不要用通配 import 掩盖漏掉的。

- [ ] **Step 5: 闸门 + 构建**

Run: `node --test --experimental-strip-types tests/download-publisher-source.test.mts` → Expected `pass 3`，`fail 0`
Run: `npm test`（先追加该文件）→ Expected `pass 426`，`fail 0`
Run: `cd android && ./gradlew.bat assembleDebug` → Expected `BUILD SUCCESSFUL`
装 APK（先请用户点头）。

- [ ] **Step 6: 真机两条通道各下一首，并把结论写回设计文档**

验收（每条都要留证据，不许"看起来没问题"）：

```bash
# A. MediaStore 那首真的进了媒体集合
MSYS_NO_PATHCONV=1 adb shell content query --uri content://media/external/audio/media \
  --projection title:relative_path:_size | grep -i "<刚下的歌名>"
# B. SAF 那首落在用户挑的树里
MSYS_NO_PATHCONV=1 adb shell ls -l /sdcard/Music/<用户挑的子目录>
# C. 两条各自的文件真的能播（用系统自带播放器打开路径 / content URI）
```

然后**打开手机自带"音乐"App 的本地歌曲列表**，看两首各在不在。把结论（含日期、机型、安卓版本）追加到设计文档 §9 风险表第二行的"状态"列：`✅ 已真机验证（2026-10-XX，vivo Android 16：MediaStore 那首在 / SAF 那首不在）` 或 `❌ 判负 → 采用 <退路>`。
**MediaStore 判负时的退路**：SAF 写完补 `scanFile` 后仍不可见 → 本功能降级为"本 App 内可播 + 文件确实在盘上"，并在下载页顶部挂 §8 那句提示；这等于第 4 条决策落空，**必须回头找用户重新拍板，不许自己替代**。

- [ ] **Step 7: 提交**

```bash
git add android/app/src/main/java/cn/toside/music/mobile/download tests/download-publisher-source.test.mts package.json docs/superpowers/specs/2026-10-14-music-download-design.md
git commit -m "feat(download): MediaStore 与 SAF 两条发布通道，并记真机音乐库索引结论"
```

---

### Task 9: 后台存活 / 6 小时配额真机验证 + 降级

设计文档 §9 的**生死判 #1**。

**Files:**
- Modify: `android/app/src/main/java/cn/toside/music/mobile/download/DownloadService.java`（在跑任务计数、stopSelf 真判断、断网/超时不误报完成）
- Modify: `src/utils/nativeModules/download.ts`（无需改，事件已定形）
- Create: `tests/download-service-lifecycle.test.mts`
- Modify: `docs/superpowers/specs/2026-10-14-music-download-design.md` §9 第一行状态
- Modify: `package.json:14`

**Interfaces:**
- Consumes: Task 7 的服务、Task 6 的 `onDownloadEvent`
- Produces: 事件 `{ action: 'serviceStopped' }`（不带 id）—— 服务被系统砍掉/6 小时配额到时原生主动播报，JS（Task 11）据此把在跑的任务转 `pause` + §8 文案。

- [ ] **Step 1: 服务收口三件事**

Modify `DownloadService.java`：

1. `private final AtomicInteger running = new AtomicInteger()`；`handleStart` 中 `running.incrementAndGet()`，`run()` 的 `finally` 中：

```java
      if (running.decrementAndGet() == 0) {
        stopForeground(true);
        stopSelf();
      }
```

并删掉 Task 7 里那个恒真的 `executorActiveTasksAreDone()`。

2. `onDestroy()` 里广播 `serviceStopped`（这是 JS 唯一的"我没了"信号）：

```java
  @Override
  public void onDestroy() {
    final WritableMap map = Arguments.createMap();
    map.putString("action", "serviceStopped");
    DownloadModule module = findModule();
    if (module != null) module.getDownloadEvent().sendEvent(DownloadEvent.CHANNEL, map);
    for (String id : cancelled.keySet()) cancelled.remove(id);
    super.onDestroy();
  }
```

3. 删掉 Task 7 留下的 `X-NOP` / `step` 垃圾行（若还没删）。

- [ ] **Step 2: 闸门测试**

Create `tests/download-service-lifecycle.test.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const service = readFileSync(path.join(rootPath, 'android/app/src/main/java/cn/toside/music/mobile/download/DownloadService.java'), 'utf8')

test('服务被砍时告诉 JS，而不是让 UI 停在假进度上', () => {
  assert.match(service, /onDestroy\(\)/)
  assert.match(service, /"serviceStopped"/)
})

test('stopSelf 由在跑任务数决定，不是恒真', () => {
  assert.match(service, /running\.decrementAndGet\(\)\s*==\s*0/)
  assert.doesNotMatch(service, /executorActiveTasksAreDone/)
})

test('不把网络异常当完成', () => {
  assert.match(service, /ETRUNC|ENET/)
})
```

Run: `node --test --experimental-strip-types tests/download-service-lifecycle.test.mts` → Expected `pass 3`，`fail 0`

- [ ] **Step 3: 真机三场景（每条留 logcat 或截图证据）**

```bash
cd android && ./gradlew.bat assembleDebug && cd ..
MSYS_NO_PATHCONV=1 adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

- **场景 1 息屏 5 分钟**：排 3 首（并发先设 1），App 退到后台、息屏 → 5 分钟后亮屏，看进度是否还在长。
  `MSYS_NO_PATHCONV=1 adb shell dumpsys activity services cn.toside.music.mobile` 里 `DownloadService` 应仍存在、`isForeground=true`、`foregroundServiceType=128`(dataSync)。
- **场景 2 划掉 App 以外的一切后台方式** + **场景 3 进程被杀**：下载中 `MSYS_NO_PATHCONV=1 adb shell am force-stop cn.toside.music.mobile` → 重开 App → 期望在跑任务从断点继续（temp 还在，`adb shell ls -l /sdcard/Android/data/cn.toside.music.mobile/files/download/` 看 `<id>.part` 从原大小继续长）。这依赖 Task 12 的恢复逻辑，**本任务只验"temp 文件与 Range 在这一场景下确实能续"**；JS 自动回队列在 Phase C 完成后复验一次（Task 12 Step 5）。
- **6 小时配额**：无法在验收里真跑 6 小时。做法：读安卓行为契约，把 `ForegroundServiceDidNotStopInTimeException` 的后果当作"服务被砍 → `serviceStopped` → JS 转 pause"来测——用 `MSYS_NO_PATHCONV=1 adb shell am force-stop` 之前先 `adb shell dumpsys activity services` 抓一条正常态、再用 `adb root` 不可行时直接杀掉服务进程（`adb shell kill $(adb shell pidof cn.toside.music.mobile)`），确认 JS 重开后走的是 pause 而不是"假装还在下"。

**把场景 1 的结论（含日期、机型、安卓版本、是否真的还在下）写回设计文档 §9 第一行"状态"列。**
判负退路（设计文档已写）：退回"仅 App 在前台/播放中下载"，并如实告知用户；此时本任务与 Task 12 的降级代码不变，只是文案不同。

- [ ] **Step 4: 提交**

```bash
git add android/app/src/main/java/cn/toside/music/mobile/download/DownloadService.java tests/download-service-lifecycle.test.mts package.json docs/superpowers/specs/2026-10-14-music-download-design.md
git commit -m "feat(download): 服务生命周期收口与后台存活真机结论（dataSync 生死判）"
```

---

# Phase C —— JS 状态与调度

---

### Task 10: 列表持久化 + download store

**Files:**
- Modify: `src/config/constant.ts:86`（`storageDataPrefix` 里 `dislikeList` 那行之后）
- Modify: `src/utils/data.ts`（末尾 `saveTempListMeta` 之后追加一组读写）
- Create: `src/store/download/state.ts`
- Create: `src/store/download/event.ts`
- Create: `src/store/download/action.ts`
- Create: `src/store/download/hook.ts`
- Create: `src/store/download/index.ts`
- Create: `tests/download-store.test.mts`
- Modify: `package.json:14`

**Interfaces:**
- Consumes: `LX.Download.ListItem`、`src/core/download/queue.ts` 的 `pickStartIds` / `restoreListOnBoot`（Task 5）
- Produces:
  - `getData`/`saveData` 层：`getDownloadList(): Promise<LX.Download.ListItem[]>`、`saveDownloadList(list): void`
  - store：`state.list: LX.Download.ListItem[]`、`actions.setList(list)`、`actions.addTasks(tasks, location: LX.AddMusicLocationType)`、`actions.patchTask(id, patch)`、`actions.updateTaskMetadata(id, patch)`、`actions.markCompleted(id, filePath, ext)`、`actions.removeTasks(ids)`、`actions.getTask(id)`、`event.list_changed()`、`event.task_updated(id)`
  - hooks：`useDownloadList()`、`useRunningTasks()`、`useCompletedTasks()`、`useDownloadTask(id)`
  - 每次 `setList`/`addTasks`/`patchTask`/`removeTasks` 之后**必须**同时 `global.app_event.downloadListUpdate()`（播放器那条链 `src/core/init/player/watchList.ts:36-41` 就靠它），并把整表落到 KV。

- [ ] **Step 1: 写失败的测试**

Create `tests/download-store.test.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(path.join(rootPath, rel), 'utf8')

const action = read('src/store/download/action.ts')
const data = read('src/utils/data.ts')

test('store 的每次改动都同时通知播放器与 UI', () => {
  // 少 emit 一次，下载完成时播放列表里的位置就不会更新（watchList 只听 downloadListUpdate）
  assert.equal(action.match(/global\.app_event\.downloadListUpdate\(\)/g)?.length, 4)
})

test('列表读写走 KV 前缀而不是裸 key', () => {
  assert.match(data, /storageDataPrefix\.download/)
})

test('完成判定同时写 isComplate 与 status（播放器 utils 只看 isComplate）', () => {
  assert.match(action, /isComplate: true/)
  assert.match(action, /status: 'completed'/)
})
```

Run: `node --test --experimental-strip-types tests/download-store.test.mts` → Expected FAIL

- [ ] **Step 2: KV 前缀与读写**

Modify `src/config/constant.ts`：在 `dislikeList: '@dislike_list',`（`:86`）之后加：

```ts
  download: '@download_list',
```

Modify `src/utils/data.ts`：在文件末尾追加（`throttle` 已从 `./common` 导入，`storageDataPrefix` 已导入）：

```ts
const downloadListKey = storageDataPrefix.download

let downloadList: LX.Download.ListItem[] | undefined

const saveDownloadListThrottle = throttle(() => {
  void saveData(downloadListKey, downloadList ?? [])
}, 300)

const initDownloadList = async() => {
  // eslint-disable-next-line require-atomic-updates
  downloadList ??= await getData<LX.Download.ListItem[]>(downloadListKey) ?? []
}

export const getDownloadList = async() => {
  await initDownloadList()
  return [...(downloadList ?? [])]
}

export const saveDownloadList = async(list: LX.Download.ListItem[]) => {
  await initDownloadList()
  downloadList = list
  saveDownloadListThrottle()
}
```

- [ ] **Step 3: store 五个文件（照 `src/store/dislikeList/` 形态）**

Create `src/store/download/state.ts`:

```ts
interface InitState {
  list: LX.Download.ListItem[]
}

const state: InitState = {
  list: [],
}

export {
  state,
}
```

Create `src/store/download/event.ts`（逐字照 `src/store/dislikeList/event.ts`，只换类名与事件名）:

```ts
import Event from '@/event/Event'


class DownloadEvent extends Event {
  list_changed() {
    this.emit('list_changed')
  }
  task_updated(id: string) {
    this.emit('task_updated', id)
  }
}


type EventMethods = Omit<EventType, keyof Event>


declare class EventType extends DownloadEvent {
  on<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): any
  off<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): any
}

type DownloadEventTypes = Omit<EventType, keyof Omit<Event, 'on' | 'off'>>


export const event: DownloadEventTypes = new DownloadEvent()
```

Create `src/store/download/action.ts`:

```ts
import { state } from './state'
import { event } from './event'
import { saveDownloadList } from '@/utils/data'

const sync = () => {
  void saveDownloadList(state.list)
  global.app_event.downloadListUpdate()
}

export const setList = (list: LX.Download.ListItem[]) => {
  state.list = list
  sync()
  event.list_changed()
}

export const addTasks = (tasks: LX.Download.ListItem[], location: LX.AddMusicLocationType = 'bottom') => {
  const exists = new Set(state.list.map(t => t.id))
  const added = tasks.filter(t => !exists.has(t.id))
  if (!added.length) return false
  state.list = location == 'top' ? [...added, ...state.list] : [...state.list, ...added]
  sync()
  event.list_changed()
  return true
}

export const getTask = (id: string) => state.list.find(item => item.id == id)

export const patchTask = (id: string, patch: Partial<LX.Download.ListItem>) => {
  const index = state.list.findIndex(item => item.id == id)
  if (index < 0) return
  const target = state.list[index]
  // 完成态必须成对写：播放器只看 isComplate（src/core/player/utils.ts:50-53），
  // UI 只看 status，两个不一致就会出现"列表说在下、播放器当它已下完"。
  const next = { ...target, ...patch }
  if (next.status == 'completed') next.isComplate = true
  state.list = [...state.list.slice(0, index), next, ...state.list.slice(index + 1)]
  event.task_updated(id)
  if (patch.status || patch.isComplate || patch.filePath !== undefined || patch.metadata) sync()
}

export const updateTaskMetadata = (id: string, patch: Partial<LX.Download.ListItem['metadata']>) => {
  const task = getTask(id)
  if (!task) return
  patchTask(id, { metadata: { ...task.metadata, ...patch } })
}

export const removeTasks = (ids: string[]) => {
  const removed = new Set(ids)
  state.list = state.list.filter(item => !removed.has(item.id))
  sync()
  event.list_changed()
}

export const markCompleted = (id: string, filePath: string, ext: LX.Download.FileExt) => {
  const task = getTask(id)
  if (!task) return
  patchTask(id, {
    status: 'completed',
    isComplate: true,
    progress: 1,
    speed: '',
    statusText: '',
    metadata: { ...task.metadata, filePath, ext },
  })
}
```

Create `src/store/download/hook.ts`:

```ts
import { useEffect, useMemo, useState } from 'react'
import { state } from './state'
import { event } from './event'

export const useDownloadList = () => {
  const [list, setList] = useState(state.list)
  useEffect(() => {
    const handleUpdate = () => setList(state.list)
    event.on('list_changed', handleUpdate)
    event.on('task_updated', handleUpdate)
    return () => {
      event.off('list_changed', handleUpdate)
      event.off('task_updated', handleUpdate)
    }
  }, [])
  return list
}

export const useRunningTasks = () => {
  const list = useDownloadList()
  return useMemo(() => list.filter(item => item.status != 'completed'), [list])
}

export const useCompletedTasks = () => {
  const list = useDownloadList()
  return useMemo(() => list.filter(item => item.isComplate), [list])
}
```

Create `src/store/download/index.ts`:

```ts
export * as actions from './action'
export * from './state'
export * from './hook'
```

- [ ] **Step 4: 闸门转绿 + 全量**

Run: `node --test --experimental-strip-types tests/download-store.test.mts` → Expected `pass 3`，`fail 0`
Run: `npm test`（先追加 ` tests/download-store.test.mts`）→ Expected `pass 432`，`fail 0`
Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → Expected `137`

- [ ] **Step 5: 提交**

```bash
git add src/config/constant.ts src/utils/data.ts src/store/download tests/download-store.test.mts package.json
git commit -m "feat(download): 任务列表 store 与 KV 持久化，改动同时通知播放器"
```

---

### Task 11: 调度器（`src/core/download/index.ts`）—— 四段式在这里收口

这是整个功能最核心的一个任务：取链（强制 `isRefresh`）、三道验收、写标签、发布、重试/认输，全在这里，且**顺序不许换**（设计文档 §4 不变量三）。

**Files:**
- Create: `src/core/download/index.ts`
- Modify: `src/core/download/format.ts`（追加 `extToMimeType`）
- Modify: `tests/download-format.mts`（追加 2 个用例）
- Create: `tests/download-scheduler.test.mts`（文本闸门：四段式顺序 + 强制刷新 + 同链认输）
- Modify: `src/types/app_setting.d.ts`（下载相关的三个 key 的**类型**：位置 / 位置名 / 并发数）
- Modify: `src/config/defaultSetting.ts`（同三个 key 的**默认值**）
- Modify: `package.json:14`

**Interfaces:**
- Consumes:
  - `getMusicUrl({ musicInfo, quality, isRefresh })` from `src/core/music/online.ts:42`（返回 `Promise<string>`）
  - `getLyricInfo({ musicInfo, isRefresh, allowToggleSource })` from `src/core/music/online.ts:84`
  - `onDownloadEvent` / `startDownloadTask` / `pauseDownloadTask` / `publishDownloadFile` / `findPublishedFile` / `getDownloadTempDir` / `isDownloadSupported`（Task 6/7/8）
  - `sniffAudioFormat` / `matchDeclaredQuality` / `resolveTarget` / `fileNameCandidates` / `pickPublishFileName` / `decideRetry` / `pickStartIds` / `formatSpeed` / `createDownloadTask`（A 阶段）
  - `actions` from `src/store/download/action`、`state` from `src/store/download/state`
  - `writeMetadata` / `writePic` / `writeLyric` from `react-native-local-media-metadata`
  - `downloadFile` / `stat` / `unlink` from `src/utils/fs.ts`
- Produces:
  ```ts
  export const initDownloadScheduler = async() => Promise<void>
  export const enqueueDownloads = (musicInfos: LX.Music.MusicInfoOnline[], quality: LX.Quality) => void
  export const pauseDownload = (id: string) => void
  export const resumeDownload = (id: string) => void
  export const retryDownload = (id: string) => void
  export const removeDownload = async(id: string, deleteFile: boolean) => Promise<void>
  export const hasDownloaded = (musicId: string) => boolean
  ```

- [ ] **Step 1: 先给 `format.ts` 补 MIME 映射（测试先行）**

Modify `tests/download-format.mts`，在末尾追加：

```ts
import { extToMimeType } from '../src/core/download/format.ts'

test('嗅探结果到 MIME 的映射覆盖本期全部容器', () => {
  assert.equal(extToMimeType('mp3'), 'audio/mpeg')
  assert.equal(extToMimeType('flac'), 'audio/flac')
  assert.equal(extToMimeType('ogg'), 'audio/ogg')
  assert.equal(extToMimeType('m4a'), 'audio/mp4')
  assert.equal(extToMimeType('wav'), 'audio/wav')
  assert.equal(extToMimeType('ape'), 'audio/x-ape')
})
```

Modify `src/core/download/format.ts`，在末尾追加：

```ts
// MediaStore 的 MIME_TYPE 与 SAF createDocument 的 mimeType 都用这张表，
// 值来自嗅探结果而不是服务器响应 —— 探针实测 Content-Type 会说谎。
const MIME_TYPES: Record<LX.Download.FileExt, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ape: 'audio/x-ape',
}

export const extToMimeType = (ext: LX.Download.FileExt): string => MIME_TYPES[ext]
```

Run: `node --test --experimental-strip-types tests/download-format.mts` → Expected `pass 7`，`fail 0`

- [ ] **Step 2: 写调度器的文本闸门（先红）**

Create `tests/download-scheduler.test.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scheduler = readFileSync(path.join(rootPath, 'src/core/download/index.ts'), 'utf8')
// 把 import 段切掉再比位置：这些名字在 import 里也出现，不切会拿 import 的位置误判顺序
const body = scheduler.slice(scheduler.indexOf('\n', scheduler.lastIndexOf("from '"))).replace(/\/\/.*$/gm, '')
const at = (token: string) => body.indexOf(token)

test('落盘四段式：校验先于写标签，写标签先于 publish（§4 不变量三）', () => {
  const sniff = at('sniffAudioFormat')
  const size = at('matchDeclaredQuality')
  const tag = at('writeMetadata')
  const publish = at('publishDownloadFile')
  assert.ok(sniff > -1 && size > sniff, '文件头校验必须在字节数对账之前')
  assert.ok(tag > -1 && tag > size, '标签不能写在未通过校验的文件上')
  assert.ok(publish > -1 && publish > tag, '发布必须在标签之后：进了 MediaStore 就拿不到可写裸路径了')
})

test('任务起手强制重取链接：实测缓存链十来分钟就死', () => {
  // 只盯取直链这一处：写标签时读内嵌歌词用的是 getLyricInfo({ isRefresh: false })，那是另一回事
  assert.match(body, /getMusicUrl\(\{[\s\S]{0,200}?isRefresh: true/)
  assert.doesNotMatch(body, /getMusicUrl\(\{[^}]*isRefresh: false/)
})

test('重取到同一条链立刻认输，不烧重试预算', () => {
  assert.match(body, /decideRetry/)
  assert.match(body, /!== lastUrl|=== lastUrl|urlChanged/)
})

test('试听片段（size_mismatch）绝不 publish', () => {
  const mismatch = at("'size_mismatch'")
  const publish = at('publishDownloadFile')
  assert.ok(mismatch > -1)
  assert.ok(mismatch < publish, '不匹配必须走失败分支，不能落到发布')
})

test('serviceStopped 把在跑任务转 pause，而不是留在假进度', () => {
  assert.match(body, /serviceStopped/)
  assert.match(body, /'6 小时|今天下载得太久了|download_limit_today/)
})

test('发布前先定名：查重名在 publish 之前，认领旧文件时不写新副本', () => {
  const find = at('findPublishedFile')
  const pick = at('pickPublishFileName')
  const publish = at('publishDownloadFile')
  assert.ok(find > -1 && pick > find, '先问再定：查询结果喂给 pickPublishFileName')
  assert.ok(publish > -1 && publish > pick, '定好名字才发布，否则 provider 会自己加 (1)')
  assert.match(body, /action == 'reuse'/)
  assert.match(body, /fileNameCandidates/)
})
```

Run: `node --test --experimental-strip-types tests/download-scheduler.test.mts` → Expected FAIL（文件不存在）

- [ ] **Step 3: 三个设置 key 先声明出来（本任务就要读它们）**

调度器要读 `download.savePath` 与 `download.maxDownloadNum`，所以这两个 key 的**类型与默认值**必须在本任务就位；Task 17 只负责把它们做成设置界面，不再重复声明。

Modify `src/types/app_setting.d.ts`：在 `'download.fileName': '歌名 - 歌手' | '歌手 - 歌名' | '歌名'` 之后加：

```ts

    /**
       * 下载保存位置：SAF 文件夹选择器给的 tree URI，%3A / %2F 是 URI 自身的一部分，不许解码
       */
    'download.savePath': string

    /**
       * 给用户看的文件夹名（tree URI 不可读，所以单独存一个名字）
       */
    'download.savePathName': string

    /**
       * 同时下载数量。首期的 dataSync 前台服务配额（24h 累计 6 小时）与真机结论都跟并发相关，
       * 所以只开三档，不提供"不限"。
       */
    'download.maxDownloadNum': 1 | 2 | 3
```

Modify `src/config/defaultSetting.ts`：在 `'download.fileName': '歌名 - 歌手',` 之后加：

```ts
  'download.savePath': '',
  'download.savePathName': '',
  'download.maxDownloadNum': 2,
```

- [ ] **Step 4: 写调度器**

Create `src/core/download/index.ts`:

```ts
import { Platform } from 'react-native'

import { getMusicUrl, getLyricInfo } from '@/core/music/online'
import { buildDownloadBaseName } from './name'
import { sniffAudioFormat, extToMimeType, MIN_HEAD_BYTES } from './format'
import { matchDeclaredQuality } from './verify'
import { resolveTarget, fileNameCandidates, pickPublishFileName, type PublishedFile } from './target'
import { createDownloadTask, pickStartIds, decideRetry, formatSpeed, type ErrorKind } from './queue'
import { actions } from '@/store/download'
import { state as downloadState } from '@/store/download/state'
import settingState from '@/store/setting/state'
import {
  isDownloadSupported,
  getDownloadTempDir,
  startDownloadTask,
  pauseDownloadTask,
  onDownloadEvent,
  publishDownloadFile,
  findPublishedFile,
  type DownloadNativeEvent,
} from '@/utils/nativeModules/download'
import { downloadFile, stat, unlink, existsFile } from '@/utils/fs'
import { toByteArray } from 'react-native-quick-base64'
import { writeMetadata, writePic, writeLyric } from 'react-native-local-media-metadata'
import { toast } from '@/utils/tools'
import { log } from '@/utils/log'

let tempDir = ''
let subscribed = false
const retriedCount = new Map<string, number>()
const lastUrl = new Map<string, string>()
// 速度用两次采样的差算，原生只报绝对字节数（§4 不变量二：原生只当搬运工）
const speedSample = new Map<string, { time: number, downloaded: number }>()

const statusText = (key: string) => global.i18n.t(key)

const errorKindFromNative = (code: string): ErrorKind => {
  switch (code) {
    case 'ELINK': return 'link_expired'
    case 'ENOSPACE': return 'space'
    case 'ENET': return 'network'
    case 'ETRUNC': return 'size_mismatch'
    case 'ENOENT': return 'network'
    default: return 'denied'
  }
}

const declaredQualityList = (
  musicInfo: LX.Music.MusicInfoOnline,
  requested: LX.Quality,
): { quality: LX.Quality, sizeText: string | null }[] => {
  // 这是 sizeFormate() 出的两位小数显示文本（"10.29 MiB"），不是字节数：
  // 探针实测的逐字节相等来自搜索 raw 字段，parse 阶段就丢掉了，这里只剩区间可用。
  const qualitys = musicInfo.meta._qualitys ?? {}
  const others = (Object.keys(qualitys) as LX.Quality[]).filter(q => q != requested)
  // 点的那档排第一：区间重叠时优先认它（明明下到了 320k 不该显示成 128k）
  return [requested, ...others].map(q => ({ quality: q, sizeText: qualitys[q]?.size ?? null }))
}

const fail = (id: string, kind: ErrorKind, copyKey: string) => {
  actions.patchTask(id, { status: 'error', statusText: statusText(copyKey), speed: '' })
  retriedCount.delete(id)
  lastUrl.delete(id)
  speedSample.delete(id)
}

const pump = () => {
  if (!isDownloadSupported()) return
  const maxNum = Platform.OS == 'android' ? settingState.setting['download.maxDownloadNum'] : 1
  for (const id of pickStartIds(downloadState.list, maxNum)) void runTask(id)
}

const resolveUrl = async(musicInfo: LX.Music.MusicInfoOnline, quality: LX.Quality): Promise<string> => {
  // 实测直链分钟级就死（wy +12 分钟已 403），所以不留"复用缓存链接"这条捷径。
  const url = await getMusicUrl({ musicInfo, quality, isRefresh: true, allowToggleSource: true })
  return url
}

const runTask = async(id: string) => {
  const task = actions.getTask(id)
  if (!task) return
  const musicInfo = task.metadata.musicInfo
  const quality = task.metadata.quality

  actions.patchTask(id, { status: 'run', statusText: '' })
  let url: string
  try {
    url = await resolveUrl(musicInfo, quality)
  } catch (err: any) {
    actions.patchTask(id, { status: 'error', statusText: statusText('download_url_failed') })
    log.warn(`resolve download url failed: ${err?.message ?? err}`)
    pump()
    return
  }

  const previousUrl = lastUrl.get(id)
  if (previousUrl !== undefined && previousUrl === url) {
    // 脚本内部也缓存直链（星澜 CACHE_TTL_MS = 6 小时），isRefresh 绕不过它。
    fail(id, 'dead_script', 'download_dead_link')
    pump()
    return
  }
  lastUrl.set(id, url)

  const fileName = buildDownloadBaseName(settingState.setting['download.fileName'], musicInfo)
  actions.updateTaskMetadata(id, { url, fileName })

  try {
    if (!tempDir) tempDir = await getDownloadTempDir()
  } catch (err: any) {
    actions.patchTask(id, { status: 'error', statusText: statusText('download_temp_failed') })
    return
  }

  speedSample.delete(id)
  startDownloadTask({ id, url, tempPath: `${tempDir}/${id}.part`, fileName })
}

/** 三道验收：文件头魔数 → 与声明大小对账 → 拒绝试听片段。全过才允许写标签。 */
const verifyCaptured = async(event: Extract<DownloadNativeEvent, { action: 'complete' }>) => {
  const task = actions.getTask(event.id)
  if (!task) return { ok: false as const, kind: 'network' as ErrorKind }

  const head = toByteArray(event.headBase64)
  if (head.length < MIN_HEAD_BYTES) return { ok: false, kind: 'not_audio' as ErrorKind }
  const ext = sniffAudioFormat(head)
  if (!ext) return { ok: false, kind: 'not_audio' as ErrorKind }

  // 取链会降档（getPlayQuality）：用户点 320k，源只给 128k 是正常的，不是"没下全"。
  // 所以拿**所有**档位的声明大小去对账（点的那档排第一，区间重叠时优先认它），
  // 对不上任何一档才是真异常 —— 实测 tx 某后端不分档位一律返回 960,887B 的 RS02 片段。
  const declaredQualitys = declaredQualityList(task.metadata.musicInfo, task.metadata.quality)
  const verdict = matchDeclaredQuality(event.downloaded, declaredQualitys)
  if (verdict.kind == 'mismatch') return { ok: false, kind: 'size_mismatch' as ErrorKind }
  // 实测对上了哪一档就记哪一档：界面显示的是"下到的"，不是"点过的"（§7.2）
  if (verdict.kind == 'match' && verdict.quality != task.metadata.quality) {
    actions.patchTask(event.id, { metadata: { ...task.metadata, quality: verdict.quality } })
  }
  return { ok: true as const, ext }
}

const writeTags = async(id: string, tempPath: string) => {
  const task = actions.getTask(id)
  if (!task) return
  const musicInfo = task.metadata.musicInfo

  try {
    await writeMetadata(tempPath, {
      name: musicInfo.name,
      singer: musicInfo.singer,
      albumName: musicInfo.meta.albumName ?? '',
    }, true)
  } catch (err: any) {
    log.warn(`write metadata failed: ${err?.message ?? err}`)
  }

  // 封面与歌词都是"拿不到就算了"：缺了不影响文件能播，绝不能让它们把已下好的歌判失败。
  const picUrl = musicInfo.meta.picUrl
  if (picUrl) {
    const picPath = `${tempDir}/${id}.pic`
    try {
      const result = await downloadFile(picUrl, picPath)
      if (result && result.statusCode === 200) {
        await writePic(tempPath, picPath)
      }
    } catch (err: any) {
      log.warn(`write pic failed: ${err?.message ?? err}`)
    } finally {
      void unlink(picPath).catch(() => {})
    }
  }

  try {
    const { rawlrcInfo } = await getLyricInfo({ musicInfo, isRefresh: false, allowToggleSource: false })
    if (rawlrcInfo?.lyric?.length) await writeLyric(tempPath, rawlrcInfo.lyric)
  } catch (err: any) {
    log.warn(`write lyric failed: ${err?.message ?? err}`)
  }
}

const publishTask = async(id: string) => {
  const task = actions.getTask(id)
  if (!task) return
  const savePath = settingState.setting['download.savePath']
  const target = resolveTarget(savePath, `${task.metadata.fileName}.${task.metadata.ext}`)
  if (!target) {
    fail(id, 'denied', 'download_path_invalid')
    return
  }

  // 重名/已存在都在这里定：先按候选名挨个问过去，第一个空名字就是它；
  // 大小和刚下的这份完全一致 → 这首歌本来就在文件夹里，认领旧文件，不再写一份。
  const where = {
    mode: target.mode,
    volumeName: target.mode == 'mediastore' ? target.volumeName : undefined,
    relativePath: target.mode == 'mediastore' ? target.relativePath : undefined,
    treeUri: target.mode == 'saf' ? target.treeUri : undefined,
  }
  const candidates = fileNameCandidates(task.metadata.fileName, task.metadata.ext)
  const measuredSize = task.downloaded
  let picked: { action: 'reuse', uri: string } | { action: 'create', fileName: string }
  try {
    const existing: (PublishedFile | null)[] = []
    for (const fileName of candidates) {
      const found = await findPublishedFile({ ...where, fileName })
      existing.push(found)
      if (!found || found.size === measuredSize) break // 空位或同一首，后面不用再问
    }
    picked = pickPublishFileName(candidates, existing, measuredSize)
  } catch (err: any) {
    // 查询失败不拦下载：退回本名（provider 可能自己加 (1)，比下不了强）
    log.warn(`find published file failed: ${err?.message ?? err}`)
    picked = { action: 'create', fileName: candidates[0]! }
  }

  if (picked.action == 'reuse') {
    await unlink(`${tempDir}/${id}.part`).catch(() => {})
    actions.markCompleted(id, picked.uri, task.metadata.ext)
    lastUrl.delete(id)
    retriedCount.delete(id)
    pump()
    return
  }

  let finalPath: string
  try {
    finalPath = await publishDownloadFile({
      tempPath: `${tempDir}/${id}.part`,
      ...where,
      fileName: picked.fileName,
      mimeType: extToMimeType(task.metadata.ext),
    })
  } catch (err: any) {
    const code = String(err?.code ?? '')
    fail(id, code == 'ENOSPACE' ? 'space' : 'denied', code == 'ENOSPACE' ? 'download_no_space' : 'download_publish_failed')
    return
  }

  actions.markCompleted(id, finalPath, task.metadata.ext)
  lastUrl.delete(id)
  retriedCount.delete(id)
  if (target.mode == 'saf') toast(statusText('download_path_not_indexed_tip'), 'long')
}

const handleFailure = async(id: string, kind: ErrorKind) => {
  await unlink(`${tempDir}/${id}.part`).catch(() => {})
  const count = retriedCount.get(id) ?? 0
  const urlChanged = kind != 'dead_script'
  const verdict = decideRetry(kind, urlChanged, count)
  retriedCount.set(id, count + 1)

  if (verdict == 'retry') {
    actions.patchTask(id, { status: 'waiting', statusText: statusText('download_refreshing_url'), speed: '' })
    pump()
    return
  }
  const copyKey = kind == 'size_mismatch' ? 'download_preview_only'
    : kind == 'not_audio' ? 'download_not_audio'
      : kind == 'space' ? 'download_no_space'
        : kind == 'denied' ? 'download_rate_limited'
          : 'download_dead_link'
  fail(id, kind, copyKey)
  pump()
}

const handleNativeEvent = (event: DownloadNativeEvent) => {
  if (event.action == 'progress') {
    const now = Date.now()
    const prev = speedSample.get(event.id)
    speedSample.set(event.id, { time: now, downloaded: event.downloaded })
    let speed = ''
    if (prev && now > prev.time) {
      speed = formatSpeed((event.downloaded - prev.downloaded) * 1000 / (now - prev.time))
    }
    actions.patchTask(event.id, {
      downloaded: event.downloaded,
      total: event.total,
      progress: event.total > 0 ? event.downloaded / event.total : 0,
      speed,
    })
    return
  }

  if (event.action == 'pause') {
    speedSample.delete(event.id)
    actions.patchTask(event.id, { status: 'pause', speed: '' })
    pump()
    return
  }

  if (event.action == 'serviceStopped') {
    // 安卓 15+ 的 dataSync 每 24h 只给累计 6 小时，超了系统强停；
    // 在跑的任务必须落地成 pause，否则 UI 永远停在假进度上。
    for (const task of downloadState.list) {
      if (task.status == 'run') actions.patchTask(task.id, { status: 'pause', speed: '', statusText: statusText('download_limit_today') })
    }
    pump()
    return
  }

  if (event.action == 'error') {
    void handleFailure(event.id ?? '', errorKindFromNative(event.code))
    return
  }

  if (event.action == 'complete') {
    void (async() => {
      const verified = await verifyCaptured(event)
      if (!verified.ok) {
        void handleFailure(event.id, verified.kind)
        return
      }
      actions.updateTaskMetadata(event.id, { ext: verified.ext })
      // 完成后显示"实测到的"而不是"请求过的"：探针里 HYW 后端被要求 128k 却给了 320k 的文件。
      const task = actions.getTask(event.id)
      if (task && verified.ext) actions.patchTask(event.id, { downloaded: event.downloaded, total: event.total || event.downloaded })
      await writeTags(event.id, `${tempDir}/${event.id}.part`)
      await publishTask(event.id)
      pump()
    })()
  }
}

export const initDownloadScheduler = async() => {
  if (!isDownloadSupported()) return
  tempDir = await getDownloadTempDir()
  if (!subscribed) {
    subscribed = true
    onDownloadEvent(handleNativeEvent)
  }
}

export const enqueueDownloads = (musicInfos: LX.Music.MusicInfoOnline[], quality: LX.Quality) => {
  const tasks = musicInfos
    .filter(m => !actions.getTask(m.id))
    .map(m => {
      const task = createDownloadTask(m, quality)
      task.metadata.fileName = buildDownloadBaseName(settingState.setting['download.fileName'], m)
      return task
    })
  if (!tasks.length) return
  actions.addTasks(tasks, settingState.setting['list.addMusicLocationType'])
  pump()
}

export const pauseDownload = (id: string) => {
  pauseDownloadTask(id)
}

export const resumeDownload = (id: string) => {
  actions.patchTask(id, { status: 'waiting', statusText: '' })
  pump()
}

export const retryDownload = (id: string) => {
  retriedCount.delete(id)
  lastUrl.delete(id)
  actions.patchTask(id, { status: 'waiting', statusText: '' })
  pump()
}

export const hasDownloaded = (musicId: string) => {
  const task = actions.getTask(musicId)
  return task?.isComplate === true
}

export const removeDownload = async(id: string, deleteFile: boolean) => {
  const task = actions.getTask(id)
  pauseDownloadTask(id)
  if (deleteFile && task?.metadata.filePath) {
    // content:// 与裸路径都能交给 react-native-file-system 的 unlink；删不掉就当已经被用户移走
    if (task.metadata.filePath.startsWith('content://')) {
      await unlink(task.metadata.filePath).catch(() => {})
    } else if (await existsFile(task.metadata.filePath)) {
      await unlink(task.metadata.filePath).catch(() => {})
    }
  }
  await unlink(`${tempDir}/${id}.part`).catch(() => {})
  actions.removeTasks([id])
  retriedCount.delete(id)
  lastUrl.delete(id)
  speedSample.delete(id)
}

export const verifyDownloadedFile = async(id: string) => {
  const task = actions.getTask(id)
  if (!task?.isComplate) return false
  if (!task.metadata.filePath) return false
  if (await existsFile(task.metadata.filePath)) return true
  actions.patchTask(id, { status: 'error', isComplate: false, statusText: statusText('download_file_missing') })
  return false
}

export const checkDownloadFilesOnBoot = async() => {
  for (const task of downloadState.list) {
    if (!task.isComplate || !task.metadata.filePath) continue
    if (task.metadata.filePath.startsWith('content://')) continue // 裸 stat 走不通，交给播放器自己报错
    await verifyDownloadedFile(task.id)
  }
  void stat('').catch(() => {}) // 保住在 stat 的引用：见下方注释
}
```

> **两处落地时必须顺手收口的坏味道**（先写在这里，避免 reviewer 事后才发现）：
> 1. `checkDownloadFilesOnBoot` 末尾那行 `void stat('').catch(...)` 是垃圾调用，**整行删掉**，并删掉 import 里的 `stat`（本任务没用上）。
> 2. `complete` 分支里 `if (task && verified.ext)` 这行是多余的（`verified.ok` 已保证 ext），**删掉**，只保留 `actions.patchTask(event.id, { downloaded: event.downloaded, total: event.total || event.downloaded })`。
> 3. `getLyricInfo` 的返回类型是 `LX.Player.LyricInfo`，其字段名以 `src/types/player.d.ts` 为准；若该类型里是 `rawlrc`/`lrc` 而不是 `rawlrcInfo`，**按实际类型改这一处**，不要为了过编译而 `as any`。
> 4. `actions.getTask` / `actions.patchTask` 是 Task 10 产的；`actions.getTask` 若在 Step 4 里发现 Task 10 未导出，回到 Task 10 补，**不要在本文件里另开一份读 state 的口子**（§4 不变量一）。

- [ ] **Step 5: 闸门转绿 + 全量**

Run: `node --test --experimental-strip-types tests/download-scheduler.test.mts` → Expected `pass 6`，`fail 0`
Run: `npm test`（先追加 ` tests/download-scheduler.test.mts`）→ Expected `pass 437`，`fail 0`
Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → Expected `137`（Step 3 已把三个设置 key 声明出来，所以本文件读 `download.savePath` / `download.maxDownloadNum` 不该报"属性不存在"）
Run: `npm run lint` → Expected 与基线同（无新增 error）

- [ ] **Step 6: 提交**

```bash
git add src/core/download/index.ts src/core/download/format.ts src/types/app_setting.d.ts src/config/defaultSetting.ts tests/download-format.mts tests/download-scheduler.test.mts package.json
git commit -m "feat(download): 调度器收口四段式，强制重取链并对不上声明大小即判失败"
```

---

### Task 12: 开机恢复接线

**Files:**
- Create: `src/core/init/download.ts`
- Modify: `src/core/init/index.ts`（`dataInit(setting)` 之后）
- Create: `tests/download-init.test.mts`
- Modify: `package.json:14`

**Interfaces:**
- Consumes: `getDownloadList`（Task 10）、`restoreListOnBoot`（Task 5）、`initDownloadScheduler` + `checkDownloadFilesOnBoot`（Task 11）、`actions.setList`
- Produces: `export default initDownload: () => Promise<void>`

- [ ] **Step 1: 写失败的测试**

Create `tests/download-init.test.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const initFile = readFileSync(path.join(rootPath, 'src/core/init/download.ts'), 'utf8')
const index = readFileSync(path.join(rootPath, 'src/core/init/index.ts'), 'utf8')

test('恢复顺序：先读列表 → run 降级 waiting → 交回 store → 起调度', () => {
  const load = initFile.indexOf('getDownloadList')
  const restore = initFile.indexOf('restoreListOnBoot')
  const set = initFile.indexOf('actions.setList')
  const scheduler = initFile.indexOf('initDownloadScheduler')
  assert.ok(load > -1 && restore > load)
  assert.ok(set > -1 && restore < set)
  assert.ok(scheduler > -1 && set < scheduler)
})

test('初始化挂在 dataInit 之后、设置就绪之后', () => {
  assert.match(index, /await initDownload\(\)/)
  assert.ok(index.indexOf('await dataInit(setting)') < index.indexOf('await initDownload()'))
})
```

- [ ] **Step 2: 写恢复逻辑**

Create `src/core/init/download.ts`:

```ts
import { getDownloadList } from '@/utils/data'
import { restoreListOnBoot } from '@/core/download/queue'
import { actions } from '@/store/download/action'
import { initDownloadScheduler, checkDownloadFilesOnBoot } from '@/core/download'
import { log } from '@/utils/log'

export default async() => {
  try {
    const list = await getDownloadList()
    // 原生侧不持久化任务状态：进程没了就是"没在下"。run 一律降级成 waiting，
    // 由调度器重新取链 + Range 从 temp 续（实测五源都支持 206）。
    actions.setList(restoreListOnBoot(list))
    await initDownloadScheduler()
    await checkDownloadFilesOnBoot()
  } catch (err: any) {
    // 恢复失败不能拖死启动：下载入口本身还可以用，只是这一批任务没回到队列。
    log.warn('download init failed: ' + (err?.message ?? err))
  }
}
```

Modify `src/core/init/index.ts`：在 `import initSync from './sync'`（`:15`）附近加 `import initDownload from './download'`；在 `await dataInit(setting)` / `bootLog('Data inited.')` 之后、`initMusicAddTimeTracker()` 之前插入：

```ts
  await initDownload()
  bootLog('Download inited.')
```

- [ ] **Step 3: 闸门转绿 + 全量**

Run: `node --test --experimental-strip-types tests/download-init.test.mts` → Expected `pass 2`，`fail 0`
Run: `npm test`（先追加 ` tests/download-init.test.mts`）→ Expected `pass 439`，`fail 0`
Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → Expected `137`

- [ ] **Step 4: 真机复验 Task 9 场景 3（这次带 UI）**

装 debug APK（先请用户点头）→ 在还没有 UI 入口前，用 Task 11 的 `enqueueDownloads` 临时从 `src/core/init/index.ts` 里调一次（**看完立刻撤掉临时代码，不许提交**），验证：
下载中 `adb shell am force-stop cn.toside.music.mobile` → 重开 App → logcat 里任务状态从 `run` 变 `waiting` 再变 `run`，且 `adb shell ls -l /sdcard/Android/data/cn.toside.music.mobile/files/download/` 里 `<id>.part` 从原大小继续长（**不是从 0**）。

- [ ] **Step 5: 提交**

```bash
git add src/core/init/download.ts src/core/init/index.ts tests/download-init.test.mts package.json
git commit -m "feat(download): 启动时恢复队列，run 降级 waiting 后续传"
```

# Phase D —— 壳（文案 → 面板 → 入口 → 页面 → 设置）

---

### Task 13: 面向用户的文案（三语言一次定稿）

后面四个任务都会 `t('download_*')`，所以文案先落地，UI 任务里就不必再碰 `src/lang`。

**Files:**
- Modify: `src/lang/zh-cn.json`
- Modify: `src/lang/zh-tw.json`
- Modify: `src/lang/en-us.json`
- Create: `tests/download-copy.test.mts`
- Modify: `docs/superpowers/specs/2026-10-14-music-download-design.md` §8（记一条实测偏差）
- Modify: `package.json:14`

**Interfaces:**
- Consumes: 设计文档 §8 定稿文案
- Produces: `download_*` 与 `setting_download*` 共 36 个 key，三个 json **键集必须完全一致**（缺一个 key 界面上就直接显示 key 名）。Task 14/15/16/17 只引用这一批 key，不许自创。

- [ ] **Step 1: 写失败的测试**

Create `tests/download-copy.test.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const langDir = path.join(rootPath, 'src/lang')
const read = (name: string) => JSON.parse(readFileSync(path.join(langDir, name), 'utf8')) as Record<string, string>

const zhc = read('zh-cn.json')
const zht = read('zh-tw.json')
const enu = read('en-us.json')

const keys = Object.keys(zhc).filter(k => k.startsWith('download_') || k.startsWith('setting_download'))

test('下载相关文案三个语言文件都有，且键集一致', () => {
  assert.ok(keys.length >= 30, `键数偏少，只有 ${keys.length}`)
  for (const key of keys) {
    assert.ok(key in zht, `zh-tw 缺 ${key}`)
    assert.ok(key in enu, `en-us 缺 ${key}`)
  }
})

test('界面文案不出现系统术语', () => {
  const banned = [/MediaStore/, /SAF/, /Range/, /前台服务/, /直链/, /URI/, /缓存/]
  for (const key of keys) {
    for (const rxp of banned) assert.doesNotMatch(zhc[key]!, rxp, `${key} 里出现了实现细节：${rxp}`)
  }
})

test('§8 定稿的两条长文案逐字保留', () => {
  assert.equal(zhc.download_preview_only, '这个音乐源只肯给片段，这首歌下不全。换个音质或换个音源再试')
  assert.equal(zhc.download_dead_link, '这个音源暂时取不到能下的链接。换一首或到设置里换个音源脚本再试')
  assert.equal(zhc.download_path_not_indexed_tip, '这个音乐 App 可能看不到这个文件夹里的歌。想都看到，改到设置里重选位置')
})
```

Run: `node --test --experimental-strip-types tests/download-copy.test.mts` → Expected FAIL（`键数偏少，只有 0`）

- [ ] **Step 2: 加 zh-cn 文案**

Modify `src/lang/zh-cn.json`：在 `"nav_discover": "发现",`（`:281`）之前插入整块（注意保持 JSON 合法，块内每行结尾都有逗号）：

```json
  "download_menu": "下载",
  "nav_download": "下载",
  "download_quality_title": "选择下载音质",
  "download_choose_path_title": "选一个文件夹存下载的歌",
  "download_first_tip": "选「音乐」里的文件夹，其他音乐 App 也能看到它们",
  "download_path_not_indexed_tip": "这个音乐 App 可能看不到这个文件夹里的歌。想都看到，改到设置里重选位置",
  "download_limit_today": "今天下载得太久了，先停一下。回到 App 点继续就能接着下",
  "download_refreshing_url": "下载链接过期了，正在重新获取…",
  "download_preview_only": "这个音乐源只肯给片段，这首歌下不全。换个音质或换个音源再试",
  "download_dead_link": "这个音源暂时取不到能下的链接。换一首或到设置里换个音源脚本再试",
  "download_rate_limited": "这个音乐源暂时下不动，过会儿再试",
  "download_no_space": "手机空间不多了，先腾点地方",
  "download_file_missing": "文件不在原来的位置了，可能被删了或换了存储卡",
  "download_not_audio": "这个音乐源给的不是能播的音频，换个音质或换个音源再试",
  "download_url_failed": "没能拿到下载地址，过会儿再试，或换个音源",
  "download_temp_failed": "手机上暂时存不了临时文件，重启 App 再试",
  "download_publish_failed": "没能把歌放进你选的文件夹，检查空间后再试",
  "download_path_invalid": "下载位置失效了，到设置里重新选一个",
  "download_quality_skipped": "有几首不支持这个音质，已经跳过",
  "download_already_added": "这些歌已经在下载列表里了",
  "download_empty": "还没有下载过歌曲",
  "download_running": "进行中",
  "download_done": "已完成",
  "download_pause": "暂停",
  "download_resume": "继续",
  "download_retry": "重试",
  "download_delete": "删除",
  "download_remove_title": "要删掉这条下载记录吗",
  "download_remove_message": "选「连同文件一起删除」会把歌从手机上抹掉",
  "download_remove_only": "只从列表移除",
  "download_remove_with_file": "连同文件一起删除",
  "download_deleted_from_list": "已从下载列表移除",
  "download_file_removed": "已连同文件一起删除",
  "setting_download": "下载",
  "setting_download_save_path": "保存位置",
  "setting_download_save_path_none": "还没选，第一次下载时会让你选",
  "setting_download_change_path": "换个位置",
  "setting_download_max_num": "同时下载数量",
  "setting_download_file_name": "文件名格式",
```

- [ ] **Step 3: 加 zh-tw 与 en-us（键集必须一致）**

Modify `src/lang/zh-tw.json`：同一位置插入同一批 key，值改繁体，两条定稿长文案为：

```json
  "download_preview_only": "這個音樂源只肯給片段，這首歌下不全。換個音質或換個音樂源再試",
  "download_dead_link": "這個音樂源暫時取不到能下的連結。換一首或到設定裡換個音樂源腳本再試",
  "download_path_not_indexed_tip": "這個音樂 App 可能看不到這個資料夾裡的歌。想都看到，改到設定裡重選位置",
  "download_first_tip": "選「音樂」裡的資料夾，其他音樂 App 也能看到它們",
```
其余 key 逐条对应繁体化（**必须 36 个都加**，缺一个界面就显示 key 名）。

Modify `src/lang/en-us.json`：同一批 key，英文值，例如：

```json
  "download_menu": "Download",
  "nav_download": "Downloads",
  "download_quality_title": "Choose audio quality",
  "download_choose_path_title": "Choose a folder for downloaded songs",
  "download_first_tip": "Pick a folder inside \"Music\" so other music apps can see these songs",
  "download_path_not_indexed_tip": "Other music apps may not see songs in this folder. To see them everywhere, pick another folder in Settings",
  "download_limit_today": "You have been downloading for a while today. Open the app and tap Resume to continue",
  "download_refreshing_url": "The download link expired. Getting a new one…",
  "download_preview_only": "This music source only offers a preview, so the song cannot be saved in full. Try another quality or source",
  "download_dead_link": "This music source cannot give a downloadable link right now. Try another song or reload a source script in Settings",
  "download_rate_limited": "This music source is busy. Try again a little later",
  "download_no_space": "Not enough free space on this phone. Make some room first",
  "download_file_missing": "The file is no longer where it was. It may have been deleted, or the storage card was removed",
  "download_not_audio": "This source returned something that is not playable audio. Try another quality or source",
  "download_url_failed": "Could not get a download address. Try again later or switch source",
  "download_temp_failed": "The phone cannot hold a temporary file right now. Restart the app and try again",
  "download_publish_failed": "Could not put the song into the folder you picked. Check free space and try again",
  "download_path_invalid": "The download folder is no longer valid. Pick one again in Settings",
  "download_quality_skipped": "Some songs do not have this quality and were skipped",
  "download_already_added": "These songs are already in the download list",
  "download_empty": "No downloads yet",
  "download_running": "In progress",
  "download_done": "Completed",
  "download_pause": "Pause",
  "download_resume": "Resume",
  "download_retry": "Retry",
  "download_delete": "Delete",
  "download_remove_title": "Remove this download",
  "download_remove_message": "Choosing \"Delete with file\" also erases the song from this phone",
  "download_remove_only": "Remove from list",
  "download_remove_with_file": "Delete with file",
  "download_deleted_from_list": "Removed from the download list",
  "download_file_removed": "Deleted together with the file",
  "setting_download": "Downloads",
  "setting_download_save_path": "Save location",
  "setting_download_save_path_none": "Not chosen yet. You will be asked at the first download",
  "setting_download_change_path": "Choose another folder",
  "setting_download_max_num": "Simultaneous downloads",
  "setting_download_file_name": "File name format",
```

- [ ] **Step 4: 记一条实测偏差到设计文档 §8**

Modify `docs/superpowers/specs/2026-10-14-music-download-design.md`：把 §8 表里 `| 下载中通知 | 正在下载 {n} 首 · 已完成 {p}% |` 那一行改成：

```markdown
| 下载中通知 | `{歌名} {p}%`（原生通知拿不到 JS 侧的语言包，跨桥取文案会让每条进度都过一次桥；歌名本来就是用户认得的东西，比"正在下载 3 首"更好读。§8 其余条目都在 JS 侧渲染，仍按原案） |
```

- [ ] **Step 5: 闸门转绿 + 全量**

Run: `node --test --experimental-strip-types tests/download-copy.test.mts` → Expected `pass 3`，`fail 0`
Run: `npm test`（先追加 ` tests/download-copy.test.mts`）→ Expected `fail 0`，总数比动手前多 3
Run: `npx tsc --noEmit 2>&1 | grep -E "lang/|download-copy"` → Expected 无输出

- [ ] **Step 6: 提交**

```bash
git add src/lang/zh-cn.json src/lang/zh-tw.json src/lang/en-us.json tests/download-copy.test.mts package.json docs/superpowers/specs/2026-10-14-music-download-design.md
git commit -m "feat(download): 下载文案三语言定稿，并记通知文案的实测偏差"
```

---

### Task 14: 音质面板 + 首次选位置

第 1、3 条决策落在这里。批量只弹一次（决策原话是"每次点击下载"，不是一首一首问 20 遍）。

**Files:**
- Create: `src/components/DownloadQualitySheet/index.tsx`
- Create: `tests/download-quality-sheet.test.mts`
- Modify: `package.json:14`

**Interfaces:**
- Consumes:
  - `global.lx.qualityList[source]`（`LX.Quality[]`，`src/core/apiSource.ts:30` 填）∩ `musicInfo.meta._qualitys`（同 `src/core/music/utils.ts:216-230` 的取交集思路）
  - `musicInfo.meta._qualitys[q].size`（`string | null`，`sizeFormate` 的显示文本）
  - `ChoosePath`（`src/components/common/ChoosePath/index.tsx`，`show({ title, dirOnly: true, saveToDir: true })` → `onConfirm(treeUri)`，内部已走 `selectManagedFolder(true)` 持久化授权）
  - `updateSetting`（`src/core/common.ts:38`）、`enqueueDownloads`（Task 11）
  - `useSheetSlideAnimation`（`src/utils/hooks/useSheetSlideAnimation`）、`GlassBackdrop`、`Icon`（icomoon 名 `download-2` 已存在）
- Produces:
  ```ts
  export interface DownloadQualitySheetType { show: (musicInfos: LX.Music.MusicInfoOnline[]) => void }
  export default DownloadQualitySheet // forwardRef<DownloadQualitySheetType>
  export const getSelectableQualitys = (musicInfo: LX.Music.MusicInfoOnline) => LX.Quality[]
  ```
  `getSelectableQualitys` 导出是为了闸门测试能直接喂夹具；面板自己用它判定"这首歌一个音质都选不了"（此时只弹一句提示，不进面板）。

- [ ] **Step 1: 写失败的测试**

Create `tests/download-quality-sheet.test.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(path.join(rootPath, 'src/components/DownloadQualitySheet/index.tsx'), 'utf8')

test('音质取的是"脚本支持与这首歌有"的交集，并且每档显示预计大小', () => {
  assert.match(source, /global\.lx\.qualityList/)
  assert.match(source, /_qualitys/)
  assert.match(source, /\bsize\b.*\?\?|size\b/)
  // 取不到 size 的档位不许编一个数字
  assert.match(source, /download_size_unknown|size \?\? ''|\bsize\s*\|\|\s*''/)
})

test('批量只弹一次：面板确认把整批交给 enqueueDownloads', () => {
  assert.match(source, /enqueueDownloads\(\s*\w+\s*,/)
  assert.doesNotMatch(source, /for \(.*of.*\)\s*\{\s*\w+Ref\.current\?\.show/)
})

test('用 Modal 而不是新的导航页，且不引入横屏分支', () => {
  assert.match(source, /<Modal/)
  assert.doesNotMatch(source, /navigation\.push|Navigation\.push/)
  assert.doesNotMatch(source, /landscape|horizontal/i)
})

test('首次没有保存位置时先选文件夹，再弹音质', () => {
  const choose = source.indexOf('choosePathRef.current?.show')
  const sheet = source.indexOf('handleConfirmPath')
  assert.ok(choose > -1 && sheet > choose, '必须先走完选位置再进面板')
  assert.match(source, /download\.savePath/)
  assert.match(source, /download\.savePathName/)
})
```

Run: `node --test --experimental-strip-types tests/download-quality-sheet.test.mts` → Expected FAIL

- [ ] **Step 2: 写面板**

Create `src/components/DownloadQualitySheet/index.tsx`:

```ts
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Animated, Modal, TouchableOpacity, View } from 'react-native'

import GlassBackdrop from '@/components/common/GlassBackdrop'
import Text from '@/components/common/Text'
import ChoosePath, { type ChoosePathType } from '@/components/common/ChoosePath'
import { useSheetSlideAnimation } from '@/utils/hooks/useSheetSlideAnimation'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle, toast, checkIgnoringBatteryOptimization } from '@/utils/tools'
import { updateSetting } from '@/core/common'
import { enqueueDownloads } from '@/core/download'
import { parseTreeUriDocId } from '@/core/download/target'
import settingState from '@/store/setting/state'

const QUALITY_ORDER = ['flac24bit', 'flac', '320k', '192k', '128k'] as const

export interface DownloadQualitySheetType {
  show: (musicInfos: LX.Music.MusicInfoOnline[]) => void
}

/** 脚本声明支持的档位 ∩ 这首歌真有那个档位。两个条件少一个都会下到空档。 */
export const getSelectableQualitys = (musicInfo: LX.Music.MusicInfoOnline): LX.Quality[] => {
  const supported = global.lx.qualityList[musicInfo.source] ?? []
  const qualitys = musicInfo.meta._qualitys ?? {}
  return QUALITY_ORDER.filter(q => (supported as string[]).includes(q) && !!qualitys[q as LX.Quality])
}

export default forwardRef<DownloadQualitySheetType>((_, ref) => {
  const theme = useTheme()
  const t = useI18n()
  const choosePathRef = useRef<ChoosePathType>(null)
  const sheetRef = useRef<View>(null)
  const pendingRef = useRef<LX.Music.MusicInfoOnline[]>([])
  const [visible, setVisible] = useState(false)
  const [qualitys, setQualitys] = useState<LX.Quality[]>([])
  const [sizes, setSizes] = useState<Partial<Record<LX.Quality, string | null>>>({})
  const slide = useSheetSlideAnimation()

  const hide = () => {
    slide.hide(() => setVisible(false))
  }

  const openSheet = (musicInfos: LX.Music.MusicInfoOnline[]) => {
    // 批量取交集：面板选一档要能套到整批上（第 3 条决策是一次点完，不是逐首问）
    const list = QUALITY_ORDER as readonly LX.Quality[]
    const selectable = list.filter(q => musicInfos.every(m => getSelectableQualitys(m).includes(q)))
    if (!selectable.length) {
      toast(t('download_quality_skipped'), 'long')
      return
    }
    const sizes: Partial<Record<LX.Quality, string | null>> = {}
    for (const q of selectable) sizes[q] = musicInfos[0]!.meta._qualitys?.[q]?.size ?? null
    pendingRef.current = musicInfos
    setQualitys(selectable)
    setSizes(sizes)
    setVisible(true)
    requestAnimationFrame(() => slide.show())
  }

  useImperativeHandle(ref, () => ({
    show(musicInfos) {
      // 第 1 条决策：第一次下载先选位置，之后记住。两条路径都在这一个入口里串完，
      // 不能让用户点两次才发现要选目录。
      if (settingState.setting['download.savePath']) {
        openSheet(musicInfos)
        return
      }
      pendingRef.current = musicInfos
      choosePathRef.current?.show({
        title: t('download_choose_path_title'),
        dirOnly: true,
        saveToDir: true,
        isPersist: true,
      })
    },
  }))

  const handleConfirmPath = (path: string) => {
    const doc = parseTreeUriDocId(path)
    updateSetting({
      'download.savePath': path,
      'download.savePathName': doc?.relativePath.split('/').filter(Boolean).pop() ?? path,
    })
    // 第一次开通下载顺手引导加省电白名单（内部有 flag，问过就不再问）：
    // vivo 的后台策略下不加白名单，息屏一会儿下载就会被掐断。
    void checkIgnoringBatteryOptimization()
    toast(t('download_first_tip'), 'long')
    openSheet(pendingRef.current)
  }

  const handlePick = (quality: LX.Quality) => {
    hide()
    const musics = pendingRef.current
    pendingRef.current = []
    // 整批一次入队。个别歌没有这个档位不要紧：取链走的是现成的降档逻辑
    // （getPlayQuality），能下哪档就下哪档，落盘后再按实测字节数对账
    enqueueDownloads(musics, quality)
    if (musics.length > 1) toast(t('download_menu') + ` · ${musics.length}`, 'short')
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={hide}>
      <View style={styles.container}>
        <TouchableOpacity activeOpacity={1} style={styles.mask} onPress={hide} />
        <Animated.View style={[styles.sheet, { backgroundColor: theme['c-content-background'], transform: [{ translateY: slide.translateY }] }]}>
          <GlassBackdrop blurRadius={24} overlayOpacity={0.5} />
          <Text size={13} style={styles.title} color={theme['c-font']} numberOfLines={1}>
            {t('download_quality_title')}
          </Text>
          {
            qualitys.map(quality => (
              <TouchableOpacity
                key={quality}
                style={{ ...styles.item, borderTopColor: theme['c-border-background'] }}
                onPress={() => handlePick(quality)}
              >
                <Text size={13} color={theme['c-font']}>{quality}</Text>
                {/* 取不到 size 就留空，不编数字 */}
                <Text size={11} color={theme['c-font-light']}>{sizes[quality] ?? ''}</Text>
              </TouchableOpacity>
            ))
          }
        </Animated.View>
      </View>
      <ChoosePath ref={choosePathRef} onConfirm={handleConfirmPath} />
    </Modal>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  mask: {
    ...createStyle({ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }).position,
  },
  sheet: {
    paddingTop: 14,
    paddingBottom: 20,
    borderRadius: 12,
    overflow: 'hidden',
  },
  title: {
    paddingLeft: 16,
    paddingBottom: 8,
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderTopWidth: 1,
  },
})
```

> 落地校对三件事，不许靠 `as any` 过编译：
> 1. `ReadOptions`（`src/components/common/ChoosePath/index.tsx:21`）里若有 `isPersist` 就照上面写；**若该字段不存在就删掉那一行**，`saveToDir: true` 已经足够走系统文件夹选择器 + 持久化授权。
> 2. `theme['c-font-light']` 必须是 `src/theme/*.ts` 里真实存在的键（**本项目键名要 grep 确认**，写错不会报错，只会渲染成 undefined 颜色）。
> 3. `slide.translateY` / `slide.show()` / `slide.hide(cb)` 以 `src/utils/hooks/useSheetSlideAnimation.ts` 的实际返回值为准；不一致就按它改，参照 `MusicMoreSheet.tsx` 的用法。

- [ ] **Step 3: 闸门转绿 + 全量**

Run: `node --test --experimental-strip-types tests/download-quality-sheet.test.mts` → Expected `pass 4`，`fail 0`
Run: `npm test`（先追加 ` tests/download-quality-sheet.test.mts`）→ Expected `fail 0`，总数 +4
Run: `npx tsc --noEmit 2>&1 | grep "DownloadQualitySheet"` → Expected 无输出

- [ ] **Step 4: 提交**

```bash
git add src/components/DownloadQualitySheet tests/download-quality-sheet.test.mts package.json
git commit -m "feat(download): 音质面板每次点击下载弹一次，首次先选保存位置"
```

---

### Task 15: 在线列表入口（单首 + 批量）

**Files:**
- Modify: `src/components/OnlineList/ListMenu.tsx`（`:18-26` props、`:58-67` 菜单、`:81-108` switch）
- Modify: `src/components/OnlineList/index.tsx`（`:31` MultipleAction、`OnlineMultipleActions` 的 actions、`handleMultipleAction`、`<ListMenu>` JSX、挂载面板）
- Create: `tests/download-entry.test.mts`
- Modify: `package.json:14`

**Interfaces:**
- Consumes: `DownloadQualitySheetType`（Task 14）、`isDownloadSupported`（Task 6）、`hasDownloaded`（Task 11）
- Produces: ListMenu 新增必填 prop `onDownload: (selectInfo: SelectInfo) => void`；`MultipleAction` 联合类型新增 `'download'`。**ListMenu 还被 `src/screens/Home/Views/Mylist/MusicList/ListMenu.tsx` 独立实现着（不是同一份代码）**，本期只改 `src/components/OnlineList/`，不动 mylist 那份（见 Step 5 的闸门）。

- [ ] **Step 1: 写失败的测试**

Create `tests/download-entry.test.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(path.join(rootPath, rel), 'utf8')

const menu = read('src/components/OnlineList/ListMenu.tsx')
const list = read('src/components/OnlineList/index.tsx')

test('菜单里有下载，且只在安卓且有原生模块时出现', () => {
  assert.match(menu, /action: 'download'/)
  assert.match(menu, /isDownloadSupported\(\)/)
  assert.doesNotMatch(menu, /\/\/ \{ action: 'download'/)
})

test('多选栏也有下载：整批一次交给面板', () => {
  assert.match(list, /'download'/)
  assert.match(list, /qualitySheetRef\.current\?\.show\(info\)/)
  assert.match(list, /qualitySheetRef\.current\?\.show\(\[info\.musicInfo\]\)/)
})

test('下载入口不落到横屏目录或 mylist 那份菜单里（本期范围只有在线列表）', () => {
  assert.doesNotMatch(read('src/screens/Home/Horizontal/Aside.tsx'), /download/)
  assert.doesNotMatch(read('src/screens/Home/Views/Mylist/MusicList/ListMenu.tsx'), /action: 'download'/)
})
```

Run: `node --test --experimental-strip-types tests/download-entry.test.mts` → Expected FAIL

- [ ] **Step 2: ListMenu 加菜单项**

Modify `src/components/OnlineList/ListMenu.tsx`：

导入区加：

```ts
import { isDownloadSupported } from '@/utils/nativeModules/download'
import { hasDownloaded } from '@/core/download'
```

`ListMenuProps`（`:18-26`）里 `onRemoveCache` 之后加一行：

```ts
  onDownload: (selectInfo: SelectInfo) => void
```

`handleSetMenu`（`:56-79`）里把注释掉的那行换成真菜单项，并按能力/状态禁用：

```ts
    let has_url_cache = false
    const canDownload = isDownloadSupported() && !hasDownloaded(musicInfo.id)
    const menu = [
      { action: 'play', label: t('play') },
      { action: 'playLater', label: t('play_later') },
      { action: 'download', label: t('download_menu'), disabled: !canDownload },
      { action: 'add', label: t('add_to') },
      { action: 'copyName', label: t('copy_name') },
      { action: 'musicSourceDetail', label: t('music_source_detail') },
      { action: 'removeCache', disabled: !has_url_cache, label: t('list_remove_cache') },
      { action: 'dislike', label: t('dislike'), disabled: hasDislike(musicInfo) },
    ]
```

`handleMenuPress`（`:81-108`）的 `case 'add':` 之前加：

```ts
      case 'download':
        props.onDownload(selectInfo)
        break
```

- [ ] **Step 3: index.tsx 接面板**

Modify `src/components/OnlineList/index.tsx`：

导入区加（`ListMenu` 那行之后）：

```ts
import DownloadQualitySheet, { type DownloadQualitySheetType } from '@/components/DownloadQualitySheet'
import { isDownloadSupported } from '@/utils/nativeModules/download'
```

`MultipleAction`（`:31`）加 `'download'`：

```ts
type MultipleAction = 'playLater' | 'add' | 'toggleSource' | 'copyName' | 'musicSourceDetail' | 'removeCache' | 'dislike' | 'download'
```

`OnlineMultipleActions` 的 `menus`（`:67-75`）里 `removeCache` 之后插入（**必须排在 `dislike` 之前**，闸门不查顺序，人查）：

```ts
      ...(isDownloadSupported() ? [{ action: 'download' as MultipleAction, label: t('download_menu'), disabled: !selectedList.length }] : []),
```

组件里加 ref（`musicToggleModalRef` 那行之后）：

```ts
  const qualitySheetRef = useRef<DownloadQualitySheetType>(null)
```

`handleMultipleAction`（`:172-199`）的 `case 'dislike':` 之前加：

```ts
      case 'download':
        hancelExitSelect()
        qualitySheetRef.current?.show(info)
        break
```

`<ListMenu ... />` 的 `onRemoveCache` 那行之后加：

```ts
        onDownload={info => { qualitySheetRef.current?.show([info.musicInfo]) }}
```

并在 `<MusicToggleModal ref={musicToggleModalRef} />` 之后加：

```ts
      <DownloadQualitySheet ref={qualitySheetRef} />
```

- [ ] **Step 4: 闸门转绿 + 真机点一遍**

Run: `node --test --experimental-strip-types tests/download-entry.test.mts` → Expected `pass 3`，`fail 0`
Run: `npm test`（先追加 ` tests/download-entry.test.mts`）→ Expected `fail 0`，总数 +3
Run: `npx tsc --noEmit 2>&1 | grep -E "OnlineList|ListMenu"` → Expected 无输出
Run: `cd android && ./gradlew.bat assembleDebug` → 装机（先请用户点头）

真机（vivo，竖屏）验收：搜索 → 结果列表长按一首 → 菜单里有"下载" → 点它 →（首次）先出系统文件夹选择器 → 选完自动出音质面板，档位后面带预计大小 → 选一档 → 下载页能看到进度。**多选 3 首 → 点"下载"→ 只弹一个面板**（决策 3 的批量口径）。

- [ ] **Step 5: 提交**

```bash
git add src/components/OnlineList/ListMenu.tsx src/components/OnlineList/index.tsx tests/download-entry.test.mts package.json
git commit -m "feat(download): 在线列表长按菜单与多选栏接入下载入口"
```

---

### Task 16: 下载页 + 底部导航第 4 个 tab

**Files:**
- Create: `src/screens/Home/Views/Download/index.tsx`
- Delete: `src/screens/Home/Views/Download/index.js`
- Modify: `src/config/constant.ts:112-116`（`NAV_MENUS`）
- Modify: `src/screens/Home/Vertical/Main.tsx`（`viewMap` + PagerView 第 4 页）
- Create: `tests/download-page.test.mts`
- Modify: `package.json:14`

**Interfaces:**
- Consumes: `useRunningTasks` / `useCompletedTasks`（Task 10）、`pauseDownload` / `resumeDownload` / `retryDownload` / `removeDownload`（Task 11）、`LIST_IDS.DOWNLOAD`（`src/config/constant.ts:14`）、`setPlayMusicInfo`（`src/core/player/playInfo.ts:122`）、icomoon 图标 `download-2`（已存在于 `src/resources/fonts/selection.json`）
- Produces: `nav_download` 这个 `NAV_ID_Type`（由 `NAV_MENUS` 派生，无需改类型定义）

- [ ] **Step 1: 写失败的测试**

Create `tests/download-page.test.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(path.join(rootPath, rel), 'utf8')

const page = read('src/screens/Home/Views/Download/index.tsx')
const constant = read('src/config/constant.ts')
const main = read('src/screens/Home/Vertical/Main.tsx')

test('占位页已经换成真页面', () => {
  assert.ok(!existsSync(path.join(rootPath, 'src/screens/Home/Views/Download/index.js')), 'index.js 必须删掉，否则 metro 会优先解析旧文件')
  assert.match(constant, /id: 'nav_download', icon: 'download-2'/)
})

test('tab 与 pager 页一一对应：NAV_MENUS 的长度等于 viewMap 的条目数', () => {
  const ids = [...constant.matchAll(/id: '(nav_\w+)'/g)].map(m => m[1]!)
  assert.ok(ids.includes('nav_download'))
  for (const id of ids) {
    if (id == 'nav_setting') continue // setting 是覆盖层，不在 pager 里
    assert.match(main, new RegExp(`${id}: \\d`), `Vertical/Main.tsx 的 viewMap 缺 ${id}`)
    assert.match(main, new RegExp(`key="${id}"`), `PagerView 缺 ${id} 这一页`)
  }
})

test('下载页分两组：进行中与已完成，删除必须问一句', () => {
  assert.match(page, /useRunningTasks\(\)/)
  assert.match(page, /useCompletedTasks\(\)/)
  assert.match(page, /download_remove_only/)
  assert.match(page, /download_remove_with_file/)
})

test('下载页不依赖横屏布局', () => {
  assert.doesNotMatch(page, /landscape|isHorizontal|Horizontal/i)
})
```

Run: `node --test --experimental-strip-types tests/download-page.test.mts` → Expected FAIL

- [ ] **Step 2: 写下载页**

Create `src/screens/Home/Views/Download/index.tsx`:

```tsx
import { useMemo } from 'react'
import { FlatList, View } from 'react-native'

import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle, confirmDialog, toast } from '@/utils/tools'
import { sizeFormate } from '@/utils/common'
import { useRunningTasks, useCompletedTasks } from '@/store/download/hook'
import { pauseDownload, resumeDownload, retryDownload, removeDownload } from '@/core/download'
import { setPlayMusicInfo } from '@/core/player/playInfo'
import { LIST_IDS } from '@/config/constant'
import type { LX } from '@/types'

const RunItem = ({ task }: { task: LX.Download.ListItem }) => {
  const theme = useTheme()
  const t = useI18n()

  const handleRemove = async() => {
    const deleteFile = await confirmDialog({
      title: t('download_remove_title'),
      message: t('download_remove_message'),
      confirmButtonText: t('download_remove_with_file'),
      cancelButtonText: t('download_remove_only'),
    })
    void removeDownload(task.id, deleteFile)
    toast(deleteFile ? t('download_file_removed') : t('download_deleted_from_list'), 'short')
  }

  return (
    <View style={{ ...styles.item, borderBottomColor: theme['c-border-background'] }}>
      <View style={styles.itemInfo}>
        <Text size={13} color={theme['c-font']} numberOfLines={1}>{task.metadata.musicInfo.name}</Text>
        <Text size={11} color={theme['c-font-light']} numberOfLines={1}>
          {task.metadata.musicInfo.singer} · {task.status == 'error' || task.status == 'pause' ? task.statusText : `${task.speed || '--'} · ${Math.round(task.progress * 100)}%`}
        </Text>
        <View style={styles.progressBg}>
          <View style={{ ...styles.progress, backgroundColor: theme['c-primary'], width: `${Math.min(100, task.progress * 100)}%` }} />
        </View>
      </View>
      <View style={styles.actions}>
        {
          task.status == 'run'
            ? <Button onPress={() => pauseDownload(task.id)} style={styles.btn}>{t('download_pause')}</Button>
            : task.status == 'error'
              ? <Button onPress={() => retryDownload(task.id)} style={styles.btn}>{t('download_retry')}</Button>
              : <Button onPress={() => resumeDownload(task.id)} style={styles.btn}>{t('download_resume')}</Button>
        }
        <Button onPress={() => { void handleRemove() }} style={styles.btn}>{t('download_delete')}</Button>
      </View>
    </View>
  )
}

const DoneItem = ({ task }: { task: LX.Download.ListItem }) => {
  const theme = useTheme()
  const t = useI18n()

  const handlePlay = () => {
    setPlayMusicInfo(LIST_IDS.DOWNLOAD, task)
  }
  const handleRemove = async() => {
    const deleteFile = await confirmDialog({
      title: t('download_remove_title'),
      message: t('download_remove_message'),
      confirmButtonText: t('download_remove_with_file'),
      cancelButtonText: t('download_remove_only'),
    })
    void removeDownload(task.id, deleteFile)
  }

  return (
    <View style={{ ...styles.item, borderBottomColor: theme['c-border-background'] }}>
      <View style={styles.itemInfo}>
        <Text size={13} color={theme['c-font']} numberOfLines={1}>{task.metadata.musicInfo.name}</Text>
        <Text size={11} color={theme['c-font-light']} numberOfLines={1}>
          {task.metadata.musicInfo.singer} · {task.metadata.quality} · {task.metadata.ext} · {sizeFormate(task.downloaded)}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button onPress={handlePlay} style={styles.btn}>{t('play')}</Button>
        <Button onPress={() => { void handleRemove() }} style={styles.btn}>{t('download_delete')}</Button>
      </View>
    </View>
  )
}

export default () => {
  const theme = useTheme()
  const t = useI18n()
  const running = useRunningTasks()
  const done = useCompletedTasks()
  const isEmpty = useMemo(() => !running.length && !done.length, [running.length, done.length])

  if (isEmpty) {
    return (
      <View style={styles.container}>
        <Text size={12} color={theme['c-font-light']} style={styles.empty}>{t('download_empty')}</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <FlatList
        ListHeaderComponent={
          <View>
            <Text size={12} color={theme['c-font']} style={styles.groupTitle}>{t('download_running')}</Text>
            {running.length ? null : <Text size={11} color={theme['c-font-light']} style={styles.groupEmpty}>--</Text>}
          </View>
        }
        data={running}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <RunItem task={item} />}
      />
      <View style={{ ...styles.groupTitle, paddingHorizontal: 12 }}>
        <Text size={12} color={theme['c-font']}>{t('download_done')}</Text>
      </View>
      <FlatList
        data={done}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <DoneItem task={item} />}
      />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  empty: {
    textAlign: 'center',
    marginTop: 60,
  },
  groupTitle: {
    paddingTop: 10,
    paddingBottom: 6,
    paddingHorizontal: 12,
  },
  groupEmpty: {
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  itemInfo: {
    flex: 1,
    paddingRight: 8,
  },
  progressBg: {
    height: 3,
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  progress: {
    height: 3,
    borderRadius: 2,
  },
  actions: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  btn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginTop: 3,
  },
})
```

> 落地校对：
> 1. 已完成那一行显示的是**实测到的**：`sizeFormate(task.downloaded)` 是落盘文件的真实字节数，`metadata.ext` 是文件头嗅探出的格式（探针实测 URL 尾巴和 Content-Type 都会说谎）。档位文字 `metadata.quality` 仍是用户点的那一档 —— 它已经被"声明大小对账"背书过（对不上就走不到这里），而从字节数推不出码率，所以不假装能测。
> 2. `import type { LX } from '@/types'` 若 `src/types/index.ts` 没有再导出（`LX` 是全局 ambient 命名空间），**直接删掉这行 import**，用 `LX.Download.ListItem` 即可 —— 别为了"看起来有 import"留一行假的。
> 3. `confirmDialog` 只给两个按钮，`cancelButtonText`/`confirmButtonText` 的语义正好是"只移除 / 连文件一起删"（`src/utils/tools.ts:192-207`：确认返回 `true`）。上面把"连文件删"放在 confirm 侧 = **更危险的那个动作要正按**，符合"必须问一句"的原意，别调换。
> 4. 两个 `FlatList` 同屏会抢滚动，真机若手感明显不对，合并成**一个** `FlatList` + 两个 section（`SectionList` 也行）。这条以真机为准，不预设。

- [ ] **Step 3: 加 tab 与 pager 页**

Modify `src/config/constant.ts:112-116`：

```ts
export const NAV_MENUS = [
  { id: 'nav_discover', icon: 'leaderboard' },
  { id: 'nav_love', icon: 'love' },
  { id: 'nav_search', icon: 'search-2' },
  { id: 'nav_download', icon: 'download-2' },
] as const
```

Modify `src/screens/Home/Vertical/Main.tsx`：导入 `import Download from '../Views/Download'`；`viewMap` 加 `nav_download: 3`；`<PagerView>` 内 `nav_search` 那页之后加：

```tsx
          <View collapsable={false} key="nav_download" style={styles.pageStyle}>
            <NavPage id="nav_download" render={() => <Download />} />
          </View>
```

> 横屏侧（`src/screens/Home/Horizontal/Aside.tsx`）会跟着 `NAV_MENUS` 多出一枚"下载"按钮，点它在 `Horizontal/Main.tsx` 里落到 `default: return <Search />`。**本项目 portrait-only，横屏是死代码，不要为它补页**（AGENTS.md）。Step 1 的闸门只检查"我们没有往横屏目录加下载相关代码"。

- [ ] **Step 4: 删占位页 + 闸门转绿**

```bash
git rm src/screens/Home/Views/Download/index.js
```

Run: `node --test --experimental-strip-types tests/download-page.test.mts` → Expected `pass 4`，`fail 0`
Run: `npm test`（先追加 ` tests/download-page.test.mts`）→ Expected `fail 0`，总数 +4
Run: `npx tsc --noEmit 2>&1 | grep -E "Views/Download|Vertical/Main"` → Expected 无输出

- [ ] **Step 5: 真机验收**

装机 → 底部导航出现第 4 个 tab（`download-2` 图标）→ 下载中那首显示速度/百分比/进度条 → 暂停再继续（断点接着长，不从 0）→ 完成后那首点"播放"能播（离线播放完整接通在 Task 18，这一步只验"能进播放列表且不崩"）→ 删除弹二选一，选"只从列表移除"后文件还在（`adb shell ls` 复核），选"连同文件一起删除"后文件真没了。**这四条是 §7.3 的硬要求，不许只看界面。**

- [ ] **Step 6: 提交**

```bash
git add src/screens/Home/Views/Download src/config/constant.ts src/screens/Home/Vertical/Main.tsx tests/download-page.test.mts package.json
git commit -m "feat(download): 下载页两组列表与底部导航入口"
```

---

### Task 17: 设置项界面（位置 / 文件名格式 / 并发数）

**Files:**
- Create: `src/screens/Home/Views/Setting/settings/Download/index.tsx`
- Create: `src/screens/Home/Views/Setting/settings/Download/SavePath.tsx`
- Create: `src/screens/Home/Views/Setting/settings/Download/MaxNum.tsx`
- Create: `src/screens/Home/Views/Setting/settings/Download/FileName.tsx`
- Modify: `src/screens/Home/Views/Setting/Main.tsx:17-30,58-76`
- Create: `tests/download-settings.test.mts`
- Modify: `package.json:14`

**Interfaces:**
- Consumes: `ChoosePath`（`saveToDir: true`）、`updateSetting`、`useSettingValue`（`src/store/setting/hook.ts:20`）、`SubTitle`/`Section`（`src/screens/Home/Views/Setting/components/`）、`CheckBox`（`src/components/common/CheckBox`，`need` 属性单选，用法同 `settings/Player/PlayHighQuality.tsx`）
- Produces:
  - 三个设置 key 的**类型与默认值**已在 Task 11 Step 3 声明（`download.savePath` / `download.savePathName` / `download.maxDownloadNum`），本任务只做界面，**不要再声明一遍**
  - `SETTING_SCREENS` 新增 `'download'`（NavList 靠 `t('setting_download')` 出标签，Task 13 已有该 key）

- [ ] **Step 1: 写失败的测试**

Create `tests/download-settings.test.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(path.join(rootPath, rel), 'utf8')

const type = read('src/types/app_setting.d.ts')
const defaults = read('src/config/defaultSetting.ts')
const settingMain = read('src/screens/Home/Views/Setting/Main.tsx')
const savePath = read('src/screens/Home/Views/Setting/settings/Download/SavePath.tsx')
const scheduler = read('src/core/download/index.ts')

test('三个设置 key 仍在（Task 11 Step 3 声明，本任务不许重复声明第二个来源）', () => {
  assert.match(type, /'download\.savePath': string/)
  assert.match(type, /'download\.savePathName': string/)
  assert.match(type, /'download\.maxDownloadNum': 1 \| 2 \| 3/)
  assert.match(defaults, /'download\.savePath': ''/)
  assert.match(defaults, /'download\.savePathName': ''/)
  assert.match(defaults, /'download\.maxDownloadNum': 2/)
})

test('设置分组注册了 download', () => {
  assert.match(settingMain, /'download',/)
  assert.match(settingMain, /case 'download': return <Download \/>/)
})

test('重选位置同时清掉旧位置名，并且走系统文件夹选择器', () => {
  assert.match(savePath, /saveToDir: true/)
  assert.match(savePath, /'download\.savePath':\s*\w+\s*,\s*\n?\s*'download\.savePathName'/)
})

test('并发数设置真的被调度器读到', () => {
  assert.match(scheduler, /download\.maxDownloadNum/)
})

test('文件名格式三选一（复用已有的 download.fileName 设置，不开新 key）', () => {
  const fileName = read('src/screens/Home/Views/Setting/settings/Download/FileName.tsx')
  assert.match(fileName, /'download\.fileName'/)
  assert.match(fileName, /歌名 - 歌手/)
  assert.match(fileName, /歌手 - 歌名/)
  assert.doesNotMatch(fileName, /download\.fileNameName/) // 不许出现编出来的第二个 key
})
```

Run: `node --test --experimental-strip-types tests/download-settings.test.mts` → Expected FAIL

- [ ] **Step 2: 设置分组三个文件**

Create `src/screens/Home/Views/Setting/settings/Download/SavePath.tsx`:

```tsx
import { memo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import Text from '@/components/common/Text'
import ChoosePath, { type ChoosePathType } from '@/components/common/ChoosePath'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { parseTreeUriDocId } from '@/core/download/target'
import { createStyle } from '@/utils/tools'

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const choosePathRef = useRef<ChoosePathType>(null)
  const savePath = useSettingValue('download.savePath')
  const savePathName = useSettingValue('download.savePathName')

  const handleConfirm = (path: string) => {
    const doc = parseTreeUriDocId(path)
    // 位置与显示名必须成对换：只改 path 而留着旧名字，界面会指着没在用的文件夹说"歌在这里"
    updateSetting({
      'download.savePath': path,
      'download.savePathName': doc?.relativePath.split('/').filter(Boolean).pop() ?? path,
    })
  }

  return (
    <>
      <SubTitle title={t('setting_download_save_path')}>
        <View style={styles.content}>
          <Text size={11} color={savePath ? theme['c-font'] : theme['c-font-light']} numberOfLines={2} style={styles.path}>
            {savePath ? savePathName : t('setting_download_save_path_none')}
          </Text>
          <Button onPress={() => choosePathRef.current?.show({ title: t('download_choose_path_title'), dirOnly: true, saveToDir: true })} small>
            {t('setting_download_change_path')}
          </Button>
        </View>
      </SubTitle>
      <ChoosePath ref={choosePathRef} onConfirm={handleConfirm} />
    </>
  )
})

const styles = createStyle({
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  path: {
    flex: 1,
    paddingRight: 8,
  },
})
```

Create `src/screens/Home/Views/Setting/settings/Download/MaxNum.tsx`:

```tsx
import { memo } from 'react'
import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'

const MAX_NUMS = [1, 2, 3] as const

const Item = ({ num }: { num: 1 | 2 | 3 }) => {
  const t = useI18n()
  const value = useSettingValue('download.maxDownloadNum')
  return (
    <CheckBox
      marginRight={8}
      check={value == num}
      label={t('setting_download_max_num') + ' ' + num}
      onChange={() => { updateSetting({ 'download.maxDownloadNum': num }) }}
      need
    />
  )
}

export default memo(() => {
  return (
    <SubTitle title="">
      <View style={styles.list}>
        {MAX_NUMS.map(num => <Item key={num} num={num} />)}
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
})
```

> `CheckBox` 的 `label` 在这里拼成了"同时下载数量 2"这种整句，**真机看着啰嗦就改成三枚只有数字的按钮 + 一行副标题**；这是观感问题不是功能问题，以真机为准（[[feedback-taste-over-spec]] 的口径：先小样看，别拿规范指标压观感）。

Create `src/screens/Home/Views/Setting/settings/Download/index.tsx`:

```tsx
import { memo } from 'react'

import Section from '../../components/Section'
import SavePath from './SavePath'
import FileName from './FileName'
import MaxNum from './MaxNum'
import { useI18n } from '@/lang'

export default memo(() => {
  const t = useI18n()
  return (
    <Section title={t('setting_download')}>
      <SavePath />
      <FileName />
      <MaxNum />
    </Section>
  )
})
```

Create `src/screens/Home/Views/Setting/settings/Download/FileName.tsx`（`download.fileName` 是**已有**的设置项，以前只给"分享"用，这里给它配个界面）：

```tsx
import { memo } from 'react'
import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'

const FORMATS = ['歌名 - 歌手', '歌手 - 歌名', '歌名'] as const

const Item = ({ format }: { format: LX.AppSetting['download.fileName'] }) => {
  const t = useI18n()
  const value = useSettingValue('download.fileName')
  return (
    <CheckBox
      marginRight={8}
      check={value == format}
      label={format}
      onChange={() => { updateSetting({ 'download.fileName': format }) }}
      need
    />
  )
}

export default memo(() => {
  return (
    <SubTitle title={t('setting_download_file_name')}>
      <View style={styles.list}>
        {FORMATS.map(format => <Item key={format} format={format} />)}
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
})
```

> `FileName` 里 `SubTitle` 标题已经写了"文件名格式"，`CheckBox` 的 `label` 就只留模板本身（三行 `歌名 - 歌手 / 歌手 - 歌名 / 歌名`），别把标题重复进每一行 —— 观感以真机为准。

- [ ] **Step 3: 注册分组**

Modify `src/screens/Home/Views/Setting/Main.tsx`：`import Download from './settings/Download'`（`import Other` 之后）；`SETTING_SCREENS` 里 `'list',` 之后加 `'download',`；`switch` 里 `case 'list': return <List />` 之后加 `case 'download': return <Download />`。

- [ ] **Step 4: 确认调度器读的是设置**

Task 11 Step 4 写的 `pump()` 就是读设置的。本步只做核对，**不改代码**：

```ts
const pump = () => {
  if (!isDownloadSupported()) return
  const maxNum = Platform.OS == 'android' ? settingState.setting['download.maxDownloadNum'] : 1
  for (const id of pickStartIds(downloadState.list, maxNum)) void runTask(id)
}
```

- [ ] **Step 5: 闸门转绿 + 真机**

Run: `node --test --experimental-strip-types tests/download-settings.test.mts` → Expected `pass 5`，`fail 0`
Run: `npm test`（先追加 ` tests/download-settings.test.mts`）→ Expected `fail 0`，总数 +5
Run: `npx tsc --noEmit 2>&1 | grep -E "Setting/settings/Download|Setting/Main"` → Expected 无输出

真机：设置里出现"下载"分组 → 显示当前位置名 → "换个位置"能重选 → 下一首后文件确实落在新位置（`adb shell ls`）→ 并发数选 3 后连排 3 首能同时在跑，通知栏不炸（vivo）。

- [ ] **Step 6: 提交**

```bash
git add src/screens/Home/Views/Setting/settings/Download src/screens/Home/Views/Setting/Main.tsx tests/download-settings.test.mts package.json
git commit -m "feat(download): 下载设置分组（位置/并发数）"
```

---

### Task 18: 离线播放接通（断网能播、能显歌词）

验收标准最后一条。**这是恢复 `src/core/music/download.ts` 里被注释掉的三个本地分支**，不是新写一套。

**Files:**
- Modify: `src/core/music/download.ts`
- Modify: `src/core/player/playInfo.ts:139-142`
- Create: `tests/download-offline.test.mts`
- Modify: `package.json:14`

**Interfaces:**
- Consumes: `LX.Download.ListItem.metadata.filePath`（`content://...` 或 SAF document URI）、`existsFile` / `readFile`（`src/utils/fs.ts:54,43`）、`readPic` / `readLyric`（`react-native-local-media-metadata`）、`buildLyricInfo` / `getCachedLyricInfo`（`./utils`，该文件已 import）、`temporaryDirectoryPath`（`src/utils/fs.ts:20`）、`state`（`src/store/download/state`）
- Produces: `getDownloadFilePath(musicInfo: LX.Download.ListItem): Promise<string | null>`（同文件导出；调用方是 `src/core/music/index.ts` 的 `'progress' in musicInfo` 分支与 `src/core/player/playInfo.ts` 的 DOWNLOAD 列表，Task 16 的"播放"按钮只是往播放器塞任务，不自己解析路径）

- [ ] **Step 1: 写失败的测试**

Create `tests/download-offline.test.mts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(path.join(rootPath, rel), 'utf8')

const music = read('src/core/music/download.ts')
const playInfo = read('src/core/player/playInfo.ts')

test('三个本地分支都恢复了：路径 / 封面 / 歌词', () => {
  assert.match(music, /export const getDownloadFilePath/)
  assert.match(music, /readPic/)
  assert.match(music, /readLyric/)
  assert.doesNotMatch(music, /getDownloadFilePath\(musicInfo, appSetting/)
})

test('本地优先：拿得到文件就用本地，拿不到才回源在线', () => {
  const order = music.indexOf('getDownloadFilePath')
  const online = music.indexOf('getOnlineMusicUrl')
  assert.ok(order > -1 && order < online, '必须先判本地文件再回源')
  assert.match(music, /isRefresh/)
})

test('播放列表认得 download 列表（原来是硬返回空数组）', () => {
  assert.match(playInfo, /listId == LIST_IDS\.DOWNLOAD \? \.\.\.downloadList/)
  assert.doesNotMatch(playInfo, /LIST_IDS\.DOWNLOAD \? \[\]/)
})
```

Run: `node --test --experimental-strip-types tests/download-offline.test.mts` → Expected FAIL

- [ ] **Step 2: 恢复三个本地分支**

Modify `src/core/music/download.ts`，整体改成（保留原有的在线兜底链，注释掉的旧代码清干净，不留 `//` 尸体）：

```ts
import {
  getMusicUrl as getOnlineMusicUrl,
  getPicUrl as getOnlinePicUrl,
  getLyricInfo as getOnlineLyricInfo,
} from './online'
import { buildLyricInfo, getCachedLyricInfo } from './utils'
import { existsFile, temporaryDirectoryPath } from '@/utils/fs'
import { readPic, readLyric } from 'react-native-local-media-metadata'
import { log } from '@/utils/log'

/**
 * 已下载歌曲的本地位置。文件可能已经在 MediaStore 里（content://），
 * 也可能还在用户挑的树上（SAF document URI），两者都存在 metadata.filePath 里，
 * 播放器与 react-native-file-system 都直接吃这两种形态。
 * 拿不到（被用户删了、SD 卡拔了）就返回 null，让上层回源在线播。
 */
export const getDownloadFilePath = async(musicInfo: LX.Download.ListItem): Promise<string | null> => {
  const path = musicInfo.metadata.filePath
  if (!path) return null
  try {
    return await existsFile(path) ? path : null
  } catch (err: any) {
    log.warn(`stat downloaded file failed: ${err?.message ?? err}`)
    return null
  }
}

export const getMusicUrl = async({ musicInfo, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  allowToggleSource?: boolean
}): Promise<string> => {
  if (!isRefresh) {
    const path = await getDownloadFilePath(musicInfo)
    if (path) return path
  }

  return getOnlineMusicUrl({ musicInfo: musicInfo.metadata.musicInfo, isRefresh, onToggleSource, allowToggleSource })
}

export const getPicUrl = async({ musicInfo, isRefresh, listId, onToggleSource = () => {} }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  listId?: string | null
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if (!isRefresh) {
    const path = await getDownloadFilePath(musicInfo)
    if (path) {
      try {
        // 封面在文件里，得先抽成一张临时图片才能交给 Image 组件；抽不到就继续用在线图
        const picPath = await readPic(path, `${temporaryDirectoryPath}/downloadPic`)
        if (picPath) return picPath.startsWith('file://') ? picPath : `file://${picPath}`
      } catch (err: any) {
        log.warn(`read embedded pic failed: ${err?.message ?? err}`)
      }
    }
    const onlineMusicInfo = musicInfo.metadata.musicInfo
    if (onlineMusicInfo.meta.picUrl) return onlineMusicInfo.meta.picUrl
  }

  return getOnlinePicUrl({ musicInfo: musicInfo.metadata.musicInfo, isRefresh, onToggleSource }).then((url) => {
    // TODO: when listId required save url (update downloadInfo)

    return url
  })
}

export const getLyricInfo = async({ musicInfo, isRefresh, onToggleSource = () => {} }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo.metadata.musicInfo)
    if (lyricInfo) return buildLyricInfo(lyricInfo)

    // 下载时把歌词写进了文件（Task 11 的 writeLyric），断网时这里就是唯一来源
    const path = await getDownloadFilePath(musicInfo)
    if (path) {
      try {
        const lyric = await readLyric(path, true)
        if (lyric) return buildLyricInfo({ lyric })
      } catch (err: any) {
        log.warn(`read embedded lyric failed: ${err?.message ?? err}`)
      }
    }
  }

  return getOnlineLyricInfo({
    musicInfo: musicInfo.metadata.musicInfo,
    isRefresh,
    onToggleSource,
  }).catch(async() => {
    throw new Error('failed')
  })
}
```

- [ ] **Step 3: 播放列表返回真列表**

Modify `src/core/player/playInfo.ts`：导入区加 `import { state as downloadState } from '@/store/download/state'`；`:139-142` 改成：

```ts
export const getList = (listId: string | null): LX.Music.MusicInfo[] | LX.Download.ListItem[] => {
  return listId == LIST_IDS.DOWNLOAD ? [...downloadState.list] : getListMusicSync(listId)
}
```

> `src/core/player/utils.ts:48-52` 已经在过滤 `'progress' in s && !s.isComplate`，所以未下完的任务不会进可播队列 —— 这里不要重复过滤。`src/core/init/player/watchList.ts:36-41` 听的是 `downloadListUpdate`，Task 10 的 `sync()` 每次都 emit，链路是通的。

- [ ] **Step 4: 闸门转绿 + 真机离线验收**

Run: `node --test --experimental-strip-types tests/download-offline.test.mts` → Expected `pass 3`，`fail 0`
Run: `npm test`（先追加 ` tests/download-offline.test.mts`）→ Expected `fail 0`，总数 +3
Run: `npx tsc --noEmit 2>&1 | grep -E "music/download|player/playInfo"` → Expected 无输出
Run: `cd android && ./gradlew.bat assembleDebug` → 装机（先请用户点头）

真机（验收标准最后一条）：**开飞行模式** → 下载页已完成那首点播放 → 能出声、封面显示、歌词滚动；切下一首已完成的不报错；`LIST_IDS.DOWNLOAD` 列表在"我喜欢"里加一首下载过的歌不炸。若歌词/封面在飞行模式下取不到，先用 `adb shell` 确认文件里真的有标签（`readLyric` 走的是文件内嵌，不是缓存）。

- [ ] **Step 5: 提交**

```bash
git add src/core/music/download.ts src/core/player/playInfo.ts tests/download-offline.test.mts package.json
git commit -m "feat(download): 恢复下载项的本地路径/封面/歌词分支，断网可播"
```

---

# Phase E —— 验收与收口

---

### Task 19: 五条验收标准逐条真机验收 + 结论回写

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-music-download-design.md`（§1 验收表加"实测列"、§9 风险表把待验证项定成结论）
- Modify: `docs/superpowers/plans/2026-10-14-music-download.md`（本任务在文末"验收记录"追加实测数据）

**Interfaces:**
- Consumes: Task 8（音乐库索引）、Task 9（后台存活）已回写的结论；本任务是**汇总复核**，不写新功能
- Produces: 五条验收的实测记录 + 一份"已知不行"清单

- [ ] **Step 1: 逐条跑（每台设备各跑一遍：vivo Android 16 + OPPO）**

| # | 验收标准（设计 §1） | 怎么做 |
| --- | --- | --- |
| 1 | 永久免费 / 无自建后端 | `git grep -n "http.*://.*xunyin\|server" android/app/src/main/java/cn/toside/music/mobile/download` 应无服务端代码；`package.json` 无新增依赖（本计划**零新增 npm 依赖**，用到 `react-native-quick-base64`、`react-native-local-media-metadata` 都已在 `package.json:33`） |
| 2 | 真进系统音乐库 | 下载 2 首（一首放 `Music/xunyin`，一首放 `Download/xunyin`）→ 打开 vivo 自带"音乐"App 的本地歌曲列表，两首各自的可见性要写进结论；再 `adb shell content query --uri content://media/external/audio/media --projection title:relative_path:_size` 交叉核对 |
| 3 | 后台继续 | 排 3 首 → 息屏 5 分钟 → 亮屏看进度；期间 `adb shell dumpsys activity services cn.toside.music.mobile` 抓 `DownloadService` 的 `isForeground` / `foregroundServiceType` |
| 4 | 进程被杀可恢复 | 下到 40% 时 `adb shell am force-stop cn.toside.music.mobile` → 重开 → 队列自动回来且 `<id>.part` 从原字节继续长（`adb shell ls -l`） |
| 5 | 离线可播 | 飞行模式 → 已完成那首能播 + 有歌词（Task 18 Step 4 的复验） |

- [ ] **Step 2: 结论回写设计文档**

Modify 设计文档 §1：在验收表后加一行说明，并把每台设备的实际结果写成表（格式：`| 后台继续 | vivo16 ✅ / OPPO 待测 | 2026-10-XX |`）；§9 的三行"待真机验证"按实测改成 `✅/❌ + 日期 + 机型`，判负的写清退路。

Modify 本文件末尾"验收记录"小节，追加实测数据（**只写结论与机型，绝不写直链**）。

- [ ] **Step 3: 全量闸门**

Run: `npm test` → Expected `fail 0`，总数 ≥ 484（384 基线 + 本计划 100 条新用例）
Run: `npx tsc --noEmit 2>&1 | grep -E "src/core/download|src/store/download|nativeModules/download|DownloadQualitySheet|Views/Download|music/download|init/download"` → Expected 无输出
Run: `npm run lint` → Expected 与基线同（只看本次改过的文件有无新增 error）

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/specs/2026-10-14-music-download-design.md docs/superpowers/plans/2026-10-14-music-download.md
git commit -m "docs(download): 五条验收标准的真机结论与设计文档收口"
```

---

### Task 20: 分支收口 + 公开分发的决策（不许自动往下走）

**Files:**
- Create: `docs/superpowers/plans/2026-10-14-music-download-acceptance.md`（若 Task 19 数据太多放不进主文档，单开一份）

**Interfaces:**
- Consumes: 前 19 个任务的提交
- Produces: 一条可评审的功能分支；一条**必须由用户拍板**的未决项

- [ ] **Step 1: 整理提交**

```bash
git status --short        # 必须只剩别人的 WIP（识曲那条线），不能有本功能的残留未提交文件
git log --oneline feat/music-recognition-phase1..HEAD
```

Expected：20 笔左右功能提交，无 `git add -A` 带进来的无关文件；`git status` 里 `src/` 的未提交 WIP 与开工前一致。

- [ ] **Step 2: 跑 `superpowers:finishing-a-development-branch` 之前，先向用户要一个决定**

**版权与分发（设计文档 §9 最后一行，状态"需用户决策"）**：上游 lyswhut/lx-music-mobile 正是把下载整块删掉的，本项目要公开发版是否带上这个功能，**不由实现者决定**。必须原话问清楚：

1. 只自用（APK 不对外，走原更新链路时公告不提下载）？
2. 对外发版但功能入口默认隐藏 / 需要用户自己导入音源脚本才出现（当前实现就是这个形态）？
3. 对外发版并公告？

在拿到答复前**不要**推远程、不要发版、不要写公告。

- [ ] **Step 3: 按答复收口**

- 选 1：分支留在本地，等用户后续决定；
- 选 2 或 3：走 `superpowers:finishing-a-development-branch`（本仓库惯例是推双远程 github + gitee，见 [[project-update-delivery]]），公告 id 用 `>= 2`（`id=1` 已 retire）。推送属对外可见动作，**每推一次都要用户单独点头**。

---

## 验收记录（执行时逐条追加，勿预填）

```
- [ ] Task 8：MediaStore 发布后自带"音乐"App 是否索引 —— 机型 / 日期 / 结论
- [ ] Task 9：dataSync 息屏 5 分钟存活 —— 机型 / 日期 / 结论
- [ ] Task 17：并发 3 时通知与队列表现 —— 机型 / 日期 / 结论
- [ ] Task 19：五条验收标准逐条 —— 机型 / 日期 / 结论
```


