# dsh-pet 女仆角色包来源与限制

- 来源项目：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)
- 固定来源提交：`82ba588c7f849a62f1af5df81250e2ca8154c3a3`
- 来源动画：`daiji-huxi-xiuxian.gif`、`nvpu-quxi-liyi.gif`、`xie-daima.gif`、`haqian-liantian.gif`
- 角色包：`role-packs/dsh-pet-maid`
- 处理：从 220×124 裁切出角色，缩放至 84×84，将 120 帧均匀筛选为 80 帧并保留总时长，量化为 64 色；
  将绿色背景替换为 Buddy 角色卡背景色 `#17181C`，且不对平坦背景使用抖动。处理脚本为
  `scripts/build-dsh-pet-role-pack.py`。

按来源项目 README 中用户指出的素材条款，本素材允许开源使用、禁止商用。本仓库的 MIT 许可证不扩展到该角色动画；分发角色包时必须保留 `NOTICE.txt` 和上述限制。
