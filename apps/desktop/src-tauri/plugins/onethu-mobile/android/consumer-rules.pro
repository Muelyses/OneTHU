# R18c：release 构建开启 R8（isMinifyEnabled=true）。插件类经 JNI/反射注册，
# 前台服务类由 Manifest 声明启动——两者都不能被裁剪/改名。
-keep class app.onethu.mobile.OnethuMobilePlugin { *; }
-keep class app.onethu.mobile.QrKeepAliveService { *; }
