# UI design (Google Stitch)

The UniRemote UI was redesigned in Google Stitch and then implemented by hand in React Native.

- **Stitch project:** "UniRemote – 433 MHz Universal Remote" (`projects/6033620748706689313`)
- **Design system:** "UniRemote Dark" (`assets/10896853765472114019`)
  - **Colours:** graphite surfaces `#0B0D10` / `#14171C` / `#1B1F26`, mint accent `#3EE6B0`, blue `#6C8CFF` for listening/learning, amber `#F5B84B` for warnings.
  - **Fonts:** Space Grotesk for headlines, Inter for body text, JetBrains Mono for labels and telemetry.
  - **Shape:** 12–16 px radii, 1 px hairline borders, tactile buttons that scale to 96 % when pressed.

| Screen | Reference | Implemented in |
|---|---|---|
| Remotes dashboard | `stitch-dashboard.png` | `mobile/src/app/(tabs)/index.tsx` |
| New remote: template picker | `stitch-template-picker.png` | `mobile/src/app/remote/new.tsx` + `components/remote/LayoutPreview.tsx` |
| Key fob remote | `stitch-keyfob.png` | `components/remote/RemoteSurface.tsx` (`KeyFobLayout`) |
| Climate remote | `stitch-climate.png` | `components/remote/RemoteSurface.tsx` (`ClimateLayout`) |
| Custom grid editor | generated in Stitch, not exported | `mobile/src/app/remote/[id].tsx` + `remote/button.tsx` |

**Deliberate differences from the generated designs.** The designs invented some data and capabilities that the hardware doesn't have, so the app leaves them out:
- **RSSI / "-64 dBm":** the receiver is a data-pin module and does not report signal strength.
- **"Test burst":** not included.
- **Climate card text "AC units, infrared tower fans":** infrared is not supported. The app's text says 433 MHz fans and heaters.
- **Frequency:** always labelled as nominal (433.92 MHz), because the modules cannot measure it.
