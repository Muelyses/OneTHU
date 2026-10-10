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
    // NotificationCompat / ContextCompat / FileProvider（前台服务常驻通知、拍照出图）
    implementation("androidx.core:core-ktx:1.9.0")
    // SAF / Photo Picker 的结果经 @ActivityCallback 回传，参数类型是 androidx 的 ActivityResult，
    // 而 tauri-android 把它作为实现依赖（不传递），故这里显式声明（版本对齐 tauri 2.11.5）
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation(project(":tauri-android"))
}
