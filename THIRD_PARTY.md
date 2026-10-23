# 第三方软件与资源

- 前端依赖 Three.js、cdt2d 和 esbuild，采用 MIT 许可。准确版本见 `work/psp-studio/package-lock.json`；安装依赖时保留其原始许可。构建产物附带 Three.js 许可文本。
- 后端依赖与固定版本见 `work/psp-runtime/requirements.txt`，各组件遵循原有许可。
- PPSSPP 是独立上游项目，采用 GPL-2.0-or-later。仓库包含连接客户端与下载/启动脚本，不包含 PPSSPP 源码副本、二进制或 assets。固定版本、官方下载地址和哈希见 `runtime-manifest.json`。上游：<https://github.com/hrydgard/ppsspp>。
- Sony 6.61 固件、NAND、UMD / 游戏文件和用户存档不随仓库发布。准备脚本引用官方更新文件并校验哈希，请按适用条款准备所需系统文件。
- README 图片为本项目实际页面截图，部分包含原版 XMB。Sony、PlayStation、PSP 名称及标识属于其权利人，本项目不主张这些品牌资源的所有权。
