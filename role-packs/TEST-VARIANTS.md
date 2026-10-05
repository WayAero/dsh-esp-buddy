# 角色包性能测试

三份测试包均基于 `dsh-pet-maid`，包含四种状态动画、80 帧、64 色和透明背景。

| 目录 | 分辨率 | 平均 FPS | 循环时长 | 对比目标 |
| --- | --- | --- | --- | --- |
| `dsh-pet-maid-resolution-test` | 128×128 | 8 | 10 秒 | 增加解码像素量 |
| `dsh-pet-maid-fps-test` | 84×84 | 16 | 5 秒 | 增加每秒解码和绘制次数 |
| `dsh-pet-maid-resolution-fps-test` | 128×128 | 16 | 5 秒 | 同时增加像素量和绘制次数 |

分辨率提高使用最近邻放大，不增加图像细节或颜色。FPS 提高通过加快现有帧播放实现，不新增姿势。
GIF 单帧时长以 10 ms 为单位，表中 FPS 为整个循环的平均值。

在插件角色包区域选择对应文件夹发送，先用 `dsh-pet-maid` 对比，再分别测试三份变体。
观察播放是否卡顿、状态动画切换及审批触摸是否正常；若设备卡死，重启后换回原包。
这些包仅用于负载测试，尚未通过实机验收。素材使用限制见各包 `NOTICE.txt`。

测试包在本机生成，不进入 Git 或 npm 安装包。需要 Python 和 Pillow，运行 `python scripts/build-role-pack-test-variants.py` 即可在 `role-packs/` 下生成上述三个文件夹。完整文件检查记录见本机 `docs/local/role-pack-test-variants.json`。
