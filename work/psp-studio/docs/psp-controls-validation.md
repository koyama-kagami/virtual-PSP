# PSP 控制件验证

这是 2026-10-22 外观交互阶段的归档。当前版本已接入原版 XMB，运行方式见[项目说明](../../../README.md)；下文验证边界仅描述该次历史检查。

2026-10-22。测试地址 `http://127.0.0.1:4330/`，单文件产物 `outputs/psp-3000.html`。

## 行为依据

- [PSP-3004 官方快速参考](https://www.playstation.com/content/dam/global_pdc/en/corporate/support/manuals/psp-docs/psp-3004/PSP-3004-QR%24en.pdf)，控制件及电源/HOLD。
- [PSP-1000 官方手册](https://www.playstation.com/content/dam/global_pdc/en/corporate/support/manuals/psp-docs/JA_PSP-1000-2.8_WEB.pdf)，20–23、28–36 页；初代 WLAN 和 OPEN 位置。
- [PSP-2000 官方手册](https://www.playstation.com/content/dam/global_pdc/en/corporate/support/manuals/psp-docs/JA_PSP-2000-3.6_2_WEB.pdf)，9–12 页；背光、声音与视频输出。
- 官方[音乐按键](https://manuals.playstation.net/document/en/psp/current/music/keyassign.html)、[视频按键](https://manuals.playstation.net/document/en/psp/current/video/keyassign.html)、[照片按键](https://manuals.playstation.net/document/en/psp/current/photo/keyassign.html)：L/R、START、SELECT 等随播放内容变化，不给空 XMB 添加虚构功能。

## 已执行验证

- `npm test`：49 项通过，含输入所有权/去重/连发/长按阈值/取消、滑杆在嵌套旋转与缩放下的坐标变换、HOLD、静音、亮度、待机恢复。
- `npm run build`：成功。三代面板缓存复用，产物无远程资源依赖。
- 浏览器用真实指针事件逐键按下和松开三种机型各 15 个正面控制：四方向、四动作键、HOME/PS、音量 ±、DISPLAY、音符、SELECT、START。均读到对应按压/释放状态。
- 三代 L/R 肩键、1000 顶部 OPEN、1000 左侧 WLAN、2000/3000 顶部 WLAN 均命中。UMD 开合与电池卡扣反馈经过检查。
- 长按音符 1.15 秒静音；再次短按恢复；音量键按住 0.85 秒从 18 连续升至 24。DISPLAY 长按关闭背光，待机后唤醒恢复背光。电源 3.15 秒长按完全关机，短按重新开机。
- 正面电源热区向下拖动进入 HOLD，× 被锁定，HOLD 指示标记变黄；解除后输入恢复。
- 鼠标保持 × 时用键盘 Q 按 L，L 释放后 × 仍保持，最终鼠标释放后无残留输入。
- 增加回归修复：电源状态切换清理全部输入；长按电源已消费的指针直到松开前不能重新触发；Shift+方向键接管时取消旧方向键输入。
- 最终产物浏览器复核：长按电源关机后上移并释放，仍保持完全关机；摇杆拖动读数 X 0.73、Y 0.68，松手回到 0；控制台无错误或警告。逐键观测结果保存在 `psp-controls-browser-results.json`。

## 验证边界

浏览器自动化不支持触屏多指注入。本轮验证了鼠标与键盘组合、多来源输入单测；五指同时实机触控仍需触屏设备回归。测试期间暂用减少动态效果固定坐标，结束时恢复浏览器原有媒体偏好。

这是本地交互状态机，没有固件、模拟器、游戏或媒体。WLAN 不联网，未插 UMD/Memory Stick，未连接耳机/视频输出线。电池盖卡扣支持按压，但拆盖未模拟。键盘映射列在页面问号操作说明内。
