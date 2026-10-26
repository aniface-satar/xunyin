#!/bin/bash
# gradle 包装脚本：内部 cd 到 android-native，杜绝调用方漏 cd 前缀的问题
cd "$(dirname "$0")" || exit 1
GRADLE_USER_HOME=E:/GradleHome ./gradlew "$@"
