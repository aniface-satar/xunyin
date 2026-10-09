/**
 * 拼接导出目标目录与文件名。
 * 目录有两种形态：App 内文件浏览器给的裸路径，和 SAF 选择器给的 tree/document URI。
 * 后者整段都是不透明标识符（%3A、%2F 属于 URI 本身），所以只能做保留原样的字符串拼接。
 */
export const joinSavePath = (dir: string, name: string) => (dir.endsWith('/') ? dir.slice(0, -1) : dir) + '/' + name
