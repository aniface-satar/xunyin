import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ktlint)
}

// 正式签名凭据：优先 android-native/keystore.properties（已 gitignore），
// 其次 XUNYIN_* 环境变量（CI 用）。两者皆无时 release 仍产出未签名包，
// 不会阻断 assembleDebug 等日常构建。
val signingProps =
    Properties().apply {
        val f = rootProject.file("keystore.properties")
        if (f.exists()) f.inputStream().use { load(it) }
    }

val signingStoreFile = signingProps.getProperty("storeFile") ?: System.getenv("XUNYIN_STORE_FILE")
val signingStorePassword = signingProps.getProperty("storePassword") ?: System.getenv("XUNYIN_STORE_PASSWORD")
val signingKeyAlias = signingProps.getProperty("keyAlias") ?: System.getenv("XUNYIN_KEY_ALIAS")
val signingKeyPassword = signingProps.getProperty("keyPassword") ?: System.getenv("XUNYIN_KEY_PASSWORD")
val hasSigning =
    listOf(signingStoreFile, signingStorePassword, signingKeyAlias, signingKeyPassword)
        .all { !it.isNullOrBlank() }

android {
    namespace = "cn.toside.music.nativeapp"
    compileSdk = 37

    defaultConfig {
        // 与 RN 版同包名：沿用 RN 分发包的签名钥匙（android/app/debug.keystore）即可原地覆盖升级，
        // 旧数据目录原样保留，首启由 RnAutoMigration 直读 AsyncStorage 还原歌单。
        applicationId = "cn.toside.music.mobile"
        minSdk = 26
        targetSdk = 36
        // RN 版本码规则 base×1000+ABI：1.2.0 的 arm64 为 89003、x86_64 为 89004。
        // 通用包取 89005，保证所有现存用户都能升上来。
        versionCode = 89005
        versionName = "1.2.0"
    }

    signingConfigs {
        if (hasSigning) {
            create("release") {
                storeFile = file(signingStoreFile!!)
                storePassword = signingStorePassword
                keyAlias = signingKeyAlias
                keyPassword = signingKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            // 本版按拍板结论不启用 R8：未开混淆时包体 22.9MB，已余量 9MB。
            // 若日后开启，需先为 QuickJS/SaltUI/hiddenapibypass 补 keep 规则并重跑真机冒烟。
            if (hasSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
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
    implementation(libs.androidx.compose.animation)
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
