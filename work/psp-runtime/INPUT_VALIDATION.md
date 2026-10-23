# PSP 输入验证 · 2026-10-23

当前核心：PPSSPP v1.20.4-3683-ga9175126e2，原版 VSH `VSHM01150`。

## 方向键

修正前，150 ms 浏览器按压在核心观测到约 250 ms 的持续状态，XMB 从 Network 越过 Game 到 Video；200 ms 按压观测到约 297 ms，从 Video 到 PlayStation Network。每次均只有一组按下/松开，不是两个点击事件。`game.speed.get` 返回 `fastForward=false, limitFps=60`，1.017 s 墙钟对应约 1.034 s 模拟时间。

VSH 方向键现在使用 `input.buttons.press` 的 2 个 vblank 脉冲；保持按住 400 ms 后开始重复，随后每次脉冲完成后至少等待 90 ms，不补发停顿期间积压的重复。只有确认当前游戏 ID 是 VSH 时启用；其他游戏继续接收完整按住状态。暂停、游戏切换、断线立即取消重复任务。

页面验证：

| 操作 | 实际结果 |
| --- | --- |
| 右键 200 ms | Game → Network，1 项 |
| 左键 150 ms | Network → Game，1 项 |
| 下键 200 ms | Saved Data Utility → Memory Stick，1 项 |
| 左键 800 ms | 延迟后连续移动，松手停止 |
| 上键 200 ms | Video Settings → USB Connection，1 项 |
| 下键 200 ms | USB Connection → Video Settings，1 项 |

原始核心输入观测保存在本地 `evidence/`，不随仓库发布。页面对比见[单步导航截图](../../docs/screenshots/single-step.png)。观测器仅查询进程身份并接收广播，不注入输入。

## 面键

上 △ → triangle，右 ○ → circle，下 × → cross，左 □ → square；原样发送 PSP 控制位。当前固件配置为 × 确认、○ 返回。实际页面验证了 △ 打开 Memory Stick 的 Information 选项、× 进入信息页、○ 返回。□ 的按下/松开已在核心广播中确认；当前 Memory Stick 根菜单没有额外动作，具体功能由固件或游戏定义，不添加虚构的通用功能。

## 回归

- 后端全部 83 项测试通过，含短按/延迟重复、原始游戏按住状态、面键独立边沿、状态切换和首发取消竞态。
- 前端输入、传输和会话相关 29 项测试通过。
- 未运行商业游戏；游戏持续输入的验证范围是客户端协议回归。
