# Dice

A phone-friendly PWA that rolls dice. No backend, no network, no tracking — one HTML file,
one script, and a service worker so it works offline and installs to a home screen.

## Rolling

- **One tap** on any die in the grid (d4 – d100) rolls a single die.
- **Steppers** above the grid set how many dice and a flat modifier, so `3` + `+6` then tapping
  **d6** rolls `3d6 + 6`. `reset` puts them back to a single unmodified die.
- **Expression field** takes standard notation: `3d6 + 6`, `d20-1`, `2d8 + 1d4 + 3`.
- **↻** re-rolls the last roll. Recent rolls are kept on the device.

Each die's face is shown alongside the total; naturals and 1s are highlighted.
`?roll=3d6%2B6` in the URL rolls on load.

## Install

Open the site on your phone, then Chrome ⋮ → *Add to Home screen* (Android also offers the
in-app **Install** button), or Safari *Share* → *Add to Home Screen*.

## Local development

```bash
python3 -m http.server 8765   # then open http://localhost:8765/
```

Bump `VERSION` in `sw.js` whenever a shell file changes, or installed copies keep serving the
old one until their second load.

## Fairness

Rolls come from `crypto.getRandomValues` with rejection sampling, so every face is equally
likely — a plain modulo would very slightly favour the low faces.
