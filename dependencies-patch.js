// 修补依赖源码以使构建的依赖恢复正常工作
//
// 每个补丁通过负向前瞻（negative lookahead）保证幂等：一旦目标位置后面已经出现补丁写入的
// 标记，再次执行时就不会匹配，因此重复运行 `node dependencies-patch.js` 不会重复插入代码。

const fs = require('node:fs')
const path = require('node:path')

const rootPath = path.join(__dirname, './')

const trackPlayerService = 'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service'
const trackPlayerModule = 'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/module'
const trackPlayerMetadata = 'node_modules/react-native-track-player/android/src/main/java/com/guichaguri/trackplayer/service/metadata'
const trackPlayerManifest = 'node_modules/react-native-track-player/android/src/main/AndroidManifest.xml'
const trackPlayerInterfaces = 'node_modules/react-native-track-player/lib/interfaces.d.ts'
const trackPlayerDrawable = 'node_modules/react-native-track-player/android/src/main/res/drawable/ic_xunyin_notification.xml'

const patchs = [
  // @material/material-color-utilities 的发布产物只暴露包根 exports，而包根 index.js
  // 有 10 处无扩展名相对 import，Node（跑单测）import 包根会 ERR_MODULE_NOT_FOUND。
  // 放开子路径后 src 与 tests 都按子路径 import：Node 能跑单测，Metro 只打进真正
  // 用到的文件（包根 import 会让 bundle +479,461 B）。负向前瞻保证幂等。
  [
    path.join(rootPath, 'node_modules/@material/material-color-utilities/package.json'),
    /("exports": \{\r?\n    "\.": \{[\s\S]{0,200}?\r?\n    \})(?![\s\S]{0,60}"\.\/\*")/,
    '$1,\n    "./*": "./*"',
  ],
  // Some Gradle/AGP combinations used by CI do not synthesize the R class when
  // this package attribute is missing from the library manifest.
  [
    path.join(rootPath, trackPlayerManifest),
    /(<manifest\s+xmlns:android="[^"]+")\s*>/,
    '$1\n    package="com.guichaguri.trackplayer"\n>',
  ],
  // Android 16 rejects startForeground when targetSdk is 35+ and the service
  // does not declare a foregroundServiceType in the merged manifest.
  [
    path.join(rootPath, trackPlayerManifest),
    /(<service\s+android:name="\.service\.MusicService"\s+android:enabled="true"\s+android:exported="true")(?!\s+android:foregroundServiceType=)/,
    '$1\n            android:foregroundServiceType="mediaPlayback"',
  ],
  // 灵动胶囊 / 原子岛 / 音乐流体云：OEM 的胶囊渲染器只识别声明了媒体按键与传输控制
  // 处理的 MediaSession，track-player 默认只设置了队列命令，这里补齐。
  [
    path.join(rootPath, trackPlayerService, 'metadata/MetadataManager.java'),
    /[ \t]*session\.setFlags\(MediaSessionCompat\.FLAG_HANDLES_QUEUE_COMMANDS\);/,
    [
      '        // Island/capsule renderers (HONOR Magic Capsule, OPPO Fluid Cloud, vivo Atomic',
      '        // Island, ...) only recognise a media session that declares the media button and',
      '        // transport control handlers, so keep all three flags set here.',
      '        session.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS',
      '                | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS',
      '                | MediaSessionCompat.FLAG_HANDLES_QUEUE_COMMANDS);',
    ].join('\n'),
  ],
  // 媒体通知的刷新不应该反复打扰用户（胶囊会跟着一起弹）。
  [
    path.join(rootPath, trackPlayerService, 'metadata/MetadataManager.java'),
    /(builder\.setVisibility\(NotificationCompat\.VISIBILITY_PUBLIC\);)(?![\s\S]{0,400}?setOnlyAlertOnce)/,
    [
      '$1',
      '',
      '        // Keep the notification silent on updates, otherwise the system (and the',
      '        // island/capsule renderers) would re-alert on every metadata refresh.',
      '        builder.setOnlyAlertOnce(true);',
    ].join('\n'),
  ],
  // 播放中的媒体通知需要是 ongoing，胶囊才会把它当作正在进行中的媒体。
  [
    path.join(rootPath, trackPlayerService, 'metadata/MetadataManager.java'),
    /(List<Integer> compact = new ArrayList<>\(\);\r?\n[ \t]*builder\.mActions\.clear\(\);)(?![\s\S]{0,400}?setOngoing)/,
    [
      '$1',
      '',
      '        // Island/capsule renderers require the media notification to be an ongoing',
      '        // notification while playback is running.',
      '        builder.setOngoing(playing);',
    ].join('\n'),
  ],
  // 荣耀灵动胶囊「接入范式三、媒体胶囊接入」要求 MediaStyle 通知的三个系统按钮为
  // 上一曲 / 播放暂停 / 下一曲，且 setShowActionsInCompactView(0, 1, 2)；按钮文案取自
  // action 的 title，这里改为可由 JS 下发的本地化文案（默认与荣耀文档示例一致）。
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /[ \t]*previousAction = createAction\(notification, PlaybackStateCompat\.ACTION_SKIP_TO_PREVIOUS, "Previous",[\s\S]*?nextAction = createAction\(notification, PlaybackStateCompat\.ACTION_SKIP_TO_NEXT, "Next",\r?\n[ \t]*getIcon\(options, "nextIcon", R\.drawable\.next\)\);(?![\s\S]{0,600}?getActionTitle)/,
    [
      '            // HONOR Magic Capsule / OPPO Fluid Cloud / vivo Atomic Island read the button labels',
      '            // from the notification actions. Keep them localised (defaults follow the HONOR',
      '            // "媒体胶囊接入" sample: 上一曲 / 播放 / 暂停 / 下一曲).',
      '            previousAction = createAction(notification, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS,',
      '                    getActionTitle(options, "previousTitle", "上一曲"),',
      '                    getIcon(options, "previousIcon", R.drawable.previous));',
      '            rewindAction = createAction(notification, PlaybackStateCompat.ACTION_REWIND,',
      '                    getActionTitle(options, "rewindTitle", "快退"),',
      '                    getIcon(options, "rewindIcon", R.drawable.rewind));',
      '            playAction = createAction(notification, PlaybackStateCompat.ACTION_PLAY,',
      '                    getActionTitle(options, "playTitle", "播放"),',
      '                    getIcon(options, "playIcon", R.drawable.play));',
      '            pauseAction = createAction(notification, PlaybackStateCompat.ACTION_PAUSE,',
      '                    getActionTitle(options, "pauseTitle", "暂停"),',
      '                    getIcon(options, "pauseIcon", R.drawable.pause));',
      '            stopAction = createAction(notification, PlaybackStateCompat.ACTION_STOP,',
      '                    getActionTitle(options, "stopTitle", "停止"),',
      '                    getIcon(options, "stopIcon", R.drawable.stop));',
      '            forwardAction = createAction(notification, PlaybackStateCompat.ACTION_FAST_FORWARD,',
      '                    getActionTitle(options, "forwardTitle", "快进"),',
      '                    getIcon(options, "forwardIcon", R.drawable.forward));',
      '            nextAction = createAction(notification, PlaybackStateCompat.ACTION_SKIP_TO_NEXT,',
      '                    getActionTitle(options, "nextTitle", "下一曲"),',
      '                    getIcon(options, "nextIcon", R.drawable.next));',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /(        return icon;\r?\n    \}\r?\n)(?![\s\S]{0,80}?private static String getActionTitle)/,
    [
      '$1',
      '',
      '    private static String getActionTitle(Bundle options, String propertyName, String defaultTitle) {',
      '        if(options == null) return defaultTitle;',
      '',
      '        String title = options.getString(propertyName);',
      '        if(title == null || title.isEmpty()) return defaultTitle;',
      '',
      '        return title;',
      '    }',
    ].join('\n'),
  ],
  // 锁屏 / 胶囊优先读取 display* 元数据，这里与 title/artist/album 保持同步。
  // Use the raw keys instead of static imports: they are stable constants and
  // avoid classpath differences between local and CI AndroidX resolutions.
  [
    path.join(rootPath, trackPlayerService, 'models/TrackMetadata.java'),
    /\r?\n\r?\n[ \t]*\/\/ Display keys are what the lockscreen \/ island \(capsule\) renderers prefer over the raw[\s\S]*?builder\.putString\(METADATA_KEY_DISPLAY_DESCRIPTION, album\);/,
    '',
  ],
  [
    path.join(rootPath, trackPlayerService, 'models/TrackMetadata.java'),
    /(builder\.putString\(METADATA_KEY_TITLE, title\);[\s\S]*?builder\.putString\(METADATA_KEY_GENRE, genre\);)(?![\s\S]{0,500}?DISPLAY_TITLE")/,
    [
      '$1',
      '',
      '        builder.putString("android.media.metadata.DISPLAY_TITLE", title);',
      '        builder.putString("android.media.metadata.DISPLAY_SUBTITLE", artist);',
      '        builder.putString("android.media.metadata.DISPLAY_DESCRIPTION", album);',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerService, 'models/TrackMetadata.java'),
    /import static android\.support\.v4\.media\.MediaMetadataCompat\.METADATA_KEY_DISPLAY_(TITLE|SUBTITLE|DESCRIPTION);\r?\n/g,
    '',
  ],
  // The notification's like button uses the remote-like event exposed by this fork.
  [
    path.join(rootPath, trackPlayerService, 'Utils.java'),
    /(public static final String EVENT_INTENT = "com\.guichaguri\.trackplayer\.event";)(?![\s\S]{0,200}?LIKE_ACTION)/,
    [
      '$1',
      '    public static final String LIKE_ACTION = "com.guichaguri.trackplayer.like";',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerModule, 'MusicEvents.java'),
    /(public static final String BUTTON_SET_RATING = "remote-set-rating";)(?![\s\S]{0,200}?BUTTON_LIKE)/,
    [
      '$1',
      '    public static final String BUTTON_LIKE = "remote-like";',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerService, 'MusicService.java'),
    /(import javax\.annotation\.Nullable;)(?![\s\S]{0,200}?import com\.guichaguri\.trackplayer\.module\.MusicEvents;)/,
    [
      '$1',
      '',
      'import com.guichaguri.trackplayer.module.MusicEvents;',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerService, 'MusicService.java'),
    /(if\(intent != null && Intent\.ACTION_MEDIA_BUTTON\.equals\(intent\.getAction\(\)\)\) \{(?:(?!Utils\.LIKE_ACTION)[\s\S])*?return START_NOT_STICKY;\r?\n        \}\r?\n)(?![\s\S]{0,500}?Utils\.LIKE_ACTION)/,
    [
      '$1',
      '',
      '        if(intent != null && Utils.LIKE_ACTION.equals(intent.getAction())) {',
      '            onStartForeground();',
      '',
      '            if(manager != null) emit(MusicEvents.BUTTON_LIKE, null);',
      '',
      '            return START_NOT_STICKY;',
      '        }',
    ].join('\n'),
  ],
  // Android 13+ rejects a foreground-service notification without a small icon.
  [
    path.join(rootPath, trackPlayerService, 'MusicService.java'),
    /(?:    private int getNotificationIcon\(\) \{[\s\S]*?\n    \}\n\n)?    private void onStartForeground\(\) \{/,
    [
      '    private int getNotificationIcon() {',
      '        int icon = com.facebook.react.views.imagehelper.ResourceDrawableIdHelper.getInstance().getResourceDrawableId(this, "ic_xunyin_notification");',
      '        return icon != 0 ? icon : android.R.drawable.ic_media_play;',
      '    }',
      '',
      '    private void onStartForeground() {',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /(?:    private int getNotificationIcon\(\) \{[\s\S]*?\n    \}\n\n)?    public MediaSessionCompat getSession\(\) \{/,
    [
      '    private int getNotificationIcon() {',
      '        int icon = ResourceDrawableIdHelper.getInstance().getResourceDrawableId(service, "ic_xunyin_notification");',
      '        return icon != 0 ? icon : android.R.drawable.ic_media_play;',
      '    }',
      '',
      '    public MediaSessionCompat getSession() {',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerService, 'MusicService.java'),
    /new NotificationCompat\.Builder\(this, channel\)\.build\(\)/g,
    [
      'new NotificationCompat.Builder(this, channel)',
      '                        .setSmallIcon(getNotificationIcon())',
      '                        .build()',
    ].join('\n'),
  ],
  // Resolve the custom icon from app resources at runtime. The library R class
  // is not reliable here because it is generated before the app source set.
  [
    path.join(rootPath, trackPlayerService, 'MusicService.java'),
    /R\.drawable\.ic_xunyin_notification/g,
    'getNotificationIcon()',
  ],
  [
    path.join(rootPath, trackPlayerService, 'MusicService.java'),
    /(\.setSmallIcon\()R\.drawable\.play(\))/g,
    '$1getNotificationIcon()$2',
  ],
  // The service and notification manager build notifications before JS options
  // arrive, so use the app's status-bar icon as the native fallback too.
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /(builder\.setSmallIcon\()R\.drawable\.play(\);\r?\n        builder\.setCategory)/,
    '$1getNotificationIcon()$2',
  ],
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /(builder\.setSmallIcon\(getIcon\(options, "icon", )R\.drawable\.play(\)\);)/,
    '$1getNotificationIcon()$2',
  ],
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /R\.drawable\.ic_xunyin_notification/g,
    'getNotificationIcon()',
  ],
  // Android 12+ requires immutable or mutable flags on every PendingIntent.
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /([ \t]*)(?:builder\.setContentIntent\(|PendingIntent contentIntent = )PendingIntent\.getActivity\(context, 0, openApp, PendingIntent\.FLAG_CANCEL_CURRENT(\)\)?);/,
    [
      '$1int contentFlags = PendingIntent.FLAG_CANCEL_CURRENT;',
      '$1if(Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) contentFlags |= PendingIntent.FLAG_IMMUTABLE;',
      '$1builder.setContentIntent(PendingIntent.getActivity(context, 0, openApp, contentFlags));',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerMetadata, 'ButtonEvents.java'),
    /(public void onSetRating\(RatingCompat rating\) \{\r?\n        Bundle bundle = new Bundle\(\);\r?\n        Utils\.setRating\(bundle, "rating", rating\);\r?\n        service\.emit\(MusicEvents\.BUTTON_SET_RATING, bundle\);\r?\n    \})(?![\s\S]{0,600}?BUTTON_LIKE)/,
    [
      '$1',
      '',
      '    @Override',
      '    public void onCustomAction(String action, Bundle extras) {',
      '        if(Utils.LIKE_ACTION.equals(action)) service.emit(MusicEvents.BUTTON_LIKE, null);',
      '    }',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /(private long compactActions = 0;)(?![\s\S]{0,500}?likePendingIntent)/,
    [
      '$1',
      '    private boolean likeEnabled = false;',
      '    private boolean likeInCompact = true;',
      '    private String likeTitle = "Like";',
      '    private String likeActiveTitle = "Unlike";',
      '    private int likeIcon = 0;',
      '    private int likeLikedIcon = 0;',
      '    private PendingIntent likePendingIntent = null;',
      '    private RatingCompat currentRating = null;',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /(if\(compact != null\) \{\r?\n                for\(int cap : compact\) compactActions \|= cap;\r?\n            \}\r?\n        \})(?![\s\S]{0,400}?updateLikeOptions)/,
    [
      '$1',
      '',
      '        updateLikeOptions(options);',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /(builder\.setSubText\(track\.album\);\r?\n\r?\n        session\.setMetadata\(metadata\.build\(\)\);)(?![\s\S]{0,200}?currentRating = track\.rating)/,
    [
      '$1',
      '',
      '        currentRating = track.rating;',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /(addAction\(nextAction, PlaybackStateCompat\.ACTION_SKIP_TO_NEXT, compact\);)(?![\s\S]{0,800}?likePendingIntent != null)/,
    [
      '$1',
      '',
      '        if(likePendingIntent != null) {',
      '            boolean liked = isLiked();',
      '            builder.mActions.add(new Action(',
      '                    liked ? likeLikedIcon : likeIcon,',
      '                    liked ? likeActiveTitle : likeTitle,',
      '                    likePendingIntent));',
      '',
      '            if(likeInCompact) compact.add(builder.mActions.size() - 1);',
      '        }',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /(pb\.setBufferedPosition\(playback\.getBufferedPosition\(\)\);)(?![\s\S]{0,600}?addCustomAction)/,
    [
      '$1',
      '',
      '        if(likePendingIntent != null) {',
      '            boolean liked = isLiked();',
      '            pb.addCustomAction(new PlaybackStateCompat.CustomAction.Builder(',
      '                    Utils.LIKE_ACTION,',
      '                    liked ? likeActiveTitle : likeTitle,',
      '                    liked ? likeLikedIcon : likeIcon).build());',
      '        }',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /(    private void updateNotification\(\) \{(?:(?!private boolean isLiked)[\s\S])*?        \}\r?\n    \})(?![\s\S]{0,1000}?private boolean isLiked)/,
    [
      '$1',
      '',
      '    private boolean isLiked() {',
      '        return currentRating != null && currentRating.hasHeart();',
      '    }',
      '',
      '    private void updateLikeOptions(Bundle options) {',
      '        likeEnabled = options.getBoolean("like", false);',
      '',
      '        if(!likeEnabled) {',
      '            likePendingIntent = null;',
      '            return;',
      '        }',
      '',
      '        Bundle likeOptions = options.getBundle("likeOptions");',
      '        String title = likeOptions == null ? null : likeOptions.getString("title");',
      '        String activeTitle = likeOptions == null ? null : likeOptions.getString("activeTitle");',
      '        likeTitle = title == null || title.isEmpty() ? "Like" : title;',
      '        likeActiveTitle = activeTitle == null || activeTitle.isEmpty() ? "Unlike" : activeTitle;',
      '        likeInCompact = options.getBoolean("likeInCompact", true);',
      '',
      '        ResourceDrawableIdHelper helper = ResourceDrawableIdHelper.getInstance();',
      '        int defaultLikeIcon = helper.getResourceDrawableId(service, "ic_notification_like");',
      '        int defaultLikedIcon = helper.getResourceDrawableId(service, "ic_notification_liked");',
      '        likeIcon = getIcon(options, "likeIcon", defaultLikeIcon != 0 ? defaultLikeIcon : R.drawable.rewind);',
      '        likeLikedIcon = getIcon(options, "likeLikedIcon", defaultLikedIcon != 0 ? defaultLikedIcon : likeIcon);',
      '',
      '        Intent likeIntent = new Intent(service, MusicService.class);',
      '        likeIntent.setAction(Utils.LIKE_ACTION);',
      '        int likeFlags = PendingIntent.FLAG_UPDATE_CURRENT;',
      '        if(Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) likeFlags |= PendingIntent.FLAG_IMMUTABLE;',
      '',
      '        likePendingIntent = PendingIntent.getService(service, 1, likeIntent, likeFlags);',
      '    }',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerInterfaces),
    /(export interface FeedbackOptions \{\r?\n    \/\*\* Marks wether the option should be marked as active or "done" \*\/\r?\n    isActive: boolean;\r?\n    \/\*\* The title to give the action \(relevant for iOS\) \*\/\r?\n    title: string;\r?\n\})(?![\s\S]{0,300}?activeTitle)/,
    [
      '$1',
      '',
      'export interface LikeFeedbackOptions extends FeedbackOptions {',
      '    /** The title used while the current track is liked */',
      '    activeTitle?: string;',
      '}',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerInterfaces),
    /(export interface MetadataOptions \{\r?\n    ratingType\?: RatingType;\r?\n    forwardJumpInterval\?: number;\r?\n    backwardJumpInterval\?: number;\r?\n    likeOptions\?: FeedbackOptions;)(?![\s\S]{0,400}?LikeFeedbackOptions)/,
    [
      'export interface MetadataOptions {',
      '$1',
      '    /** Enables the Android notification like button; this fork adds it outside Capability */',
    '    like?: boolean;',
    '    likeOptions?: LikeFeedbackOptions;',
    '    likeIcon?: ResourceObject;',
    '    likeLikedIcon?: ResourceObject;',
    '    likeInCompact?: boolean;',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerInterfaces),
    /(export type ResourceObject = number;)(?![\s\S]{0,200}?uri: string)/,
    'export type ResourceObject = number | { uri: string };',
  ],
  // 音频字节预热：ExoPlayback 声明两个口子，LocalPlayback 用手里那份 SimpleCache 实现。
  // 默认实现只 resolve(false)，所以补丁只重打了 LocalPlayback 那半时也只是"这项功能熄火"，不会崩。
  // ExoPlayback 的锚点用 isCached 那条 abstract 声明（上游原生的代码），别用 getAudioSessionId ——
  // 那是音量均衡补丁插进去的方法，干净安装时它不存在，锚点会失配，只剩 MusicModule 一半打上就编译红。
  [
    path.join(rootPath, trackPlayerService, 'player/ExoPlayback.java'),
    /(    public abstract void isCached\(String url, Promise promise\);)(?![\s\S]{0,400}?cacheTrack)/,
    [
      '$1',
      '',
      '    /**',
      '     * Downloads bytes for the next track into the same cache playback uses, so switching',
      '     * to it stops re-fetching from the network. Default: nothing to cache into.',
      '     */',
      '    public void cacheTrack(String url, com.facebook.react.bridge.ReadableMap headers,',
      '                           double maxBytes, String token, com.facebook.react.bridge.Promise promise) {',
      '        if(promise != null) promise.resolve(false);',
      '    }',
      '',
      '    public void cancelCacheTrack(String token) {',
      '',
      '    }',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerService, 'player/LocalPlayback.java'),
    /(    public void isCached\(String url, Promise promise\) \{[\s\S]{0,400}?\r?\n    \})(?![\s\S]{0,200}?cancelCacheTrack)/,
    [
      '$1',
      '',
      '    // token -> writer，供 cancelCacheTrack 用；用户跳走时早点收摊，省流量。',
      '    private final java.util.concurrent.ConcurrentHashMap<String, androidx.media3.datasource.cache.CacheWriter>',
      '            cacheWriters = new java.util.concurrent.ConcurrentHashMap<>();',
      '',
      '    private static java.util.Map<String, String> headerMap(com.facebook.react.bridge.ReadableMap headers) {',
      '        java.util.Map<String, String> map = new java.util.HashMap<>();',
      '        if(headers == null) return map;',
      '        com.facebook.react.bridge.ReadableMapKeySetIterator it = headers.keySetIterator();',
      '        while(it.hasNextKey()) {',
      '            String key = it.nextKey();',
      '            if(headers.getType(key) == com.facebook.react.bridge.ReadableType.String) {',
      '                String value = headers.getString(key);',
      '                if(value != null) map.put(key, value);',
      '            }',
      '        }',
      '        return map;',
      '    }',
      '',
      '    public void cacheTrack(String url, com.facebook.react.bridge.ReadableMap headers,',
      '                           double maxBytes, final String token, final Promise promise) {',
      '        // 只能用播放器这一份 cache：同目录再起一个 SimpleCache 会撞实例锁（SimpleCache.isCacheFolderLocked）。',
      '        if(cache == null || url == null || url.isEmpty() || token == null) {',
      '            promise.resolve(false);',
      '            return;',
      '        }',
      '        final long byteLimit = (long) maxBytes;',
      '        final java.util.Map<String, String> requestHeaders = headerMap(headers);',
      '        final android.net.Uri target = android.net.Uri.parse(url);',
      '        // 建好 DataSource 再登记 token，两步都留在调用线程：cacheTrack 与 cancelCacheTrack 都被',
      '        // MusicModule.waitForConnection 甩到 service 的主 looper 队列上，只有同一条队列才谈先后；',
      '        // put 放进 worker 就变成两条队列抢时间 —— 取消可能先落地，摘不到 writer，那条读循环一路下到底',
      '        // （full 档 maxBytes<=0 → LENGTH_UNSET，没有 8MB 上限兜底，最坏是一整首），',
      '        // 还会比预期更久地占着这个 key 的 hole span（Cache.startReadWrite 拿走、还回它在',
      '        // CacheDataSource.close() → closeCurrentSource() 里的 Cache.releaseHoleSpan；1.8.0 没有 CacheLock 那种对象）。',
      '        // 占着的这段时间里播放器再来读同一段只能等或绕过缓存。worker 只承担会阻塞的部分。',
      '        final androidx.media3.datasource.cache.CacheDataSource cacheDataSource;',
      '        final androidx.media3.datasource.cache.CacheWriter writer;',
      '        try {',
      '            // 与 Track.toMediaSource 里那条播放路径同一套请求头配置，',
      '            // 否则带 referer / UA 校验的源会 403，白下一趟。',
      '            androidx.media3.datasource.DefaultHttpDataSource.Factory upstream =',
      '                    new androidx.media3.datasource.DefaultHttpDataSource.Factory()',
      '                            // 与 Track.java:165-166 播放路径逐字一致：这两个常量挂在 DefaultHttpDataSource 上（各 8000）,',
      '                            // HttpDataSource 接口里没有, 写成 HttpDataSource.XXX 编译不过。',
      '                            .setConnectTimeoutMs(androidx.media3.datasource.DefaultHttpDataSource.DEFAULT_CONNECT_TIMEOUT_MILLIS)',
      '                            .setReadTimeoutMs(androidx.media3.datasource.DefaultHttpDataSource.DEFAULT_READ_TIMEOUT_MILLIS)',
      '                            .setAllowCrossProtocolRedirects(true);',
      '            String userAgent = requestHeaders.remove("User-Agent");',
      '            if(userAgent != null && !userAgent.isEmpty()) upstream.setUserAgent(userAgent);',
      '            if(!requestHeaders.isEmpty()) upstream.setDefaultRequestProperties(requestHeaders);',
      '            cacheDataSource = new androidx.media3.datasource.cache.CacheDataSource.Factory()',
      '                    .setCache(cache)',
      '                    .setUpstreamDataSourceFactory(upstream)',
      '                    .setFlags(androidx.media3.datasource.cache.CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)',
      '                    .createDataSource();',
      '            // maxBytes <= 0 表示整首，交给 LENGTH_UNSET，别用"很大的正数"糊弄。',
      '            androidx.media3.datasource.DataSpec dataSpec = new androidx.media3.datasource.DataSpec(',
      '                    target, 0, byteLimit > 0 ? byteLimit : androidx.media3.common.C.LENGTH_UNSET);',
      '            writer = new androidx.media3.datasource.cache.CacheWriter(',
      '                    cacheDataSource, dataSpec, new byte[64 * 1024],',
      '                    // javap 实测：CacheWriter$ProgressListener 只有 onProgress(long, long, long)，',
      '                    // 第三个参数是 media3 的 removal action 码，不是可选的 —— 少写一个参数编译就红。',
      '                    // 预热不需要进度回报，空实现即可。',
      '                    (cachedBytes, totalBytes, removalAction) -> { });',
      '        } catch(Throwable t) {',
      '            // 这一步失败时 token 还没登记、worker 也还没起，resolve 只此一次，没人会再动这条 promise。',
      '            Log.d("LocalPlayback", "cacheTrack setup failed: " + t);',
      '            promise.resolve(false);',
      '            return;',
      '        }',
      '        cacheWriters.put(token, writer);',
      '        Thread worker = new Thread(() -> {',
      '            try {',
      '                writer.cache();',
      '                // 这里只依赖一件事：读循环结束时 token 还登记在 map 里，这次预热才算成功。',
      '                // cancelCacheTrack 会把 token 摘走，所以被取消的那次在下面这句 remove 到 null，报 false。',
      '                promise.resolve(cacheWriters.remove(token) != null);',
      '            } catch(Throwable t) {',
      '                cacheWriters.remove(token);',
      '                Log.d("LocalPlayback", "cacheTrack failed: " + t);',
      '                promise.resolve(false);',
      '            } finally {',
      '                // 兜底关一次。正常情况下 media3 自己已经关过了：CacheWriter.readBlockToCache',
      '                // 的常规路径末尾调 dataSource.close()，抛异常时走 DataSourceUtil.closeQuietly（javap 实测）。',
      '                // 这里补的是到不了那两步的路径 —— 没关的代价是上游那条 HTTP 连接与该 key 的',
      '                // hole span 一直不放（releaseHoleSpan 在 closeCurrentSource 里）。close() 幂等，重复调无害。',
      '                try { cacheDataSource.close(); } catch(java.io.IOException ignored) { }',
      '            }',
      '        }, "TrackPlayerCacheTrack");',
      '        worker.setDaemon(true);',
      '        worker.start();',
      '    }',
      '',
      '    public void cancelCacheTrack(String token) {',
      '        if(token == null) return;',
      '        androidx.media3.datasource.cache.CacheWriter writer = cacheWriters.remove(token);',
      '        if(writer != null) writer.cancel();',
      '    }',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerModule, 'MusicModule.java'),
    /(    public void isCached\(String url, final Promise callback\) \{[\s\S]{0,300}?\r?\n    \})(?![\s\S]{0,600}?cacheTrack)/,
    [
      '$1',
      '',
      '    @ReactMethod',
      '    public void cacheTrack(String url, ReadableMap headers, double maxBytes, String token,',
      '                           final Promise callback) {',
      '        waitForConnection(() -> {',
      '            binder.getPlayback().cacheTrack(url, headers, maxBytes, token, callback);',
      '        });',
      '    }',
      '',
      '    @ReactMethod',
      '    public void cancelCacheTrack(String token) {',
      '        waitForConnection(() -> {',
      '            binder.getPlayback().cancelCacheTrack(token);',
      '        });',
      '    }',
    ].join('\n'),
  ],
]

const moduleIconXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M2.5,9.5h1.5v5H2.5z M5.5,7.5h1.5v9H5.5z M8.5,5h1.5v14H8.5z M11.5,3h1.5v18h-1.5z M14.5,5h1.5v14h-1.5z M17.5,7.5h1.5v9h-1.5z M20.5,9.5h1.5v5h-1.5z" />
</vector>
`

;(async() => {
  for (const [filePath, fromStr, toStr] of patchs) {
    const shortPath = filePath.replace(rootPath, '')
    try {
      const file = (await fs.promises.readFile(filePath)).toString()
      const patched = file.replace(fromStr, toStr)
      if (patched === file) {
        console.log(`Skipping ${shortPath} (already patched)`)
        continue
      }
      console.log(`Patching ${shortPath}`)
      await fs.promises.writeFile(filePath, patched)
    } catch (err) {
      console.error(`Patch ${shortPath} failed: ${err.message}`)
    }
  }
  // 这条 material-color-utilities 补丁匹配的是 npm 发布产物的字面 JSON：上游一旦改
  // exports 的缩进或写成单行，正则就 0 命中，而上面的循环对"没匹配上"和"已打过"
  // 打印的是同一句话，脚本也从不置非零退出码。这里单独验一次结果，让它在 postinstall
  // 就炸，而不是拖到 node --test 抛 ERR_PACKAGE_PATH_NOT_EXPORTED 才发现。
  const mcuPkgPath = path.join(rootPath, 'node_modules/@material/material-color-utilities/package.json')
  try {
    const { exports: mcuExports } = JSON.parse((await fs.promises.readFile(mcuPkgPath)).toString())
    // 上游若彻底删掉 exports 字段，Node 会回落到按文件路径解析，子路径 import 本来就通，不算失配
    if (mcuExports !== undefined && !('./*' in Object(mcuExports))) {
      console.error('Patch failed: @material/material-color-utilities exports 未放开子路径（正则与上游 package.json 字面格式不匹配）')
      process.exitCode = 1
    }
  } catch (err) {
    if (err.code === 'ENOENT') console.log('Skipping material-color-utilities exports check (not installed)')
    else {
      console.error(`Patch verify ${mcuPkgPath} failed: ${err.message}`)
      process.exitCode = 1
    }
  }
  await fs.promises.mkdir(path.dirname(path.join(rootPath, trackPlayerDrawable)), { recursive: true })
  await fs.promises.writeFile(path.join(rootPath, trackPlayerDrawable), moduleIconXml)
  console.log('\nDependencies patch finished.\n')
})()
