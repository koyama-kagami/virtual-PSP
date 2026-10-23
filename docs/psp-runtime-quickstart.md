# 真实 PSP 运行说明

当前后端为固定 PPSSPP 开发版 + Sony 6.61 原版 XMB。视频来自指定 PPSSPP 窗口；声音由本机 PPSSPP 播放。网页不是独立模拟器，关闭原生窗口会中断运行。

## 日常启动

在项目根目录执行：

```powershell
./work/psp-runtime/start-runtime.ps1
```

打开 **http://127.0.0.1:4330**，点击模型 POWER。脚本用 uv 管理 Python 环境，启动或复用网页 4330 和 Bridge 4331，核验进程归属、回环监听及 HTTP 状态。POWER 首次连接时才由 Bridge 安全启动/连接本项目 PPSSPP；脚本不会重复拉起核心。

无需提前打开 PPSSPP。关闭原生窗口后，再点网页「重试」或「开机」可重新启动。若本项目旧进程残留，Bridge 仅在核对程序路径、启动参数、进程创建时间，并持续确认窗口和控制端口均已消失后回收；随后等待新窗口就绪。冷启动期间保持页面打开，按钮显示连接状态。

保持 PPSSPP 窗口**非最小化**。可以在浏览器操作模型；型号、颜色和旋转属于外壳，不改变模拟硬件配置。POWER 当前表示宿主暂停/恢复，不是 PSP 原生睡眠或完整关机。HOLD 阻止并释放宿主输入。

视频输出 480×272，aiortc 目标 30 fps；声音没有进入 WebRTC，音量/静音只作用于 PPSSPP 的进程音频 session。性能与兼容边界见[架构说明](architecture.md)。

## 首次准备

新环境需要 Windows、Node.js 20.11+ 和 uv，建议 PowerShell 7；先构建网页，再准备核心、固件和防火墙限制。Python 依赖由启动脚本安装，固定版本见 [requirements.txt](../work/psp-runtime/requirements.txt)。网页源代码更改后执行：

```powershell
Push-Location ./work/psp-studio
npm ci
npm run build
Pop-Location
```

官方开发包及 Sony 6.61 来源、提交、校验值见 [runtime-manifest.json](../work/psp-runtime/runtime-manifest.json)，不要用未核验文件覆盖：

```powershell
./work/psp-runtime/download-runtime.ps1
./work/psp-runtime/start-native.ps1 -Mode InstallFirmware
```

在 PPSSPP 选择 **File → Load...**，打开 `work/psp-runtime/downloads/PSP-6.61-EBOOT.PBP`，点 **Install**。看到完成后正常关闭该安装实例，再启动网页服务。固件写入隔离的 `work/psp-runtime/data/PSP/NAND`；桌面版没有 `--install` 静默安装参数。固定版本、来源与校验值见 runtime-manifest.json。

原生 debugger 不能绑定指定 host，启用前必须有本项目防火墙限制。首次在管理员 PowerShell 中运行以下脚本，提升权限会出现 UAC；完成后日常启动只核验：

```powershell
./work/psp-runtime/restrict-debugger.ps1
```

规则仅限制本项目 EXE 的 TCP 4332 入站，不添加开放规则。启动器会检查 ActiveStore、程序路径、端口与防火墙配置；失败时停止，不降级到无保护 debugger。不要为了启动而关闭系统防火墙。

这条规则限制网络入站，不给上游 debugger 增加鉴权。原生 4332 仍可被同机程序访问；其他来源网页也可能直接尝试连接其 WebSocket，绕过 Bridge 的令牌。当前版本面向本机开发使用，不应把这层防火墙描述成原生接口鉴权或完整网页隔离。

## 暂停、退出与服务停止

短暂离开使用 POWER 暂停。页面隐藏或控制链路丢失时 Bridge 会释放输入并暂停；再次连接需要重新建立视频/控制连接。网页关闭不能当作存档已完成的确认。

需要完整退出时，先关闭网页标签页，执行下面的本项目停止流程。`/stop` 先清零、暂停原生并关媒体连接；然后在 PPSSPP 窗口正常退出。最后只停止核验属于本项目的 4331/4330 服务，**不要使用 `taskkill /IM node.exe` 或按名称停止所有 Python/Node**。

```powershell
# 在项目根目录执行；先让 Bridge 完成输入释放和暂停。
$ErrorActionPreference = 'Stop'
$pspSession = Invoke-RestMethod http://127.0.0.1:4331/bootstrap
$pspBody = @{ token = $pspSession.token } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:4331/stop -Method Post -ContentType application/json -Body $pspBody
```

通过 PPSSPP 窗口正常退出后，执行：

```powershell
# 只停止两个本项目辅助服务。
$ErrorActionPreference = 'Stop'
$pspServices = @(
    @{ Port = 4331; Script = (Resolve-Path ./work/psp-runtime/runtime_bridge.py).Path },
    @{ Port = 4330; Script = (Resolve-Path ./work/psp-studio/serve.mjs).Path }
)
foreach ($pspService in $pspServices) {
    $pspListeners = @(Get-NetTCPConnection -LocalPort $pspService.Port -State Listen -ErrorAction SilentlyContinue)
    if ($pspListeners.Count -eq 0) { continue }
    if ($pspListeners.Count -ne 1 -or $pspListeners[0].LocalAddress -ne '127.0.0.1') { throw '监听状态不匹配，停止操作。' }
    $pspProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($pspListeners[0].OwningProcess)"
    $pspPattern = [regex]::Escape($pspService.Script) + '(?:"|\s|$)'
    if (-not $pspProcess -or $pspProcess.CommandLine -notmatch $pspPattern) { throw '端口不属于本项目，停止操作。' }
    Stop-Process -Id $pspProcess.ProcessId
}
```

若服务已退出，首个 HTTP 请求可能失败；不要据此停止其他进程。查看 `work/psp-runtime/logs/`、`native-state.json`、`bridge-state.json`、`runtime-stack-state.json`，重新核验实际 PID 与完整命令行。PID 会变化，不能沿用旧验收记录里的数字。

游戏、UMD、WLAN/PSN、麦克风、原生休眠、完整 PSP 启动链及长期稳定性尚未验收。当前没有下载或附带游戏，也没有以复刻菜单代替原版 XMB。
