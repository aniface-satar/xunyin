pluginManagement {
    repositories {
        maven("https://maven.aliyun.com/repository/gradle-plugin")
        maven("https://plugins.gradle.org/m2/")
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/public")
        maven("https://repo1.maven.org/maven2/")
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        // 注意仓库顺序：Gradle 按序尝试，某仓库提供 POM 但缺构件文件时
        // 会继续尝试后续仓库。SaltUI 的根 jar（KMP metadata 包装）在
        // aliyun public 镜像缺失，必须让 Maven Central 排在 aliyun 之后、
        // 且 aliyun 不会因 404 缓存中断解析——把 Central 放首位最稳。
        maven("https://repo1.maven.org/maven2/")
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/public")
        google()
        mavenCentral()
    }
}

rootProject.name = "XunyinNative"
include(":app")
include(":core")
