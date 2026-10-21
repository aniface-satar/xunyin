/**
 * 「这份脚本能不能编译」的闸门。
 *
 * 音源脚本多为作者每天自动生成，上游拼装出错时会吐出字符串没闭合的半截文件：
 * 头部注释还在，所以只查头部的判断放得过去，而 QuickJS 一个字都跑不起来。
 * 让它覆盖掉用户正在用的那份能听的源，源就停在一个永远初始化失败的脚本上，
 * 而且下次检查还会发现「内容没变」，再也不会自愈。
 *
 * 用独立的 JS 解析器而不是宿主的 new Function：真机 Hermes 的 eval 编译路径
 * 不支持 async 函数，会把自己能正常加载的音源误判成坏脚本。
 */
import { parse } from 'acorn'

export type SyntaxCheckResult = { ok: true } | { ok: false, message: string }

export const checkScriptSyntax = (script: string): SyntaxCheckResult => {
  if (!script) return { ok: true }
  try {
    parse(script, { ecmaVersion: 'latest', sourceType: 'script' })
    return { ok: true }
  } catch (err: any) {
    if (err instanceof SyntaxError) return { ok: false, message: err.message }
    return { ok: true }
  }
}
