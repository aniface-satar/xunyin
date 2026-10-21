/**
 * 自定义源和内置源都由用户音源引擎加载脚本，只是 id 前缀不同。
 *
 * 切换音源、取播放链接都要按这个判断：只认 `user_api` 会把内置源当成原生音源，
 * 脚本即使初始化成功，播放时也取不到 `global.lx.apis` 里的实现
 * （见 core/apiSource 与 musicSdk/api-source）。
 */
export const isUserApiSource = (id: string): boolean => /^(?:user_api|builtin_)/.test(id)
