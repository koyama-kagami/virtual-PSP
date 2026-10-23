# PSP Studio

PSP-1000 / 2000 / 3000 的单页 Three.js 展示，已连接本机 PPSSPP 开发版与 Sony 6.61 原版 XMB。完整启动步骤见[运行说明](../../docs/psp-runtime-quickstart.md)。

## 机身交互

所有正面键、L/R 肩键、WLAN、电源/HOLD、UMD 和电池盖卡扣都可直接操作；按下保持行程，松开回弹。摇杆可拖动、回中，无 L3 点击。1000 的 OPEN 拨钮独立开仓。

- 鼠标、触摸、键盘共享输入生命周期；真实 down/up、组合键和连续摇杆传入原生核心。取消、失焦、切机型、待机时清空输入，摇杆电气值立即归中。
- 电源短推连接/暂停/恢复，长推断开并暂停后台核心；这不是原生睡眠或完整关机。下拉进入 HOLD，拨回中间解锁。WLAN 与 UMD 当前只有机械交互，不改变网络或介质。
- DISPLAY 调整宿主亮度/背光；音符键长按静音，音量键调节 PPSSPP 进程音量。声音直接来自本机原生进程，尚未传入 WebRTC。
- `runtime-session.js` 持有系统会话，`runtime-input.js` 聚合输入，`runtime-client.js` 管理连接，`runtime-display.js` 持有共享视频纹理。旧演示菜单和合成音已移除。

完整快捷键在页面问号中。行为依据与验证见 [交互验证记录](docs/psp-controls-validation.md)。

## 本地开发

需要 Node.js 20.11+。在本目录运行：

```sh
npm ci
npm test
npm run build
node serve.mjs
```

预览地址为 `http://127.0.0.1:4330/`。真实系统还需要本机 Bridge，建议从项目根目录运行 `./work/psp-runtime/start-runtime.ps1` 一次启动/复用两个服务。已有服务时改前端只需构建并刷新。默认产物为 `../../outputs/psp-3000.html`，包含全部外观资源；实际运行需要本地服务，直接打开 HTML 文件无法连接系统。

```sh
npm run build -- --rebuild-faceplates
npm run build -- --output .cache/preview.html
node benchmarks/shell-geometry.mjs
```

## 性能与资源边界

- `build.mjs` 在构建时烘焙三代面板。`.cache/faceplates/` 仅保留三份缓存；几何源码的传递依赖、依赖锁文件变化或缓存校验失败会触发重建。普通 JS/CSS 修改直接复用网格。
- `render-loop.js` 管理唯一帧回调与闲置定时器。输入和真实视频帧唤醒绘制；减少动态效果只影响外壳运动。背面不更新 LCD，隐藏页面暂停核心并清输入。
- `studio-environment.js` 的灯光环境由应用持有，跨机型复用，页面真正退出时释放；显卡上下文恢复时重新生成。
- `scene-resources.js` 释放模型自己的网格、材质和纹理；借用的公共 VideoTexture 不释放。机型切换取消旧输入、动画、观察器和监听，再释放场景，保留系统会话。
- 漆面只缓存 2 MiB 的只读 CPU 像素，各模型仍有独立可释放的 GPU 纹理。UV 与握把优化保持位置、法线、索引和像素数据一致。
- `control-picking.js` 先检测控制件；可能命中时再检查机壳遮挡。悬停输入按帧合并，避免对每个鼠标事件遍历高精度机壳。

## 验证与剩余成本

`npm test` 覆盖渲染调度、资源释放、拾取遮挡、摇杆回中、色卡隔离、缓存失效/损坏恢复及网格/像素一致性。修改模型或生命周期后还需实际浏览器检查三机型切换、颜色、开关机、UMD、拖动缩放和减少动态效果模式。

本机增量构建约 0.5–0.6 秒，优化前约 36 秒；首次完整烘焙仍耗时。纹理与网格 CPU 微基准见 `benchmarks/shell-geometry-results.json`，不能等同于浏览器帧率。单文件仍约 6.4 MiB，透明按键折射仍需要额外渲染通道；本次保留现有几何、纹理尺寸和抗锯齿画质。
