'use strict';

// A 3D dice tray: three.js draws the dice, cannon-es throws them. It's decoration only —
// the result is already on screen when the dice start tumbling, so it never holds a roll
// up, and both libraries load after startup.

(() => {
  const MAX_BODIES = 12;      // the chips below the total list every die; this is a sample
  const PHI = (1 + Math.sqrt(5)) / 2;

  // --- vector helpers (plain arrays; the shapes are worked out before three.js loads) ---

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const norm = (a) => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

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

  // Whichever label slot is pointing up for a body orientation `q`.
  function landed(b, q) {
    const n = b.sides === 4 ? 4 : shape(b.sides).faces.length;
    let best = 0, bestY = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = new T.Vector3(...upOf(b, i)).applyQuaternion(q).y;
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

  // --- libraries ---------------------------------------------------------------------

  // three.js and cannon-es, fetched once the page has painted so they never delay startup.
  let T = null;          // three.js, once loaded
  let C = null;          // cannon-es, once loaded
  let libs = null;
  const loadLibs = () => (libs ||= Promise.all([import('./vendor/three.js'), import('./vendor/cannon-es.js')])
    .then(([three, cannon]) => { T = three; C = cannon; return true; })
    .catch(() => false));

  // --- camera ----------------------------------------------------------------------

  // World: x right, y up off the table, z along the table towards us. The camera looks
  // down at the table from 24° off vertical, orthographic so dice don't change size
  // across the tray.
  const TILT = 0.42;
  const SN = Math.sin(TILT), CS = Math.cos(TILT);
  const VIEW = [0, CS, SN];      // from the table towards the camera
  const SCREEN_UP = [0, SN, -CS];

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
    const [x, y, z] = [cross(up, fwd), up, fwd];   // rows: body axes -> world x, y, z
    const m = new T.Matrix4().set(...x, 0, ...y, 0, ...z, 0, 0, 0, 0, 1);
    m.premultiply(new T.Matrix4().makeRotationY((Math.random() - 0.5) * 0.5));
    return new T.Quaternion().setFromRotationMatrix(m);
  }

  // --- physics -----------------------------------------------------------------------

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


  // --- dice meshes -----------------------------------------------------------------

  const BODY = '#7c62d6';
  const EDGE = 'rgba(10, 8, 20, 0.45)';
  const INK = { '': '#f4f0ff', max: '#86efac', min: '#fca5a5' };
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const CELL = 128;           // texture pixels per face
  const FILL = 0.47;          // how much of its cell a face spans, from the centre

  const PIPS = {
    1: [[0, 0]], 2: [[-1, 1], [1, -1]], 3: [[-1, 1], [0, 0], [1, -1]],
    4: [[-1, 1], [1, 1], [-1, -1], [1, -1]], 5: [[-1, 1], [1, 1], [0, 0], [-1, -1], [1, -1]],
    6: [[-1, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [1, -1]],
  };

  // Each face gets a square cell of the texture, centred on the face's centre and
  // lined up with its right/up axes, so a label drawn upright in the cell lies upright
  // on the face. `layout` says where face `i`'s cell is and how a point maps into it.
  function cells(sides) {
    const { verts, faces } = shape(sides);
    const cols = Math.ceil(Math.sqrt(faces.length));
    const rows = Math.ceil(faces.length / cols);
    const layout = faces.map((f, i) => {
      const reach = Math.max(...f.ring.map((vi) => Math.hypot(...sub(verts[vi], f.center))));
      const k = FILL / reach;   // cell widths per unit
      return {
        col: i % cols, row: Math.floor(i / cols), k,
        // a point's (right, up) coordinates on the face, in cell widths from the centre
        local: (p) => { const d = sub(p, f.center); return [dot(d, f.right) * k, dot(d, f.up) * k]; },
      };
    });
    return { cols, rows, layout };
  }

  const geometries = {};
  function geometry(sides) {
    if (geometries[sides]) return geometries[sides];
    const { verts, faces } = shape(sides);
    const { cols, rows, layout } = cells(sides);
    const k = SIZE[sides];
    const pos = [], normal = [], uv = [];
    faces.forEach((f, i) => {
      const { col, row, local } = layout[i];
      // A fan of triangles per face; the ring already winds anticlockwise from outside.
      for (let t = 1; t + 1 < f.ring.length; t++) {
        for (const vi of [f.ring[0], f.ring[t], f.ring[t + 1]]) {
          const [a, b] = local(verts[vi]);
          pos.push(...scale(verts[vi], k));
          normal.push(...f.normal);
          uv.push((col + 0.5 + a) / cols, 1 - (row + 0.5 - b) / rows);
        }
      }
    });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    return (geometries[sides] = g);
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

  // The die's faces, outlines and numbers, painted for this roll's labels.
  function texture(b) {
    const { verts, faces } = shape(b.sides);
    const { cols, rows, layout } = cells(b.sides);
    const canvas = document.createElement('canvas');
    canvas.width = cols * CELL;
    canvas.height = rows * CELL;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = BODY;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    faces.forEach((f, idx) => {
      const { col, row, k, local } = layout[idx];
      const x0 = (col + 0.5) * CELL, y0 = (row + 0.5) * CELL;
      const at = (p) => { const [a, up] = local(p); return [x0 + a * CELL, y0 - up * CELL]; };

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      f.ring.forEach((vi, n) => ctx[n ? 'lineTo' : 'moveTo'](...at(verts[vi])));
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = CELL * 0.035;
      ctx.strokeStyle = EDGE;
      ctx.stroke();

      // 100 label units = the face's inner radius.
      const unit = (f.inner * k * CELL) / 100;
      const ink = (value) => (value === b.face ? INK[b.tone] : INK['']);

      if (b.sides === 4) {
        // A d4 has a number in each corner of each face; the one at the top point counts.
        for (const vi of f.ring) {
          const toward = norm(sub(verts[vi], f.center));
          const [ta, tb] = [dot(toward, f.right), dot(toward, f.up)];
          const [x, y] = at(f.center.map((c, i) => c + toward[i] * f.inner * 1.05));
          const u = unit * 0.5;
          ctx.setTransform(tb * u, ta * u, -ta * u, tb * u, x, y);   // label's up = towards the corner
          const value = labelOf(b, vi);
          ctx.fillStyle = ink(value);
          label(ctx, String(value + 1), 120);
        }
        return;
      }

      ctx.setTransform(unit, 0, 0, unit, x0, y0);
      const value = labelOf(b, idx);
      ctx.fillStyle = ink(value);
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
    });

    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  // --- the tray --------------------------------------------------------------------

  function create(canvas) {
    let bodies = [];        // the dice on the table, each with its `mesh`
    let frames = null;      // recorded simulation, or null for dice laid out at rest
    let zoom = 1;           // pixels per world unit
    let start = 0;
    let frame = 0;
    let rollId = 0;
    let gl = null;          // renderer, scene, camera once three.js is here
    const still = matchMedia('(prefers-reduced-motion: reduce)');

    function setup() {
      if (gl) return gl;
      const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      const scene = new T.Scene();
      const camera = new T.OrthographicCamera();
      camera.position.set(...scale(VIEW, 40));
      camera.up.set(...SCREEN_UP);
      camera.lookAt(0, 0, 0);
      camera.near = 1;
      camera.far = 80;

      scene.add(new T.AmbientLight(0xffffff, 0.8));
      const sun = new T.DirectionalLight(0xffffff, 2.8);
      sun.position.set(-4, 16, 3);   // high and to the left, so shadows fall short and to the right
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.radius = 4;
      Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 40 });
      scene.add(sun);

      const table = new T.Mesh(new T.PlaneGeometry(100, 100), new T.ShadowMaterial({ opacity: 0.35 }));
      table.rotation.x = -Math.PI / 2;
      table.receiveShadow = true;
      scene.add(table);
      return (gl = { renderer, scene, camera });
    }

    function place(list) {
      for (const b of bodies) {
        if (!b.mesh) continue;
        gl.scene.remove(b.mesh);
        b.mesh.material.map.dispose();
        b.mesh.material.dispose();
      }
      bodies = list;
      for (const b of bodies) {
        b.mesh = new T.Mesh(geometry(b.sides), new T.MeshLambertMaterial({ map: texture(b) }));
        b.mesh.castShadow = true;
        gl.scene.add(b.mesh);
      }
    }

    // Dice at rest in a grid: one row, or two if that lets them be bigger.
    function layOut(w, h) {
      const n = bodies.length;
      let best = null;
      for (let rows = 1; rows <= 2; rows++) {
        const cols = Math.ceil(n / rows);
        const cell = Math.min(w / cols, h / rows, 120);
        if (!best || cell > best.cell * 1.05) best = { rows, cols, cell };
      }
      const { rows, cols, cell } = best;
      zoom = cell * 0.4;
      bodies.forEach((b, i) => {
        const row = Math.floor(i / cols);
        const inRow = row === rows - 1 ? n - row * cols : cols;
        const dx = (i - row * cols - (inRow - 1) / 2) * cell / zoom;
        const dy = (row - (rows - 1) / 2) * cell / zoom;
        // Sit it on the table, then slide it back so its centre lands in its cell.
        b.mesh.quaternion.copy(b.pose);
        b.mesh.position.set(0, 0, 0);
        b.mesh.updateMatrixWorld();
        const lift = -new T.Box3().setFromObject(b.mesh).min.y;
        b.mesh.position.set(dx, lift, (dy + SN * lift) / CS);
      });
    }

    // A frame of the recorded simulation, blending between steps for high refresh rates.
    function playBack(t) {
      const at = Math.min(frames.length - 1, Math.max(0, t / (STEP * 1000)));
      const i = Math.floor(at), mix = at - i;
      const f0 = frames[i], f1 = frames[Math.min(frames.length - 1, i + 1)];
      const q0 = new T.Quaternion(), q1 = new T.Quaternion();
      bodies.forEach((b, n) => {
        const o = n * 7;
        b.mesh.position.set(f0[o], f0[o + 1], f0[o + 2]).lerp(new T.Vector3(f1[o], f1[o + 1], f1[o + 2]), mix);
        b.mesh.quaternion.slerpQuaternions(q0.fromArray(f0, o + 3), q1.fromArray(f1, o + 3), mix);
      });
      return at < frames.length - 1;
    }

    function draw(now) {
      if (!gl) return false;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return false;
      gl.renderer.setPixelRatio(window.devicePixelRatio || 1);
      gl.renderer.setSize(w, h, false);
      let moving = false;
      if (frames) moving = playBack(now - start);
      else layOut(w, h);
      Object.assign(gl.camera, { left: -w / 2 / zoom, right: w / 2 / zoom, top: h / 2 / zoom, bottom: -h / 2 / zoom });
      gl.camera.updateProjectionMatrix();
      gl.renderer.render(gl.scene, gl.camera);
      return moving;
    }

    // Runs only while a recorded throw is playing: the physics finished before the
    // first frame, and once the last frame is drawn nothing is scheduled again, so a
    // tray at rest costs no CPU (and no battery) until the next roll or a resize.
    function tick(now) {
      frame = draw(now) ? requestAnimationFrame(tick) : 0;
    }

    function redraw() {
      if (!frame) draw(performance.now());
    }

    new ResizeObserver(redraw).observe(canvas);

    function showResting(list) {
      cancelAnimationFrame(frame);
      frame = 0;
      frames = null;
      if (!gl) return;
      for (const b of list) b.pose = restingPose(b);
      place(list);
      redraw();
    }

    async function throwDice(list, id) {
      // Sweep the last roll's dice away now: they'd be showing the wrong numbers under
      // the new total while a big throw is being worked out.
      if (gl) showResting([]);
      const ok = await loadLibs();
      // Let the total paint before spending any time on the dice.
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const stale = () => id !== rollId;   // a newer roll has come along
      if (stale() || !ok) return;
      setup();
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) { showResting(list); return; }

      // Smaller dice when there are more of them, so they have room to tumble.
      const throwScale = Math.min(h / 5, Math.sqrt((w * h) / (list.length * 10)));
      const r = 0.85;     // roughly how far a resting die's centre sits from a wall
      const reach = 1.1;  // and how far its outline reaches on screen
      const halfW = w / 2 / throwScale;
      // A die against the back wall is drawn highest: keep its top inside the canvas.
      const halfD = Math.max(r + 0.5, (h / 2 / throwScale - SN * r - reach) / CS + r);

      const recorded = await simulate(C, list, halfW, halfD, stale);
      if (!recorded) return;
      const last = recorded[recorded.length - 1];
      list.forEach((b, i) => relabel(b, landed(b, new T.Quaternion().fromArray(last, i * 7 + 3))));

      place(list);
      zoom = throwScale;
      frames = recorded;
      start = performance.now();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    }

    // Fetch the libraries once the page is up, and put a die on the table.
    let pending = null;
    const boot = () => loadLibs().then((ok) => {
      if (!ok) return;
      setup();
      if (pending && !frames && !bodies.length) showResting(pending);
    });
    if (document.readyState === 'complete') setTimeout(boot, 0);
    else addEventListener('load', () => setTimeout(boot, 0));

    return {
      // Throw the dice for a roll's groups.
      roll(groups) {
        const list = bodiesFor(groups);
        rollId++;
        pending = null;
        if (still.matches || !list.length) {
          if (gl) showResting(list);
          else pending = list;
        } else {
          throwDice(list, rollId);
        }
      },
      // Show dice already at rest, with no throw.
      rest(groups) {
        rollId++;
        if (gl) showResting(bodiesFor(groups));
        else pending = bodiesFor(groups);
      },
      clear() {
        rollId++;
        pending = null;
        if (gl) showResting([]);
      },
    };
  }

  window.DiceTray = { create };
})();
