# R18c：release 构建开启 R8（isMinifyEnabled=true）。插件类经 JNI/反射注册，
# 前台服务类由 Manifest 声明启动——两者都不能被裁剪/改名。
-keep class app.onethu.mobile.OnethuMobilePlugin { *; }
-keep class app.onethu.mobile.QrKeepAliveService { *; }

# R21 兜底：Args 参数类靠 @InvokeArg 反射构造（2026-09-21 实录：漏注解的
# OpenWebModalArgs/SeedCookiesArgs 被 R8 处理后 Jackson 报 no Creators →
# 应用内打开 webview 一直失败）。注解已补，这里整包 keep 双保险。
-keep class app.onethu.mobile.** { *; }
