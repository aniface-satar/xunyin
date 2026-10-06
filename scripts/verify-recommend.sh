#!/bin/bash
# 推荐引擎真机验证辅助脚本(需设备已连接)
ADB="/e/Android/Sdk/platform-tools/adb.exe"
PKG="cn.toside.music.mobile"
ABI=$($ADB shell getprop ro.product.cpu.abi | tr -d '\r')
echo "ABI: $ABI"
APK="C:/Users/30913/Documents/ChatGPT/music/android/app/build/outputs/apk/release/xunyin-v1.0.8-arm64-v8a.apk"

echo "== 1. wake & install =="
$ADB shell input keyevent KEYCODE_WAKEUP
$ADB push "$APK" /data/local/tmp/xunyin.apk && $ADB shell pm install -r /data/local/tmp/xunyin.apk

echo "== 2. launch app =="
$ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1

echo "== 3. logcat recommend filter =="
$ADB logcat -c
$ADB logcat ReactNativeJS:D *:S | grep -iE "recommend|radio" &
LOGPID=$!
sleep 3
kill $LOGPID 2>/dev/null
echo "脚本就绪,后续按验证清单手动操作+抓取 logcat。"
