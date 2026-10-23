# virtual-PSP

[简体中文](README.md) | **English**

An interactive virtual PSP for the web. Rotate the device, change its finish, and operate its controls. Three.js renders the PSP-1000 / 2000 / 3000, while a local bridge connects to PPSSPP to run Sony's original 6.61 XMB.

![Actual page screenshots showing the black front shell and red rear shell](docs/screenshots/appearance.jpg)

## Screenshots

The original XMB runs in a local PPSSPP process. WebRTC streams its video onto the model's screen.

<img src="docs/screenshots/xmb.png" alt="Original XMB running on the virtual PSP screen" width="760">

Side details include the middle frame, Memory Stick cover, POWER / HOLD slider, and battery cover latch:

<img src="docs/screenshots/sides.png" alt="Left and right sides of the virtual PSP" width="580">

## Implemented features

- PSP-1000 / 2000 / 3000 appearances, with multiple colors and finishes for each model.
- Device rotation and zoom, button travel and spring-back, a draggable self-centering analog nub, and a mechanically animated UMD door.
- Front buttons, L/R shoulder buttons, POWER / HOLD, and combined mouse and keyboard input.
- Original XMB video streaming. In the current XMB configuration, × confirms, ○ goes back, △ opens options, and □ follows the current screen's behavior.
- Single-step D-pad taps in XMB, with repeat starting after approximately 400 ms of holding. Pausing, disconnecting, or changing games cancels pending repeats.
- Native PPSSPP audio, with volume and mute controls on the webpage.
- Build-time geometry caching, material texture reuse, an independent session lifecycle, and bounded input/video buffers.

This implementation combines a web frontend with a native emulator. It requires local services and a PPSSPP window; audio plays directly from the native process. Full hardware boot, a complete game-launch flow from XMB, UMD media integration, WLAN, and microphone support are not implemented. Game compatibility has not been validated in this project.

## Quick start

### Explore the 3D model

Requires Node.js 20.11+.

```powershell
git clone git@github.com:koyama-kagami/virtual-PSP.git
cd virtual-PSP
Push-Location work/psp-studio
npm ci
npm run build
node serve.mjs
```

Open **http://127.0.0.1:4330/** to view and interact with the model. Running the original XMB also requires the local runtime setup below.

### Run the original XMB

Requires Windows and uv. PowerShell 7 is recommended. The repository does not include firmware, emulator binaries, games, NAND contents, or user saves.

From the project root, download and verify the pinned PPSSPP build and the official Sony update file:

```powershell
./work/psp-runtime/download-runtime.ps1
./work/psp-runtime/start-native.ps1 -Mode InstallFirmware
```

In PPSSPP, select **File → Load...**, open `work/psp-runtime/downloads/PSP-6.61-EBOOT.PBP`, and select **Install**. Close the installation window normally when it finishes.

For the initial setup, install the project-specific inbound restriction for the debugger in an administrator PowerShell:

```powershell
./work/psp-runtime/restrict-debugger.ps1
```

Then start the services in a regular PowerShell:

```powershell
./work/psp-runtime/start-runtime.ps1
```

Open **http://127.0.0.1:4330/** and press POWER. The script uses uv to create the Python environment and starts or reuses the web and bridge services. The project's PPSSPP instance is launched or connected only when you press POWER. Keep its native window unminimized while running.

For detailed installation, startup, and shutdown instructions, see the [runtime guide (Chinese)](docs/psp-runtime-quickstart.md).

## Controls

| Action | Input |
| --- | --- |
| Rotate / zoom | Drag the body / scroll wheel |
| Buttons | Click the corresponding model button; hold to keep it pressed |
| Analog nub | Drag the nub; Shift + arrow keys |
| D-pad | Arrow keys or WASD |
| × / ○ / △ / □ | X / O / I / J |
| L / R | Q / E |
| START / SELECT | Enter / Backspace |
| Power | Tap P to connect, pause, or resume; hold to disconnect and pause the core |
| UMD | Click the rear door, or press U |

The question-mark button on the page lists all shortcuts. Changing the displayed model does not automatically change the emulator's hardware configuration. POWER controls the host session; UMD and WLAN currently provide mechanical interaction only.

## Architecture

```text
Three.js model → Input & session → WebRTC DataChannel → Python Bridge → PPSSPP
      ↑                                                                 │
 LCD VideoTexture ← WebRTC video ← Window capture / latest-frame slot ←──┘
```

Node.js serves the page and a restricted HTTP proxy at `127.0.0.1:4330`. Python manages sessions, capture, and media transport at `127.0.0.1:4331`, and controls the native core through its debugger on port `4332`. The web and bridge layers validate origins and session credentials. A project-specific firewall rule restricts inbound network access to the native debugger.

See the [architecture notes (Chinese)](docs/architecture.md).

## Development and verification

```powershell
# Frontend
Push-Location work/psp-studio
npm ci
npm test
npm run build
Pop-Location

# Local bridge on Windows
uv venv --python 3.12 work/psp-runtime/.venv
uv pip install --python work/psp-runtime/.venv/Scripts/python.exe -r work/psp-runtime/requirements.txt
Push-Location work/psp-runtime
uv run --python .venv/Scripts/python.exe python -m unittest discover -p 'test_*.py'
Pop-Location
```

The first build bakes the faceplates for all three models. Later builds reuse `.cache/faceplates/`. The output is written to `outputs/psp-3000.html`; rebuild and refresh the page after frontend changes.

```text
work/psp-studio/   3D models, input, sessions, and frontend tests
work/psp-runtime/  Local bridge, startup scripts, pinned runtime manifest, and tests
docs/             Runtime guide, architecture notes, and actual page screenshots
```

## Third-party components

This is an independent technical experiment with no affiliation to Sony or PlayStation. PSP, PlayStation, and Sony marks, and original system visuals, belong to their respective rights holders. See [THIRD_PARTY.md (Chinese)](THIRD_PARTY.md) for software and resource notes.
