plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// exFAT 兼容（与 onethu-mobile 同）：产物挪到 /tmp，避开 ._ 资源叉重复类报错
layout.buildDirectory.set(file("/tmp/onethu-android-plugin-build/onethu-overlay"))

android {
    namespace = "app.onethu.overlay"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    // NotificationCompat / ContextCompat（前台服务常驻通知、startForegroundService 兼容）
    implementation("androidx.core:core-ktx:1.9.0")
    implementation(project(":tauri-android"))
}
