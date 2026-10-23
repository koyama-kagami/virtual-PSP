# PSP exterior — original design record

This document records the initial PSP-3000 direction. The current implementation also supports PSP-1000/2000, model-specific solid-colour catalogues, a white gallery and opening UMD compartments. See README.md for current architecture, commands and performance behavior.

Scope: an interactive object, not a marketing site. The user approved exterior-first work and explicitly selected PSP-3000. Firmware and game emulation are outside this iteration. The lit screen must be identified as an appearance preview.

Composition: cool, softly lit studio with one large floating handheld. Compact masthead, quiet model identification, a functional bottom control strip. No cards or marketing claims. The PSP is the distinctive element. Actual geometry supports unrestricted horizontal rotation and front/back inspection.

Palette: studio #eff0ed; ink #252b30; muted #858b8e; shell #15171b; silver #adb4b9; screen #557da5. Fonts: restrained Arial Black/Arial display, Microsoft YaHei/Segoe UI body, Consolas utility.

Model: wide rounded PSP-3000 chassis, chrome seam, central 16:9 screen, glossy black finish, four separate direction keys, analog nub, silver action symbols, PS key, bottom volume/display/note/select/start controls, microphone, shoulder buttons, physical side power switch, slim UMD ring and rear PSP mark.

Interactions: drag to rotate; wheel/pinch to zoom within bounds; front/back/reset presets; dark/light shell; physical and accessible power controls; keyboard arrows/WASD and face buttons; optional sound; reduced-motion support. Power only starts a clearly described visual screen demo.

Delivery: standalone HTML with bundled code, no CDN or external assets required; persistent local preview. Verify rendering, controls, state changes, resize/mobile, and reduced motion in a real browser.
