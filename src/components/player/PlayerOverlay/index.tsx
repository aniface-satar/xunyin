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
var LyricPage = function LyricPage(_ref) {
  var activeIndex = _ref.activeIndex,
    showSummary = _ref.showSummary;
  var initedRef = (0, _react.useRef)(false);
  var lyric = (0, _react.useMemo)(function () {
    return <_Lyric.default showSummary={showSummary} />;
  }, [showSummary]);
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
  var progress = _refBackdrop.progress,
    source = _refBackdrop.source,
    winWidth = _refBackdrop.winWidth,
    winHeight = _refBackdrop.winHeight;
  var theme = (0, require("../../../store/theme/hook").useTheme)();
  var backdropImageSource = theme['bg-image'];
  var hasBackdropImage = backdropImageSource != null;
  var backdropOffsetX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-source.bar.x, 0]
  });
  var backdropOffsetY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-source.bar.y, 0]
  });
  return (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
    pointerEvents: "none",
    style: {
      position: 'absolute',
      left: 0,
      top: 0,
      width: winWidth,
      height: winHeight,
      backgroundColor: theme['c-content-background'],
      transform: [{ translateX: backdropOffsetX }, { translateY: backdropOffsetY }]
    },
    children: (0, _jsxRuntime.jsxs)(_jsxRuntime.Fragment, {
      children: [hasBackdropImage ? (0, _jsxRuntime.jsx)(_ImageBackground.default, {
        style: _reactNative.StyleSheet.absoluteFill,
        source: backdropImageSource,
        resizeMode: "cover",
        blurRadius: 24
      }) : null, (0, _jsxRuntime.jsx)(_reactNative.View, {
        style: [_reactNative.StyleSheet.absoluteFill, {
          backgroundColor: theme['c-content-background'],
          opacity: hasBackdropImage ? 0.58 : 0.64
        }]
      })]
    })
  });
};
var PlayerOverlay = (0, _react.forwardRef)(function (_ref2, ref) {
  var _measuredActionLayout, _measuredActionLayout2, _measuredActionLayout3, _progressTarget$heigh, _source$bar$y, _source$bar$height, _source$bar$x, _source$bar$width, _source$progress, _source$bar$x2, _source$bar$width2, _source$bar$y2, _source$bar$height2, _source$bar$width3, _source$controls, _source$pic$y, _source$pic$height, _source$pic$height2, _source$pic$width, _source$pic$y2, _source$title$y, _source$pic$x, _source$pic$x2, _source$title, _source$artist, _musicInfoLayout$titl, _musicInfoLayout$arti;
  var progress = _ref2.progress,
    onSourceVisibilityChange = _ref2.onSourceVisibilityChange,
    onBarSettledChange = _ref2.onBarSettledChange;
  var theme = (0, require("../../../store/theme/hook").useTheme)();
  var glassColors = (0, require("../../../utils/hooks/useGlassColors").useGlassColors)();
  var musicInfo = (0, require("../../../store/player/hook").usePlayerMusicInfo)();
  var playMusicInfo = (0, require("../../../store/player/hook").usePlayMusicInfo)();
  var isLove = (0, require("../../../store/player/useIsLove").useIsLove)();
  var playerProgress = (0, require("../../../store/player/hook").useProgress)();
  var playProgress = playerProgress.progress;
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
  var transitionOriginRef = (0, _react.useRef)('pic');
  var progressRef = (0, _react.useRef)(1);
  var isOpenRef = (0, _react.useRef)(false);
  var pageIndexRef = (0, _react.useRef)(0);
  var isTransitioningRef = (0, _react.useRef)(false);
  var gestureEnabledRef = (0, _react.useRef)(false);
  var targetLayoutsSettledRef = (0, _react.useRef)(false);
  var targetMeasurementEpochRef = (0, _react.useRef)(0);
  var closeGestureStartDyRef = (0, _react.useRef)(0);
  var closeGestureAreaRef = (0, _react.useRef)({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0
  });
  console.log('[PAGE_DEBUG] PlayerOverlay render', {
    mounted,
    pageIndex,
    remembered: (0, require("./transition").getLastOverlayPage)()
  });
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
  var closeGestureActivationThreshold = (0, require("./transition").getCloseGestureActivationThreshold)();
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
  closeGestureAreaRef.current = pageIndex == LYRIC_PAGE ? (0, require("./transition").getLyricCloseGestureArea)({
    coverBottom: lyricSummary.cover.y + lyricSummary.cover.height,
    windowWidth: winWidth
  }) : {
    top: coverY,
    bottom: coverY + coverSize,
    left: coverX,
    right: coverRight
  };
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
  var handleToggleLove = function handleToggleLove() {
    if (!playMusicInfo.musicInfo) return;
    console.log('[LOVE_DEBUG] PlayerOverlay.handleToggleLove', {
      isLove: isLove,
      id: playMusicInfo.musicInfo.id,
      stack: new Error().stack && new Error().stack.split('\n').slice(1, 12).join(' <- ')
    });
    if (isLove) (0, require("../../../core/player/player").uncollectMusic)();else (0, require("../../../core/player/player").collectMusic)();
  };
  (0, _react.useEffect)(function () {
    pageIndexRef.current = pageIndex;
    (0, require("./transition").setLastOverlayPage)(pageIndex);
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
    animation.start(function (_ref3) {
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
        setMounted(false);
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
    console.log('[PAGE_DEBUG] open', restoredPage);
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
    console.log('[PAGE_DEBUG] startGesture', restoredPage);
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
      if (!isTransitioning) close();
      return true;
    });
    return function () {
      subscription.remove();
    };
  }, [close, isOpen, isTransitioning]);
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
  var closePanResponder = (0, _react.useRef)(_reactNative.PanResponder.create({
    onStartShouldSetPanResponderCapture: function onStartShouldSetPanResponderCapture() {
      return false;
    },
    onMoveShouldSetPanResponderCapture: function onMoveShouldSetPanResponderCapture(_event, gestureState) {
      var gestureArea = closeGestureAreaRef.current;
      var inGestureArea = gestureState.x0 >= gestureArea.left && gestureState.x0 <= gestureArea.right && gestureState.y0 >= gestureArea.top && gestureState.y0 <= gestureArea.bottom;
      return isOpenRef.current && !_overlayModalGesture.overlayModalGesture.active && gestureState.dy > closeGestureActivationThreshold && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) && (pageIndexRef.current != LYRIC_PAGE || inGestureArea);
    },
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
  })).current;
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
  var separatorOpacity = progress.interpolate({
    inputRange: [0, 0.08, 0.92, 1],
    outputRange: [0, 1, 1, 0]
  });
  // ghost 元素只在接近全屏时淡入、离开全屏时立刻淡出，避免手势刚开始时闪现
  var ghostFadeConfig = (0, require("./transition").getGhostFadeConfig)();
  var heartOpacity = progress.interpolate(ghostFadeConfig);
  var coverShadowOpacity = isLyricOrigin ? progress.interpolate({
    inputRange: [0, require("./transition").LYRIC_FADE_OUT_END],
    outputRange: [0, 1],
    extrapolate: 'clamp'
  }) : 1;
  // 歌词页摘要里的小封面本身没有描边，收起时再淡入，避免进度 0 时多出一圈边框
  var coverBorderWidth = isLyricOrigin ? progress.interpolate({
    inputRange: [0, require("./transition").LYRIC_FADE_OUT_END],
    outputRange: [0, require("../../../theme").BorderWidths.normal, require("../../../theme").BorderWidths.normal],
    extrapolate: 'clamp'
  }) : require("../../../theme").BorderWidths.normal;
  // 收起动画的封面起点：歌曲页是大封面，歌词页是顶部小封面摘要
  var coverStart = isLyricOrigin ? lyricSummary.cover : {
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
    console.log('[PAGE_DEBUG] pager event', nativeEvent.position, (0, require("./transition").getLastOverlayPage)());
    setPageIndex(nativeEvent.position);
  };
  var cardStyle = {
    left: 0,
    top: 0,
    width: winWidth,
    height: winHeight,
    borderRadius: cardRadius,
    overflow: 'hidden',
    backgroundColor: theme['c-content-background'],
    transform: [{
      translateX: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [cardMorphTransform.from.translateX, cardMorphTransform.to.translateX]
      })
    }, {
      translateY: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [cardMorphTransform.from.translateY, cardMorphTransform.to.translateY]
      })
    }, {
      scaleX: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [cardMorphTransform.from.scaleX, cardMorphTransform.to.scaleX]
      })
    }, {
      scaleY: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [cardMorphTransform.from.scaleY, cardMorphTransform.to.scaleY]
      })
    }]
  };
  var separatorStyle = {
    left: 0,
    top: 0,
    width: winWidth,
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
    height: artistHeight
  };
  var artistTextStyle = {
    fontSize: artistFontSize,
    lineHeight: artistLineHeight
  };
  var actionColumnStyle = {
    left: isLyricOrigin ? lyricSummary.action.x : fullHeartLeft,
    top: isLyricOrigin ? lyricSummary.action.y : fullHeartTop,
    width: _Btn.BTN_WIDTH,
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
  return <_reactNative.View ref={rootRef} pointerEvents={mounted ? 'box-none' : 'none'} style={styles.root}>{mounted && source && <>{(0, _jsxRuntime.jsxs)(_reactNative.Animated.View, Object.assign({
        pointerEvents: mounted && !isTransitioning ? 'auto' : 'none',
        style: [styles.card, cardStyle]
      }, closePanResponder.panHandlers, {
        children: [(0, _jsxRuntime.jsx)(_reactNative.View, {
          pointerEvents: "none",
          style: [_reactNative.StyleSheet.absoluteFillObject, {
            backgroundColor: theme['c-content-background']
          }]
        }), (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
          style: styles.background,
          children: (0, _jsxRuntime.jsx)(OverlayBackdrop, {
            progress: progress,
            source: source,
            winWidth: winWidth,
            winHeight: winHeight
          })
        }), (fullscreenMounted || showLyricPager) && <_reactNative.View pointerEvents={showStaticContent ? 'auto' : 'none'} style={styles.content}>{(0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
            style: staticOpacityStyle,
            children: <_Header.default onBack={close} pageIndex={pageIndex} onPageSelected={function onPageSelected(page) {
              var _pagerRef$current2;
              return (_pagerRef$current2 = pagerRef.current) == null ? void 0 : _pagerRef$current2.setPage(page);
            }} />
          })}{(fullscreenMounted || showLyricPager) && (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
            style: [styles.pagerView, pagerOpacityStyle],
            children: <_reactNativePagerView.default ref={pagerRef} initialPage={pageIndex} onPageSelected={handlePageSelected} style={styles.pagerViewInner}><_reactNative.View collapsable={false}><_Pic.default onMusicInfoLayout={handleMusicInfoLayout} marqueeActive={showStaticContent} /></_reactNative.View><_reactNative.View collapsable={false}><LyricPage activeIndex={pageIndex} showSummary={showStaticContent} /></_reactNative.View></_reactNativePagerView.default>
          })}{(fullscreenMounted || showLyricPager) && (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
            style: [styles.bottom, staticOpacityStyle],
            children: <_Player.default showMusicInfo={false} onProgressLayout={setProgressTargetLayout} onControlLayout={setControlTargetLayout} />
          })}</_reactNative.View>]
      }))}{(0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
        pointerEvents: "none",
        style: [styles.transitionSeparator, separatorStyle, {
          backgroundColor: theme['c-border-background']
        }]
      })}{showCoverMorph && (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
        pointerEvents: "none",
        style: [styles.morphTitle, titleStyle],
        children: (0, _jsxRuntime.jsx)(_reactNative.Animated.Text, {
          numberOfLines: 1,
          ellipsizeMode: "clip",
          style: [styles.morphText, titleTextStyle, {
            color: glassColors.text
          }],
          children: musicInfo.name
        })
      })}{showCoverMorph && (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
        pointerEvents: "none",
        style: [styles.morphTitle, artistStyle],
        children: (0, _jsxRuntime.jsx)(_reactNative.Animated.Text, {
          numberOfLines: 1,
          ellipsizeMode: "clip",
          style: [styles.morphText, artistTextStyle, {
            color: glassColors.muted
          }],
          children: musicInfo.singer
        })
      })}{showCoverMorph && <>{(0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
          pointerEvents: isOpen ? 'auto' : 'none',
          style: [styles.morphTitle, actionColumnStyle],
          children: <_reactNative.TouchableOpacity activeOpacity={0.7} hitSlop={{
            top: 10,
            bottom: 5,
            left: 10,
            right: 10
          }} onPress={handleToggleLove} style={styles.loveBtn}>{(0, _jsxRuntime.jsx)(require("../../common/LoveIcon").LoveIcon, {
              filled: isLove,
              size: _Btn.BTN_ICON_SIZE,
              color: isLove ? glassColors.accent : glassColors.muted
            })}</_reactNative.TouchableOpacity>
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
            backgroundColor: theme['c-content-background'],
            borderRadius: coverRadius,
            borderWidth: coverBorderWidth,
            borderColor: theme['c-border-background'],
            opacity: coverShadowOpacity
          }]
        })}{(0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
          pointerEvents: "none",
          style: [styles.cover, coverStyle, {
            backgroundColor: theme['c-primary-light-900-alpha-200'],
            borderWidth: coverBorderWidth,
            borderColor: theme['c-border-background']
          }],
          children: (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
            style: [styles.coverContent, {
              borderRadius: coverRadius
            }],
            children: <_Image.default url={transitionPic} style={styles.coverImage} />
          })
        })}{(0, _jsxRuntime.jsxs)(_reactNative.Animated.View, {
          pointerEvents: "none",
          style: [styles.morphProgress, progressStyle],
          children: [<_reactNative.View style={styles.progressTrackWrapper}><_reactNative.View style={{
              position: 'relative',
              width: '100%',
              height: require("../ProgressBar").PROGRESS_BAR_HEIGHT
            }}><_reactNative.View style={Object.assign({}, styles.progressBar, (0, require("./transition").getMorphProgressTrackStyle)(), {
                backgroundColor: theme['c-primary-light-300-alpha-800']
              })} /><_reactNative.View style={Object.assign({}, styles.progressBar, {
                backgroundColor: theme['c-primary-light-400-alpha-700'],
                width: bufferedPercent
              })} /><_reactNative.View style={Object.assign({}, styles.progressBar, {
                backgroundColor: theme['c-primary-light-100-alpha-400'],
                width: progressPercent
              })}><_reactNative.View style={[styles.progressDot, {
                  width: require("../ProgressBar").PROGRESS_DOT_SIZE,
                  height: require("../ProgressBar").PROGRESS_DOT_SIZE,
                  top: (require("../ProgressBar").PROGRESS_BAR_HEIGHT - require("../ProgressBar").PROGRESS_DOT_SIZE) / 2,
                  right: -require("../ProgressBar").PROGRESS_DOT_SIZE / 2,
                  borderRadius: require("../ProgressBar").PROGRESS_DOT_SIZE / 2,
                  backgroundColor: theme['c-primary-light-100']
                }]} /></_reactNative.View></_reactNative.View></_reactNative.View>, <_reactNative.View style={styles.morphProgressInfo}>{(0, _jsxRuntime.jsx)(_reactNative.Animated.Text, {
              style: [styles.morphProgressTime, progressInfoTextStyle, {
                color: glassColors.muted
              }],
              children: playerProgress.nowPlayTimeStr
            })}{(0, _jsxRuntime.jsx)(_reactNative.Animated.Text, {
              style: [styles.morphProgressTime, progressInfoTextStyle, {
                color: glassColors.muted
              }],
              children: playerProgress.maxPlayTimeStr
            })}</_reactNative.View>]
        })}</>}{showCoverMorph && ['prev', 'play', 'next'].map(function (key) {
        var morph = controlMorphs[key];
        var iconName = key == 'play' ? isPlay ? 'pause' : 'play' : key == 'prev' ? 'prevMusic' : 'nextMusic';
        return (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
          pointerEvents: "none",
          style: [styles.morphControl, morph.style],
          children: (0, _jsxRuntime.jsx)(_reactNative.Animated.View, {
            style: [styles.morphControlIcon, {
              transform: [{
                scale: morph.iconScale
              }]
            }],
            children: (0, _jsxRuntime.jsx)(require("../../common/Icon").Icon, {
              name: iconName,
              color: glassColors.accent,
              rawSize: morph.iconSize
            })
          })
        }, key);
      })}<_reactNative.View pointerEvents={gestureEnabled ? 'auto' : 'box-none'} style={{
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
  return <PlayerOverlayContext.Provider value={controller}>{children}<PlayerOverlay ref={overlayRef} progress={progress} onSourceVisibilityChange={handleSourceVisibilityChange} onBarSettledChange={handleBarSettledChange} /></PlayerOverlayContext.Provider>;
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
  progressTrackWrapper: Object.assign({}, _reactNative.StyleSheet.absoluteFillObject, {
    justifyContent: 'center'
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
    height: require("../ProgressBar").PROGRESS_BAR_HEIGHT,
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
  morphTitle: {
    position: 'absolute'
  },
  morphText: {
    width: '100%',
    includeFontPadding: false
  },
  loveBtn: {
    alignItems: 'center',
    height: _Btn.BTN_WIDTH,
    justifyContent: 'center',
    width: _Btn.BTN_WIDTH
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
