/*
 * 本文件由 2026-09-19 22:22 版本构建产物（_lx_island_arm64.apk 内的 dev bundle）反编译还原，
 * 与该时间点线上运行版本行为一致；因当时没有 VCS 快照，TypeScript 类型注解已丢失。
 */
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.usePlayerOverlay = exports.default = exports.PlayerOverlayProvider = void 0;
var _slicedToArray2 = _interopRequireDefault(require("@babel/runtime/helpers/slicedToArray"));
var _react = require("react");
var _reactNative = require("react-native");
var _Header = _interopRequireWildcard(require("../../../screens/PlayDetail/Vertical/components/Header"));
var _Player = _interopRequireDefault(require("../../../screens/PlayDetail/Vertical/Player"));
var _Pic = _interopRequireDefault(require("../../../screens/PlayDetail/Vertical/Pic"));
var _Lyric = _interopRequireDefault(require("../../../screens/PlayDetail/Vertical/Lyric"));
var _reactNativePagerView = _interopRequireDefault(require("react-native-pager-view"));
var _overlayModalGesture = require("./overlayModalGesture");
var _Image = _interopRequireDefault(require("../../common/Image"));
var _ImageBackground = _interopRequireDefault(require("../../common/ImageBackground"));
var _state = _interopRequireDefault(require("../../../store/common/state"));
var _Btn = _interopRequireWildcard(require("../../../screens/PlayDetail/Vertical/Player/components/MoreBtn/Btn"));
var _PlayModeBtn = _interopRequireDefault(require("../../../screens/PlayDetail/Vertical/Player/components/MoreBtn/PlayModeBtn"));
var _TimeoutExitBtn = _interopRequireDefault(require("../../../screens/PlayDetail/Vertical/Player/components/MoreBtn/TimeoutExitBtn"));
var _CommentBtn = _interopRequireDefault(require("../../../screens/PlayDetail/Vertical/Player/components/MoreBtn/CommentBtn"));
var _LyricPreview = _interopRequireDefault(require("../../../screens/PlayDetail/Vertical/Player/components/LyricPreview"));
var _lyricCopy = require("../../../core/lyricCopy");
var _useLyricToolMode = require("../../../utils/hooks/useLyricToolMode");
var _OnCoverThemeProvider = _interopRequireDefault(require("../OnCoverThemeProvider"));
var _CoverBackdrop = _interopRequireDefault(require("../CoverBackdrop"));
var _CoverStageProvider = _interopRequireDefault(require("../CoverStageProvider"));
var _jsxRuntime = require("react/jsx-runtime");
var _this = this,
  _jsxFileName = "C:\\Users\\30913\\Documents\\ChatGPT\\music\\lx-music-mobile\\lx-music-mobile-master\\src\\components\\player\\PlayerOverlay\\index.tsx";
function _interopRequireWildcard(e, t) {
  if ("function" == typeof WeakMap) var r = new WeakMap(),
    n = new WeakMap();
  return (_interopRequireWildcard = function _interopRequireWildcard(e, t) {
    if (!t && e && e.__esModule) return e;
    var o,
      i,
      f = {
        __proto__: null,
        default: e
      };
    if (null === e || "object" != typeof e && "function" != typeof e) return f;
    if (o = t ? n : r) {
      if (o.has(e)) return o.get(e);
      o.set(e, f);
    }
    for (var _t in e) "default" !== _t && {}.hasOwnProperty.call(e, _t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, _t)) && (i.get || i.set) ? o(f, _t, i) : f[_t] = e[_t]);
    return f;
  })(e, t);
}
var LYRIC_PAGE = 1;
// 下滑收起手势只依据位移判定：Fabric 下 gestureState.x0/y0 是相对被命中视图的坐标，
// 用它做窗口热区判定会失效，因此热区改由响应器树（头部行、小封面行）决定
var isCloseGestureAllowed = function isCloseGestureAllowed(gestureState) {
  return gestureState.dy > (0, require("./transition").getCloseGestureActivationThreshold)() && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
};
var LyricPage = function LyricPage(_ref) {
  var activeIndex = _ref.activeIndex,
    showSummary = _ref.showSummary,
    summaryGestureHandlers = _ref.summaryGestureHandlers;
  var initedRef = (0, _react.useRef)(false);
  var lyric = (0, _react.useMemo)(function () {
    return <_Lyric.default showSummary={showSummary} summaryGestureHandlers={summaryGestureHandlers} />;
  }, [showSummary, summaryGestureHandlers]);
  switch (activeIndex) {
    case LYRIC_PAGE:
      if (!initedRef.current) initedRef.current = true;
      return lyric;
    default:
      return initedRef.current ? lyric : null;
  }
};
var PlayerOverlayContext = (0, _react.createContext)(null);
var usePlayerOverlay = exports.usePlayerOverlay = function usePlayerOverlay(): PlayerOverlayController | null {
  return (0, _react.useContext)(PlayerOverlayContext);
};
var clamp = function clamp(value) {
  var min = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  var max = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 1;
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
};
var localRect = function localRect(rect, rootX, rootY) {
  return {
    x: rect.x - rootX,
    y: rect.y - rootY,
    width: rect.width,
    height: rect.height
  };
};
var localControlLayout = function localControlLayout(layouts, rootX, rootY) {
  return {
    prev: localRect(layouts.prev, rootX, rootY),
    play: localRect(layouts.play, rootX, rootY),
    next: localRect(layouts.next, rootX, rootY)
  };
};
var MINI_TITLE_FONT_SIZE = (0, require("../../../utils/pixelRatio").setSpText)(15);
var MINI_ARTIST_FONT_SIZE = (0, require("../../../utils/pixelRatio").setSpText)(15);
var TRANSITION_CLEAR_GAP = 6;
// 与 PlayerBar 的 borderTopLeftRadius / 卡片终态圆角同源：播放栏顶部的边框线在两端各内缩这个半径
var BAR_TOP_CORNER_RADIUS = 12;
// 与 SynchronizedMarquee 测量层同源：给 morph 文字一个远超屏宽的自然宽度，
// 让它永远排成一整行、由外层 morphClip 硬裁，而不是触发系统的整字省略
var MORPH_TEXT_NATURAL_WIDTH = 10000;
var TRANSITION_DURATION_MS = 800;
var toProgressVelocity = function toProgressVelocity(velocity, distance) {
  return velocity * 1000 / distance;
};
var TRANSITION_SPRING_CONFIG = {
  stiffness: 90,
  damping: 19,
  mass: 1,
  overshootClamping: true,
  restSpeedThreshold: 0.002,
  restDisplacementThreshold: 0.002
};
var toProgressNumber = function toProgressNumber(value) {
  return typeof value == 'number' ? clamp(value) : 0;
};
var thresholdRange = function thresholdRange(threshold) {
  var min = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0.08;
  return [0, clamp(threshold, min, 0.94), 1];
};
var OverlayBackdrop = function OverlayBackdrop(_refBackdrop) {
  var winWidth = _refBackdrop.winWidth,
    winHeight = _refBackdrop.winHeight,
    progress = _refBackdrop.progress;
  var theme = (0, require("../../../store/theme/hook").useTheme)();
  var baseTheme = require("../../../store/theme/state").default.theme;
  var backdropImageSource = theme['bg-image'];
  var hasBackdropImage = backdropImageSource != null;
  var coverBackdrop = (0, require("../../../utils/monet/useCoverSurface").useCoverSurface)();
  var coverSurface = hasBackdropImage || !coverBackdrop.enabled ? null : coverBackdrop.surface;
  // 壁纸模式（自定义图片背景）：这张背景不许再被任何一层加工 —— 不糊、不洗白、不压暗，
  // 只跟主界面一样铺一层同样深度的柔光。`is-wallpaper` 是主题层给出的（见 utils/wallpaper/palette.ts），
  // 但它成立不代表播控页上有这张图：applyToPlayer 关掉时 bg-image 会回落到主题自带插画，
  // 那是另一张图（还是 require 出来的本地资源），不能按壁纸处理。
  var wallpaper = theme['is-wallpaper'] === true;
  var customBgSource = wallpaper ? (0, require("../../../utils/customBgBridge").getCustomBgSource)() : null;
  var wallpaperBackdrop = customBgSource != null && customBgSource.applyToPlayer && hasBackdropImage;
  var veil = (0, require("../../../store/setting/hook").useSettingValue)('theme.customBg.veil');
  // 壁纸模式下这一层整个不画，改由 PlayerOverlay 的 WallpaperBackdrop 在卡片的**外面**铺：
  // 这一层是卡片的子层，卡片收起时靠 scaleY 把自己压进播放栏，背景图跟着一起被压扁 ——
  // 那正是"背景随动画形变"的来源。固定层不动、只开窗，才是一层钉在页面上的透明底。
  if (wallpaperBackdrop) return null;
  // 封面那三层交给 CoverBackdrop：它会"叠一层淡到位"，这里的旧写法是有就整层硬出现。
  // 底色自己不淡的话，淡的就只剩装饰层：c-content-background 被 COVER_RULES 换成封面深色 panel 后，
  // 卡片挂载那一帧就是深底，播放栏→卡片那一下的亮度跳变跟 CoverBackdrop 的墙钟时长无关。
  // 所以这里把根 View 的底色挂到 progress 上（起点=播放栏那一面的主题色），并把 progress 交给
  // CoverBackdrop，让"浮现"那两层也跟着手指走。
  return (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
    pointerEvents: "none",
    style: Object.assign((0, require("./transition").getBackdropFrame)(winWidth, winHeight), {
      backgroundColor: progress.interpolate((0, require("./transition").getEnterFieldRange)(baseTheme['c-content-background'], theme['c-content-background']))
    }),
    children: (0, _jsxRuntime.jsxs)(_jsxRuntime.Fragment, {
      children: [hasBackdropImage ? (0, _jsxRuntime.jsx)(_ImageBackground.default, {
        style: _reactNative.StyleSheet.absoluteFill,
        source: backdropImageSource,
        resizeMode: "cover",
        // 壁纸模式下这张图跟主界面用同一个模糊度（用户为那一套自己设的值）；
        // 原来那支写死的 24 是"给主题自带插画打底"用的，压在用户自己的照片上就是另一张图了
        blurRadius: wallpaperBackdrop ? (customBgSource != null ? customBgSource.blur : 0) : 24
      }) : null, coverSurface != null ? (0, _jsxRuntime.jsx)(_CoverBackdrop.default, {
        progress: progress
      }) : null, coverSurface != null ? null : (0, _jsxRuntime.jsx)(_reactNative.View, {
        style: [_reactNative.StyleSheet.absoluteFill, {
          // 壁纸模式下"洗白"这层换成跟主界面同款的深色柔光：不柔光的话白字直接压在照片上，
          // 就是用户反馈的那个可读性问题；洗白的话照片又被洗淡了，两头都不对。
          // 没有图（applyToPlayer 关掉、动态背景也关着）时铺满柔光色 —— 壁纸模式下 c-content-background
          // 是全透明的，这时候不兜一层，整个播控页就变成一张全透明的膜，透出下面的首页。
          backgroundColor: wallpaper ? (0, require("../../../utils/wallpaper/palette").WALLPAPER_SCRIM) : theme['c-content-background'],
          opacity: wallpaper
            ? (hasBackdropImage ? (0, require("../../../utils/wallpaper/palette").clampWallpaperVeil)(veil) : 1)
            : (hasBackdropImage ? 0.58 : 0.64)
        }]
      })]
    })
  });
};
// 壁纸模式（自定义图片同时用作播控页背景）下的背景层，铺在卡片**外面**。
//
// 卡片从整屏收到播放栏靠的是 translate + scaleY：背景图挂在它的子树里就跟着被纵向压扁，
// 全程看得见照片在变形，收到最后是一张被挤进横栏的缩略图。
// 这里改成"开窗"：图钉死在屏幕坐标上（窗框下移多少，图就反向补偿多少，净位移恒为 0），
// 真正动的只有露出它的那扇窗 —— 观感是一层透明、钉在页面上的底，内容从它上面滑过去。
//
// 窗框必须与卡片的可见矩形严格重合：上沿跟卡片同一条 `bar.y * p`（cardStyle 的 translateY 就是它），
// 下沿交给外层的 clip（同一个 clipStyle）。于是 p=1 时窗里露出的正是屏幕底部那一格，
// 与下面是透明播放栏、露出的页面壁纸完全对齐 —— 卸下 overlay 不会跳。
var WallpaperBackdrop = function WallpaperBackdrop(_refWallpaper) {
  var winWidth = _refWallpaper.winWidth,
    winHeight = _refWallpaper.winHeight,
    progress = _refWallpaper.progress,
    imageSource = _refWallpaper.imageSource,
    blurRadius = _refWallpaper.blurRadius,
    veil = _refWallpaper.veil,
    barTop = _refWallpaper.barTop;
  return <_reactNative.Animated.View pointerEvents="none" style={{
    position: 'absolute',
    left: 0,
    top: 0,
    width: winWidth,
    height: winHeight,
    overflow: 'hidden',
    // 窗框下移：p=1 时正好落到播放栏的位置（barTop）
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, barTop] }) }]
  }}>
    <_reactNative.Animated.View style={{
      position: 'absolute',
      left: 0,
      top: 0,
      width: winWidth,
      height: winHeight,
      // 反向补偿，净位移恒为 0：这张图自始至终停在屏幕原点，一帧都没有被移动或缩放
      transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -barTop] }) }]
    }}>
      <_ImageBackground.default
        style={_reactNative.StyleSheet.absoluteFill}
        source={imageSource}
        resizeMode="cover"
        blurRadius={blurRadius}
      />
      {/* 与主界面同款、同深度的柔光：0.24 亮纱会让壁纸发灰，洗白会把照片洗没 */}
      <_reactNative.View
        style={[
          _reactNative.StyleSheet.absoluteFill,
          {
            backgroundColor: require("../../../utils/wallpaper/palette").WALLPAPER_SCRIM,
            opacity: (0, require("../../../utils/wallpaper/palette").clampWallpaperVeil)(veil),
          },
        ]}
      />
    </_reactNative.Animated.View>
  </_reactNative.Animated.View>
};
var PlayerOverlay = (0, _react.forwardRef)(function (_ref2, ref) {
  var _measuredActionLayout, _measuredActionLayout2, _measuredActionLayout3, _progressTarget$heigh, _source$bar$y, _source$bar$height, _source$bar$x, _source$bar$width, _source$progress, _source$bar$x2, _source$bar$width2, _source$bar$y2, _source$bar$height2, _source$bar$width3, _source$controls, _source$pic$y, _source$pic$height, _source$pic$height2, _source$pic$width, _source$pic$y2, _source$title$y, _source$pic$x, _source$pic$x2, _source$title, _source$artist, _musicInfoLayout$titl, _musicInfoLayout$arti;
  var progress = _ref2.progress,
    onSourceVisibilityChange = _ref2.onSourceVisibilityChange,
    onBarSettledChange = _ref2.onBarSettledChange;
  var theme = (0, require("../../../store/theme/hook").useTheme)();
  var glassColors = (0, require("../../../utils/hooks/useGlassColors").useGlassColors)();
  // 壁纸模式下播控页的背景只画一次，且画在卡片外面（见 WallpaperBackdrop）。
  // 判据只看"用户有没有把这张图也应用到播控页"（applyToPlayer）—— 那是 buildActiveThemeColors
  // 把 bg-image 换成壁纸 URI 的唯一条件；关掉时 bg-image 会回落到主题自带插画，那是另一张图。
  var wallpaperCustomBg = (0, require("../../../utils/customBgBridge").getCustomBgSource)();
  var wallpaperBackdropSource = wallpaperCustomBg != null && wallpaperCustomBg.applyToPlayer ? wallpaperCustomBg : null;
  var wallpaperBackdropVeil = (0, require("../../../store/setting/hook").useSettingValue)('theme.customBg.veil');
  // 进入/收起那一下的"变色"必须挂在 progress 轴上（窗口表在 ./transition）：底色和墨色都是
  // OnCoverThemeProvider 从 context 发下来的静态值，卡片挂载那一帧就整体翻完，任何墙钟淡入都追不上手指。
  // baseTheme 直接读 store —— provider 只换 context、不换这份，于是两个端点就是"播放栏那一面"与"全屏那一面"。
  // 动态背景没生效时 applyOnCoverTheme 原样返回同一个引用，enterFadeActive 为假、两条端点同色，整组退化成常量。
  var baseTheme = require("../../../store/theme/state").default.theme;
  var enterFadeActive = theme !== baseTheme;
  var _enterFade = require("./transition");
  var enterFieldBg = progress.interpolate((0, _enterFade.getEnterFieldRange)(baseTheme['c-content-background'], theme['c-content-background']));
  var enterInkFont = progress.interpolate((0, _enterFade.getEnterInkRange)(baseTheme['c-font'], theme['c-font']));
  var enterInkLabel = progress.interpolate((0, _enterFade.getEnterInkRange)(baseTheme['c-font-label'], theme['c-font-label']));
  var enterInkBorder = progress.interpolate((0, _enterFade.getEnterInkRange)(baseTheme['c-border-background'], theme['c-border-background']));
  var enterInkTrack = progress.interpolate((0, _enterFade.getEnterInkRange)(baseTheme['c-primary-light-300-alpha-800'], theme['c-primary-light-300-alpha-800']));
  var enterInkBuffered = progress.interpolate((0, _enterFade.getEnterInkRange)(baseTheme['c-primary-light-400-alpha-700'], theme['c-primary-light-400-alpha-700']));
  var enterInkFill = progress.interpolate((0, _enterFade.getEnterInkRange)(baseTheme['c-primary-light-100-alpha-400'], theme['c-primary-light-100-alpha-400']));
  var enterInkDot = progress.interpolate((0, _enterFade.getEnterInkRange)(baseTheme['c-primary-light-100'], theme['c-primary-light-100']));
  var enterInkPlate = progress.interpolate((0, _enterFade.getEnterInkRange)(baseTheme['c-primary-light-900-alpha-200'], theme['c-primary-light-900-alpha-200']));
  var enterIconRanges = (0, _enterFade.getEnterInkOpacityRanges)(enterFadeActive);
  var enterIconExpanded = progress.interpolate(enterIconRanges.expanded);
  var enterIconCollapsed = progress.interpolate(enterIconRanges.collapsed);
  // 静态侧 Text/Icon 在 fontShadow 开启时带文字阴影，动画层的裸 Animated.Text 必须补齐同样的阴影，
  // 否则开启动画端点切换瞬间标题/歌手/时间文本会有阴影闪现
  var fontShadow = (0, require("../../../store/theme/hook").useTextShadow)();
  var textShadowStyle = fontShadow ? {
    textShadowColor: theme['c-primary-dark-300-alpha-800'],
    textShadowOffset: { width: 0.2, height: 0.2 },
    textShadowRadius: 2
  } : null;
  var musicInfo = (0, require("../../../store/player/hook").usePlayerMusicInfo)();
  var playMusicInfo = (0, require("../../../store/player/hook").usePlayMusicInfo)();
  var isLove = (0, require("../../../store/player/useIsLove").useIsLove)();
  var playBuffered = (0, require("../../../plugins/player").useBufferProgress)();
  var isPlay = (0, require("../../../store/player/hook").useIsPlay)();
  var _useWindowSize = (0, require("../../../utils/hooks").useWindowSize)(),
    winWidth = _useWindowSize.width,
    winHeight = _useWindowSize.height;
  var statusBarHeight = (0, require("../../../store/common/hook").useStatusbarHeight)();
  var animationRef = (0, _react.useRef)(null);
  var rootRef = (0, _react.useRef)(null);
  var sourceRef = (0, _react.useRef)(null);
  var _useState = (0, _react.useState)(null),
    _useState2 = (0, _slicedToArray2.default)(_useState, 2),
    source = _useState2[0],
    setSource = _useState2[1];
  var _useState3 = (0, _react.useState)(false),
    _useState4 = (0, _slicedToArray2.default)(_useState3, 2),
    mounted = _useState4[0],
    setMounted = _useState4[1];
  var _useState5 = (0, _react.useState)(false),
    _useState6 = (0, _slicedToArray2.default)(_useState5, 2),
    isOpen = _useState6[0],
    setIsOpen = _useState6[1];
  var _useStateFullscreen = (0, _react.useState)(false),
    _useStateFullscreen2 = (0, _slicedToArray2.default)(_useStateFullscreen, 2),
    fullscreenMounted = _useStateFullscreen2[0],
    setFullscreenMounted = _useStateFullscreen2[1];
  var _useState7 = (0, _react.useState)(0),
    _useState8 = (0, _slicedToArray2.default)(_useState7, 2),
    pageIndex = _useState8[0],
    setPageIndex = _useState8[1];
  var _useState9 = (0, _react.useState)(false),
    _useState0 = (0, _slicedToArray2.default)(_useState9, 2),
    isTransitioning = _useState0[0],
    setIsTransitioning = _useState0[1];
  var _useState1 = (0, _react.useState)(false),
    _useState10 = (0, _slicedToArray2.default)(_useState1, 2),
    gestureEnabled = _useState10[0],
    setGestureEnabled = _useState10[1];
  // 播放进度按 1000ms / 倍速推一次（playProgress.ts 的轮询），每次都是一个新对象，所以必然让本组件
  // 整树重渲染：57 条 progress.interpolate 与所有 animated style 重建、39 个 Animated.* 的动画图重挂。
  // 补间是 useNativeDriver:false 的，JS 每帧都要参与，落在动画里的那一次重渲染正好吃掉当帧剩余时间。
  // 倍速越高越密（2 倍速下 800ms 的动画里平均会撞上一次以上）。
  // 动画这 800ms 里进度条本身正在形变、静态层透明度为 0，冻结进度不影响观感；
  // 转场结束重新订阅时 useProgress 会立刻 update(state.progress) 把真值补回来。
  var playerProgress = (0, require("../../../store/player/hook").useProgress)(!isTransitioning && !gestureEnabled);
  var playProgress = playerProgress.progress;
  var _useState11 = (0, _react.useState)(musicInfo.pic),
    _useState12 = (0, _slicedToArray2.default)(_useState11, 2),
    transitionPic = _useState12[0],
    setTransitionPic = _useState12[1];
  var _useState13 = (0, _react.useState)(null),
    _useState14 = (0, _slicedToArray2.default)(_useState13, 2),
    progressTarget = _useState14[0],
    setProgressTarget = _useState14[1];
  var _useState15 = (0, _react.useState)(null),
    _useState16 = (0, _slicedToArray2.default)(_useState15, 2),
    controlTarget = _useState16[0],
    setControlTarget = _useState16[1];
  var _useState17 = (0, _react.useState)(null),
    _useState18 = (0, _slicedToArray2.default)(_useState17, 2),
    musicInfoLayout = _useState18[0],
    setMusicInfoLayout = _useState18[1];
  var _useState19 = (0, _react.useState)('pic'),
    _useState20 = (0, _slicedToArray2.default)(_useState19, 2),
    transitionOrigin = _useState20[0],
    setTransitionOrigin = _useState20[1];
  var lyricToolMode = (0, _useLyricToolMode.useLyricToolMode)();
  var coverStage = (0, _CoverStageProvider.useCoverStage)();
  var transitionOriginRef = (0, _react.useRef)('pic');
  var _useState25 = (0, _react.useState)(null),
    _useState26 = (0, _slicedToArray2.default)(_useState25, 2),
    pagerOrigin = _useState26[0],
    setPagerOrigin = _useState26[1];
  var _useState27 = (0, _react.useState)(null),
    _useState28 = (0, _slicedToArray2.default)(_useState27, 2),
    coverRelLayout = _useState28[0],
    setCoverRelLayout = _useState28[1];
  var progressRef = (0, _react.useRef)(1);
  var isOpenRef = (0, _react.useRef)(false);
  var pageIndexRef = (0, _react.useRef)(0);
  var isTransitioningRef = (0, _react.useRef)(false);
  var gestureEnabledRef = (0, _react.useRef)(false);
  var targetLayoutsSettledRef = (0, _react.useRef)(false);
  var targetMeasurementEpochRef = (0, _react.useRef)(0);
  var closeGestureStartDyRef = (0, _react.useRef)(0);
  if (__DEV__) {
    console.log('[PAGE_DEBUG] PlayerOverlay render', {
      mounted,
      pageIndex,
      remembered: (0, require("./transition").getLastOverlayPage)()
    });
  }
  var pagerRef = (0, _react.useRef)(null);
  var headerHeight = statusBarHeight + _Header.HEADER_HEIGHT;
  var _getPlayDetailLayout = (0, require("../../../screens/PlayDetail/Vertical/layout").getPlayDetailLayout)(winWidth, winHeight, headerHeight),
    coverGap = _getPlayDetailLayout.coverGap,
    coverSize = _getPlayDetailLayout.coverSize,
    contentLeft = _getPlayDetailLayout.contentLeft,
    pageTitleTop = _getPlayDetailLayout.titleTop,
    pageArtistTop = _getPlayDetailLayout.artistTop,
    fullTitleWidth = _getPlayDetailLayout.titleWidth,
    textWidth = _getPlayDetailLayout.textWidth,
    contentWidth = _getPlayDetailLayout.contentWidth;
  var coverX = (winWidth - coverSize) / 2;
  var coverY = headerHeight + coverGap;
  var coverRight = coverX + coverSize;
  var transitionDistance = Math.max(winHeight * 0.36, 250);
  // 歌词页顶部的小封面摘要：收起动画从这里出发才能和静态布局无缝衔接
  var lyricSummary = (0, require("./transition").getLyricSummaryLayout)({
    headerHeight: headerHeight,
    coverGap: coverGap,
    contentWidth: contentWidth,
    buttonWidth: _Btn.BTN_WIDTH,
    metrics: {
      paddingLeft: (0, require("../../../utils/pixelRatio").scaleSizeW)(20),
      coverTextGap: (0, require("../../../utils/pixelRatio").scaleSizeW)(16),
      actionGap: (0, require("../../../utils/pixelRatio").scaleSizeW)(2),
      titleFontSize: (0, require("../../../utils/pixelRatio").setSpText)(20),
      titleLineHeight: (0, require("../../../utils/pixelRatio").setSpText)(26),
      artistFontSize: (0, require("../../../utils/pixelRatio").setSpText)(15),
      artistLineHeight: (0, require("../../../utils/pixelRatio").setSpText)(20),
      artistGap: (0, require("../../../utils/pixelRatio").scaleSizeH)(5)
    }
  });
  var isLyricOrigin = transitionOrigin == 'lyric';
  var fullTitleTop = headerHeight + pageTitleTop;
  var fullArtistTop = headerHeight + pageArtistTop;
  // 与静态 MusicInfo 的 actionColumn（横向 row，右对齐，gap 4，paddingTop 2）完全一致
  var actionLayout = (0, require("./transition").getActionColumnLayout)(coverRight, _Btn.BTN_WIDTH, (0, require("../../../utils/pixelRatio").scaleSizeW)(4));
  var measuredActionLayout = musicInfoLayout ? (0, require("./transition").getActionColumnTarget)({
    containerLeft: contentLeft,
    actionX: musicInfoLayout.actionX,
    actionWidth: musicInfoLayout.actionWidth,
    buttonWidth: _Btn.BTN_WIDTH
  }) : null;
  var actionColumnWidth = (_measuredActionLayout = measuredActionLayout == null ? void 0 : measuredActionLayout.width) != null ? _measuredActionLayout : actionLayout.width;
  var fullHeartLeft = (_measuredActionLayout2 = measuredActionLayout == null ? void 0 : measuredActionLayout.heartLeft) != null ? _measuredActionLayout2 : actionLayout.heartLeft;
  var fullMoreLeft = (_measuredActionLayout3 = measuredActionLayout == null ? void 0 : measuredActionLayout.moreLeft) != null ? _measuredActionLayout3 : actionLayout.moreLeft;
  var fullHeartTop = (0, require("./transition").getFullscreenActionTop)(fullTitleTop, musicInfoLayout == null ? void 0 : musicInfoLayout.actionY, musicInfoLayout == null ? void 0 : musicInfoLayout.titleY, (0, require("../../../utils/pixelRatio").scaleSizeH)(2));
  var progressContentHeight = (_progressTarget$heigh = progressTarget == null ? void 0 : progressTarget.height) != null ? _progressTarget$heigh : (0, require("../../../utils/pixelRatio").scaleSizeH)(require("../ProgressBar").PROGRESS_CONTENT_HEIGHT);
  var progressSettleThreshold = 0.01;
  var progressInfoFontSize = progress.interpolate({
    inputRange: [0, progressSettleThreshold, 1],
    outputRange: [(0, require("../../../utils/pixelRatio").setSpText)(15), (0, require("../../../utils/pixelRatio").setSpText)(15), (0, require("../../../utils/pixelRatio").setSpText)(11)]
  });
  var progressInfoLineHeight = progress.interpolate({
    inputRange: [0, progressSettleThreshold, 1],
    outputRange: [require("../../../screens/PlayDetail/Vertical/Player/components/PlayInfo").FULL_PROGRESS_INFO_HEIGHT, require("../../../screens/PlayDetail/Vertical/Player/components/PlayInfo").FULL_PROGRESS_INFO_HEIGHT, require("../ProgressBar").MINI_PROGRESS_INFO_HEIGHT]
  });
  var fullControlSize = Math.min(Math.max(winWidth * 0.33 * global.lx.fontSize * 0.4, _Btn.BTN_WIDTH * 1.2), _Btn.BTN_WIDTH * 1.6, Math.max(winHeight * 0.11, _Btn.BTN_WIDTH * 1.2));
  var fullControlVerticalPadding = (0, require("../../../utils/pixelRatio").scaleSizeH)(22);
  var fullControlContainerHeight = fullControlSize + _Btn.BTN_WIDTH + (0, require("../../../utils/pixelRatio").scaleSizeH)(62);
  var fullControlBottomPadding = (0, require("../../../utils/pixelRatio").scaleSizeH)(15);
  var fullActionRowBottomPadding = (0, require("../../../utils/pixelRatio").scaleSizeH)(6);
  var fullControlLeft = contentLeft;
  var fullControlRight = coverRight;
  var fallbackFullProgress = {
    x: contentLeft,
    y: winHeight - fullControlBottomPadding - fullControlContainerHeight - require("../../../screens/PlayDetail/Vertical/Player/components/PlayInfo").FULL_PROGRESS_INFO_HEIGHT - progressContentHeight,
    width: coverSize,
    height: progressContentHeight
  };
  var fallbackFullControls = {
    prev: {
      x: fullControlLeft,
      y: winHeight - fullControlBottomPadding - fullControlContainerHeight + fullControlVerticalPadding,
      width: fullControlSize,
      height: fullControlSize
    },
    play: {
      x: (winWidth - fullControlSize) / 2,
      y: winHeight - fullControlBottomPadding - fullControlContainerHeight + fullControlVerticalPadding,
      width: fullControlSize,
      height: fullControlSize
    },
    next: {
      x: fullControlRight - fullControlSize,
      y: winHeight - fullControlBottomPadding - fullControlContainerHeight + fullControlVerticalPadding,
      width: fullControlSize,
      height: fullControlSize
    }
  };
  var fullProgress = progressTarget != null ? progressTarget : fallbackFullProgress;
  var fullControls = controlTarget != null ? controlTarget : fallbackFullControls;
  var fallbackControlSize = (0, require("../../../utils/pixelRatio").scaleSizeW)(46);
  var fallbackControlTop = ((_source$bar$y = source == null ? void 0 : source.bar.y) != null ? _source$bar$y : winHeight) + (((_source$bar$height = source == null ? void 0 : source.bar.height) != null ? _source$bar$height : fallbackControlSize) - fallbackControlSize) / 2;
  var fallbackControlRight = ((_source$bar$x = source == null ? void 0 : source.bar.x) != null ? _source$bar$x : 0) + ((_source$bar$width = source == null ? void 0 : source.bar.width) != null ? _source$bar$width : winWidth) - (0, require("../../../utils/pixelRatio").scaleSizeW)(5);
  var fallbackBarControls = {
    prev: {
      x: fallbackControlRight - fallbackControlSize * 3,
      y: fallbackControlTop,
      width: fallbackControlSize,
      height: fallbackControlSize
    },
    play: {
      x: fallbackControlRight - fallbackControlSize * 2,
      y: fallbackControlTop,
      width: fallbackControlSize,
      height: fallbackControlSize
    },
    next: {
      x: fallbackControlRight - fallbackControlSize,
      y: fallbackControlTop,
      width: fallbackControlSize,
      height: fallbackControlSize
    }
  };
  var barProgress = (_source$progress = source == null ? void 0 : source.progress) != null ? _source$progress : {
    x: ((_source$bar$x2 = source == null ? void 0 : source.bar.x) != null ? _source$bar$x2 : 0) + ((_source$bar$width2 = source == null ? void 0 : source.bar.width) != null ? _source$bar$width2 : winWidth) * 0.22,
    y: ((_source$bar$y2 = source == null ? void 0 : source.bar.y) != null ? _source$bar$y2 : winHeight) + ((_source$bar$height2 = source == null ? void 0 : source.bar.height) != null ? _source$bar$height2 : 0) - progressContentHeight - (0, require("../../../utils/pixelRatio").scaleSizeH)(4),
    width: ((_source$bar$width3 = source == null ? void 0 : source.bar.width) != null ? _source$bar$width3 : winWidth) * 0.52,
    height: progressContentHeight
  };
  var barControls = (_source$controls = source == null ? void 0 : source.controls) != null ? _source$controls : fallbackBarControls;
  var barCoverBottom = ((_source$pic$y = source == null ? void 0 : source.pic.y) != null ? _source$pic$y : winHeight) + ((_source$pic$height = source == null ? void 0 : source.pic.height) != null ? _source$pic$height : 0);
  var fullCoverBottom = coverY + coverSize;
  var barCoverHeight = (_source$pic$height2 = source == null ? void 0 : source.pic.height) != null ? _source$pic$height2 : coverSize;
  var barCoverWidth = (_source$pic$width = source == null ? void 0 : source.pic.width) != null ? _source$pic$width : coverSize;
  var barCoverTop = (_source$pic$y2 = source == null ? void 0 : source.pic.y) != null ? _source$pic$y2 : winHeight;
  var barControlsTop = Math.min(barControls.prev.y, barControls.play.y, barControls.next.y);
  var titleClearTop = ((_source$title$y = source == null ? void 0 : source.title.y) != null ? _source$title$y : fullTitleTop) - (0, require("../../../utils/pixelRatio").scaleSizeH)(TRANSITION_CLEAR_GAP);
  var textMoveThreshold = clamp((titleClearTop - fullCoverBottom) / Math.max(1, barCoverBottom - fullCoverBottom), 0.08, 0.94);
  // 最后一段动画直接锁定静态全屏文本布局，避免动画结束时字号和可见宽度再跳变
  var textSettleThreshold = Math.min(0.08, Math.max(0.02, textMoveThreshold - 0.02));
  var textMorphThresholds = [0, textSettleThreshold, textMoveThreshold, 1];
  // 封面和文本共用同一段末态锁定区，避免动画结束前一帧仍有尺寸/圆角舍入差
  var coverMorphThresholds = textMorphThresholds;
  var coverClearBottom = fullCoverBottom + (barCoverBottom - fullCoverBottom) * textMoveThreshold;
  var coverSmallTop = coverClearBottom - barCoverHeight;
  var controlClearTop = barControlsTop - (0, require("../../../utils/pixelRatio").scaleSizeH)(TRANSITION_CLEAR_GAP);
  var progressStageBottom = fullProgress.y + barProgress.height;
  var controlMoveThreshold = clamp(textMoveThreshold * ((controlClearTop - progressStageBottom) / Math.max(1, barProgress.y - fullProgress.y)), 0.04, textMoveThreshold);
  var progressLengthenThreshold = clamp(Math.min(textMoveThreshold * 0.45, controlMoveThreshold * 0.8), 0.02, textMoveThreshold - 0.01);
  var progressMorphThresholds = [0, progressSettleThreshold, progressLengthenThreshold, textMoveThreshold, 1];
  var controlSettleThreshold = Math.min(0.02, Math.max(0.01, controlMoveThreshold * 0.5));
  var controlMorphThresholds = [0, controlSettleThreshold, controlMoveThreshold, 1];
  var handleMusicInfoLayout = (0, _react.useCallback)(function (layout) {
    setMusicInfoLayout(function (prev) {
      return (prev == null ? void 0 : prev.titleY) == layout.titleY && prev.titleWidth == layout.titleWidth && prev.artistY == layout.artistY && prev.artistWidth == layout.artistWidth && prev.lyricY == layout.lyricY && prev.actionX == layout.actionX && prev.actionY == layout.actionY && prev.actionWidth == layout.actionWidth && prev.actionHeight == layout.actionHeight ? prev : layout;
    });
  }, []);
  // 封面端点测量：pager 原点 + 封面在页内的相对布局（均为 Yoga 像素取整后的静态布局值），
  // 比公式重算更能保证与静态封面逐像素一致；onLayout 不受转场 transform 影响，动画期间即可获得
  var handlePagerLayout = (0, _react.useCallback)(function (event) {
    var layout = event.nativeEvent.layout;
    setPagerOrigin(function (prev) {
      return prev != null && prev.x == layout.x && prev.y == layout.y ? prev : {
        x: layout.x,
        y: layout.y
      };
    });
  }, []);
  var handleCoverLayout = (0, _react.useCallback)(function (rect) {
    setCoverRelLayout(function (prev) {
      return prev != null && prev.x == rect.x && prev.y == rect.y && prev.width == rect.width && prev.height == rect.height ? prev : rect;
    });
  }, []);
  var handleToggleLove = function handleToggleLove() {
    if (!playMusicInfo.musicInfo) return;
    if (__DEV__) {
      console.log('[LOVE_DEBUG] PlayerOverlay.handleToggleLove', {
        isLove: isLove,
        id: playMusicInfo.musicInfo.id,
        stack: new Error().stack && new Error().stack.split('\n').slice(1, 12).join(' <- ')
      });
    }
    if (isLove) (0, require("../../../core/player/player").uncollectMusic)();else (0, require("../../../core/player/player").collectMusic)();
  };
  (0, _react.useEffect)(function () {
    pageIndexRef.current = pageIndex;
    (0, require("./transition").setLastOverlayPage)(pageIndex);
    // 分台布光：翻页落定后把压暗层钉到该台的端值。重开时 initialStage 已经对，
    // 这条兜的是运行中的翻页（含 setPageIndex 的其余三条路径）；中途跟手在 handlePageScroll。
    coverStage.dim.setValue(pageIndex == LYRIC_PAGE ? 1 : 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex]);
  var setSourceLayout = (0, _react.useCallback)(function (nextSource) {
    var _rootRef$current;
    (_rootRef$current = rootRef.current) == null ? void 0 : _rootRef$current.measureInWindow(function (rootX, rootY) {
      var _sourceRef$current, _sourceRef$current2;
      var localSource = {
        bar: localRect(nextSource.bar, rootX, rootY),
        pic: localRect(nextSource.pic, rootX, rootY),
        title: localRect(nextSource.title, rootX, rootY),
        artist: localRect(nextSource.artist, rootX, rootY),
        progress: nextSource.progress ? localRect(nextSource.progress, rootX, rootY) : (_sourceRef$current = sourceRef.current) == null ? void 0 : _sourceRef$current.progress,
        controls: nextSource.controls ? localControlLayout(nextSource.controls, rootX, rootY) : (_sourceRef$current2 = sourceRef.current) == null ? void 0 : _sourceRef$current2.controls
      };
      sourceRef.current = localSource;
      setSource(localSource);
    });
  }, []);
  var updateSourceLayout = (0, _react.useCallback)(function (partial) {
    var _rootRef$current2;
    (_rootRef$current2 = rootRef.current) == null ? void 0 : _rootRef$current2.measureInWindow(function (rootX, rootY) {
      var nextSource = {};
      if (partial.progress) nextSource.progress = localRect(partial.progress, rootX, rootY);
      if (partial.controls) nextSource.controls = localControlLayout(partial.controls, rootX, rootY);
      if (!Object.keys(nextSource).length) return;
      if (!sourceRef.current) return;
      sourceRef.current = Object.assign({}, sourceRef.current, nextSource);
      setSource(sourceRef.current);
    });
  }, []);
  var setProgressSourceLayout = (0, _react.useCallback)(function (layout) {
    updateSourceLayout({
      progress: layout
    });
  }, [updateSourceLayout]);
  var setControlSourceLayout = (0, _react.useCallback)(function (layouts) {
    updateSourceLayout({
      controls: layouts
    });
  }, [updateSourceLayout]);
  var invalidateTargetMeasurements = (0, _react.useCallback)(function () {
    targetMeasurementEpochRef.current++;
    targetLayoutsSettledRef.current = false;
    setProgressTarget(null);
    setControlTarget(null);
  }, []);

  // 卡片变形期间内部 Player 的窗口坐标是错的（挂在动画中的卡片里），只在全屏静止时采信测量值
  var setProgressTargetLayout = (0, _react.useCallback)(function (layout) {
    var _rootRef$current3;
    if (!(0, require("./transition").canMeasureFullscreenTarget)({
      progress: progressRef.current,
      isTransitioning: isTransitioningRef.current,
      gestureEnabled: gestureEnabledRef.current,
      settled: targetLayoutsSettledRef.current
    })) return;
    (_rootRef$current3 = rootRef.current) == null ? void 0 : _rootRef$current3.measureInWindow(function (rootX, rootY) {
      setProgressTarget(localRect(layout, rootX, rootY));
    });
  }, []);
  var setControlTargetLayout = (0, _react.useCallback)(function (layouts) {
    var _rootRef$current4;
    if (!(0, require("./transition").canMeasureFullscreenTarget)({
      progress: progressRef.current,
      isTransitioning: isTransitioningRef.current,
      gestureEnabled: gestureEnabledRef.current,
      settled: targetLayoutsSettledRef.current
    })) return;
    (_rootRef$current4 = rootRef.current) == null ? void 0 : _rootRef$current4.measureInWindow(function (rootX, rootY) {
      setControlTarget(localControlLayout(layouts, rootX, rootY));
    });
  }, []);
  var applyTransitionOrigin = (0, _react.useCallback)(function (origin) {
    if (transitionOriginRef.current == origin) return;
    transitionOriginRef.current = origin;
    setTransitionOrigin(origin);
  }, []);

  // 收起动画的起点取决于当前页：歌曲页从大封面出发，歌词页从小封面摘要出发
  var syncTransitionOriginFromPage = (0, _react.useCallback)(function () {
    applyTransitionOrigin((0, require("./transition").getTransitionOrigin)(pageIndexRef.current, LYRIC_PAGE));
  }, [applyTransitionOrigin]);
  var animateTo = (0, _react.useCallback)(function (toValue) {
    var _animationRef$current;
    var velocity = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
    if (!sourceRef.current) return;
    (_animationRef$current = animationRef.current) == null ? void 0 : _animationRef$current.stop();
    setGestureEnabled(false);
    gestureEnabledRef.current = false;
    invalidateTargetMeasurements();
    onSourceVisibilityChange(toValue == 1);
    onBarSettledChange == null ? void 0 : onBarSettledChange(false);
    if (toValue == 1) setFullscreenMounted(false);
    if (toValue == 0) setFullscreenMounted(true);
    if (toValue == 1) {
      // 收起动画一开始就退出歌词工具模式：工具模式收掉了静态播控区，而 ghost 控件层照它的
      // 位置画 morph 终点，不先放回来关闭瞬间会出现鬼影对不上实体的跳变
      (0, _lyricCopy.setLyricToolMode)(false);
      syncTransitionOriginFromPage();
      // 歌词页收起时保持当前页，动画结束后再复位，避免中途切换页面导致闪跳
      if (transitionOriginRef.current != 'lyric') {
        var _pagerRef$current;
        setPageIndex(0);
        (_pagerRef$current = pagerRef.current) == null ? void 0 : _pagerRef$current.setPage(0);
      }
    }
    if (toValue == 0) {
      var homeId = _state.default.componentIds.home;
      if (homeId) (0, require("../../../core/common").setComponentId)(require("../../../config/constant").COMPONENT_IDS.playDetail, homeId);
    }
    var animation = (0, require("./transition").getTransitionAnimationMode)(velocity) == 'timing' ? _reactNative.Animated.timing(progress, {
      toValue: toValue,
      duration: TRANSITION_DURATION_MS,
      easing: _reactNative.Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: false
    }) : _reactNative.Animated.spring(progress, Object.assign({
      toValue: toValue,
      velocity: velocity
    }, TRANSITION_SPRING_CONFIG, {
      useNativeDriver: false
    }));
    animationRef.current = animation;
    isTransitioningRef.current = true;
    setIsTransitioning(true);
    // 这段补间是 useNativeDriver:false 的，JS 线程每帧都要参与；而 PanResponder 只为拖拽登记交互句柄，
    // 动画本身不登记 —— 于是空闲调度器会把"封面取色量化"（实测 143ms 同步）放行进动画中间，
    // 用户看到的就是展开到一半卡一下。这里补一个句柄，整个补间期间都扣住后台活。
    var interactionHandle = _reactNative.InteractionManager.createInteractionHandle();
    animation.start(function (_ref3) {
      // 必须是回调第一行：外部 stop() 也会走到这里（finished=false，下面那行就 return 了），
      // 句柄漏还一次就等于全局的 runAfterInteractions 永久饿死。
      _reactNative.InteractionManager.clearInteractionHandle(interactionHandle);
      var finished = _ref3.finished;
      setIsTransitioning(false);
      isTransitioningRef.current = false;
      if (!finished) return;
      setIsOpen(toValue == 0);
      if (toValue == 0) setFullscreenMounted(true);
      isOpenRef.current = toValue == 0;
      setGestureEnabled(false);
      gestureEnabledRef.current = false;
      if (toValue == 0) {
        var measurementEpoch = targetMeasurementEpochRef.current;
        requestAnimationFrame(function () {
          if (measurementEpoch !== targetMeasurementEpochRef.current || isTransitioningRef.current || gestureEnabledRef.current) return;
          targetLayoutsSettledRef.current = true;
        });
      }
      if (toValue == 1) {
        onBarSettledChange == null ? void 0 : onBarSettledChange(true);
        // 整棵 overlay 的卸载（morph 层 + 歌词 pager）实测要 JS ~43ms、主线程删视图 ~16ms，
        // 赶在落定帧里就是"回到控制栏那一下顿一下"（真机 V2302A 60Hz：帧间隔 66ms，无探针时 30ms）。
        // progress 已经到 1，overlay 与静态控制栏逐像素重合，卸载本身不改画面 —— 推到下一帧，
        // 让落定帧先画出去。中途再展开时 animateTo 会把 progressRef 改成 0，这里直接放弃。
        requestAnimationFrame(function () {
          if (isTransitioningRef.current || progressRef.current != 1) return;
          setMounted(false);
        });
      }
      if (toValue == 1 && _state.default.componentIds.playDetail == _state.default.componentIds.home) {
        (0, require("../../../core/common").removeComponentId)(require("../../../config/constant").COMPONENT_IDS.playDetail);
      }
    });
    progressRef.current = toValue;
  }, [invalidateTargetMeasurements, onBarSettledChange, onSourceVisibilityChange, progress, syncTransitionOriginFromPage]);
  var open = (0, _react.useCallback)(function () {
    if (!sourceRef.current) return;
    var restoredPage = (0, require("./transition").getLastOverlayPage)();
    if (__DEV__) {
      console.log('[PAGE_DEBUG] open', restoredPage);
    }
    onSourceVisibilityChange(false);
    setMounted(true);
    setTransitionPic(musicInfo.pic);
    pageIndexRef.current = restoredPage;
    setPageIndex(restoredPage);
    applyTransitionOrigin((0, require("./transition").getTransitionOrigin)(restoredPage, LYRIC_PAGE));
    progress.setValue(1);
    progressRef.current = 1;
    animateTo(0);
  }, [animateTo, applyTransitionOrigin, musicInfo.pic, onSourceVisibilityChange, progress]);
  var startGesture = (0, _react.useCallback)(function () {
    var _animationRef$current2;
    if (!sourceRef.current) return;
    var restoredPage = (0, require("./transition").getLastOverlayPage)();
    if (__DEV__) {
      console.log('[PAGE_DEBUG] startGesture', restoredPage);
    }
    (_animationRef$current2 = animationRef.current) == null ? void 0 : _animationRef$current2.stop();
    onSourceVisibilityChange(false);
    setMounted(true);
    setTransitionPic(musicInfo.pic);
    pageIndexRef.current = restoredPage;
    setPageIndex(restoredPage);
    applyTransitionOrigin((0, require("./transition").getTransitionOrigin)(restoredPage, LYRIC_PAGE));
    setIsOpen(false);
    isOpenRef.current = false;
    isTransitioningRef.current = false;
    setFullscreenMounted(false);
    invalidateTargetMeasurements();
    setGestureEnabled(true);
    gestureEnabledRef.current = true;
    progress.setValue(1);
    progressRef.current = 1;
  }, [applyTransitionOrigin, invalidateTargetMeasurements, musicInfo.pic, onSourceVisibilityChange, progress]);
  var updateGesture = (0, _react.useCallback)(function (distance) {
    var value = clamp(1 - distance / transitionDistance);
    progressRef.current = value;
    progress.setValue(value);
  }, [progress, transitionDistance]);
  var endGesture = (0, _react.useCallback)(function (distance, velocity) {
    var shouldOpen = progressRef.current < 0.68 || velocity < -0.32;
    animateTo(shouldOpen ? 0 : 1, toProgressVelocity(velocity, transitionDistance));
  }, [animateTo, transitionDistance]);
  var startCloseGesture = (0, _react.useCallback)(function () {
    var _animationRef$current3;
    (_animationRef$current3 = animationRef.current) == null ? void 0 : _animationRef$current3.stop();
    syncTransitionOriginFromPage();
    closeGestureStartDyRef.current = arguments.length > 1 ? arguments[1].dy : 0;
    onSourceVisibilityChange(true);
    invalidateTargetMeasurements();
    setGestureEnabled(false);
    gestureEnabledRef.current = false;
    setIsOpen(false);
    isOpenRef.current = false;
    setIsTransitioning(true);
    setFullscreenMounted(false);
    progress.setValue(0);
    progressRef.current = 0;
  }, [invalidateTargetMeasurements, onSourceVisibilityChange, progress, syncTransitionOriginFromPage]);
  var updateCloseGesture = (0, _react.useCallback)(function (distance) {
    var value = clamp(distance / transitionDistance);
    progressRef.current = value;
    progress.setValue(value);
  }, [progress, transitionDistance]);
  var endCloseGesture = (0, _react.useCallback)(function (distance, velocity) {
    var shouldClose = progressRef.current > 0.32 || velocity > 0.32;
    animateTo(shouldClose ? 1 : 0, toProgressVelocity(velocity, transitionDistance));
  }, [animateTo, transitionDistance]);
  var close = (0, _react.useCallback)(function () {
    animateTo(1);
  }, [animateTo]);
  // 歌词工具模式是播控页里的子界面：返回先退出模式，再按一次才收起整张卡片
  var handleBack = (0, _react.useCallback)(function () {
    if (lyricToolMode) {
      (0, _lyricCopy.setLyricToolMode)(false);
      return;
    }
    close();
  }, [close, lyricToolMode]);
  (0, _react.useEffect)(function () {
    if (!isOpen) return;
    setTransitionPic(musicInfo.pic);
  }, [isOpen, musicInfo.pic]);
  (0, _react.useEffect)(function () {
    if (!isOpen || pageIndex != LYRIC_PAGE) {
      (0, require("../../../utils/nativeModules/utils").screenUnkeepAwake)();
      return;
    }
    (0, require("../../../utils/nativeModules/utils").screenkeepAwake)();
  }, [isOpen, pageIndex]);
  (0, _react.useEffect)(function () {
    if (!isTransitioning && !isOpen) return;
    var subscription = _reactNative.BackHandler.addEventListener('hardwareBackPress', function () {
      if (!isTransitioning) handleBack();
      return true;
    });
    return function () {
      subscription.remove();
    };
  }, [handleBack, isOpen, isTransitioning]);
  (0, _react.useEffect)(function () {
    return function () {
      var _animationRef$current4;
      (_animationRef$current4 = animationRef.current) == null ? void 0 : _animationRef$current4.stop();
    };
  }, []);
  (0, _react.useImperativeHandle)(ref, function () {
    return {
      setSource: setSourceLayout,
      setProgressSource: setProgressSourceLayout,
      setControlSource: setControlSourceLayout,
      setProgressTarget: setProgressTargetLayout,
      setControlTarget: setControlTargetLayout,
      open: open,
      startGesture: startGesture,
      updateGesture: updateGesture,
      endGesture: endGesture,
      close: close,
      progress: progress
    };
  }, [close, endGesture, open, progress, setControlSourceLayout, setControlTargetLayout, setProgressSourceLayout, setProgressTargetLayout, setSourceLayout, startGesture, updateGesture]);
  var closeGestureResponderHandlers = {
    onPanResponderGrant: startCloseGesture,
    onPanResponderMove: function onPanResponderMove(_event, gestureState) {
      updateCloseGesture((0, require("./transition").getCloseGestureDistance)(gestureState.dy, closeGestureStartDyRef.current));
    },
    onPanResponderRelease: function onPanResponderRelease(_event, gestureState) {
      endCloseGesture((0, require("./transition").getCloseGestureDistance)(gestureState.dy, closeGestureStartDyRef.current), gestureState.vy);
    },
    onPanResponderTerminate: function onPanResponderTerminate(_event, gestureState) {
      endCloseGesture((0, require("./transition").getCloseGestureDistance)(gestureState.dy, closeGestureStartDyRef.current), gestureState.vy);
    }
  };
  var isOverlayCloseGesture = function isOverlayCloseGesture(gestureState) {
    return isOpenRef.current && !_overlayModalGesture.overlayModalGesture.active && isCloseGestureAllowed(gestureState);
  };
  var closePanResponder = (0, _react.useRef)(_reactNative.PanResponder.create(Object.assign({
    onStartShouldSetPanResponderCapture: function onStartShouldSetPanResponderCapture() {
      return false;
    },
    // 歌曲页整页可下滑；歌词页交给头部行与小封面行在冒泡阶段认领
    onMoveShouldSetPanResponderCapture: function onMoveShouldSetPanResponderCapture(_event, gestureState) {
      return isOverlayCloseGesture(gestureState) && pageIndexRef.current != LYRIC_PAGE;
    }
  }, closeGestureResponderHandlers))).current;
  var lyricClosePanResponder = (0, _react.useRef)(_reactNative.PanResponder.create(Object.assign({
    onStartShouldSetPanResponder: function onStartShouldSetPanResponder() {
      return false;
    },
    onMoveShouldSetPanResponder: function onMoveShouldSetPanResponder(_event, gestureState) {
      return isOverlayCloseGesture(gestureState) && pageIndexRef.current == LYRIC_PAGE;
    }
  }, closeGestureResponderHandlers))).current;
  var cardMorphTransform = (0, require("./transition").getCardMorphTransformRange)({
    bar: source == null ? {
      x: 0,
      y: winHeight,
      width: winWidth,
      height: winHeight
    } : source.bar,
    windowHeight: winHeight,
    windowWidth: winWidth
  });
  var cardRadius = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 12]
  });
  // 卡片终态不透明并完全盖住真实播放栏，所以这条线在 progress=1 必须保持可见，
  // 它此时就是播放栏的 borderTopWidth；只在贴近全屏时淡出
  var separatorOpacity = progress.interpolate({
    inputRange: [0, 0.08, 1],
    outputRange: [0, 1, 1]
  });
  // ghost 元素只在接近全屏时淡入、离开全屏时立刻淡出，避免手势刚开始时闪现
  var ghostFadeConfig = (0, require("./transition").getGhostFadeConfig)();
  var heartOpacity = progress.interpolate(ghostFadeConfig);
  var coverShadowOpacity = progress.interpolate((0, require("./transition").getMorphCoverShadowFadeConfig)(isLyricOrigin, textMoveThreshold));
  // 歌词页摘要里的小封面本身没有描边，收起时再淡入，避免进度 0 时多出一圈边框
  var coverBorderWidth = isLyricOrigin ? progress.interpolate({
    inputRange: [0, require("./transition").LYRIC_FADE_OUT_END],
    outputRange: [0, require("../../../theme").BorderWidths.normal],
    extrapolate: 'clamp'
  }) : require("../../../theme").BorderWidths.normal;
  var measuredCoverRect = pagerOrigin != null && coverRelLayout != null ? {
    x: pagerOrigin.x + coverRelLayout.x,
    y: pagerOrigin.y + coverRelLayout.y,
    width: coverRelLayout.width,
    height: coverRelLayout.height
  } : null;
  // 收起动画的封面起点：歌曲页是大封面，歌词页是顶部小封面摘要；歌曲页优先用实测布局值
  var coverStart = isLyricOrigin ? lyricSummary.cover : measuredCoverRect != null ? measuredCoverRect : {
    x: coverX,
    y: coverY,
    width: coverSize,
    height: coverSize
  };
  var coverMidTop = isLyricOrigin ? barCoverTop : coverSmallTop;
  var coverLeft = progress.interpolate({
    inputRange: coverMorphThresholds,
    outputRange: [coverStart.x, coverStart.x, (_source$pic$x = source == null ? void 0 : source.pic.x) != null ? _source$pic$x : coverX, (_source$pic$x2 = source == null ? void 0 : source.pic.x) != null ? _source$pic$x2 : coverX]
  });
  var coverTop = progress.interpolate({
    inputRange: coverMorphThresholds,
    outputRange: [coverStart.y, coverStart.y, coverMidTop, barCoverTop]
  });
  var coverWidth = progress.interpolate({
    inputRange: coverMorphThresholds,
    outputRange: [coverStart.width, coverStart.width, barCoverWidth, barCoverWidth]
  });
  var coverHeight = progress.interpolate({
    inputRange: coverMorphThresholds,
    outputRange: [coverStart.height, coverStart.height, barCoverHeight, barCoverHeight]
  });
  var coverRadius = progress.interpolate({
    inputRange: coverMorphThresholds,
    outputRange: [require("../../../screens/PlayDetail/Vertical/layout").FULL_COVER_RADIUS, require("../../../screens/PlayDetail/Vertical/layout").FULL_COVER_RADIUS, require("../../../screens/PlayDetail/Vertical/layout").BAR_COVER_RADIUS, require("../../../screens/PlayDetail/Vertical/layout").BAR_COVER_RADIUS]
  });
  var titleBarRect = (_source$title = source == null ? void 0 : source.title) != null ? _source$title : {
    x: contentLeft,
    y: fullTitleTop,
    width: fullTitleWidth,
    height: require("../../../screens/PlayDetail/Vertical/layout").FULL_TITLE_LINE_HEIGHT
  };
  var artistBarRect = (_source$artist = source == null ? void 0 : source.artist) != null ? _source$artist : {
    x: contentLeft,
    y: fullArtistTop,
    width: fullTitleWidth,
    height: require("../../../screens/PlayDetail/Vertical/layout").FULL_ARTIST_LINE_HEIGHT
  };
  var barTextLeft = barProgress.x;
  var barTextRight = barProgress.x + barProgress.width;
  var clampTextLeft = Math.max(titleBarRect.x, barTextLeft);
  var clampedTitleBarRect = {
    x: clampTextLeft,
    y: titleBarRect.y,
    width: Math.max(0, Math.min(titleBarRect.width, barTextRight - clampTextLeft)),
    height: titleBarRect.height
  };
  var clampedArtistLeft = Math.max(artistBarRect.x, clampedTitleBarRect.x + clampedTitleBarRect.width);
  var clampedArtistBarRect = {
    x: clampedArtistLeft,
    y: artistBarRect.y,
    width: Math.max(0, Math.min(artistBarRect.width, barTextRight - clampedArtistLeft)),
    height: artistBarRect.height
  };
  // 动画终点必须与静态全屏布局完全一致，否则收尾时会跳变
  var fullTitleMorphTop = fullTitleTop + ((_musicInfoLayout$titl = musicInfoLayout == null ? void 0 : musicInfoLayout.titleY) != null ? _musicInfoLayout$titl : 0);
  var fullArtistMorphTop = fullTitleTop + ((_musicInfoLayout$arti = musicInfoLayout == null ? void 0 : musicInfoLayout.artistY) != null ? _musicInfoLayout$arti : require("../../../screens/PlayDetail/Vertical/layout").FULL_TITLE_LINE_HEIGHT + 4);
  // 以静态跑马灯遮罩的实际宽度为准，避免长标题在收尾时可见长度跳变
  var fullTitleMorphWidth = musicInfoLayout && typeof musicInfoLayout.titleWidth == 'number' ? musicInfoLayout.titleWidth : textWidth - actionColumnWidth;
  var fullArtistMorphWidth = musicInfoLayout && typeof musicInfoLayout.artistWidth == 'number' ? musicInfoLayout.artistWidth : textWidth - actionColumnWidth;
  var fullTitleMorphRect = {
    x: contentLeft,
    y: fullTitleMorphTop,
    width: fullTitleMorphWidth,
    height: require("../../../screens/PlayDetail/Vertical/layout").FULL_TITLE_LINE_HEIGHT
  };
  var fullArtistMorphRect = {
    x: contentLeft,
    y: fullArtistMorphTop,
    width: fullArtistMorphWidth,
    height: require("../../../screens/PlayDetail/Vertical/layout").FULL_ARTIST_LINE_HEIGHT
  };
  // 歌词页收起时标题/歌手从摘要行出发，歌曲页仍从封面下方的完整信息出发
  var titleStart = isLyricOrigin ? lyricSummary.title : fullTitleMorphRect;
  var titleStartFontSize = isLyricOrigin ? lyricSummary.titleFontSize : require("../../../screens/PlayDetail/Vertical/layout").FULL_TITLE_FONT_SIZE;
  var titleStartLineHeight = isLyricOrigin ? lyricSummary.titleLineHeight : require("../../../screens/PlayDetail/Vertical/layout").FULL_TITLE_LINE_HEIGHT;
  var titleLeft = progress.interpolate({
    inputRange: textMorphThresholds,
    outputRange: [titleStart.x, titleStart.x, clampedTitleBarRect.x, clampedTitleBarRect.x]
  });
  var titleTop = progress.interpolate({
    inputRange: textMorphThresholds,
    outputRange: [titleStart.y, titleStart.y, clampedTitleBarRect.y, clampedTitleBarRect.y]
  });
  var titleWidth = progress.interpolate({
    inputRange: textMorphThresholds,
    outputRange: [titleStart.width, titleStart.width, clampedTitleBarRect.width, clampedTitleBarRect.width]
  });
  var titleHeight = progress.interpolate({
    inputRange: textMorphThresholds,
    outputRange: [titleStart.height, titleStart.height, clampedTitleBarRect.height, clampedTitleBarRect.height]
  });
  var titleFontSize = progress.interpolate({
    inputRange: textMorphThresholds,
    outputRange: [titleStartFontSize, titleStartFontSize, MINI_TITLE_FONT_SIZE, MINI_TITLE_FONT_SIZE]
  });
  var titleLineHeight = progress.interpolate({
    inputRange: textMorphThresholds,
    outputRange: [titleStartLineHeight, titleStartLineHeight, clampedTitleBarRect.height, clampedTitleBarRect.height]
  });
  var artistStart = isLyricOrigin ? lyricSummary.artist : fullArtistMorphRect;
  var artistStartFontSize = isLyricOrigin ? lyricSummary.artistFontSize : require("../../../screens/PlayDetail/Vertical/layout").FULL_ARTIST_FONT_SIZE;
  var artistStartLineHeight = isLyricOrigin ? lyricSummary.artistLineHeight : require("../../../screens/PlayDetail/Vertical/layout").FULL_ARTIST_LINE_HEIGHT;
  var artistLeft = progress.interpolate({
    inputRange: textMorphThresholds,
    outputRange: [artistStart.x, artistStart.x, clampedArtistBarRect.x, clampedArtistBarRect.x]
  });
  var artistTop = progress.interpolate({
    inputRange: textMorphThresholds,
    outputRange: [artistStart.y, artistStart.y, clampedArtistBarRect.y, clampedArtistBarRect.y]
  });
  var artistWidth = progress.interpolate({
    inputRange: textMorphThresholds,
    outputRange: [artistStart.width, artistStart.width, clampedArtistBarRect.width, clampedArtistBarRect.width]
  });
  var artistHeight = progress.interpolate({
    inputRange: textMorphThresholds,
    outputRange: [artistStart.height, artistStart.height, clampedArtistBarRect.height, clampedArtistBarRect.height]
  });
  var artistFontSize = progress.interpolate({
    inputRange: textMorphThresholds,
    outputRange: [artistStartFontSize, artistStartFontSize, MINI_ARTIST_FONT_SIZE, MINI_ARTIST_FONT_SIZE]
  });
  var artistLineHeight = progress.interpolate({
    inputRange: textMorphThresholds,
    outputRange: [artistStartLineHeight, artistStartLineHeight, clampedArtistBarRect.height, clampedArtistBarRect.height]
  });
  // 歌名自然宽度占满文字栏时，静态底部栏的跑马灯只画到歌名，歌手根本不在末态里；
  // morph 层必须让歌手在飞行途中淡出，否则它会飞进歌名那一行、被零宽裁切框啃成"躲在空白块后面"
  var barTextAvailableWidth = barTextRight - clampTextLeft;
  var titleFillsBarTextColumn = barTextAvailableWidth > 0 && titleBarRect.width > barTextAvailableWidth;
  var artistOpacity = titleFillsBarTextColumn ? progress.interpolate((0, require("./transition").getMorphArtistFadeConfig)(textMorphThresholds, titleStart, artistStart)) : 1;
  var morphOpacity = 1;
  var progressStyle = {
    left: progress.interpolate({
      inputRange: progressMorphThresholds,
      outputRange: [fullProgress.x, fullProgress.x, barProgress.x, barProgress.x, barProgress.x]
    }),
    top: progress.interpolate({
      inputRange: progressMorphThresholds,
      outputRange: [fullProgress.y, fullProgress.y, fullProgress.y, barProgress.y, barProgress.y]
    }),
    width: progress.interpolate({
      inputRange: progressMorphThresholds,
      outputRange: [fullProgress.width, fullProgress.width, barProgress.width, barProgress.width, barProgress.width]
    }),
    height: progress.interpolate({
      inputRange: [0, progressSettleThreshold, 1],
      outputRange: [fullProgress.height, fullProgress.height, barProgress.height]
    }),
    opacity: morphOpacity
  };
  var progressInfoTextStyle = {
    fontSize: progressInfoFontSize,
    lineHeight: progressInfoLineHeight
  };
  var createControlMorph = function createControlMorph(key) {
    var fullRect = fullControls[key];
    var barRect = barControls[key];
    var style = {
      left: progress.interpolate({
        inputRange: controlMorphThresholds,
        outputRange: [fullRect.x, fullRect.x, barRect.x, barRect.x]
      }),
      top: progress.interpolate({
        inputRange: controlMorphThresholds,
        outputRange: [fullRect.y, fullRect.y, barRect.y, barRect.y]
      }),
      width: progress.interpolate({
        inputRange: controlMorphThresholds,
        outputRange: [fullRect.width, fullRect.width, barRect.width, barRect.width]
      }),
      height: progress.interpolate({
        inputRange: controlMorphThresholds,
        outputRange: [fullRect.height, fullRect.height, barRect.height, barRect.height]
      }),
      opacity: morphOpacity
    };
    var iconSize = (0, require("../../../utils/pixelRatio").scaleSizeW)(key == 'play' ? 28 : 22);
    var fullIconSize = fullRect.width * 0.7;
    var iconScale = progress.interpolate({
      inputRange: controlMorphThresholds,
      outputRange: [fullIconSize / iconSize, fullIconSize / iconSize, 1, 1]
    });
    return {
      style: style,
      iconScale: iconScale,
      iconSize: iconSize
    };
  };
  var controlMorphs = {
    prev: createControlMorph('prev'),
    play: createControlMorph('play'),
    next: createControlMorph('next')
  };
  var _getOverlayTransition = (0, require("./transition").getOverlayTransitionVisibility)({
      isOpen: isOpen,
      isTransitioning: isTransitioning,
      gestureEnabled: gestureEnabled
    }),
    showMorphContent = _getOverlayTransition.showMorphContent,
    staticTransitionVisible = _getOverlayTransition.showStaticContent;
  var showStaticContent = staticTransitionVisible && fullscreenMounted;
  var showLyricPager = (0, require("./transition").getLyricPagerVisibility)({
    isLyricOrigin: isLyricOrigin,
    isTransitioning: isTransitioning,
    gestureEnabled: gestureEnabled
  });
  var showCoverMorph = showMorphContent || !fullscreenMounted;
  // 与歌曲页一致：静态头部/底部播放器过渡期间不可见，动画结束时与 morph/ghost 层原子切换，
  // 避免它们在末端与 morph 进度条/控制按钮、ghost 头部/操作行同时渐显造成重影
  var staticOpacityStyle = {
    opacity: showStaticContent ? 1 : 0
  };
  var pagerOpacityStyle = {
    opacity: showStaticContent ? 1 : showLyricPager ? progress.interpolate((0, require("./transition").getLyricPagerFadeConfig)()) : 0
  };
  var showLyricPreview = (0, require("./transition").shouldRenderLyricCurrentPreview)(isLyricOrigin);
  var handlePageSelected = function handlePageSelected(_ref4) {
    var nativeEvent = _ref4.nativeEvent;
    if (__DEV__) {
      console.log('[PAGE_DEBUG] pager event', nativeEvent.position, (0, require("./transition").getLastOverlayPage)());
    }
    pageIndexRef.current = nativeEvent.position;
    setPageIndex(nativeEvent.position);
    // 工具模式收掉的是全局底部播控区，翻回封面页时必须退回普通模式，否则封面页会没有播控
    if (nativeEvent.position != LYRIC_PAGE) (0, _lyricCopy.setLyricToolMode)(false);
  };
  var handlePageScroll = function handlePageScroll(_refScroll: { nativeEvent: { position: number, offset: number } }) {
    var nativeEvent = _refScroll.nativeEvent;
    // 分台布光：翻页中途连续跟手（0=浏览台、1=歌词台）。两页布局里 position+offset 就是 0~1。
    coverStage.dim.setValue(Math.min(1, Math.max(0, nativeEvent.position + nativeEvent.offset)));
  };
  // 卡片与分离出去的 morph/ghost 层一起裁在这条下缘上：下缘从屏幕底边收到播放栏下沿（= 底部导航栏上沿），
  // 与底部导航栏的下移/回升同一个窗口（展开量 60% 就收到屏底），卡片框的下沿也挂在同一条窗口上。
  // 详见 transition.ts 的 getCardBottomClampRange
  var clipStyle = {
    width: winWidth,
    height: progress.interpolate((0, require("./transition").getCardBottomClampRange)({
      winHeight: winHeight,
      barBottom: source == null ? winHeight : source.bar.y + source.bar.height
    }))
  };
  var cardStyle = {
    left: 0,
    top: 0,
    width: winWidth,
    height: winHeight,
    borderRadius: cardRadius,
    overflow: 'hidden',
    backgroundColor: enterFieldBg,
    transform: [{
      translateX: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [cardMorphTransform.from.translateX, cardMorphTransform.to.translateX]
      })
    }, {
      // 竖支多一个关键帧（p = BOTTOM_STRIP_SETTLE_SPAN：下沿已到屏幕下缘），
      // 与底部那一条同窗；水平那一支没有这个拐点
      translateY: progress.interpolate({
        inputRange: [0, require("./transition").BOTTOM_STRIP_SETTLE_SPAN, 1],
        outputRange: [cardMorphTransform.from.translateY, cardMorphTransform.mid.translateY, cardMorphTransform.to.translateY]
      })
    }, {
      scaleX: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [cardMorphTransform.from.scaleX, cardMorphTransform.to.scaleX]
      })
    }, {
      scaleY: progress.interpolate({
        inputRange: [0, require("./transition").BOTTOM_STRIP_SETTLE_SPAN, 1],
        outputRange: [cardMorphTransform.from.scaleY, cardMorphTransform.mid.scaleY, cardMorphTransform.to.scaleY]
      })
    }]
  };
  var separatorStyle = {
    // 直线段两端各内缩一个圆角半径，与静态播放栏 borderTopWidth 的可见直线段对齐；
    // 元素中心仍是 winWidth/2，所以下面的 translateX/scaleX 落点不变
    left: BAR_TOP_CORNER_RADIUS,
    top: 0,
    width: winWidth - BAR_TOP_CORNER_RADIUS * 2,
    opacity: separatorOpacity,
    transform: [{
      translateX: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, cardMorphTransform.to.translateX]
      })
    }, {
      translateY: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, source == null ? winHeight : source.bar.y]
      })
    }, {
      scaleX: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, cardMorphTransform.to.scaleX]
      })
    }]
  };
  var coverStyle = {
    left: coverLeft,
    top: coverTop,
    width: coverWidth,
    height: coverHeight,
    borderRadius: coverRadius
  };
  var titleStyle = {
    left: titleLeft,
    top: titleTop,
    width: titleWidth,
    height: titleHeight
  };
  var titleTextStyle = {
    fontSize: titleFontSize,
    lineHeight: titleLineHeight
  };
  var artistStyle = {
    left: artistLeft,
    top: artistTop,
    width: artistWidth,
    height: artistHeight,
    opacity: artistOpacity
  };
  var artistTextStyle = {
    fontSize: artistFontSize,
    lineHeight: artistLineHeight
  };
  // 静态底部栏是一整段 "歌名 - 歌手"，morph 层的标题与歌手之间空出来的正是 " - " 的位置；
  // 把它挂在歌手盒子左缘一起飞行、并在行程内淡入，收尾时才不会凭空跳出连接符
  var morphSeparatorRect = (0, require("./transition").getMorphSeparatorRect)(clampedTitleBarRect, clampedArtistBarRect, barTextRight);
  var barSeparatorOpacity = progress.interpolate((0, require("./transition").getMorphSeparatorFadeConfig)(textMorphThresholds));
  // 不能写 artistLeft.subtract(...)：RN 只提供静态的 Animated.subtract，插值节点原型上没有该方法
  var barSeparatorLeft = progress.interpolate({
    inputRange: textMorphThresholds,
    outputRange: [artistStart.x - morphSeparatorRect.width, artistStart.x - morphSeparatorRect.width, morphSeparatorRect.left, morphSeparatorRect.left]
  });
  var barSeparatorStyle = {
    left: barSeparatorLeft,
    top: artistTop,
    width: morphSeparatorRect.width,
    height: artistHeight,
    opacity: barSeparatorOpacity
  };
  var barSeparatorTextStyle = {
    fontSize: artistFontSize,
    lineHeight: artistLineHeight
  };
  var actionColumnStyle = {
    left: isLyricOrigin ? lyricSummary.action.x : fullHeartLeft,
    top: isLyricOrigin ? lyricSummary.action.y : fullHeartTop,
    width: _Btn.BTN_WIDTH,
    height: _Btn.BTN_WIDTH,
    opacity: heartOpacity
  };
  // 过渡期淡入的非运动元素副本，位置与静态全屏布局完全一致
  var ghostDotsStyle = {
    left: isLyricOrigin ? lyricSummary.action.x + lyricSummary.action.width - _Btn.BTN_WIDTH : fullMoreLeft,
    top: isLyricOrigin ? lyricSummary.action.y : fullHeartTop,
    width: _Btn.BTN_WIDTH,
    height: _Btn.BTN_WIDTH,
    opacity: heartOpacity
  };
  var fallbackLyricOffsetY = require("../../../screens/PlayDetail/Vertical/layout").FULL_TITLE_LINE_HEIGHT + 4 + require("../../../screens/PlayDetail/Vertical/layout").FULL_ARTIST_LINE_HEIGHT + 12;
  var ghostLyricStyle = {
    left: contentLeft,
    top: (0, require("./transition").getGhostLyricTop)(fullTitleTop, musicInfoLayout == null ? void 0 : musicInfoLayout.lyricY, fallbackLyricOffsetY),
    width: textWidth,
    opacity: heartOpacity
  };
  var ghostActionRowStyle = {
    left: contentLeft,
    top: winHeight - fullControlBottomPadding - _Btn.BTN_WIDTH - fullActionRowBottomPadding,
    width: coverSize,
    opacity: heartOpacity
  };
  var progressPercent = `${toProgressNumber(playProgress) * 100}%`;
  var bufferedPercent = `${toProgressNumber(playBuffered) * 100}%`;
  return <_reactNative.View ref={rootRef} pointerEvents={(0, require("./transition").getOverlayRootPointerEvents)(mounted)} style={styles.root}>{mounted && source && <>{(<_reactNative.Animated.View pointerEvents="box-none" style={[styles.clip, clipStyle]}>{wallpaperBackdropSource != null ? <WallpaperBackdrop
        winWidth={winWidth}
        winHeight={winHeight}
        progress={progress}
        imageSource={{ uri: wallpaperBackdropSource.uri }}
        blurRadius={wallpaperBackdropSource.blur}
        veil={wallpaperBackdropVeil}
        barTop={source == null ? winHeight : source.bar.y}
      /> : null}{(0, _jsxRuntime.jsxs)(_reactNative.Animated.View, Object.assign({
        pointerEvents: mounted && !isTransitioning ? 'auto' : 'none',
        style: [styles.card, cardStyle]
      }, closePanResponder.panHandlers, {
        children: [(0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
          pointerEvents: "none",
          style: [_reactNative.StyleSheet.absoluteFillObject, {
            // 壁纸模式：卡片必须是一层透明的膜，底由外面那层 WallpaperBackdrop 出。
            // 不能继续用 enterFieldBg —— 那条插值在"封面动态背景也开着"时会端起一支不透明的
            // 深色 panel（baseTheme 是壁纸模式、context 是 on-cover），整屏把那层壁纸盖死。
            backgroundColor: wallpaperBackdropSource != null ? 'transparent' : enterFieldBg
          }]
        }), (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
          style: styles.background,
          children: (0, _jsxRuntime.jsx)(OverlayBackdrop, {
            winWidth: winWidth,
            winHeight: winHeight,
            progress: progress
          })
        }), (fullscreenMounted || showLyricPager) && <_reactNative.View pointerEvents={showStaticContent ? 'auto' : 'none'} style={styles.content}>{(0, _jsxRuntime.jsx)(_reactNative.Animated.View, Object.assign({}, lyricClosePanResponder.panHandlers, {
            style: staticOpacityStyle,
            children: <_Header.default onBack={handleBack} pageIndex={pageIndex} onPageSelected={function onPageSelected(page) {
              var _pagerRef$current2;
              return (_pagerRef$current2 = pagerRef.current) == null ? void 0 : _pagerRef$current2.setPage(page);
            }} />
          }))}{(fullscreenMounted || showLyricPager) && (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
            style: [styles.pagerView, pagerOpacityStyle],
            onLayout: handlePagerLayout,
            children: <_reactNativePagerView.default ref={pagerRef} initialPage={pageIndex} onPageSelected={handlePageSelected} onPageScroll={handlePageScroll} style={styles.pagerViewInner}><_reactNative.View collapsable={false}><_Pic.default onMusicInfoLayout={handleMusicInfoLayout} onCoverLayout={handleCoverLayout} marqueeActive={showStaticContent} /></_reactNative.View><_reactNative.View collapsable={false}><LyricPage activeIndex={pageIndex} showSummary={showStaticContent} summaryGestureHandlers={lyricClosePanResponder.panHandlers} /></_reactNative.View></_reactNativePagerView.default>
          })}{(fullscreenMounted || showLyricPager) && !lyricToolMode && (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
            style: [styles.bottom, staticOpacityStyle],
            children: <_Player.default showMusicInfo={false} onProgressLayout={setProgressTargetLayout} onControlLayout={setControlTargetLayout} />
          })}</_reactNative.View>]
      }))}{(0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
        pointerEvents: "none",
        style: [styles.transitionSeparator, separatorStyle, {
          backgroundColor: enterInkBorder
        }]
      })}{showCoverMorph && (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
        pointerEvents: "none",
        style: [styles.morphClip, titleStyle],
        children: (0, _jsxRuntime.jsx)(_reactNative.Animated.Text, {
          numberOfLines: 1,
          ellipsizeMode: "clip",
          style: [styles.morphText, titleTextStyle, {
            color: enterInkFont
          }, textShadowStyle],
          children: musicInfo.name
        })
      })}{showCoverMorph && (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
        pointerEvents: "none",
        style: [styles.morphClip, artistStyle],
        children: (0, _jsxRuntime.jsx)(_reactNative.Animated.Text, {
          numberOfLines: 1,
          ellipsizeMode: "clip",
          style: [styles.morphText, artistTextStyle, {
            color: enterInkLabel
          }, textShadowStyle],
          children: musicInfo.singer
        })
      })}{showCoverMorph && musicInfo.singer ? (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
        pointerEvents: "none",
        style: [styles.morphClip, barSeparatorStyle],
        children: (0, _jsxRuntime.jsx)(_reactNative.Animated.Text, {
          numberOfLines: 1,
          ellipsizeMode: "clip",
          style: [styles.morphText, barSeparatorTextStyle, {
            color: enterInkLabel
          }, textShadowStyle],
          children: " - "
        })
      }) : null}{showCoverMorph && <>{(0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
          pointerEvents: isOpen ? 'auto' : 'none',
          style: [styles.morphTitle, actionColumnStyle],
          children: <_reactNative.TouchableOpacity activeOpacity={0.7} hitSlop={{
            top: 10,
            bottom: 5,
            left: 10,
            right: 10
          }} onPress={handleToggleLove} style={styles.loveBtn}>{[(0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
            pointerEvents: "none",
            style: [styles.morphIconLayer, {
              opacity: enterIconCollapsed
            }],
            children: (0, _jsxRuntime.jsx)(require("../../common/LoveIcon").LoveIcon, {
              filled: isLove,
              size: _Btn.BTN_ICON_SIZE,
              color: isLove ? baseTheme['c-button-font'] : baseTheme['c-font-label']
            })
          }, 'bar'), (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
            pointerEvents: "none",
            style: [styles.morphIconLayer, {
              opacity: enterIconExpanded
            }],
            children: (0, _jsxRuntime.jsx)(require("../../common/LoveIcon").LoveIcon, {
              filled: isLove,
              size: _Btn.BTN_ICON_SIZE,
              color: isLove ? glassColors.accent : glassColors.muted
            })
          }, 'cover')]}</_reactNative.TouchableOpacity>
        })}{(0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
          pointerEvents: "none",
          style: [styles.ghostBtn, ghostDotsStyle],
          children: (0, _jsxRuntime.jsx)(require("../../common/Icon").Icon, {
            name: "dots-vertical",
            color: glassColors.muted,
            size: _Btn.BTN_ICON_SIZE,
            style: {
              transform: [{
                translateX: _Btn.DOTS_VERTICAL_ALIGNMENT_OFFSET
              }]
            }
          })
        })}{(0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
          pointerEvents: "none",
          style: [styles.ghostHeader, {
            opacity: heartOpacity
          }],
          children: <_Header.default pageIndex={pageIndex} onPageSelected={function onPageSelected(page) {
            var _pagerRef$current3;
            return (_pagerRef$current3 = pagerRef.current) == null ? void 0 : _pagerRef$current3.setPage(page);
          }} />
        })}{showLyricPreview ? (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
          pointerEvents: "none",
          style: [styles.ghostLyric, ghostLyricStyle],
          children: <_LyricPreview.default topGap={false} lineCount={2} />
        }) : null}{(0, _jsxRuntime.jsxs)(_reactNative.Animated.View, {
          pointerEvents: "none",
          style: [styles.ghostActionRow, ghostActionRowStyle],
          children: [<_PlayModeBtn.default />, <_TimeoutExitBtn.default />, <_CommentBtn.default />, <_Btn.default icon="list-order" onPress={function onPress() {}} />]
        })}{(0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
          pointerEvents: "none",
          style: [styles.coverShadow, coverStyle, {
            backgroundColor: enterFieldBg,
            borderRadius: coverRadius,
            borderWidth: coverBorderWidth,
            borderColor: enterInkBorder,
            opacity: coverShadowOpacity
          }]
        })}{(0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
          pointerEvents: "none",
          style: [styles.cover, coverStyle, {
            backgroundColor: enterInkPlate,
            borderWidth: coverBorderWidth,
            borderColor: enterInkBorder
          }],
          children: (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
            style: styles.coverContent,
            children: <_Image.default url={transitionPic} style={styles.coverImage} />
          })
        })}{(0, _jsxRuntime.jsxs)(_reactNative.Animated.View, {
          pointerEvents: "none",
          style: [styles.morphProgress, progressStyle],
          children: [<_reactNative.View style={styles.progressTrackWrapper}><_reactNative.View style={{
              position: 'relative',
              width: '100%',
              height: require("../ProgressBar").PROGRESS_BAR_HEIGHT
            }}><_reactNative.Animated.View style={Object.assign({}, styles.progressBar, (0, require("./transition").getMorphProgressTrackStyle)(), {
                backgroundColor: enterInkTrack
              })} /><_reactNative.Animated.View style={Object.assign({}, styles.progressBar, {
                backgroundColor: enterInkBuffered,
                width: bufferedPercent
              })} /><_reactNative.Animated.View style={Object.assign({}, styles.progressBar, {
                backgroundColor: enterInkFill,
                width: progressPercent
              })}><_reactNative.Animated.View style={[styles.progressDot, {
                  width: require("../ProgressBar").PROGRESS_DOT_SIZE,
                  height: require("../ProgressBar").PROGRESS_DOT_SIZE,
                  top: (require("../ProgressBar").PROGRESS_BAR_HEIGHT - require("../ProgressBar").PROGRESS_DOT_SIZE) / 2,
                  right: -require("../ProgressBar").PROGRESS_DOT_SIZE / 2,
                  borderRadius: require("../ProgressBar").PROGRESS_DOT_SIZE / 2,
                  backgroundColor: enterInkDot
                }]} /></_reactNative.Animated.View></_reactNative.View></_reactNative.View>, <_reactNative.View style={styles.morphProgressInfo}>{(0, _jsxRuntime.jsx)(_reactNative.Animated.Text, {
              style: [styles.morphProgressTime, progressInfoTextStyle, {
                color: enterInkLabel
              }, textShadowStyle],
              children: playerProgress.nowPlayTimeStr
            })}{(0, _jsxRuntime.jsx)(_reactNative.Animated.Text, {
              style: [styles.morphProgressTime, progressInfoTextStyle, {
                color: enterInkLabel
              }, textShadowStyle],
              children: playerProgress.maxPlayTimeStr
            })}</_reactNative.View>]
        })}</>}{showCoverMorph && ['prev', 'play', 'next'].map(function (key) {
        var morph = controlMorphs[key];
        var iconName = key == 'play' ? isPlay ? 'pause' : 'play' : key == 'prev' ? 'prevMusic' : 'nextMusic';
        // Icon 的 color 不是 Animated 属性（它只是个 Text），要淡变只能同位叠两份、各走一条互补的透明度曲线
        return (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
          pointerEvents: "none",
          style: [styles.morphControl, morph.style],
          children: (0, _jsxRuntime.jsxs)(_reactNative.Animated.View, {
            style: [styles.morphControlIcon, {
              transform: [{
                scale: morph.iconScale
              }]
            }],
            children: [(0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
              pointerEvents: "none",
              style: [styles.morphIconLayer, {
                opacity: enterIconCollapsed
              }],
              children: (0, _jsxRuntime.jsx)(require("../../common/Icon").Icon, {
                name: iconName,
                color: baseTheme['c-button-font'],
                rawSize: morph.iconSize
              })
            }, 'bar'), (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
              pointerEvents: "none",
              style: [styles.morphIconLayer, {
                opacity: enterIconExpanded
              }],
              children: (0, _jsxRuntime.jsx)(require("../../common/Icon").Icon, {
                name: iconName,
                color: glassColors.accent,
                rawSize: morph.iconSize
              })
            }, 'cover')]
          })
        }, key);
      })}</_reactNative.Animated.View>)}<_reactNative.View pointerEvents={gestureEnabled ? 'auto' : 'box-none'} style={{
        position: 'absolute',
        left: source.bar.x,
        top: source.bar.y,
        width: source.bar.width,
        height: source.bar.height
      }} /></>}</_reactNative.View>;
});
var PlayerOverlayProvider = exports.PlayerOverlayProvider = function PlayerOverlayProvider(_ref5) {
  var children = _ref5.children;
  var overlayRef = (0, _react.useRef)(null);
  var progress = (0, _react.useRef)(new _reactNative.Animated.Value(1)).current;
  var _useState21 = (0, _react.useState)(true),
    _useState22 = (0, _slicedToArray2.default)(_useState21, 2),
    sourceVisible = _useState22[0],
    setSourceVisible = _useState22[1];
  var _useState23 = (0, _react.useState)(true),
    _useState24 = (0, _slicedToArray2.default)(_useState23, 2),
    barSettled = _useState24[0],
    setBarSettled = _useState24[1];
  var handleSourceVisibilityChange = (0, _react.useCallback)(function (visible) {
    setSourceVisible(visible);
  }, []);
  var handleBarSettledChange = (0, _react.useCallback)(function (settled) {
    setBarSettled(settled);
  }, []);
  var controller = (0, _react.useMemo)(function () {
    return {
      setSource: function setSource(source) {
        var _overlayRef$current;
        (_overlayRef$current = overlayRef.current) == null ? void 0 : _overlayRef$current.setSource(source);
      },
      setProgressSource: function setProgressSource(layout) {
        var _overlayRef$current2;
        (_overlayRef$current2 = overlayRef.current) == null ? void 0 : _overlayRef$current2.setProgressSource(layout);
      },
      setControlSource: function setControlSource(layouts) {
        var _overlayRef$current3;
        (_overlayRef$current3 = overlayRef.current) == null ? void 0 : _overlayRef$current3.setControlSource(layouts);
      },
      setProgressTarget: function setProgressTarget(layout) {
        var _overlayRef$current4;
        (_overlayRef$current4 = overlayRef.current) == null ? void 0 : _overlayRef$current4.setProgressTarget(layout);
      },
      setControlTarget: function setControlTarget(layouts) {
        var _overlayRef$current5;
        (_overlayRef$current5 = overlayRef.current) == null ? void 0 : _overlayRef$current5.setControlTarget(layouts);
      },
      open: function open() {
        var _overlayRef$current6;
        (_overlayRef$current6 = overlayRef.current) == null ? void 0 : _overlayRef$current6.open();
      },
      startGesture: function startGesture() {
        var _overlayRef$current7;
        (_overlayRef$current7 = overlayRef.current) == null ? void 0 : _overlayRef$current7.startGesture();
      },
      updateGesture: function updateGesture(distance) {
        var _overlayRef$current8;
        (_overlayRef$current8 = overlayRef.current) == null ? void 0 : _overlayRef$current8.updateGesture(distance);
      },
      endGesture: function endGesture(distance, velocity) {
        var _overlayRef$current9;
        (_overlayRef$current9 = overlayRef.current) == null ? void 0 : _overlayRef$current9.endGesture(distance, velocity);
      },
      close: function close() {
        var _overlayRef$current0;
        (_overlayRef$current0 = overlayRef.current) == null ? void 0 : _overlayRef$current0.close();
      },
      progress: progress,
      sourceVisible: sourceVisible,
      barSettled: barSettled
    };
  }, [barSettled, progress, sourceVisible]);
  return <PlayerOverlayContext.Provider value={controller}>{children}<_CoverStageProvider.default initialStage={(0, require("./transition").getLastOverlayPage)() == LYRIC_PAGE ? 'lyric' : 'browse'}><_OnCoverThemeProvider.default><PlayerOverlay ref={overlayRef} progress={progress} onSourceVisibilityChange={handleSourceVisibilityChange} onBarSettledChange={handleBarSettledChange} /></_OnCoverThemeProvider.default></_CoverStageProvider.default></PlayerOverlayContext.Provider>;
};
var styles = (0, require("../../../utils/tools").createStyle)({
  root: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 100
  },
  card: {
    position: 'absolute',
    left: 0,
    top: 0
  },
  // 只出那条下缘（高度挂在 progress 轴上，见 clipStyle）：卡片与 morph/ghost 层都从它里面出
  clip: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'hidden'
  },
  transitionSeparator: {
    position: 'absolute',
    height: require("../../../theme").BorderWidths.normal
  },
  background: Object.assign({}, _reactNative.StyleSheet.absoluteFillObject),
  content: {
    flex: 1
  },
  pagerView: {
    flex: 1
  },
  pagerViewInner: {
    flex: 1
  },
  bottom: {
    flex: 0,
    justifyContent: 'flex-end'
  },
  cover: {
    position: 'absolute',
    overflow: 'hidden'
  },
  // 与 PlayerBar / PlayDetail 静态封面使用同一组阴影参数，避免转场中出现双层或渐隐偏差
  coverShadow: {
    position: 'absolute',
    backgroundColor: 'transparent',
    elevation: 18,
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowOffset: {
      width: 0,
      height: 8
    },
    shadowRadius: 18
  },
  coverContent: {
    width: '100%',
    height: '100%',
    overflow: 'hidden'
  },
  coverImage: {
    width: '100%',
    height: '100%'
  },
  morphProgress: {
    position: 'absolute'
  },
  // 静态 Progress 的轨道由 paddingTop 定位（不是垂直居中），动画层必须用同样的 paddingTop 才能在切换时对齐
  progressTrackWrapper: Object.assign({}, _reactNative.StyleSheet.absoluteFillObject, {
    justifyContent: 'flex-start',
    paddingTop: 10
  }),
  morphProgressInfo: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  morphProgressTime: {
    flexShrink: 0,
    fontSize: (0, require("../../../utils/pixelRatio").setSpText)(11),
    fontVariant: ['tabular-nums'],
    includeFontPadding: false
  },
  progressBar: {
    position: 'absolute',
    // PROGRESS_BAR_HEIGHT 已完成换算，不能经过 createStyle 二次缩放；轨道高度由外层轨道盒决定
    height: '100%',
    left: 0,
    top: 0,
    borderRadius: 4
  },
  progressDot: {
    position: 'absolute'
  },
  morphControl: {
    position: 'absolute'
  },
  morphControlIcon: Object.assign({}, _reactNative.StyleSheet.absoluteFillObject, {
    alignItems: 'center',
    justifyContent: 'center'
  }),
  // 同一枚图标的两份墨色副本要重叠在同一位置：父容器是 flex，直接并排放两个子节点会左右排开
  morphIconLayer: Object.assign({}, _reactNative.StyleSheet.absoluteFillObject, {
    alignItems: 'center',
    justifyContent: 'center'
  }),
  morphTitle: {
    position: 'absolute'
  },
  // 与 SynchronizedMarquee 的 mask 同构：外层裁切、内层按自然宽度排版，
  // 这样长文本的最后一个字能像静态控制栏一样只露一半，
  // 而不是被安卓的 ellipsizeMode:'clip' 整字丢掉、收尾时比静态栏少露一个字
  morphClip: {
    position: 'absolute',
    overflow: 'hidden'
  },
  morphText: {
    width: MORPH_TEXT_NATURAL_WIDTH,
    includeFontPadding: false
  },
  // BTN_WIDTH 已完成屏幕换算，不能再经过 createStyle 二次缩放；
  // 这里用百分比铺满外层容器（外层 width/height 为原始 BTN_WIDTH），与静态 MusicInfo 的按钮盒一致
  loveBtn: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'center',
    width: '100%'
  },
  ghostHeader: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  ghostBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute'
  },
  ghostLyric: {
    position: 'absolute'
  },
  ghostActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 6,
    position: 'absolute'
  }
});
var _default = exports.default = PlayerOverlay;

export interface PlayerTextLayout {
  x: number
  y: number
  width: number
  height: number
}

export interface PlayerRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PlayerControlLayout {
  prev: PlayerRect
  play: PlayerRect
  next: PlayerRect
}

export interface PlayerSourceLayout {
  bar: { x: number, y: number, width: number, height: number }
  pic: { x: number, y: number, width: number, height: number }
  title: PlayerTextLayout
  artist: PlayerTextLayout
  progress?: PlayerRect
  controls?: PlayerControlLayout
}

export interface PlayerOverlayController {
  setSource: (source: PlayerSourceLayout) => void
  setProgressSource: (layout: PlayerRect) => void
  setControlSource: (layouts: PlayerControlLayout) => void
  setProgressTarget: (layout: PlayerRect) => void
  setControlTarget: (layouts: PlayerControlLayout) => void
  open: () => void
  startGesture: () => void
  updateGesture: (distance: number) => void
  endGesture: (distance: number, velocity: number) => void
  close: () => void
  progress: Animated.Value
  sourceVisible: boolean
  barSettled: boolean
}
