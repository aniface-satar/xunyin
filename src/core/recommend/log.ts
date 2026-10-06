/** DEV 诊断日志：生产环境静默。独立成文件避免底层管线反向依赖引擎入口。 */
export const recallLog = (tag: string, data: Record<string, unknown>) => {
  if (!__DEV__) return
  console.log(`[recommend:${tag}]`, JSON.stringify(data))
}
