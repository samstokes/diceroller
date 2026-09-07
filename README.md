# Dice

A phone-friendly PWA that rolls dice. No backend, no network, no tracking — one HTML file,
one script, and a service worker so it works offline and installs to a home screen.

## Rolling

- **One tap** on any die in the grid (d4 – d100) rolls a single die.
- **Steppers** above the grid set how many dice and a flat modifier, so `3` + `+6` then tapping
  **d6** rolls `3d6 + 6`. `reset` puts them back to a single unmodified die.
- **Expression field** takes standard notation: `3d6 + 6`, `d20-1`, `2d8 + 1d4 + 3`, and
  multiplication with `x`, `*` or `×` — `2d6 x 10` sums the dice *then* multiplies, so a 2 and
  a 5 is 70. `×` binds tighter than `+`, so `2d6 x 10 + 5` is `(2d6 x 10) + 5`.
- **↻** re-rolls the last roll. Recent rolls are kept on the device.

### d66

`d66` is the Games Workshop die: two d6 read as tens and units, so a 3 and a 1 is **31**, not 4.
It gives 36 equally likely results from 11 to 66 — no 0s, no 7s, and a flat distribution rather
than the bell curve a 2d6 sum would give you. Both d6 faces are shown alongside the value they
read as (`3 5 = 35`), so you can see what was physically rolled. It's on the preset grid and in expressions
(`d66`, `2d66`, `d66 + 10`); highlighting treats 11 and 66 as the naturals.

Because of this, `d66` never means a 66-sided die — nobody rolls one of those. `d666` still
parses as an ordinary 666-sided die.

Each die's face is shown alongside the total; naturals and 1s are highlighted.
`?roll=3d6%2B6` in the URL rolls on load.

## Install

Open the site on your phone, then Chrome ⋮ → *Add to Home screen* (Android also offers the
in-app **Install** button), or Safari *Share* → *Add to Home Screen*.

## Local development

```bash
python3 -m http.server 8765   # then open http://localhost:8765/
```

The service worker is stale-while-revalidate: a launch paints instantly from the cache, and the
cache refreshes in the background, so a deploy arrives on the launch after next without any
action. Bumping `VERSION` in `sw.js` forces it a launch sooner, but it's no longer the only way
an update can land.

## Fairness

Rolls come from `crypto.getRandomValues` with rejection sampling, so every face is equally
likely — a plain modulo would very slightly favour the low faces.
