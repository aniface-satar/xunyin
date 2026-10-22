import test from 'node:test'
import assert from 'node:assert/strict'
import {
  matchHeaderComment,
  parseScriptHeader,
  resolveScriptFromUrl,
  type FetchImpl,
} from '../src/core/userApiUpdate/resolveScript.ts'

// 音源脚本的最小头部注释：lx 官方规范只要求这段 /* @name ... */ 注释，
// 应用侧判断「这是不是一个音源脚本」用的就是它，见 src/utils/data.ts 的 matchInfo。
const SCRIPT = '/**\n * @name 测试音源\n * @version v1.0.1\n * @description demo\n */\nuserApi.register.action(() => {})\n'

// 记录调用顺序的假网络：keys 是 url -> 响应体，miss 视为 404
const fakeFetch = (routes: { [url: string]: string | number }): { fetch: FetchImpl, called: string[] } => {
  const called: string[] = []
  const fetch: FetchImpl = async(url) => {
    called.push(url)
    const body = routes[url]
    if (typeof body == 'number') return { ok: false, status: body, text: async() => '' }
    if (body == null) return { ok: false, status: 404, text: async() => 'not found' }
    return { ok: true, status: 200, text: async() => body }
  }
  return { fetch, called }
}

test('更新地址直接就是脚本纯文本时，一次请求就拿到', async() => {
  const { fetch, called } = fakeFetch({ 'https://a.example/src.js': SCRIPT })
  const result = await resolveScriptFromUrl('https://a.example/src.js', { fetch })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.script, SCRIPT)
  assert.equal(result.fromUrl, 'https://a.example/src.js')
  assert.deepEqual(called, ['https://a.example/src.js'])
})

test('地址是 JSON 版本描述时，按里面的 url 字段补全相对路径再取一次', async() => {
  // HYWmusic 这类作者会把「版本检查接口」当 updateUrl 传进来：
  // 接口本身返回 JSON，真正的脚本在它给的相对路径里。
  const { fetch, called } = fakeFetch({
    'https://api.example/releases?ver=v1.0.0': '{"code":200,"data":{"version":"v1.0.1","url":"/dl/latest?format=lx"}}',
    'https://api.example/dl/latest?format=lx': SCRIPT,
  })
  const result = await resolveScriptFromUrl('https://api.example/releases?ver=v1.0.0', { fetch })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.script, SCRIPT)
  assert.deepEqual(called, [
    'https://api.example/releases?ver=v1.0.0',
    'https://api.example/dl/latest?format=lx',
  ])
})

test('地址是 GitHub 页面时，blob 链接换成 raw 后取脚本', async() => {
  const page = '<html><body><a href="https://github.com/some/author/blob/main/source.js">source.js</a></body></html>'
  const { fetch } = fakeFetch({
    'https://github.com/some/author/blob/main/source.js': page,
    'https://raw.githubusercontent.com/some/author/main/source.js': SCRIPT,
  })
  const result = await resolveScriptFromUrl('https://github.com/some/author/blob/main/source.js', { fetch })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.script, SCRIPT)
})

test('页面上有好几个脚本链接时逐个试，第一个不是脚本就接着试下一个', async() => {
  const page = [
    '<html><body>',
    '<a href="https://cdn.example/readme.js">readme.js</a>', // 返回的是 HTML，不是脚本
    '<a href="https://cdn.example/real.js">real.js</a>',
    '</body></html>',
  ].join('')
  const { fetch, called } = fakeFetch({
    'https://page.example/': page,
    'https://cdn.example/readme.js': '<html><body>not a script</body></html>',
    'https://cdn.example/real.js': SCRIPT,
  })
  const result = await resolveScriptFromUrl('https://page.example/', { fetch })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.script, SCRIPT)
  assert.equal(called[called.length - 1], 'https://cdn.example/real.js')
})

test('页面里的脚本链接多于一个时，名字像当前源的排前面', async() => {
  const page = [
    '<html><body>',
    '<a href="https://cdn.example/other.js">other.js</a>',
    '<a href="https://cdn.example/测试音源.js">测试音源.js</a>',
    '</body></html>',
  ].join('')
  const { fetch, called } = fakeFetch({
    'https://page.example/': page,
    'https://cdn.example/测试音源.js': SCRIPT,
    'https://cdn.example/other.js': SCRIPT,
  })
  const result = await resolveScriptFromUrl('https://page.example/', { fetch, hint: '测试音源' })
  assert.equal(result.ok, true)
  assert.ok(called.includes('https://cdn.example/测试音源.js'))
  assert.equal(called[1], 'https://cdn.example/测试音源.js', '名字匹配的链接应当第一个尝试')
})

test('页面里没有任何脚本线索时给出可判定的失败原因，绝不瞎猜', async() => {
  const { fetch } = fakeFetch({
    'https://pan.example/share/abc': '<html><body><a href="/login">登录后可见</a></body></html>',
  })
  const result = await resolveScriptFromUrl('https://pan.example/share/abc', { fetch })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.reason, 'no_script_link')
})

test('更新地址返回带块注释的网页时，整页 HTML 绝不能当脚本交出去', async() => {
  const page = '<html>\n<style>/* @name 页面样式 */</style>\n<body><p>最新版本请打开网盘</p></body>\n</html>'
  const { fetch } = fakeFetch({ 'https://page.example/': page })
  const result = await resolveScriptFromUrl('https://page.example/', { fetch })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.reason, 'no_script_link')
})

// 网页里的第三方库（zepto 等）也会以块注释开头，头部里没有任何 lx 字段。
// 只认「块注释开头」会把它们当音源脚本交出去，确认更新就会把真脚本覆盖掉。
test('网页引用的第三方 JS 只有块注释、没有 @name/@version 时不算音源脚本', async() => {
  const zepto = '/* Zepto v1.1.6 - zepto event ajax form ie - zeptojs.com/license */\nvar Zepto = (function() {})\n'
  const page = '<html><body><a href="https://cdn.example/zepto.js">zepto.js</a></body></html>'
  const { fetch } = fakeFetch({
    'https://doc.example/update': page,
    'https://cdn.example/zepto.js': zepto,
  })
  const result = await resolveScriptFromUrl('https://doc.example/update', { fetch })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.reason, 'no_script_link')
})

// 念心/长青的 updateUrl 返回版本描述，updateUrl 字段是给人看的网页。
// 网页里没有脚本时，版本号仍要留下来，调用方才能判断“其实已经是最新”。
test('版本描述 JSON 没找到脚本时，把版本和更新页地址一起带出来', async() => {
  const descriptor = '{"version":"1.0.1","updateUrl":"https://doc.example/update","description":"x"}'
  const page = '<html><body><a href="https://cdn.example/zepto.js">zepto.js</a></body></html>'
  const zepto = '/* Zepto v1.1.6 - zeptojs.com/license */\nvar Zepto = (function() {})\n'
  const { fetch } = fakeFetch({
    'https://api.example/check': descriptor,
    'https://doc.example/update': page,
    'https://cdn.example/zepto.js': zepto,
  })
  const result = await resolveScriptFromUrl('https://api.example/check', { fetch })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.reason, 'no_script_link')
  assert.deepEqual(result.descriptor, { version: '1.0.1', url: 'https://doc.example/update' })
})

test('没有更新地址的 latest 描述也能认出当前版本', async() => {
  const { fetch } = fakeFetch({
    'https://api.example/check': '{"latest":"1.3.0","log":"修复搜索"}',
  })
  const result = await resolveScriptFromUrl('https://api.example/check', { fetch })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.deepEqual(result.descriptor, { version: '1.3.0', url: '' })
})

test('版本接口不比当前新、页面又不给脚本时直接判最新，不再爬网盘/文档页', async() => {
  const descriptor = '{"version":"1.0.1","updateUrl":"https://doc.example/update"}'
  const { fetch, called } = fakeFetch({
    'https://api.example/check': descriptor,
    // 如果继续爬这个文档页，会取到一个别的脚本，容易误判成新版本
    'https://doc.example/update': '<html><body><a href="https://cdn.example/other.js">other.js</a></body></html>',
    'https://cdn.example/other.js': SCRIPT,
  })
  const result = await resolveScriptFromUrl('https://api.example/check', { fetch, currentVersion: '1.0.2' })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.reason, 'no_update')
  assert.deepEqual(called, ['https://api.example/check'])
  assert.deepEqual(result.descriptor, { version: '1.0.1', url: 'https://doc.example/update' })
})

test('版本号相同但更新页直接给了 .js 时仍继续取，抓同版本重新构建', async() => {
  const { fetch } = fakeFetch({
    'https://api.example/check': '{"version":"1.0.0","updateUrl":"https://cdn.example/new.js"}',
    'https://cdn.example/new.js': SCRIPT,
  })
  const result = await resolveScriptFromUrl('https://api.example/check', { fetch, currentVersion: '1.0.0' })
  assert.equal(result.ok, true)
})

test('更新页里 .js 链接排在说明页前面，先拿脚本', async() => {
  const page = [
    '<html><body>',
    '<a href="https://doc.example/readme">readme</a>',
    '<a href="https://cdn.example/real.js">real.js</a>',
    '</body></html>',
  ].join('')
  const { fetch, called } = fakeFetch({
    'https://page.example/': page,
    'https://cdn.example/real.js': SCRIPT,
    'https://doc.example/readme': '<html><body>not a script</body></html>',
  })
  const result = await resolveScriptFromUrl('https://page.example/', { fetch })
  assert.equal(result.ok, true)
  assert.deepEqual(called, ['https://page.example/', 'https://cdn.example/real.js'])
})

test('线索很多也拿不到脚本时按预算收手，不无限跟下去', async() => {
  // 每一页都只给出「下一页的 .js 链接」，永远拿不到脚本
  const hop = (i: number) => ({
    [`https://loop.example/${i}`]: `<html><a href="https://loop.example/${i + 1}">next.js</a></html>`,
  })
  const routes: { [url: string]: string | number } = {}
  for (let i = 0; i < 40; i++) Object.assign(routes, hop(i))
  const { fetch, called } = fakeFetch(routes)
  const result = await resolveScriptFromUrl('https://loop.example/0', { fetch })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.reason, 'budget_exceeded')
  assert.ok(called.length <= 8, `请求数应当有上限，实际 ${called.length}`)
})

// HYW 这类版本接口在当前已最新时只回一句「已是最新版本」，不再给脚本地址。
// 这是“没有更新”，不是“地址里找不到脚本”，不能当失败报给用户。
test('版本接口回「已是最新版本」时判为没有更新', async() => {
  const { fetch } = fakeFetch({
    'https://api.example/check?ver=v1.2.0': '{"code":0,"msg":"已是最新版本"}',
    'https://api.example/en?ver=1.2.0': '{"code":0,"msg":"Already up to date"}',
  })
  for (const url of ['https://api.example/check?ver=v1.2.0', 'https://api.example/en?ver=1.2.0']) {
    const result = await resolveScriptFromUrl(url, { fetch })
    assert.equal(result.ok, false)
    if (result.ok) continue
    assert.equal(result.reason, 'no_update', url)
  }
})

// lx-animemusic 的接口已最新时连提示都没有，只回 {"code":200,"data":null}；
// 有新版时 data 里才带 updateUrl。空 data 也得算「没有更新」，不能报找不到脚本。
test('版本接口回 code:200 且 data 为空时判为没有更新', async() => {
  const { fetch } = fakeFetch({
    'https://api.example/script/lxmusic?checkUpdate=abc': '{"code":200,"data":null}',
  })
  const result = await resolveScriptFromUrl('https://api.example/script/lxmusic?checkUpdate=abc', { fetch })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.reason, 'no_update')
})

// 星海的版本接口已最新时回 {"message":"已是最新版本","update_url":null,"ip_query_url":…}：
// 提示语是 GBK 编码，UTF-8 解码后成乱码正则认不出，接口还总挂一个没用的 ip 查询地址。
// 更新地址字段显式为 null 且整份 JSON 没有任何版本信息，就该判「没有更新」，
// 再顺着垃圾链接爬下去只会误报「更新地址里没有可用的音源脚本链接」。
test('版本接口回 update_url 显式为 null 且没有版本信息时判为没有更新', async() => {
  const { fetch, called } = fakeFetch({
    'https://api.example/lx/versionh2.php?ver=v3.2.15': '{"message":"\ufffd\ufffd\ufffd\ufffd\ufffd\xb0汾","update_url":null,"ip_query_url":"https://api.example/ip.php"}',
    'https://api.example/ip.php': '{"ip":"1.2.3.4","country":"CN"}',
  })
  const result = await resolveScriptFromUrl('https://api.example/lx/versionh2.php?ver=v3.2.15', { fetch, currentVersion: 'v3.2.15' })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.reason, 'no_update')
  assert.deepEqual(called, ['https://api.example/lx/versionh2.php?ver=v3.2.15'])
})

test('提示「已是最新」的接口还挂着非脚本查询链接时，照样判没有更新', async() => {
  const { fetch } = fakeFetch({
    'https://api.example/check': '{"code":0,"msg":"已是最新版本","status_url":"https://api.example/status"}',
    'https://api.example/status': '<html><body>ok</body></html>',
  })
  const result = await resolveScriptFromUrl('https://api.example/check', { fetch })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.reason, 'no_update')
})

test('接口给了版本号但 update_url 为空时，不能被「无更新地址」规则吞掉', async() => {
  const { fetch } = fakeFetch({
    'https://api.example/check': '{"version":"9.9.9","update_url":null}',
  })
  const result = await resolveScriptFromUrl('https://api.example/check', { fetch, currentVersion: '1.0.0' })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.reason, 'no_script_link')
  assert.deepEqual(result.descriptor, { version: '9.9.9', url: '' })
})

test('没有地址也没有“已最新”提示的 JSON 仍报找不到脚本', async() => {
  const { fetch } = fakeFetch({ 'https://api.example/check': '{"code":500,"msg":"server error"}' })
  const result = await resolveScriptFromUrl('https://api.example/check', { fetch })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.reason, 'no_script_link')
})

test('非 http(s) 的地址一律不发请求', async() => {
  const { fetch, called } = fakeFetch({})
  for (const url of ['javascript:alert(1)', 'file:///data/x.js', 'not-a-url', '']) {
    const result = await resolveScriptFromUrl(url, { fetch })
    assert.equal(result.ok, false)
    if (result.ok) continue
    assert.equal(result.reason, 'invalid_url')
  }
  assert.deepEqual(called, [])
})

test('地址取不到（非 2xx）时报网络失败，不当成脚本', async() => {
  const { fetch } = fakeFetch({ 'https://a.example/src.js': 503 })
  const result = await resolveScriptFromUrl('https://a.example/src.js', { fetch })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.reason, 'fetch_failed')
})

test('matchHeaderComment 把开头那段注释原文取出来，位置不对就取不到', () => {
  assert.equal(matchHeaderComment('\n\n' + SCRIPT), '/**\n * @name 测试音源\n * @version v1.0.1\n * @description demo\n */')
  assert.equal(matchHeaderComment(String.fromCharCode(0xFEFF) + SCRIPT), '/**\n * @name 测试音源\n * @version v1.0.1\n * @description demo\n */')
  assert.equal(matchHeaderComment('<html>/* @name 页面样式 */</html>'), null)
})

test('头部注释带 BOM 或前导空行也认得', () => {
  const bomScript = String.fromCharCode(0xFEFF) + '\n\n' + SCRIPT
  const body = parseScriptHeader(bomScript)
  assert.equal(body?.name, '测试音源')
  assert.equal(body?.version, 'v1.0.1')
  const body2 = parseScriptHeader('   /**\n * @name 空白起始\n * @updateUrl https://a.example/src.js\n */\n')
  assert.equal(body2?.name, '空白起始')
  assert.equal(body2?.updateUrl, 'https://a.example/src.js')
})

test('头部注释里的完整构建时间认得出，只有日期的不算', () => {
  const built = parseScriptHeader('/**\n * @name a\n * @version 2026.10.20\n * 由生成器于 2026-10-20 19:00:02 自动生成\n */\n')
  assert.equal(built?.buildTime, Date.UTC(2026, 9, 20, 19, 0, 2))
  assert.equal(parseScriptHeader(SCRIPT)?.buildTime, 0)
  // @lastUpdate 2026-10-20 这种只有日期，不能当构建时间拿去比新旧
  assert.equal(parseScriptHeader('/**\n * @name a\n * @version 1\n * @lastUpdate 2026-10-20\n */\n')?.buildTime, 0)
})

test('不是音源脚本的内容解析不出头部', () => {
  assert.equal(parseScriptHeader('<html><head><title>x</title></head></html>'), null)
  assert.equal(parseScriptHeader(''), null)
})

// 头部注释必须在正文开头：网页里的 <style>/<script> 也满是 /* */，
// 一旦放宽到「任意位置」就会把人家的一页 HTML 当成音源脚本写回源里。
test('块注释不在开头时不算头部，注释里带 @name 也不算', () => {
  assert.equal(parseScriptHeader('<html>\n<style>/* @name 页面样式 */</style>\n<body>x</body>\n</html>'), null)
  assert.equal(parseScriptHeader('var a = 1\n/* @name 中途的注释 */\n'), null)
})

test('头部里的 @updateUrl 能读出来，作者没写就是空', () => {
  const withUrl = parseScriptHeader('/**\n * @name a\n * @updateUrl http://103.79.184.97/api/releases?script=a\n */\n')
  assert.equal(withUrl?.updateUrl, 'http://103.79.184.97/api/releases?script=a')
  const withoutUrl = parseScriptHeader('/**\n * @name a\n * @version v1\n */\n')
  assert.equal(withoutUrl?.updateUrl, '')
})

// 长青、念心这类脚本写的是 @update_url；lx 头部字段并不区分下划线，看着像更新地址就得认
test('@update_url 下划线写法与大小写变体都算更新地址', () => {
  const snake = parseScriptHeader('/**\n * @name a\n * @update_url https://a.example/src.js\n */\n')
  assert.equal(snake?.updateUrl, 'https://a.example/src.js')
  const upper = parseScriptHeader('/**\n * @name a\n * @UpdateUrl https://b.example/src.js\n */\n')
  assert.equal(upper?.updateUrl, 'https://b.example/src.js')
})

// @update 是「更新说明」，值是一段文案，不能当成地址去请求
test('@update 更新说明不会被误当成更新地址', () => {
  const body = parseScriptHeader('/**\n * @name a\n * @update 修复了搜索无结果的问题\n */\n')
  assert.equal(body?.updateUrl, '')
})
