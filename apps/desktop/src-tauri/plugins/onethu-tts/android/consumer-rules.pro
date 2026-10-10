# no consumer rules（TTS 不需要额外 keep：命令入口由 tauri 的 PluginManager 反射调用，
# 反射目标类本身已由 @TauriPlugin 注解与宿主 keep 规则覆盖）
