'use strict';

// A tiny 3D dice tray: flat-shaded polyhedra on a 2D canvas, no libraries and no
// textures. It's decoration only — the result is already on screen when the dice
// start tumbling, so it never holds a roll up.

(() => {
  const DURATION = 750;       // ms from throw to rest
  const MAX_BODIES = 12;      // the chips below the total list every die; this is a sample
  const PHI = (1 + Math.sqrt(5)) / 2;

  // --- vector & matrix helpers (3x3 matrices as row-major arrays of 9) ---------

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const norm = (a) => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

  const apply = (m, v) => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];

  function mul(a, b) {
    const out = new Array(9);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
      }
    }
    return out;
  }

  // Rodrigues: rotation of `angle` about unit `axis`.
  function rotation(axis, angle) {
    const [x, y, z] = axis;
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    return [
      t * x * x + c, t * x * y - s * z, t * x * z + s * y,
      t * x * y + s * z, t * y * y + c, t * y * z - s * x,
      t * x * z - s * y, t * y * z + s * x, t * z * z + c,
    ];
  }

  // --- shapes --------------------------------------------------------------------

  // Every die is convex, so its faces are exactly the planes through three vertices
  // with every other vertex on one side. Brute force, but it runs once per shape
  // on at most 20 vertices, and it saves hand-writing face lists.
  function hull(points) {
    const verts = points.map((p) => scale(p, 1 / Math.max(...points.map((q) => Math.hypot(...q)))));
    const faces = [];
    const seen = new Set();
    const n = verts.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
      let normal = cross(sub(verts[j], verts[i]), sub(verts[k], verts[i]));
      if (Math.hypot(...normal) < 1e-9) continue;
      normal = norm(normal);
      let d = dot(normal, verts[i]);
      if (d < 0) { normal = scale(normal, -1); d = -d; }
      if (verts.some((v) => dot(normal, v) > d + 1e-6)) continue;
      const on = verts.map((_, idx) => idx).filter((idx) => Math.abs(dot(normal, verts[idx]) - d) < 1e-6);
      const key = on.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      faces.push(makeFace(verts, on, normal));
    }
    return { verts, faces: numberFaces(faces) };
  }

  function makeFace(verts, idx, normal) {
    const center = scale(idx.reduce((acc, i) => [acc[0] + verts[i][0], acc[1] + verts[i][1], acc[2] + verts[i][2]], [0, 0, 0]), 1 / idx.length);
    // Wind the outline around the normal so it draws as a simple polygon.
    const ref = norm(sub(verts[idx[0]], center));
    const side = cross(normal, ref);
    const angle = (i) => { const d = sub(verts[i], center); return Math.atan2(dot(d, side), dot(d, ref)); };
    const ring = idx.slice().sort((a, b) => angle(a) - angle(b));

    // "Up" for the number: towards a point (triangles, pentagons, a d10's long tip),
    // but towards an edge on a square, or a d6 would read diagonally.
    const dists = ring.map((i) => Math.hypot(...sub(verts[i], center)));
    const far = Math.max(...dists);
    const regular = dists.every((d) => far - d < 1e-6);
    let up;
    if (regular && ring.length % 2 === 0) {
      up = norm(sub(scale([verts[ring[0]], verts[ring[1]]].reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]), 0.5), center));
    } else {
      up = norm(sub(verts[ring[dists.indexOf(far)]], center));
    }
    const right = cross(up, normal);

    // Room for a label: the distance from the centre to the nearest edge.
    let inner = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = verts[ring[i]], b = verts[ring[(i + 1) % ring.length]];
      const ab = sub(b, a);
      const t = dot(sub(center, a), ab) / dot(ab, ab);
      inner = Math.min(inner, Math.hypot(...sub(center, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t])));
    }
    return { ring, normal, center, up, right, inner };
  }

  // Opposite faces sum to n + 1, like a real die (a d4 has no opposite faces).
  function numberFaces(faces) {
    const out = new Array(faces.length);
    const left = faces.slice();
    let low = 0, high = faces.length - 1;
    while (left.length) {
      const face = left.shift();
      const opp = left.findIndex((f) => dot(f.normal, face.normal) < -0.999);
      out[low++] = face;
      if (opp >= 0) out[high--] = left.splice(opp, 1)[0];
    }
    return out;
  }

  // A pentagonal trapezohedron; the apex height keeps each kite flat.
  function d10Points() {
    const z = 0.105, c36 = Math.cos(Math.PI / 5);
    const h = z * (1 + c36) / (1 - c36);
    const pts = [[0, 0, h], [0, 0, -h]];
    for (let k = 0; k < 5; k++) {
      const a = (k * 2 * Math.PI) / 5, b = a + Math.PI / 5;
      pts.push([Math.cos(a), Math.sin(a), z], [Math.cos(b), Math.sin(b), -z]);
    }
    return pts;
  }

  function signs(p) {
    // Every sign combination of a point's non-zero coordinates.
    let out = [[]];
    for (const c of p) out = out.flatMap((q) => (c === 0 ? [[...q, 0]] : [[...q, c], [...q, -c]]));
    return out;
  }
  const cyclic = (p) => [p, [p[1], p[2], p[0]], [p[2], p[0], p[1]]];

  const POINTS = {
    4: () => [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
    6: () => signs([1, 1, 1]),
    8: () => cyclic([1, 0, 0]).flatMap(signs),
    10: d10Points,
    12: () => [...signs([1, 1, 1]), ...cyclic([0, 1 / PHI, PHI]).flatMap(signs)],
    20: () => cyclic([0, 1, PHI]).flatMap(signs),
  };
  // Circumradius is 1 for every shape; these even out how big they look.
  const SIZE = { 4: 1.2, 6: 0.92, 8: 1.05, 10: 1.05, 12: 1, 20: 1 };

  const shapes = {};
  const shape = (sides) => (shapes[sides] ||= hull(POINTS[sides]()));

  // --- turning a roll into bodies on the table -----------------------------------

  const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const LABELS = {
    d10: range(10, (i) => String(i + 1)),
    tens: range(10, (i) => String(i * 10).padStart(2, '0')),
    units: range(10, (i) => String(i)),
  };

  // Each body is one physical die: a d66 is two d6, a d100 is a tens and a units d10.
  function bodiesFor(groups) {
    const bodies = [];
    for (const g of groups) {
      if (g.kind !== 'dice') continue;
      g.values.forEach((value, i) => {
        const tone = value === (g.concat ? 66 : g.sides) ? 'max' : (value === (g.concat ? 11 : 1) ? 'min' : '');
        if (g.concat) {
          for (const face of g.pairs[i]) bodies.push({ sides: 6, face: face - 1, tone });
        } else if (g.sides === 100) {
          bodies.push({ sides: 10, face: Math.floor((value % 100) / 10), labels: LABELS.tens, tone });
          bodies.push({ sides: 10, face: value % 10, labels: LABELS.units, tone });
        } else if (POINTS[g.sides]) {
          bodies.push({ sides: g.sides, face: value - 1, labels: g.sides === 10 ? LABELS.d10 : null, tone });
        }
      });
    }
    return bodies.slice(0, MAX_BODIES);
  }

  // Where each body comes to rest: the rolled face towards us, tipped back a little
  // so the die reads as a solid rather than a flat polygon.
  function restingPose(body) {
    const f = shape(body.sides).faces[body.face];
    const toFront = [...f.right, ...f.up, ...f.normal];   // face frame -> view axes
    const twist = rotation([0, 0, 1], (Math.random() - 0.5) * 0.35);
    const tilt = mul(rotation([1, 0, 0], -0.42), rotation([0, 1, 0], (Math.random() - 0.5) * 0.5));
    return mul(tilt, mul(twist, toFront));
  }

  function prepare(body, i) {
    const axis = norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
    return {
      ...body,
      rest: restingPose(body),
      axis,
      spin: (2.5 + Math.random() * 2) * Math.PI,
      // Thrown in from one side and from above, a little out of step with each other.
      fromX: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.8),
      fromY: 1.2 + Math.random() * 0.8,
      delay: i * 25 + Math.random() * 60,
    };
  }

  // --- drawing -------------------------------------------------------------------

  const LIGHT = norm([-0.45, 0.65, 0.8]);
  const BODY = [124, 98, 214];
  const INK = { '': '#f4f0ff', max: '#86efac', min: '#fca5a5' };

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  function bounce(t) {
    // Lands at t = 0.45, then two shrinking hops.
    if (t < 0.45) return 1 - (t / 0.45) ** 2;
    if (t < 0.75) { const u = (t - 0.6) / 0.15; return 0.12 * (1 - u * u); }
    const u = (t - 0.875) / 0.125; return 0.03 * (1 - u * u);
  }

  function shade(normal) {
    const k = 0.38 + 0.62 * Math.max(0, dot(normal, LIGHT));
    return `rgb(${BODY.map((c) => Math.round(c * k)).join(',')})`;
  }

  const PIPS = {
    1: [[0, 0]], 2: [[-1, 1], [1, -1]], 3: [[-1, 1], [0, 0], [1, -1]],
    4: [[-1, 1], [1, 1], [-1, -1], [1, -1]], 5: [[-1, 1], [1, 1], [0, 0], [-1, -1], [1, -1]],
    6: [[-1, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [1, -1]],
  };

  function drawBody(ctx, b, cx, cy, size, m, dpr) {
    const { verts, faces } = shape(b.sides);
    const s = size * SIZE[b.sides];
    const screen = verts.map((v) => { const p = apply(m, v); return [cx + p[0] * s, cy - p[1] * s]; });

    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.strokeStyle = 'rgba(10, 8, 20, 0.45)';

    faces.forEach((f, idx) => {
      const n = apply(m, f.normal);
      if (n[2] <= 0) return;   // convex, so back-face culling is all the sorting we need

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath();
      f.ring.forEach((vi, k) => (k ? ctx.lineTo : ctx.moveTo).call(ctx, screen[vi][0], screen[vi][1]));
      ctx.closePath();
      ctx.fillStyle = shade(n);
      ctx.fill();
      ctx.stroke();

      // Labels fade out towards the silhouette, where they'd be squashed to a line.
      const alpha = Math.min(1, (n[2] - 0.12) / 0.35);
      if (alpha <= 0) return;

      // Map the face's own 2D frame onto the screen, so the label lies on the face.
      const c = apply(m, f.center), r = apply(m, f.right), u = apply(m, f.up);
      const k = (s * f.inner) / 100;   // 100 label units = the face's inner radius
      ctx.setTransform(
        dpr * k * r[0], -dpr * k * r[1], -dpr * k * u[0], dpr * k * u[1],
        dpr * (cx + c[0] * s), dpr * (cy - c[1] * s),
      );
      ctx.globalAlpha = alpha;
      ctx.fillStyle = idx === b.face ? INK[b.tone] : INK[''];

      if (b.sides === 6) {
        ctx.beginPath();
        for (const [px, py] of PIPS[idx + 1]) {
          ctx.moveTo(px * 52 + 17, -py * 52);
          ctx.arc(px * 52, -py * 52, 17, 0, Math.PI * 2);
        }
        ctx.fill();
      } else {
        const text = b.labels ? b.labels[idx] : String(idx + 1);
        const width = (b.sides === 10 ? 105 : 150);   // a d10 kite is narrow at its centre
        ctx.font = '700 100px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        const fit = Math.min(1.05, width / ctx.measureText(text).width);
        ctx.font = `700 ${Math.round(100 * fit)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 4);
        // 6 and 9 get a bar so they can't be read upside down.
        if (text === '6' || text === '9') ctx.fillRect(-22 * fit, 44 * fit, 44 * fit, 8 * fit);
      }
      ctx.globalAlpha = 1;
    });
  }

  // --- the tray --------------------------------------------------------------------

  function create(canvas) {
    const ctx = canvas.getContext('2d');
    let bodies = [];
    let start = 0;
    let frame = 0;
    const still = matchMedia('(prefers-reduced-motion: reduce)');

    function layout(w, h, n) {
      // One row, or two if that lets the dice be bigger.
      let best = null;
      for (let rows = 1; rows <= 2; rows++) {
        const cols = Math.ceil(n / rows);
        const cell = Math.min(w / cols, h / rows, 120);
        if (!best || cell > best.cell * 1.05) best = { rows, cols, cell };
      }
      return best;
    }

    function draw(now) {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!bodies.length || !w || !h) return false;

      const { rows, cols, cell } = layout(w, h, bodies.length);
      const size = cell * 0.4;
      let moving = false;

      // Draw back to front by height, so a die still in the air passes over a landed one.
      const placed = bodies.map((b, i) => {
        const row = Math.floor(i / cols);
        const inRow = row === rows - 1 ? bodies.length - row * cols : cols;
        const col = i - row * cols;
        const x = w / 2 + (col - (inRow - 1) / 2) * cell;
        const y = h / 2 + (row - (rows - 1) / 2) * cell;
        const t = still.matches ? 1 : Math.min(1, Math.max(0, (now - start - b.delay) / DURATION));
        if (t < 1) moving = true;
        const air = bounce(t);
        const m = mul(b.rest, rotation(b.axis, b.spin * Math.pow(1 - t, 2.2)));
        // Thrown away from us, so smaller in the air, and never higher than the tray.
        const airSize = size * (1 - 0.2 * air);
        const drop = Math.max(0, Math.min(b.fromY * cell, y - size * 0.8 * 1.3));
        return {
          b, m, air,
          x: x + b.fromX * cell * (1 - easeOut(t)),
          y: y - drop * air,
          lift: drop * air,
          size: airSize,
        };
      });
      placed.sort((p, q) => p.air - q.air);

      for (const p of placed) {
        // A soft shadow on the table, smaller and fainter the higher the die is.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const sy = p.y + p.lift + size * 0.85;
        ctx.fillStyle = `rgba(0, 0, 0, ${0.35 * (1 - 0.6 * p.air)})`;
        ctx.beginPath();
        ctx.ellipse(p.x, sy, size * (0.9 - 0.3 * p.air), size * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        drawBody(ctx, p.b, p.x, p.y, p.size, p.m, dpr);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return moving;
    }

    function tick(now) {
      frame = draw(now) ? requestAnimationFrame(tick) : 0;
    }

    function redraw() {
      if (!frame) draw(performance.now());
    }

    new ResizeObserver(redraw).observe(canvas);

    return {
      // Throw the dice for a roll's groups.
      roll(groups) {
        bodies = bodiesFor(groups).map(prepare);
        start = performance.now();
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(tick);
      },
      // Show dice already at rest, with no throw.
      rest(groups) {
        bodies = bodiesFor(groups).map(prepare);
        start = -Infinity;
        cancelAnimationFrame(frame);
        frame = 0;
        redraw();
      },
      clear() {
        bodies = [];
        cancelAnimationFrame(frame);
        frame = 0;
        redraw();
      },
    };
  }

  window.DiceTray = { create };
})();
