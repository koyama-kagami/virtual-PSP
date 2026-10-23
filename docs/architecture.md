# 当前架构

网页三维外观 + 本机 PPSSPP + 本地视频与输入桥接。

| 模块 | 职责 |
| --- | --- |
| `work/psp-studio/app.js` 与模型模块 | Three.js 机身、漆面、拾取与机械动画 |
| `hardware-input.js` / `runtime-input.js` | 按键来源、真实按下/松开与连续摇杆轴 |
| `runtime-session.js` | 开始、暂停、恢复、停止、错误与会话代次 |
| `runtime-client.js` | 同源 HTTP、可靠有序 DataChannel 输入与 WebRTC 视频 |
| `runtime-display.js` | 共享视频解码器与 LCD VideoTexture |
| `work/psp-runtime/runtime_bridge.py` | 核心进程管理、指定窗口采集、最新帧槽、WebRTC 与心跳 |
| `ppsspp_client.py` / `vsh_navigation.py` | 原生 debugger 协议、输入序列与 VSH 导航适配 |
| `start-native.ps1` / `runtime-manifest.json` | 隔离数据目录、固定版本与哈希、防火墙检查 |

模型、会话与视频使用不同生命周期。换机型或漆面只重建外观，保留核心会话和视频纹理。模型自有 GPU 资源在重建时释放；面板构建期缓存，材质像素复用。渲染可暂停，核心执行时钟独立于 Three.js。

控制请求通过 Node `4330` 的限定路由到 Python `4331`；实时输入通过 WebRTC DataChannel 进入桥接，再通过 debugger `4332` 写入控制位。序号和会话代次拒绝过期输入，队列有上限。暂停、HOLD、失焦、断线与游戏切换清理对应状态。

视频只采集经过进程身份检查的 PPSSPP 窗口，裁去装饰并缩放至 480×272。最新帧槽不积压旧帧；WebRTC 目标 30 fps，浏览器将视频贴到 LCD。声音由原生进程播放，网页通过进程音频接口调整音量与静音。

原版 XMB 的方向短按采用两次 vblank 采样的脉冲，按住 400 ms 后重复。适配仅针对 `VSHM01150`，其他游戏保留物理按住状态。四个面键原样映射，确认/返回和游戏动作由当前固件/游戏定义。

完整硬件冷启动、XMB 启动游戏的完整流程、UMD 介质联动、WLAN、麦克风和浏览器音轨尚未实现。30 fps 是配置目标，不是性能达标测量。
