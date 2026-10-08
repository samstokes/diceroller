'use strict';

// A 3D dice tray: flat-shaded polyhedra on a 2D canvas, thrown by cannon-es physics.
// It's decoration only — the result is already on screen when the dice start
// tumbling, so it never holds a roll up, and the physics library loads after startup.

(() => {
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
  // `face` is the index of the label it has to show; on a d4 that's a corner, since a
  // d4 is read from the number at its top point.
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
    return bodies.slice(0, MAX_BODIES).map((b) => ({ ...b, perm: null }));
  }

  // The direction, in the die's own frame, that ends up pointing at the sky.
  function upOf(b, idx) {
    const { verts, faces } = shape(b.sides);
    return b.sides === 4 ? verts[idx] : faces[idx].normal;
  }

  // Whichever label slot is pointing up for a body orientation `m` (body -> world).
  function landed(b, m) {
    const n = b.sides === 4 ? 4 : shape(b.sides).faces.length;
    let best = 0, bestY = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = apply(m, upOf(b, i))[1];
      if (y > bestY) { bestY = y; best = i; }
    }
    return best;
  }

  // The physics decides which way up a die lands, the RNG decides what it rolled: swap
  // two labels so the face that landed on top carries the rolled value.
  function relabel(b, top) {
    const n = b.sides === 4 ? 4 : shape(b.sides).faces.length;
    b.perm = range(n, (i) => i);
    b.perm[top] = b.face;
    b.perm[b.face] = top;
  }
  const labelOf = (b, idx) => (b.perm ? b.perm[idx] : idx);

  // --- camera ----------------------------------------------------------------------

  // World: x right, y up off the table, z along the table towards us. The camera looks
  // down at the table from 24° off vertical, orthographic so labels map affinely.
  const TILT = 0.42;
  const SN = Math.sin(TILT), CS = Math.cos(TILT);
  const CAMERA = [1, 0, 0, 0, SN, -CS, 0, CS, SN];   // world -> view (x right, y up, z out)

  // A pose for dice with no physics behind them (the idle die, reduced motion):
  // the result facing up, turned a little at random about the vertical.
  function restingPose(b) {
    const { verts, faces } = shape(b.sides);
    let up, fwd;
    if (b.sides === 4) {
      up = norm(verts[b.face]);
      const other = verts[(b.face + 1) % 4];
      fwd = norm(sub(other, scale(up, dot(other, up))));
    } else {
      up = faces[b.face].normal;
      fwd = scale(faces[b.face].up, -1);   // label reads upright from the camera
    }
    const toWorld = [...cross(up, fwd), ...up, ...fwd];   // rows: body axes -> world x, y, z
    return mul(rotation([0, 1, 0], (Math.random() - 0.5) * 0.5), toWorld);
  }

  function quatToMatrix([x, y, z, w]) {
    return [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
    ];
  }

  // --- physics -----------------------------------------------------------------------

  // cannon-es, fetched once the page has painted so it never delays startup.
  let physics = null;
  const loadPhysics = () => (physics ||= import('./vendor/cannon-es.js').catch(() => null));

  const STEP = 1 / 60;
  const MAX_STEPS = 240;      // 4 s; anything still moving after that just stops there
  const GRAVITY = 90;         // die radii per s²: real gravity at this scale looks floaty

  const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

  // Throws the dice and runs the whole simulation up front, recording every frame, so
  // the faces can be relabelled before the first frame is shown. A dozen d20s can take
  // a while on a phone, so it gives the page a turn every few milliseconds; it gives up
  // (returning null) if `stale()` says a newer roll has come along.
  async function simulate(C, bodies, halfW, halfD, stale) {
    const world = new C.World({ gravity: new C.Vec3(0, -GRAVITY, 0), allowSleep: true });
    world.broadphase = new C.SAPBroadphase(world);
    const dieMat = new C.Material(), tableMat = new C.Material();
    world.addContactMaterial(new C.ContactMaterial(dieMat, tableMat, { friction: 0.3, restitution: 0.35 }));
    world.addContactMaterial(new C.ContactMaterial(dieMat, dieMat, { friction: 0.15, restitution: 0.45 }));

    // The table and four walls, each a plane facing into the tray.
    const walls = [
      [[0, 0, 0], [1, 0, 0], -Math.PI / 2],
      [[-halfW, 0, 0], [0, 1, 0], Math.PI / 2],
      [[halfW, 0, 0], [0, 1, 0], -Math.PI / 2],
      [[0, 0, -halfD], [0, 1, 0], 0],
      [[0, 0, halfD], [0, 1, 0], Math.PI],
    ];
    for (const [pos, axis, angle] of walls) {
      const plane = new C.Body({ mass: 0, material: tableMat, shape: new C.Plane() });
      plane.position.set(...pos);
      plane.quaternion.setFromAxisAngle(new C.Vec3(...axis), angle);
      world.addBody(plane);
    }

    // Thrown from one side, in a loose bunch, spinning.
    const side = Math.random() < 0.5 ? -1 : 1;
    const rows = Math.min(bodies.length, Math.max(1, Math.floor((2 * halfD - 2) / 2.1)));
    const rigid = bodies.map((b, i) => {
      const { verts, faces } = shape(b.sides);
      const k = SIZE[b.sides];
      const body = new C.Body({
        mass: 1,
        material: dieMat,
        linearDamping: 0.1,
        angularDamping: 0.1,
        // Asleep counts as settled: it stops a die jittering on top of another one
        // from keeping the whole simulation going.
        sleepSpeedLimit: 0.4,
        sleepTimeLimit: 0.25,
        shape: new C.ConvexPolyhedron({
          vertices: verts.map((v) => new C.Vec3(v[0] * k, v[1] * k, v[2] * k)),
          faces: faces.map((f) => f.ring),
        }),
      });
      const col = Math.floor(i / rows), row = i % rows;
      body.position.set(
        side * (halfW - 1.2 - col * 2.1),
        1.4 + Math.random() * 0.6 + (col % 2) * 0.4,
        (row - (rows - 1) / 2) * 2.1 + (Math.random() - 0.5) * 0.3,
      );
      body.quaternion.setFromAxisAngle(new C.Vec3(...norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5])), Math.random() * 2 * Math.PI);
      body.velocity.set(-side * (10 + Math.random() * 8), Math.random() * 3, (Math.random() - 0.5) * 6);
      body.angularVelocity.set(...range(3, () => (Math.random() - 0.5) * 40));
      world.addBody(body);
      return body;
    });

    const frames = [];
    let slice = performance.now();
    for (let step = 0; step < MAX_STEPS; step++) {
      if (performance.now() - slice > 8) {
        await nextTask();
        if (stale()) return null;
        slice = performance.now();
      }
      world.step(STEP);
      const f = new Float32Array(rigid.length * 7);
      rigid.forEach((r, i) => {
        f.set([r.position.x, r.position.y, r.position.z, r.quaternion.x, r.quaternion.y, r.quaternion.z, r.quaternion.w], i * 7);
      });
      frames.push(f);
      if (rigid.every((r) => r.sleepState === C.Body.SLEEPING)) break;
    }
    return frames;
  }

  // --- drawing -------------------------------------------------------------------

  const LIGHT = norm([-0.45, 0.65, 0.8]);
  const BODY = [124, 98, 214];
  const INK = { '': '#f4f0ff', max: '#86efac', min: '#fca5a5' };
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  function shade(normal) {
    const k = 0.38 + 0.62 * Math.max(0, dot(normal, LIGHT));
    return `rgb(${BODY.map((c) => Math.round(c * k)).join(',')})`;
  }

  const PIPS = {
    1: [[0, 0]], 2: [[-1, 1], [1, -1]], 3: [[-1, 1], [0, 0], [1, -1]],
    4: [[-1, 1], [1, 1], [-1, -1], [1, -1]], 5: [[-1, 1], [1, 1], [0, 0], [-1, -1], [1, -1]],
    6: [[-1, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [1, -1]],
  };

  // Lays the canvas over a patch of a face: `center`, `right` and `up` are in the
  // die's frame, and 100 canvas units span `radius` of it.
  function onFace(ctx, m, s, cx, cy, dpr, center, right, up, radius) {
    const c = apply(m, center), r = apply(m, right), u = apply(m, up);
    const k = (s * radius) / 100;
    ctx.setTransform(
      dpr * k * r[0], -dpr * k * r[1], -dpr * k * u[0], dpr * k * u[1],
      dpr * (cx + c[0] * s), dpr * (cy - c[1] * s),
    );
  }

  function label(ctx, text, width) {
    ctx.font = `700 100px ${FONT}`;
    const fit = Math.min(1.05, width / ctx.measureText(text).width);
    ctx.font = `700 ${Math.round(100 * fit)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 4);
    // 6 and 9 get a bar so they can't be read upside down.
    if (text === '6' || text === '9') ctx.fillRect(-22 * fit, 44 * fit, 44 * fit, 8 * fit);
  }

  // `m` turns the die's frame into view space; (cx, cy) is its centre on screen and
  // `size` the pixels per unit.
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
      ctx.globalAlpha = alpha;

      if (b.sides === 4) {
        // A d4 has a number in each corner of each face; the one at the top point counts.
        for (const vi of f.ring) {
          const toward = norm(sub(verts[vi], f.center));
          const at = [f.center[0] + toward[0] * f.inner * 1.05, f.center[1] + toward[1] * f.inner * 1.05, f.center[2] + toward[2] * f.inner * 1.05];
          onFace(ctx, m, s, cx, cy, dpr, at, cross(toward, f.normal), toward, f.inner * 0.5);
          const value = labelOf(b, vi);
          ctx.fillStyle = value === b.face ? INK[b.tone] : INK[''];
          label(ctx, String(value + 1), 120);
        }
      } else {
        onFace(ctx, m, s, cx, cy, dpr, f.center, f.right, f.up, f.inner);
        const value = labelOf(b, idx);
        ctx.fillStyle = value === b.face ? INK[b.tone] : INK[''];
        if (b.sides === 6) {
          ctx.beginPath();
          for (const [px, py] of PIPS[value + 1]) {
            ctx.moveTo(px * 52 + 17, -py * 52);
            ctx.arc(px * 52, -py * 52, 17, 0, Math.PI * 2);
          }
          ctx.fill();
        } else {
          // A d10 kite is narrow at its centre.
          label(ctx, b.labels ? b.labels[value] : String(value + 1), b.sides === 10 ? 105 : 150);
        }
      }
      ctx.globalAlpha = 1;
    });
  }

  // --- the tray --------------------------------------------------------------------

  function create(canvas) {
    const ctx = canvas.getContext('2d');
    let bodies = [];
    let frames = null;     // recorded simulation, or null for dice laid out at rest
    let scale = 1;         // pixels per world unit while a simulation plays
    let start = 0;
    let frame = 0;
    let rollId = 0;
    const still = matchMedia('(prefers-reduced-motion: reduce)');

    // Start fetching the physics once the page is up, not on the first roll.
    if (document.readyState === 'complete') setTimeout(loadPhysics, 500);
    else addEventListener('load', () => setTimeout(loadPhysics, 500));

    function size() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      return { w, h, dpr };
    }

    // Dice at rest in a grid: one row, or two if that lets them be bigger.
    function drawResting(w, h, dpr) {
      const n = bodies.length;
      let best = null;
      for (let rows = 1; rows <= 2; rows++) {
        const cols = Math.ceil(n / rows);
        const cell = Math.min(w / cols, h / rows, 120);
        if (!best || cell > best.cell * 1.05) best = { rows, cols, cell };
      }
      const { rows, cols, cell } = best;
      const px = cell * 0.4;
      bodies.forEach((b, i) => {
        const row = Math.floor(i / cols);
        const inRow = row === rows - 1 ? n - row * cols : cols;
        const x = w / 2 + (i - row * cols - (inRow - 1) / 2) * cell;
        const y = h / 2 + (row - (rows - 1) / 2) * cell;
        shadow(x, y + px * 0.7, px, 0, dpr);
        drawBody(ctx, b, x, y, px, mul(CAMERA, b.pose), dpr);
      });
    }

    function shadow(x, y, px, height, dpr) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgba(0, 0, 0, ${0.32 * Math.max(0, 1 - height / 4)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, px * 0.95, px * 0.95 * SN, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // A frame of the recorded simulation, blending between steps for high refresh rates.
    function drawSimulated(w, h, dpr, t) {
      // rAF's timestamp is the frame's start, which can be a hair before the throw.
      const at = Math.min(frames.length - 1, Math.max(0, t / (STEP * 1000)));
      const f0 = frames[Math.floor(at)], f1 = frames[Math.min(frames.length - 1, Math.floor(at) + 1)];
      const mix = at - Math.floor(at);
      const placed = bodies.map((b, i) => {
        const o = i * 7;
        const v = range(7, (k) => f0[o + k] + (f1[o + k] - f0[o + k]) * mix);
        const q = v.slice(3);
        const ql = Math.hypot(...q);
        const pos = v.slice(0, 3);
        const view = apply(CAMERA, pos);
        return { b, pos, view, m: mul(CAMERA, quatToMatrix(q.map((c) => c / ql))) };
      });
      placed.sort((a, c) => a.view[2] - c.view[2]);   // far to near
      for (const p of placed) {
        const floor = apply(CAMERA, [p.pos[0], 0, p.pos[2]]);
        shadow(w / 2 + floor[0] * scale, h / 2 - floor[1] * scale, scale * SIZE[p.b.sides] * 0.8, p.pos[1], dpr);
      }
      for (const p of placed) drawBody(ctx, p.b, w / 2 + p.view[0] * scale, h / 2 - p.view[1] * scale, scale, p.m, dpr);
      return at < frames.length - 1;
    }

    function draw(now) {
      const { w, h, dpr } = size();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!bodies.length || !w || !h) return false;
      if (frames) return drawSimulated(w, h, dpr, now - start);
      drawResting(w, h, dpr);
      return false;
    }

    function tick(now) {
      frame = draw(now) ? requestAnimationFrame(tick) : 0;
    }

    function redraw() {
      if (!frame) draw(performance.now());
    }

    new ResizeObserver(redraw).observe(canvas);

    function showResting(list) {
      bodies = list;
      for (const b of bodies) b.pose = restingPose(b);
      frames = null;
      cancelAnimationFrame(frame);
      frame = 0;
      redraw();
    }

    async function throwDice(list, id) {
      // Sweep the last roll's dice away now: they'd be showing the wrong numbers under
      // the new total while a big throw is being worked out.
      showResting([]);
      const C = await loadPhysics();
      // Let the total paint before spending any time on the dice.
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const stale = () => id !== rollId;   // a newer roll has come along
      if (stale()) return;
      const { w, h } = size();
      if (!C || !w || !h) { showResting(list); return; }

      // Smaller dice when there are more of them, so they have room to tumble.
      scale = Math.min(h / 5, Math.sqrt((w * h) / (list.length * 10)));
      const r = 0.85;     // roughly how far a resting die's centre sits from a wall
      const reach = 1.1;  // and how far its outline reaches on screen
      const halfW = w / 2 / scale;
      // A die against the back wall is drawn highest: keep its top inside the canvas.
      const halfD = Math.max(r + 0.5, (h / 2 / scale - SN * r - reach) / CS + r);

      const recorded = await simulate(C, list, halfW, halfD, stale);
      if (!recorded) return;
      const last = recorded[recorded.length - 1];
      list.forEach((b, i) => {
        const q = Array.from(last.subarray(i * 7 + 3, i * 7 + 7));
        relabel(b, landed(b, quatToMatrix(q)));
      });

      bodies = list;
      frames = recorded;
      start = performance.now();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    }

    return {
      // Throw the dice for a roll's groups.
      roll(groups) {
        const list = bodiesFor(groups);
        rollId++;
        if (still.matches || !list.length) showResting(list);
        else throwDice(list, rollId);
      },
      // Show dice already at rest, with no throw.
      rest(groups) {
        rollId++;
        showResting(bodiesFor(groups));
      },
      clear() {
        rollId++;
        showResting([]);
      },
    };
  }

  window.DiceTray = { create };
})();
