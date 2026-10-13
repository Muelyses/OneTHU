exFAT 外置盘仓库的 git 健康预案（2026-10-13 实证）：
- 现象：`error: non-monotonic index .git/objects/pack/._pack-*.idx`、`badRefName: refs/heads/._dev3`。
- 根因：macOS 在 exFAT 盘上写 AppleDouble（._*）资源 Fork 文件；git 把它们当 pack/refs 成员误读。
- 一步修复：`find .git/refs -name "._*" -delete; find .git/objects/pack -name "._*" -delete`，然后 git fsck 只应剩 dangling。
- 预防：终端 `xattr -rc <repo>` 或切换 APFS 分区；每天首个 git 命令前 find 清一次亦可。
