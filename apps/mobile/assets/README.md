# Mobile assets

Binary assets referenced by `app.json`. These are **not** committed as placeholders
because Expo requires valid PNGs at build time — add the real artwork before the
first EAS build.

Required files (all with a `#0C0B14` near-black background per the design tokens):

| File                | Size        | Used for                          |
| ------------------- | ----------- | --------------------------------- |
| `icon.png`          | 1024×1024   | App icon (iOS + Android)          |
| `adaptive-icon.png` | 1024×1024   | Android adaptive icon foreground  |
| `splash.png`        | 1284×2778   | Splash screen (the five-point star) |

Fonts (Playfair Display + Nunito) are loaded at runtime from
`@expo-google-fonts/*`, so no font files live here.
