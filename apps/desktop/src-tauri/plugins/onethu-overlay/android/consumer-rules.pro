# release 开 R8（isMinifyEnabled=true）：
# - 插件类经 JNI/反射注册（api.register_android_plugin），不能被裁剪/改名；
# - 前台服务与广播接收器由 Manifest 声明启动，同样不能改名；
# - Args 参数类靠 @InvokeArg 反射构造（onethu-mobile 实录过 no Creators 崩），整包 keep 双保险。
-keep class app.onethu.overlay.OnethuOverlayPlugin { *; }
-keep class app.onethu.overlay.OverlayService { *; }
-keep class app.onethu.overlay.OverlayBootReceiver { *; }
-keep class app.onethu.overlay.** { *; }
