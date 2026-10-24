plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ktlint)
}

android {
    namespace = "cn.toside.music.nativeapp"
    compileSdk = 37

    defaultConfig {
        applicationId = "cn.toside.music.mobile.native"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-b0"
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    // SaltUI 传递依赖 org.lsposed:hiddenapibypass（ART 隐藏 API），
    // 发 Google Play 必须关闭依赖信息上报（见 docs/kotlin-saltui-migration-feasibility.md §五）
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    buildFeatures {
        compose = true
    }

    testOptions {
        unitTests {
            isReturnDefaultValues = true
        }
    }
}

dependencies {
    implementation(project(":core"))
    // core 的播放状态用 JsonObject 承载曲目信息；跨模块使用需显式声明
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.salt.ui)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.session)
    implementation(libs.androidx.media3.datasource)
    implementation(libs.quickjs.wrapper)
    // SaltUI 以 implementation 方式依赖 Compose，不向下游传递；
    // 本工程直接 import 的 Compose 库需显式声明。
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.foundation.layout)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.text)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.runtime)
    testImplementation(libs.junit)
}

ktlint {
    version.set("1.5.0")
    android.set(true)
    filter {
        exclude { element -> element.file.path.contains("build/") }
    }
}
