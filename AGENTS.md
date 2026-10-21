# AGENTS.md

## 屏幕方向约定

本应用固定竖屏（portrait-only），所有界面改动必须遵守：

- 不得修改 `android/app/src/main/AndroidManifest.xml` 中 MainActivity 的 `android:screenOrientation="portrait"`
- 不得修改 `src/navigation/index.ts` 中 `Navigation.setDefaultOptions` 的 `layout.orientation: ['portrait']`
- 新增页面/组件时不要依赖横屏布局或调用会改方向的 API（如 `rn-orientation-locker` 的 landscape 接口）
- `useDeviceOrientation` 在锁定后恒为 portrait，横屏分支代码视为死代码，不要为其扩展新功能
