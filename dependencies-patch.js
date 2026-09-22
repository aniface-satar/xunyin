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
const trackPlayerInterfaces = 'node_modules/react-native-track-player/lib/interfaces.d.ts'
const trackPlayerDrawable = 'node_modules/react-native-track-player/android/src/main/res/drawable/ic_xunyin_notification.xml'

const patchs = [
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
  [
    path.join(rootPath, trackPlayerService, 'models/TrackMetadata.java'),
    /(builder\.putString\(METADATA_KEY_TITLE, title\);[\s\S]*?builder\.putString\(METADATA_KEY_GENRE, genre\);)(?![\s\S]{0,400}?METADATA_KEY_DISPLAY_TITLE)/,
    [
      '$1',
      '',
      '        builder.putString(METADATA_KEY_DISPLAY_TITLE, title);',
      '        builder.putString(METADATA_KEY_DISPLAY_SUBTITLE, artist);',
      '        builder.putString(METADATA_KEY_DISPLAY_DESCRIPTION, album);',
    ].join('\n'),
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
    /new NotificationCompat\.Builder\(this, channel\)\.build\(\)/g,
    [
      'new NotificationCompat.Builder(this, channel)',
      '                        .setSmallIcon(R.drawable.ic_xunyin_notification)',
      '                        .build()',
    ].join('\n'),
  ],
  [
    path.join(rootPath, trackPlayerService, 'MusicService.java'),
    /(\.setSmallIcon\()R\.drawable\.play(\))/g,
    '$1R.drawable.ic_xunyin_notification$2',
  ],
  // The service and notification manager build notifications before JS options
  // arrive, so use the app's status-bar icon as the native fallback too.
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /(builder\.setSmallIcon\()R\.drawable\.play(\);\r?\n        builder\.setCategory)/,
    '$1R.drawable.ic_xunyin_notification$2',
  ],
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /(builder\.setSmallIcon\(getIcon\(options, "icon", )R\.drawable\.play(\)\);)/,
    '$1R.drawable.ic_xunyin_notification$2',
  ],
  // Android 12+ requires immutable or mutable flags on every PendingIntent.
  [
    path.join(rootPath, trackPlayerMetadata, 'MetadataManager.java'),
    /[ \t]*PendingIntent contentIntent = PendingIntent\.getActivity\(context, 0, openApp, PendingIntent\.FLAG_CANCEL_CURRENT\);/,
    [
      '        int contentFlags = PendingIntent.FLAG_CANCEL_CURRENT;',
      '        if(Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) contentFlags |= PendingIntent.FLAG_IMMUTABLE;',
      '        PendingIntent contentIntent = PendingIntent.getActivity(context, 0, openApp, contentFlags);',
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
  await fs.promises.mkdir(path.dirname(path.join(rootPath, trackPlayerDrawable)), { recursive: true })
  await fs.promises.writeFile(path.join(rootPath, trackPlayerDrawable), moduleIconXml)
  console.log('\nDependencies patch finished.\n')
})()
