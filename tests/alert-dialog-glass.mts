import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// 系统原生 Alert 由系统绘制，配色/圆角/背景都不受应用控制 —— 在自定义背景主题里它是
// 唯一一块突兀的纯色方块。这里盯住"提示框、确认框、权限说明框"全部改走应用自己的
// 玻璃框（AlertHost → Dialog → GlassBackdrop），不许再退回原生 Alert。
const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (relPath: string) => readFileSync(path.join(rootPath, 'src', relPath), 'utf8')

const toolsSource = readSrc('utils/tools.ts')
const pactModalSource = readSrc('navigation/components/PactModal.tsx')
const errorHandleSource = readSrc('utils/errorHandle.ts')
const alertServiceSource = readSrc('components/common/alertService.ts')
const alertHostSource = readSrc('components/common/AlertHost.tsx')
const registerScreensSource = readSrc('navigation/registerScreens.tsx')
const dialogSource = readSrc('components/common/Dialog.tsx')

// 逐个函数切出来看，避免"文件里还有一处 Alert.alert"这种漏网被整文件的 grep 掩盖
const sliceFn = (source: string, start: string, end?: string) => {
  const from = source.indexOf(start)
  assert.ok(from >= 0, `function not found: ${start}`)
  const to = end == null ? source.length : source.indexOf(end, from)
  return source.slice(from, to > from ? to : source.length)
}

test('确认框 / 提示框不再用系统原生 Alert', () => {
  const sections = [
    { name: 'confirmDialog', start: 'export const confirmDialog', end: 'export const tipDialog' },
    { name: 'tipDialog', start: 'export const tipDialog', end: 'export const clipboardWriteText' },
    { name: 'checkNotificationPermission', start: 'export const checkNotificationPermission', end: 'export const checkIgnoringBatteryOptimization' },
    { name: 'checkIgnoringBatteryOptimization', start: 'export const checkIgnoringBatteryOptimization', end: 'export const resetNotificationPermissionCheck' },
  ]
  for (const { name, start, end } of sections) {
    const fn = sliceFn(toolsSource, start, end)
    assert.doesNotMatch(fn, /Alert\.alert/, `${name} 仍在用系统原生 Alert`)
    assert.match(fn, /showAlert\(/, `${name} 未走应用的玻璃提示框`)
  }
  // 连 react-native 的 Alert 都不该再被引进来
  assert.doesNotMatch(toolsSource, /import \{[^}]*\bAlert\b[^}]*\} from 'react-native'/)
})

test('协议确认后的提示也走玻璃框', () => {
  assert.doesNotMatch(pactModalSource, /Alert\.alert/)
  assert.match(pactModalSource, /import \{ showAlert \} from '@\/components\/common\/alertService'/)
  assert.match(pactModalSource, /void showAlert\(\{/)
})

// 唯一的例外：JS 致命错误。那时 React 树本身可能已经坏了，弹得出来比弹得好看重要。
test('JS 致命错误保留原生 Alert（唯一例外）', () => {
  assert.match(errorHandleSource, /Alert\.alert\(/)
  assert.match(errorHandleSource, /React 树本身可能已经坏了|最后一道出口/)
})

test('提示框宿主用项目自己的 Dialog，玻璃底随主题', () => {
  assert.match(alertHostSource, /import Dialog, \{ type DialogType \} from '\.\/Dialog'/)
  assert.match(alertHostSource, /<Dialog/)
  // Dialog 内部就是 GlassBackdrop + 圆角面板，复用才能保证与其它弹层一个观感
  assert.match(dialogSource, /theme\['is-wallpaper'\] \? <GlassBackdrop/)
  // 提示框不该有关闭叉：原生 Alert 没有，多一个叉反而让人以为"关掉等于确认"
  assert.match(alertHostSource, /closeBtn=\{false\}/)
  // 点背景 / 返回键只在 cancelable 时生效，与原生 Alert 的 cancelable 语义对齐
  assert.match(alertHostSource, /bgHide=\{request\?\.cancelable \?\? false\}/)
  assert.match(alertHostSource, /keyHide=\{request\?\.cancelable \?\? false\}/)
})

test('宿主没挂上时回退原生 Alert，不让调用方永远 await', () => {
  assert.match(alertServiceSource, /if \(host == null\) return showNativeAlert\(request\)/)
  assert.match(alertServiceSource, /registerAlertHost/)
  // 没有按钮 = 没有出口，直接按取消结算，别挂一个关不掉的框
  assert.match(alertServiceSource, /actions\.length == 0/)
})

// 宿主必须挂在"推送任何页面都不会被卸载"的根上，否则进了播控页 / 详情页就没有框可弹；
// 而它底层是 Android Dialog window，浮在 Activity 内容之上，盖得住别的页面与 Modal。
test('宿主挂在首页根节点上', () => {
  assert.match(registerScreensSource, /import AlertHost from '@\/components\/common\/AlertHost'/)
  assert.match(registerScreensSource, /WrappedComponent\(Home, AlertHost\)/)
  // 其它页面各挂一份会变成"同一次调用弹好几个框"
  const registrations = registerScreensSource.match(/WrappedComponent\(\w+, AlertHost\)/g) ?? []
  assert.equal(registrations.length, 1, 'AlertHost 只能挂一处')
})
