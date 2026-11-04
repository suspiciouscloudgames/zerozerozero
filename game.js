const canvas = document.querySelector('#forest');
const ctx = canvas.getContext('2d', { alpha: false });
const counter = document.querySelector('#remaining');
const forest = new Forest();
const sound = new ForestAudio();
const soundToggle = document.querySelector('#sound-toggle');
function syncSoundButton() {
  const audible = !sound.muted && sound.context?.state === 'running';
  soundToggle.dataset.state = audible ? 'on' : 'off';
  soundToggle.setAttribute('aria-label', audible ? '소리 끄기' : '소리 켜기');
  soundToggle.setAttribute('aria-pressed', String(audible));
  soundToggle.title = audible ? '소리 끄기' : '소리 켜기';
}
sound.onStateChange = syncSoundButton;
syncSoundButton();
soundToggle.addEventListener('click', () => sound.toggle());
for (const type of ['pointerdown', 'keydown']) {
  document.addEventListener(type, event => {
    if (!event.target.closest?.('#sound-toggle')) sound.unlock();
  }, { capture: true });
}
document.addEventListener('visibilitychange', () => sound.visibilityChanged());

const camera = { x: WORLD.width / 2, y: WORLD.height / 2, scale: ZOOMS[0], fromX: WORLD.width / 2, fromY: WORLD.height / 2, fromScale: ZOOMS[0], toX: WORLD.width / 2, toY: WORLD.height / 2, toScale: ZOOMS[0], elapsed: 2.4, duration: 2.4, zoomStep: 0, zoomIndex: 1 };
const pointer = { x: innerWidth / 2, y: innerHeight / 2, inside: false, worldX: WORLD.width / 2, worldY: WORLD.height / 2 };
let dragState = null;
let roadTool = null;
const roadDone = document.querySelector('#road-done');
const particles = [];
const brushTraces = [];
let activeHiddenAnimals = [];
let width = 0, height = 0, dpr = 1, previous = performance.now(), lastPulse = 0, endTime = 0, wheelReadyAt = 0;
const rng = random(Math.floor(Math.random() * 0x100000000));
const forestSigns = createForestSigns();
const palette = {
  paper: '#080d0a', ink: '#d2d4c1', green: ['#286544', '#34804a', '#4c9653', '#70a960', '#317957', '#659b69'],
  fire: '#bc4f37', ember: '#dc8052', ash: '#111511', pale: '#c9d1b7', mist: '#8ca996'
};
const canopyAtlas = makeCanopyAtlas();
const smokeSpriteSheet = new Image(); smokeSpriteSheet.src = './assets/smoke-atlas.png';
const fireSpriteSheet = new Image(); fireSpriteSheet.src = './assets/fire-atlas.png';
let fireSpriteCutouts = null;
const charredGroundSheet = new Image(); charredGroundSheet.src = './assets/charred-ground-decals.png';
const charredGroundVariants = [
  { x: 20, y: 20, w: 720, h: 580 }, { x: 700, y: 0, w: 836, h: 600 },
  { x: 0, y: 565, w: 560, h: 459 }, { x: 520, y: 565, w: 500, h: 459 },
  { x: 990, y: 555, w: 546, h: 469 }
];
let charredGroundCutouts = null;
const creatureSprites = Array.from({ length: 13 }, (_, i) => {
  const sprite = new Image();
  sprite.src = `./assets/creatures/creature-${String(i).padStart(2, '0')}.png`;
  return sprite;
});
// Keep the supplied artwork intact; source rectangles omit its black margins.
const stageIcons = [
  { x: 475, y: 215, w: 290, h: 725 },
  { x: 480, y: 320, w: 295, h: 570 },
  { x: 430, y: 485, w: 395, h: 270 },
  { x: 365, y: 450, w: 530, h: 320 }
].map((bounds, index) => {
  const image = new Image();
  const icon = { ...bounds, image, raster: null };
  image.onload = () => {
    // Downsample before applying display brightness so the fine supplied lines
    // remain legible without enlarging the icons or altering their source files.
    const fit = 78 / Math.max(bounds.w, bounds.h);
    const raster = document.createElement('canvas');
    raster.width = Math.ceil(bounds.w * fit); raster.height = Math.ceil(bounds.h * fit);
    raster.getContext('2d').drawImage(image, bounds.x, bounds.y, bounds.w, bounds.h,
      0, 0, raster.width, raster.height);
    icon.raster = raster;
  };
  image.src = `./assets/stages/stage-${index + 1}.png`;
  return icon;
});
const toasterSprites = Array.from({ length: 6 }, (_, i) => {
  const sprite = new Image();
  sprite.src = `./assets/toasters/toaster-${String(i).padStart(2, '0')}.png`;
  return sprite;
});
const signSprites = Array.from({ length: 12 }, (_, i) => {
  const sprite = new Image();
  sprite.src = `./assets/signs/sign-${String(i).padStart(2, '0')}.png`;
  return sprite;
});

function createForestSigns() {
  const signs = [], trees = forest.trees.filter(tree => tree.state === 'green');
  for (let i = 0; i < 23; i++) {
    let tree = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = trees[Math.floor(rng() * trees.length)];
      if (signs.every(sign => Math.hypot(sign.x - candidate.x, sign.y - candidate.y) > 54)) { tree = candidate; break; }
    }
    if (!tree) continue;
    signs.push({
      x: tree.x, y: tree.y + 12, spriteIndex: Math.floor(rng() * 12),
      rotation: (rng() - .5) * .2, scale: .78 + rng() * .24, fallen: rng() < .14,
      seed: Math.floor(rng() * 0x100000000)
    });
  }
  return signs;
}

function makeCanopyAtlas() {
  const colors = ['#315b42', '#477654', '#719269', '#91a878', '#627f78', '#9eaa7d', '#c0bd91', '#d1cba0'];
  const atlas = [];
  for (let variant = 0; variant < 12; variant++) {
    const c = document.createElement('canvas'); c.width = c.height = 312;
    const g = c.getContext('2d'); g.scale(3, 3);
    const leafRng = random(721 + variant * 199), shade = colors[variant % colors.length];
    const leaves = (x, y, angle, length, color, alpha = .8) => {
      const nx = x + Math.cos(angle) * length, ny = y + Math.sin(angle) * length;
      const side = length * (.18 + leafRng() * .08);
      g.globalAlpha = alpha; g.fillStyle = color; g.beginPath(); g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(angle + .68) * length * .42 - Math.sin(angle) * side, y + Math.sin(angle + .68) * length * .42 + Math.cos(angle) * side, nx, ny);
      g.quadraticCurveTo(x + Math.cos(angle - .53) * length * .4 + Math.sin(angle) * side * .55, y + Math.sin(angle - .53) * length * .4 - Math.cos(angle) * side * .55, x, y); g.fill();
      if (length > 5) { g.globalAlpha = alpha * .65; g.strokeStyle = colors[6]; g.lineWidth = .42; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + nx) / 2, (y + ny) / 2 - .5, nx, ny); g.stroke(); }
    };
    const branch = (x, y, angle, length, thick, depth, arm) => {
      const bend = (leafRng() - .5) * length * .58, ex = x + Math.cos(angle) * length, ey = y + Math.sin(angle) * length;
      const mx = x + Math.cos(angle) * length * .52 + Math.cos(angle + Math.PI / 2) * bend;
      const my = y + Math.sin(angle) * length * .52 + Math.sin(angle + Math.PI / 2) * bend;
      g.globalAlpha = .72; g.strokeStyle = '#101710'; g.lineWidth = thick + 1.7; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
      g.globalAlpha = .75 + leafRng() * .2; g.strokeStyle = colors[(variant + depth + arm) % 6]; g.lineWidth = thick;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
      const forks = depth > 1 ? (depth === 3 ? 2 : 2 + Math.floor(leafRng() * 2)) : 1;
      if (depth > 0) for (let f = 0; f < forks; f++) {
        const t = .32 + f * (.35 + leafRng() * .12), bx = x + (mx - x) * t + (ex - mx) * t;
        const by = y + (my - y) * t + (ey - my) * t;
        const side = (f + arm + variant) % 2 ? 1 : -1;
        const nextAngle = angle + side * (.48 + leafRng() * .72) + (leafRng() - .5) * .32;
        const nextLength = length * (.48 + leafRng() * .2);
        branch(bx, by, nextAngle, nextLength, thick * .62, depth - 1, arm + f + 1);
        if (depth <= 2) leaves(bx, by, nextAngle + side * .85, nextLength * .32, colors[(variant + f + depth + 2) % 8], .66);
      }
      if (depth === 0) {
        leaves(ex, ey, angle + (leafRng() - .5) * .7, 4 + leafRng() * 5, colors[(variant + arm) % 8], .76);
        leaves(ex, ey, angle + (leafRng() - .5) * .9 + 1.4, 3.5 + leafRng() * 4.2, colors[(variant + arm + 3) % 8], .68);
      }
    };
    g.lineCap = 'round'; g.lineJoin = 'round';
    // Dark, broken underpaint gives each crown a visible silhouette on the black forest floor.
    g.globalAlpha = .12; g.fillStyle = '#010302'; g.beginPath(); g.ellipse(52, 54, 39 + variant % 4 * 2, 27 + variant % 3 * 2, leafRng() * .8, 0, Math.PI * 2); g.fill();
    const primaryCount = 3 + variant % 3, dominant = leafRng() * Math.PI * 2;
    for (let arm = 0; arm < primaryCount; arm++) {
      const angle = dominant + (arm - (primaryCount - 1) / 2) * (.62 + leafRng() * .28) + (leafRng() - .5) * .56;
      const ox = 48 + (leafRng() - .5) * 12, oy = 54 + (leafRng() - .5) * 12;
      branch(ox, oy, angle, 23 + leafRng() * 19, 1.6 + leafRng() * 1.6, 3, arm);
    }
    // Sparse leaf clumps sit in branch forks, never in a uniform ring around the trunk.
    for (let i = 0; i < 18; i++) {
      const x = 20 + leafRng() * 64, y = 19 + leafRng() * 67, angle = leafRng() * Math.PI * 2;
      const len = 3 + leafRng() * 6;
      leaves(x, y, angle, len, colors[(variant + i + 1) % colors.length], .18 + leafRng() * .28);
    }
    g.globalAlpha = 1; atlas.push(c);
  }
  return atlas;
}

function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  width = innerWidth; height = innerHeight;
  counter.style.top = `${scopeCenterY()}px`;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize(); addEventListener('resize', resize);

function scopeCenterY() { return height / 2 - 18; }
function scopeRadius() {
  // Leave space around the outer scale, with extra room below for its glyphs.
  return Math.max(32, Math.min((width - 120) / 2, (height - 128) / 2));
}
function inScope(x, y) { return Math.hypot(x - width / 2, y - scopeCenterY()) <= scopeRadius(); }
function fitScale() {
  // Fit the actual irregular forest silhouette to the circular lens instead of
  // fitting the unused rectangular world corners, which made the opening view tiny.
  const forestRadius = 665;
  return scopeRadius() * .97 / forestRadius * 2;
}
function screenToWorld(sx, sy) {
  const s = camera.scale * fitScale();
  return { x: camera.x + (sx - width / 2) / s, y: camera.y + (sy - scopeCenterY()) / s };
}
function worldToScreen(x, y) {
  const s = camera.scale * fitScale();
  return { x: width / 2 + (x - camera.x) * s, y: scopeCenterY() + (y - camera.y) * s };
}
function setZoom(index) {
  index = clamp(index, 0, ZOOMS.length - 1);
  if (index === camera.zoomStep || forest.ended) return;
  dragState = null;
  const anchor = index > 0 ? screenToWorld(pointer.x, pointer.y) : { x: WORLD.width / 2, y: WORLD.height / 2 };
  camera.fromX = camera.x; camera.fromY = camera.y; camera.fromScale = camera.scale;
  camera.toScale = ZOOMS[index];
  const focusX = index === 0 ? WORLD.width / 2 : anchor.x - (pointer.x - width / 2) / (fitScale() * camera.toScale);
  const focusY = index === 0 ? WORLD.height / 2 : anchor.y - (pointer.y - scopeCenterY()) / (fitScale() * camera.toScale);
  camera.toX = clamp(focusX, 0, WORLD.width); camera.toY = clamp(focusY, 0, WORLD.height);
  camera.elapsed = 0; camera.duration = .22; camera.zoomStep = index;
  // Four unmistakable detail thresholds sit after every three mechanical notches.
  camera.zoomIndex = Math.min(4, Math.floor(index / 3) + 1);
  wheelReadyAt = performance.now() + camera.duration * 1000 + 70;
}
function zooming() { return camera.elapsed < camera.duration; }
function updateCamera(dt) {
  if (!zooming()) return;
  camera.elapsed = Math.min(camera.duration, camera.elapsed + dt);
  const t = camera.elapsed / camera.duration;
  const ticks = 7;
  const phase = t * ticks;
  const tick = Math.floor(phase);
  const withinTick = phase - tick;
  const stroke = t >= 1 ? 1 : Math.min(1, withinTick / .42);
  const easedStroke = stroke * stroke * (3 - 2 * stroke);
  const progress = t >= 1 ? 1 : (tick + easedStroke) / ticks;
  // Equal-ratio steps make the zoom feel like a geared lens moving notch by notch.
  camera.scale = camera.fromScale * Math.pow(camera.toScale / camera.fromScale, progress);
  camera.x = camera.fromX + (camera.toX - camera.fromX) * progress;
  camera.y = camera.fromY + (camera.toY - camera.fromY) * progress;
  clampCamera();
}
function clampCamera() {
  const scale = camera.scale * fitScale();
  const aperture = scopeRadius() * 2;
  const halfW = aperture / (2 * scale), halfH = aperture / (2 * scale);
  const margin = camera.zoomStep === 0 ? 55 : 0;
  const minX = halfW < WORLD.width / 2 ? halfW : WORLD.width / 2 - margin;
  const maxX = halfW < WORLD.width / 2 ? WORLD.width - halfW : WORLD.width / 2 + margin;
  const minY = halfH < WORLD.height / 2 ? halfH : WORLD.height / 2 - margin;
  const maxY = halfH < WORLD.height / 2 ? WORLD.height - halfH : WORLD.height / 2 + margin;
  camera.x = clamp(camera.x, minX, maxX);
  camera.y = clamp(camera.y, minY, maxY);
}

function mouseMove(event) {
  const wasInside = pointer.inside;
  const previousWorld = { x: pointer.worldX, y: pointer.worldY };
  pointer.x = event.clientX; pointer.y = event.clientY; pointer.inside = inScope(pointer.x, pointer.y);
  if (dragState?.mode === 'pan' && event.pointerId === dragState.pointerId) {
    const dx = event.clientX - dragState.startX, dy = event.clientY - dragState.startY;
    if (Math.hypot(dx, dy) > 5) dragState.moved = true;
    if (dragState.moved) {
      const scale = camera.scale * fitScale();
      camera.x = dragState.cameraX - dx / scale;
      camera.y = dragState.cameraY - dy / scale;
      clampCamera();
    }
  }
  const p = screenToWorld(pointer.x, pointer.y); pointer.worldX = p.x; pointer.worldY = p.y;
  if (wasInside && pointer.inside && !dragState && !roadTool) registerFoliageSweep(previousWorld, p);
}

function brushRadiusWorld() { return 110 / Math.max(.1, camera.scale * fitScale()); }
function observationRadiusWorld() { return brushRadiusWorld() * .94; }
function distanceToSegment(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1) : 0;
  return { x: a.x + dx * t, y: a.y + dy * t, t };
}
function registerFoliageSweep(from, to) {
  if (zooming() || camera.zoomIndex < 3 || !pointer.inside || forest.ended) return;
  const moved = Math.hypot(to.x - from.x, to.y - from.y);
  if (moved < 2) return;
  const last = brushTraces[brushTraces.length - 1];
  if (!last || Math.hypot(to.x - last.x, to.y - last.y) > 5) {
    brushTraces.push({ from, x: to.x, y: to.y, time: forest.time });
    if (brushTraces.length > 22) brushTraces.shift();
  } else {
    last.x = to.x; last.y = to.y; last.time = forest.time;
  }
  const radius = observationRadiusWorld();
  const discoveredGroups = new Set();
  for (const animal of forest.animals) {
    if (animal.state !== 'idle' || animal.revealed || camera.zoomIndex < animal.revealAt) continue;
    const closest = distanceToSegment(animal, from, to);
    if (Math.hypot(animal.x - closest.x, animal.y - closest.y) <= radius * .52) {
      discoveredGroups.add(animal.groupId);
    }
  }
  const signaledGroups = new Set();
  for (const animal of forest.animals) {
    if (animal.state !== 'idle' || animal.revealed || !discoveredGroups.has(animal.groupId)) continue;
    animal.revealed = true;
    animal.revealedAt = forest.time;
    if (!signaledGroups.has(animal.groupId)) {
      burst(animal.x, animal.y, 7, '#c5d19b', 18);
      signaledGroups.add(animal.groupId);
    }
  }
}
function foliageBendAt(x, y) {
  if (camera.zoomIndex < 3 || !activeHiddenAnimals.length) return { x: 0, y: 0, strength: 0 };
  let vx = 0, vy = 0, strength = 0;
  const hideoutRadius = WORLD.cell * 1.65;
  const reach = observationRadiusWorld() * .9;
  for (const animal of activeHiddenAnimals) {
    const d = Math.hypot(x - animal.x, y - animal.y);
    if (d >= hideoutRadius) continue;
    const weight = (1 - d / hideoutRadius) ** 1.45;
    const sway = forest.time * 2.7 + animal.phase;
    const pulse = .42 + .58 * (.5 + .5 * Math.sin(forest.time * 3.4 + animal.phase * 1.7));
    vx += Math.sin(sway) * weight;
    vy += Math.cos(sway * .82) * weight;
    strength += weight * (.22 + pulse * .32);

    // A recent brush sweep makes just this hidden patch answer more strongly.
    for (const trace of brushTraces) {
      const age = forest.time - trace.time;
      if (age > 1.35) continue;
      const animalNear = distanceToSegment(animal, trace.from, trace);
      if (Math.hypot(animal.x - animalNear.x, animal.y - animalNear.y) > reach) continue;
      const closest = distanceToSegment({ x, y }, trace.from, trace);
      const dx = x - closest.x, dy = y - closest.y;
      const inv = Math.hypot(dx, dy) > .01 ? 1 / Math.hypot(dx, dy) : 0;
      const traceDx = trace.x - trace.from.x, traceDy = trace.y - trace.from.y;
      const traceLength = Math.max(1, Math.hypot(traceDx, traceDy));
      const force = weight * (1 - age / 1.35) * .9;
      vx += (inv ? dx * inv : -traceDy / traceLength) * force;
      vy += (inv ? dy * inv : traceDx / traceLength) * force;
      strength += force;
    }
  }
  const magnitude = Math.hypot(vx, vy);
  if (magnitude > 1) { vx /= magnitude; vy /= magnitude; }
  return { x: vx, y: vy, strength: clamp(strength, 0, 1) };
}
canvas.addEventListener('pointermove', mouseMove);
canvas.addEventListener('pointerenter', mouseMove);
canvas.addEventListener('pointerleave', () => { if (!dragState) pointer.inside = false; });
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  if (!inScope(event.clientX, event.clientY)) return;
  if (Math.abs(event.deltaY) < 3 || dragState || zooming() || performance.now() < wheelReadyAt) return;
  setZoom(camera.zoomStep + (event.deltaY < 0 ? 1 : -1));
}, { passive: false });
function roadHandles() {
  if (camera.zoomIndex < 4 || zooming() || forest.ended) return [];
  const groups = new Map();
  for (const a of forest.animals) {
    if (!a.revealed || !['idle', 'waiting'].includes(a.state)) continue;
    if (!groups.has(a.groupId)) groups.set(a.groupId, []);
    groups.get(a.groupId).push(a);
  }
  return [...groups.entries()].map(([groupId, members]) => {
    const world = { x: members.reduce((v, a) => v + a.x, 0) / members.length,
      y: members.reduce((v, a) => v + a.y, 0) / members.length };
    const screen = worldToScreen(world.x, world.y);
    // Keep the action clear of the animal even at the closest magnification.
    const offset = Math.max(42, 7 * camera.scale * fitScale() + 24);
    return { groupId, x: screen.x, y: screen.y - offset, world, count: members.length };
  }).filter(h => inScope(h.x, h.y));
}
function nearestRoadHandle(x, y) {
  return roadHandles().sort((a, b) => Math.hypot(x-a.x,y-a.y)-Math.hypot(x-b.x,y-b.y))
    .find(h => Math.hypot(x-h.x,y-h.y) < 27);
}
function nearestRoadPoint(x, y) {
  if (camera.zoomIndex < 4 || zooming()) return null;
  let closest = null, best = 12;
  for (const id of forest.roads) {
    const point = forest.roadPoint(id), screen = worldToScreen(point.x, point.y);
    const d = Math.hypot(screen.x - x, screen.y - y);
    if (d < best) { best = d; closest = point; }
  }
  return closest;
}
function endRoadTool() { roadTool = null; dragState = null; }
roadDone.addEventListener('click', endRoadTool);
addEventListener('keydown', event => { if (event.key === 'Escape') endRoadTool(); });
canvas.addEventListener('contextmenu', event => event.preventDefault());
function extendRoad(point) {
  if (!roadTool || camera.zoomIndex < 4 || zooming()) return;
  const zone = forest.safeZones.find(z => distance(z, point) < 26);
  roadTool.anchor = forest.addRoadSegment(roadTool.anchor, zone || point);
  if (zone && forest.roadCellAt(roadTool.anchor.x, roadTool.anchor.y).id === forest.roadCellAt(zone.x, zone.y).id) endRoadTool();
}
canvas.addEventListener('pointerdown', event => {
  if (![0, 2].includes(event.button) || forest.ended || zooming() || !inScope(event.clientX, event.clientY)) return;
  mouseMove(event);
  // Defer every click action until release: a drag always pans, even over a handle.
  dragState = { pointerId: event.pointerId, mode: 'pan', moved: false,
    startX: event.clientX, startY: event.clientY, cameraX: camera.x, cameraY: camera.y };
  try { canvas.setPointerCapture(event.pointerId); } catch {}
});
canvas.addEventListener('pointerup', event => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  mouseMove(event);
  const dragged = dragState.moved;
  dragState = null;
  if (dragged || event.button === 2 || forest.ended || zooming() || !pointer.inside) return;
  const handle = nearestRoadHandle(pointer.x, pointer.y);
  if (handle) {
    const anchor = forest.startRoad(handle.groupId);
    if (anchor) roadTool = { anchor };
    return;
  }
  const ember = nearestVisibleFireEmber(pointer.x, pointer.y);
  if (ember) {
    if (forest.clear({ x: ember.x, y: ember.y })) burst(ember.x, ember.y, 22, '#c6ded1', 58);
    return;
  }
  const fakeToaster = nearestVisibleToaster(pointer.x, pointer.y);
  if (fakeToaster) {
    const oldX = fakeToaster.x, oldY = fakeToaster.y;
    sound.popToaster({ x: oldX, y: oldY }, {
      x: camera.x, y: camera.y, radius: scopeRadius() / (camera.scale * fitScale())
    });
    moveFakeSmokeSignal(fakeToaster);
    burst(oldX, oldY, 12, '#c4c8ad', 42);
    return;
  }
  if (roadTool) { extendRoad(screenToWorld(pointer.x, pointer.y)); return; }
  const roadPoint = nearestRoadPoint(pointer.x, pointer.y);
  if (roadPoint) roadTool = { anchor: roadPoint };
});
canvas.addEventListener('pointercancel', () => { dragState = null; });

function nearestVisibleToaster(screenX, screenY) {
  if (camera.zoomIndex < 2 || zooming()) return null;
  const stage = Math.max(1, Math.min(4, camera.zoomIndex));
  const target = [9, 13, 16, 18][stage - 1];
  const screenScale = camera.scale * fitScale();
  let found = null, best = Infinity;
  for (const signal of forest.smokeSignals) {
    if (!signal.fake) continue;
    const size = target * (signal.robotLook?.scale || 1);
    // The hit region covers the appliance silhouette at the plume's base, never the smoke above it.
    const screen = worldToScreen(signal.x, signal.y - size * .48);
    const d = Math.hypot((screenX - screen.x) / Math.max(1, size * screenScale * .58),
      (screenY - screen.y) / Math.max(1, size * screenScale * .58));
    if (d < 1 && d < best) { found = signal; best = d; }
  }
  return found;
}
function fireEmberTrees(cluster) {
  const count = Math.min(5, Math.max(1, Math.ceil(cluster.length / 3)));
  const ordered = [...cluster].sort((a, b) => a.id - b.id);
  return Array.from({ length: count }, (_, i) => ordered[Math.floor((i + .5) * ordered.length / count) % ordered.length]);
}
function isFireClusterVisible(cluster) {
  if (zooming()) return false;
  return camera.zoomIndex >= 2 && cluster.length > 0;
}
function nearestVisibleFireEmber(screenX, screenY) {
  if (camera.zoomIndex < 2 || zooming() || forest.ended) return null;
  const screenScale = camera.scale * fitScale();
  let found = null, best = Infinity;
  for (const cluster of collectFireClusters()) {
    if (!isFireClusterVisible(cluster)) continue;
    for (const tree of cluster) {
      const shape = fireGeometry(tree);
      const halfW = shape.rx * screenScale, halfH = shape.ry * screenScale;
      const center = worldToScreen(shape.x, shape.y);
      const d = Math.hypot((screenX - center.x) / Math.max(8, halfW), (screenY - center.y) / Math.max(8, halfH));
      if (d <= 1 && d < best) { found = tree; best = d; }
    }
  }
  return found;
}
function moveFakeSmokeSignal(signal) {
  let candidate = null;
  for (let attempt = 0; attempt < 240; attempt++) {
    const point = { x: 230 + rng() * 1040, y: 205 + rng() * 560 };
    if (!forestShape(point.x, point.y)) continue;
    if (forest.trees.some(tree => tree.state === 'fire' && distance(tree, point) < WORLD.cell * 9)) continue;
    if (forest.smokeSignals.some(other => other !== signal && distance(other, point) < WORLD.cell * 8)) continue;
    candidate = point; break;
  }
  if (!candidate) return;
  signal.x = candidate.x; signal.y = candidate.y; signal.phase = rng() * Math.PI * 2; signal.robotLook = null;
}
function burst(x, y, count, color, speed) {
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2, v = 8 + rng() * speed;
    const life = .45 + rng() * .8;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, r: 1 + rng() * 2.2 });
  }
}

function drawBackground() {
  ctx.fillStyle = palette.paper; ctx.fillRect(0, 0, width, height);
  const vignette = ctx.createRadialGradient(width * .52, height * .48, Math.min(width, height) * .12, width * .5, height * .5, Math.max(width, height) * .8);
  vignette.addColorStop(0, 'rgba(42,67,51,.04)'); vignette.addColorStop(1, 'rgba(0,0,0,.62)');
  ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
}
function drawForestBase() {
  ctx.save();
  ctx.translate(width / 2, scopeCenterY()); ctx.scale(camera.scale * fitScale(), camera.scale * fitScale());
  ctx.translate(-camera.x, -camera.y);
  // Subtle soil grain makes the forest read as a continuous painted field.
  const groundTones = ['#070b09', '#090f0b', '#0b120d', '#0e160f', '#111a12'];
  ctx.fillStyle = groundTones[Math.max(0, Math.min(4, camera.zoomIndex))];
  ctx.beginPath(); ctx.ellipse(740, 480, 660, 355, -.035, 0, Math.PI * 2); ctx.fill();
  const visibleReach = scopeRadius() / (camera.scale * fitScale()) + WORLD.cell * 2;
  drawForestFloor(camera.zoomIndex, visibleReach);
  for (let i = 0; i < forest.cells.length; i++) {
    const c = forest.cells[i];
    if (!c.original) continue;
    if (Math.abs(c.x - camera.x) > visibleReach || Math.abs(c.y - camera.y) > visibleReach) continue;
    if (c.state === 'cleared') continue;
    if (c.state === 'ash') {
      drawAshGround(c); continue;
    }
    if (c.state === 'fire') continue;
    const pulse = Math.sin(forest.time * .5 + c.phase) * .045;
    const size = WORLD.cell * (1.9 + c.size * .34);
    // Keep the painted canopy present at every magnification; reveal detail inside it
    // instead of fading the forest away as the telescope zooms.
    const crownOpacity = [.91, .88, .84, .8, .76][Math.min(camera.zoomIndex, 4)];
    ctx.globalAlpha = crownOpacity + pulse * .35;
    ctx.drawImage(canopyAtlas[c.variant % canopyAtlas.length], c.x - size / 2, c.y - size / 2, size, size);
    if (camera.zoomIndex >= 1) drawCloseCanopy(c, size, camera.zoomIndex);
  }
  drawAshDecals(visibleReach);
  drawUnderstory(camera.zoomIndex, visibleReach);
  drawRoadsAndSafeZones(visibleReach);
  drawForestSigns(visibleReach);
  // Let hidden creatures peek through, then let a few foreground fronds overlap them.
  drawAnimals(true);
  ctx.globalAlpha = 1;
  drawBreaks(); drawFire(); drawAnimals(false); drawParticles();
  ctx.restore();
}
function organicPatchPath(x, y, rx, ry, seed, roughness = .32) {
  const detail = random(seed), count = 11, points = [];
  const offset = detail() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = offset + i / count * Math.PI * 2;
    const r = .7 + detail() * roughness + Math.sin(a * 3 + seed) * .08;
    points.push({ x: x + Math.cos(a) * rx * r, y: y + Math.sin(a) * ry * r });
  }
  ctx.beginPath();
  const first = points[0], last = points[count - 1];
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let i = 0; i < count; i++) {
    const p = points[i], next = points[(i + 1) % count];
    ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
  ctx.closePath();
}
function drawAshGround(tree) {
  const size = WORLD.cell * (.59 + tree.size * .12);
  const seed = tree.id * 7919 + 17;
  ctx.save();
  // A feathered earth stain under each burned tree merges into the neighboring ash cells.
  ctx.globalAlpha = .36; ctx.fillStyle = '#211811'; ctx.shadowColor = 'rgba(27,18,13,.72)'; ctx.shadowBlur = size * .34;
  organicPatchPath(tree.x, tree.y + 2, size * 1.06, size * .68, seed, .76); ctx.fill();
  ctx.shadowBlur = 0; ctx.globalAlpha = .76; ctx.fillStyle = '#030403';
  organicPatchPath(tree.x, tree.y + 2, size * .72, size * .46, seed + 31, .78); ctx.fill();
  const detail = random(seed + 91);
  // A few tiny soot flecks connect the larger painted decal to the surrounding ground.
  for (let i = 0; i < 3; i++) {
    const px = tree.x + (detail() - .5) * size * 1.2, py = tree.y + (detail() - .5) * size * .7;
    ctx.globalAlpha = .11 + detail() * .13; ctx.fillStyle = i % 2 ? '#29241f' : '#0a0c0a';
    ctx.beginPath(); ctx.ellipse(px, py, .7 + detail() * 1.4, .45 + detail(), detail() * 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore(); ctx.globalAlpha = 1;
}
let ashGroupsCache = { revision: -1, groups: [] };
function ashGroups() {
  if (ashGroupsCache.revision === forest.revision) return ashGroupsCache.groups;
  const visited = new Set(), groups = [];
  for (const tree of forest.trees) {
    if (tree.state !== 'ash' || visited.has(tree.id)) continue;
    const group = [], queue = [tree]; visited.add(tree.id);
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]; group.push(current);
      for (const neighborId of current.neighbors) {
        const neighbor = forest.cells[neighborId];
        if (neighbor.state === 'ash' && !visited.has(neighbor.id)) { visited.add(neighbor.id); queue.push(neighbor); }
      }
    }
    groups.push(group);
  }
  ashGroupsCache = { revision: forest.revision, groups };
  return groups;
}
function drawAshDecals(visibleReach) {
  if (!charredGroundSheet.complete || !charredGroundSheet.naturalWidth || camera.zoomIndex < 1) return;
  if (!charredGroundCutouts) {
    charredGroundCutouts = charredGroundVariants.map(source => {
      const cutout = document.createElement('canvas');
      cutout.width = source.w; cutout.height = source.h;
      const cutCtx = cutout.getContext('2d');
      cutCtx.drawImage(charredGroundSheet, source.x, source.y, source.w, source.h, 0, 0, source.w, source.h);
      return cutout;
    });
  }
  for (const group of ashGroups()) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const tree of group) {
      minX = Math.min(minX, tree.x); minY = Math.min(minY, tree.y);
      maxX = Math.max(maxX, tree.x); maxY = Math.max(maxY, tree.y);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    if (Math.abs(cx - camera.x) > visibleReach || Math.abs(cy - camera.y) > visibleReach) continue;
    const variantIndex = Math.abs((group[0].id * 13 + group.length * 7) % charredGroundVariants.length);
    const source = charredGroundVariants[variantIndex];
    const aspect = source.w / source.h;
    const footprint = Math.sqrt(group.length);
    const dw = Math.min(230, Math.max(maxX - minX + 27, (maxY - minY + 20) * aspect, 48 + footprint * 11));
    const dh = dw / aspect;
    const seed = group[0].id * 997 + group.length * 31;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate((random(seed)() - .5) * .72);
    const halo = Math.max(dw, dh) * .58;
    // A soft soil/soot bed and scattered charcoal fragments connect the decal to nearby ground.
    organicPatchPath(0, 0, dw * .78, dh * .8, seed + 5, .76); ctx.clip();
    const soil = ctx.createRadialGradient(0, 0, halo * .08, 0, 0, halo);
    soil.addColorStop(0, 'rgba(42,31,24,.48)'); soil.addColorStop(.56, 'rgba(29,25,20,.34)');
    soil.addColorStop(1, 'rgba(12,15,12,0)');
    ctx.fillStyle = soil; ctx.fillRect(-dw, -dh, dw * 2, dh * 2);
    const debris = random(seed + 83);
    for (let i = 0; i < 9; i++) {
      const angle = debris() * Math.PI * 2, radius = .48 + debris() * .55;
      const px = Math.cos(angle) * dw * .52 * radius, py = Math.sin(angle) * dh * .54 * radius;
      const shard = 1 + debris() * 3.4, lean = (debris() - .5) * shard * 2;
      ctx.globalAlpha = .12 + debris() * .16; ctx.fillStyle = i % 3 ? '#272722' : '#493126';
      ctx.beginPath(); ctx.moveTo(px - shard, py + shard * .15); ctx.quadraticCurveTo(px + lean, py - shard, px + shard * .7, py + shard * .3); ctx.lineTo(px - shard * .25, py + shard * .5); ctx.closePath(); ctx.fill();
    }
    const cutout = charredGroundCutouts[variantIndex];
    const zoomAlpha = [.34, .48, .62, .7, .74][Math.min(camera.zoomIndex, 4)];
    const artW = dw * .58, artH = dh * .58;
    ctx.globalAlpha = zoomAlpha * .24; ctx.filter = 'blur(3px)';
    ctx.drawImage(cutout, -artW * .67, -artH * .67, artW * 1.34, artH * 1.34);
    ctx.filter = 'none'; ctx.globalAlpha = zoomAlpha * .82;
    ctx.drawImage(cutout, -artW / 2, -artH / 2, artW, artH);
    ctx.restore(); ctx.globalAlpha = 1;
  }
}
function drawCloseCanopy(tree, size, level) {
  // Zoom reveals finer off-center stems and leaves in the same etched botanical language.
  const colors = ['#829875', '#a4ae80', '#9bb7a0', '#c4c59a'];
  const disturbance = foliageBendAt(tree.x, tree.y);
  const arms = level === 1 ? 2 : level === 2 ? 3 : 4;
  const reach = size * (level === 1 ? .18 : level === 2 ? .27 : level === 3 ? .34 : .4);
  ctx.save(); ctx.translate(tree.x, tree.y); ctx.rotate(tree.phase * .23);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 0; i < arms; i++) {
    const a = tree.phase + i * 2.399 + Math.sin(i * 4.1 + tree.phase) * .43
      + Math.sin(forest.time * 4.2 + tree.phase + i) * .12 * disturbance.strength;
    const len = reach * (.63 + ((tree.variant + i * 3) % 5) * .09);
    const sx = Math.sin(tree.phase + i) * size * .075, sy = Math.cos(tree.phase * .7 + i) * size * .065;
    const ex = sx + Math.cos(a) * len, ey = sy + Math.sin(a) * len;
    const bend = Math.sin(tree.phase * 1.9 + i * 2.2) * len * .21
      + disturbance.x * len * .22 * disturbance.strength;
    ctx.globalAlpha = level === 1 ? .18 : level === 2 ? .23 : .3;
    ctx.strokeStyle = colors[(tree.variant + i) % colors.length]; ctx.lineWidth = .28 + level * .04;
    ctx.beginPath(); ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + Math.cos(a) * len * .5 - Math.sin(a) * bend, sy + Math.sin(a) * len * .5 + Math.cos(a) * bend, ex, ey); ctx.stroke();
    const forks = level === 1 ? 0 : level === 2 ? 1 : level === 3 ? 1 : 2;
    for (let j = 0; j < forks; j++) {
      const t = .34 + j * .19, side = (i + j + tree.variant) % 2 ? 1 : -1;
      const fx = sx + (ex - sx) * t, fy = sy + (ey - sy) * t;
      const fa = a + side * (.78 + j * .09), fl = len * (level === 4 ? .28 : .23);
      const tx = fx + Math.cos(fa) * fl, ty = fy + Math.sin(fa) * fl;
      ctx.globalAlpha = level === 2 ? .2 : .25; ctx.lineWidth = .22 + level * .035;
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.quadraticCurveTo(fx + Math.cos(fa) * fl * .54, fy + Math.sin(fa) * fl * .54 - fl * .08, tx, ty); ctx.stroke();
      if (level >= 3) {
        const leafLen = len * (level === 4 ? .14 : .12);
        for (const side2 of [-1, 1]) {
          const la = fa + side2 * .93, lx = fx + Math.cos(fa) * fl * .67, ly = fy + Math.sin(fa) * fl * .67;
          ctx.globalAlpha = .36; ctx.fillStyle = colors[(tree.variant + i + j + (side2 > 0 ? 1 : 2)) % colors.length];
          ctx.beginPath(); ctx.moveTo(lx, ly);
          ctx.quadraticCurveTo(lx + Math.cos(la + .7) * leafLen * .52, ly + Math.sin(la + .7) * leafLen * .52, lx + Math.cos(la) * leafLen, ly + Math.sin(la) * leafLen);
          ctx.quadraticCurveTo(lx + Math.cos(la - .55) * leafLen * .42, ly + Math.sin(la - .55) * leafLen * .42, lx, ly); ctx.fill();
          ctx.globalAlpha = .32; ctx.strokeStyle = '#d1d0a6'; ctx.lineWidth = .42;
          ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + Math.cos(la) * leafLen, ly + Math.sin(la) * leafLen); ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
}
function drawLeafBlade(x, y, length, width, angle, color, alpha, bend = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-width * .16 + bend * .35, -length * .3, bend, -length);
  ctx.quadraticCurveTo(width * .62 + bend * .42, -length * .76, width * .42, -length * .43);
  ctx.quadraticCurveTo(width * .22, -length * .12, 0, 0);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawForestFloor(level, visibleReach) {
  if (level < 1) return;
  const bladeCounts = [0, 2, 2, 3, 4];
  const colors = ['#000', '#354638', '#435b43', '#526c4d', '#68764f'];
  for (const c of forest.cells) {
    const spacing = level === 1 ? 10 : level === 2 ? 7 : level === 3 ? 5 : 4;
    if (c.id % spacing !== 0) continue;
    if (Math.abs(c.x - camera.x) > visibleReach || Math.abs(c.y - camera.y) > visibleReach) continue;
    if (c.state === 'cleared' || c.state === 'ash' || c.state === 'fire') continue;
    if (!c.original && !forestShape(c.x, c.y)) continue;
    const count = bladeCounts[Math.min(level, 4)];
    const disturbance = foliageBendAt(c.x, c.y);
    const breeze = disturbance.strength ? Math.sin(forest.time * 13 + c.phase) * .055 * disturbance.strength : 0;
    const tuftAngle = c.phase + breeze;
    const lengthBase = WORLD.cell * (.22 + level * .035);
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(tuftAngle);
    for (let i = 0; i < count; i++) {
      const spread = i / Math.max(1, count - 1) - .5;
      const reach = lengthBase * (.7 + ((i * 3 + c.variant) % 5) * .12);
      const bend = Math.sin(forest.time * 12 + c.phase + i * .9) * reach * .14 * disturbance.strength
        + disturbance.x * reach * .62 * disturbance.strength;
      const angle = -Math.PI / 2 + spread * .9 + disturbance.y * .13 * disturbance.strength;
      const color = colors[Math.min(level, 4)];
      drawLeafBlade(spread * WORLD.cell * .12, 2, reach, reach * .24, angle,
        color, .11 + level * .025, bend);
    }
    if (level >= 4 && c.id % 8 === 0) {
      ctx.globalAlpha = .15; ctx.fillStyle = '#8c8660';
      ctx.beginPath(); ctx.ellipse(-5, 3, 2.2, .8, .45 + c.phase, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(5, -2, 1.7, .7, -.55 + c.phase, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}
function drawUnderstory(level, visibleReach) {
  if (level < 2) return;
  const grassColors = ['#000', '#000', '#415a43', '#526b4d', '#68764f'];
  for (const c of forest.cells) {
    if (!c.original || c.state !== 'green' || c.id % (level >= 4 ? 8 : 11) !== 0) continue;
    if (Math.abs(c.x - camera.x) > visibleReach || Math.abs(c.y - camera.y) > visibleReach) continue;
    const disturbance = foliageBendAt(c.x, c.y);
    const angle = c.phase * 1.7;
    const offset = WORLD.cell * .76;
    const x = c.x + Math.cos(angle) * offset, y = c.y + Math.sin(angle) * offset;
    const count = 3 + Math.min(2, level - 2);
    const lengthBase = WORLD.cell * (.2 + level * .03);
    const color = grassColors[Math.min(level, 4)];
    ctx.save(); ctx.translate(x, y);
    for (let i = 0; i < count; i++) {
      const spread = (i - (count - 1) / 2) * .25;
      const length = lengthBase * (.72 + (i % 3) * .12);
      const sway = Math.sin(forest.time * 12 + c.phase + i * .8) * .14 * disturbance.strength;
      const bend = disturbance.x * length * .48 * disturbance.strength + sway * length;
      drawLeafBlade(spread * length * .2, 2, length, length * .3,
        -Math.PI / 2 + spread + sway + disturbance.x * .1 * disturbance.strength,
        color, .16 + level * .018, bend);
    }
    if (level >= 4 && c.id % 6 === 0) {
      ctx.globalAlpha = .42; ctx.fillStyle = '#d0d6a2';
      ctx.beginPath(); ctx.ellipse(-4, -3, 1.1, 1.7, c.phase, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}
function drawForestSigns(visibleReach) {
  // Let signs fade in across several mechanical zoom notches, including mid-transition.
  const t = clamp((camera.scale - ZOOMS[5]) / (ZOOMS[9] - ZOOMS[5]), 0, 1);
  const reveal = t * t * (3 - 2 * t);
  if (reveal <= .005) return;
  for (const sign of forestSigns) {
    if (Math.abs(sign.x - camera.x) > visibleReach || Math.abs(sign.y - camera.y) > visibleReach) continue;
    const sprite = signSprites[sign.spriteIndex % signSprites.length];
    if (!sprite?.complete || !sprite.naturalWidth) continue;
    const target = 20 * sign.scale;
    const fit = target / Math.max(sprite.naturalWidth, sprite.naturalHeight);
    const drawW = sprite.naturalWidth * fit, drawH = sprite.naturalHeight * fit;
    const lean = sign.rotation + (sign.fallen ? (sign.seed % 2 ? .62 : -.58) : 0);
    const sway = Math.sin(forest.time * .8 + sign.seed) * .012;
    ctx.save();
    ctx.globalAlpha = reveal;
    ctx.translate(sign.x, sign.y + (sign.fallen ? 2 : 0));
    ctx.rotate(lean + sway);
    // A broken, dark soil contact follows the ground instead of outlining a floating prop.
    ctx.globalAlpha = reveal * .42;
    ctx.fillStyle = '#020402';
    organicPatchPath(0, 1.5, drawW * .28, 1.45, sign.seed, .58);
    ctx.fill();
    ctx.globalAlpha = reveal;
    // Each source cutout already contains the rusted object and its tangled ground growth.
    ctx.drawImage(sprite, -drawW / 2, -drawH, drawW, drawH);
    // A few local blades overlap the cutout's foot so it sits inside the existing brush.
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const side = i % 2 ? 1 : -1;
      const x = (i - 2) * drawW * .12;
      const h = drawH * (.12 + ((i * 7 + sign.seed) % 5) * .012);
      ctx.globalAlpha = reveal * (.48 + (i % 3) * .08);
      ctx.strokeStyle = i % 2 ? '#789064' : '#9ca77a';
      ctx.lineWidth = .55 + i % 2 * .35;
      ctx.beginPath(); ctx.moveTo(x, 1.5); ctx.quadraticCurveTo(x + side * h * .18, -h * .48, x + side * h * .34, -h); ctx.stroke();
    }
    ctx.restore();
  }
}
function drawBreaks() {
  for (const b of forest.breaks) {
    const age = forest.time - b.time;
    const fade = Math.exp(-age * .48);
    const seed = Math.floor(Math.abs(Math.sin(b.x * 12.9898 + b.y * 78.233) * 1e6));
    ctx.save();
    ctx.globalAlpha = .13 * fade; ctx.fillStyle = '#020302';
    organicPatchPath(b.x, b.y, BREAK_RADIUS * 1.08, BREAK_RADIUS * .9, seed, .42); ctx.fill();
    ctx.globalAlpha = .76 * fade; ctx.strokeStyle = '#111a13'; ctx.lineWidth = 5;
    organicPatchPath(b.x, b.y, BREAK_RADIUS * 1.08, BREAK_RADIUS * .9, seed, .42); ctx.stroke();
    ctx.globalAlpha = .8 * fade; ctx.strokeStyle = '#b9c2a0'; ctx.lineWidth = 1.2; ctx.setLineDash([2.5, 5.5]);
    organicPatchPath(b.x, b.y, BREAK_RADIUS * 1.08, BREAK_RADIUS * .9, seed, .42); ctx.stroke();
    ctx.setLineDash([]); ctx.restore(); ctx.globalAlpha = 1;
    if (age > 7) forest.breaks.splice(forest.breaks.indexOf(b), 1);
  }
}
function drawSmoke(x, y, phase, strength, plumeScale = 1) {
  if (!smokeSpriteSheet.complete || !smokeSpriteSheet.naturalWidth) return;
  const cellW = smokeSpriteSheet.naturalWidth / 4, cellH = smokeSpriteSheet.naturalHeight / 2;
  const time = forest.time;
  const sway = Math.sin(time * 1.18 + phase) * 2.8 + Math.sin(time * 2.35 + phase * 1.7) * .9;
  const variant = Math.floor((time * .34 + phase * .19) * 1.4) % 8;
  const sx = (variant % 4) * cellW, sy = Math.floor(variant / 4) * cellH;
  const breathe = .96 + .045 * Math.sin(time * 1.7 + phase);
  const dw = 48 * plumeScale * breathe, dh = 66 * plumeScale * breathe;

  ctx.save();
  ctx.translate(x + sway, y - .8 + Math.sin(time * .9 + phase) * .8);
  ctx.rotate(Math.sin(time * .43 + phase) * .035 + Math.sin(time * 1.4 + phase) * .012);
  // The painted base stays anchored while its translucent silhouette breathes in the breeze.
  ctx.globalAlpha = strength * (.58 + .08 * Math.sin(time * 1.5 + phase));
  ctx.drawImage(smokeSpriteSheet, sx, sy, cellW, cellH, -dw / 2, -dh, dw, dh);

  // Billows peel off the column, rise, wobble sideways and grow before dissolving.
  const lifeSpan = 2.65;
  for (let i = 0; i < 2; i++) {
    const localTime = time + phase * .43 + i * 1.28;
    const age = (localTime % lifeSpan) / lifeSpan;
    const life = Math.sin(Math.PI * age);
    const puffVariant = (Math.floor(localTime / lifeSpan) * 3 + variant + i * 2) % 8;
    const px = (puffVariant % 4) * cellW, py = Math.floor(puffVariant / 4) * cellH;
    const puffW = (17 + age * 21) * plumeScale;
    const puffH = (24 + age * 30) * plumeScale;
    const side = i === 0 ? -1 : 1;
    const drift = Math.sin(time * (1.05 + i * .16) + phase + i * 2.1) * (3 + age * 5);
    ctx.globalAlpha = strength * .31 * life;
    ctx.drawImage(smokeSpriteSheet, px, py, cellW, cellH * .46,
      side * (5 + age * 8) + drift - puffW / 2,
      -(12 + age * 37) * plumeScale - i * 7,
      puffW, puffH);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}
function drawFireSprites(cluster) {
  if (!fireSpriteSheet.complete || !fireSpriteSheet.naturalWidth) return;
  const cellW = fireSpriteSheet.naturalWidth / 4, cellH = fireSpriteSheet.naturalHeight / 2;
  if (!fireSpriteCutouts) {
    fireSpriteCutouts = [0, 1, 5].map(variant => {
      const sprite = document.createElement('canvas');
      sprite.width = cellW; sprite.height = cellH;
      const spriteCtx = sprite.getContext('2d');
      spriteCtx.drawImage(fireSpriteSheet, variant % 4 * cellW, Math.floor(variant / 4) * cellH,
        cellW, cellH, 0, 0, cellW, cellH);
      // Feather only the soot-heavy foot so the atlas panel never ends in a hard baseline.
      spriteCtx.globalCompositeOperation = 'destination-in';
      const fade = spriteCtx.createLinearGradient(0, cellH * .88, 0, cellH);
      fade.addColorStop(0, 'rgba(0,0,0,1)');
      fade.addColorStop(.48, 'rgba(0,0,0,.92)');
      fade.addColorStop(.82, 'rgba(0,0,0,.48)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      spriteCtx.fillStyle = fade; spriteCtx.fillRect(0, 0, cellW, cellH);
      spriteCtx.globalCompositeOperation = 'source-over';
      return sprite;
    });
  }
  const reach = scopeRadius() / (camera.scale * fitScale()) + 60;
  const trees = cluster.filter(tree => Math.abs(tree.x - camera.x) < reach && Math.abs(tree.y - camera.y) < reach);
  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i];
    // Select atlas panels whose painted flames have safe margins on every side.
    const safeVariants = [0, 1, 5];
    const variantIndex = Math.abs(tree.id * 7 % safeVariants.length);
    const flicker = .94 + Math.sin(forest.time * 5.2 + tree.phase) * .06;
    const shape = fireGeometry(tree);
    const dw = shape.width, dh = shape.height * flicker;
    ctx.save(); ctx.translate(tree.x, shape.baseY);
    const glow = ctx.createRadialGradient(0, 3, 1, 0, 3, dw * 1.14);
    glow.addColorStop(0, 'rgba(255,116,43,.34)'); glow.addColorStop(.38, 'rgba(184,63,26,.17)');
    glow.addColorStop(1, 'rgba(92,33,18,0)');
    ctx.fillStyle = glow; organicPatchPath(0, 3, dw * 1.02, dw * .38, tree.id * 73 + 9, .62); ctx.fill();
    ctx.globalAlpha = .92;
    ctx.drawImage(fireSpriteCutouts[variantIndex], -dw / 2, -dh * .94, dw, dh);
    ctx.restore(); ctx.globalAlpha = 1;
  }
}
function drawFireEmbers(cluster) {
  // Small ember trails rise irregularly from the burning edge and fade into the canopy.
  const emitters = fireEmberTrees(cluster);
  for (let i = 0; i < emitters.length; i++) {
    const tree = emitters[i];
    for (let j = 0; j < 2; j++) {
      const phase = tree.phase * .17 + j * .47 + (tree.id % 9) * .13;
      const age = ((forest.time * (.52 + (tree.id % 4) * .035) + phase) % 1 + 1) % 1;
      const life = Math.sin(Math.PI * age);
      if (life < .08) continue;
      const drift = Math.sin(age * 5.2 + phase) * (WORLD.cell * (.12 + age * .16));
      const x = tree.x + drift + (j ? WORLD.cell * .12 : -WORLD.cell * .1);
      const y = tree.y + 3 - age * WORLD.cell * (1.05 + (tree.id % 3) * .18);
      const size = (1.1 + (tree.id % 3) * .25) * (1 - age * .42);
      const alpha = life * (.42 + .2 * Math.sin(forest.time * 13 + phase));
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.shadowColor = '#f47a36'; ctx.shadowBlur = 2.2;
      ctx.strokeStyle = j ? '#ffbd68' : '#ef5c32'; ctx.lineWidth = Math.max(.7, size * .72);
      ctx.beginPath(); ctx.moveTo(x, y + size * 1.8);
      ctx.lineTo(x + drift * .12, y - size * 1.8); ctx.stroke();
      ctx.fillStyle = '#ffe3a0'; ctx.beginPath(); ctx.arc(x, y, size * .54, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}
function drawFire() {
  // Distant smoke is only a lead. A false plume clears as the telescope resolves the scene.
  for (const signal of forest.smokeSignals) {
    if (!signal.fake) continue;
    // Keep the smoke plume behind its hidden source so the revealed toaster reads clearly.
    // Keep false leads visible through the first close look, then let them recede gradually.
    const visibility = clamp(1.15 - Math.max(0, camera.scale - ZOOMS[3]) * .11, .42, 1);
    const pulse = .72 + .28 * Math.sin(forest.time * .7 + signal.phase);
    drawSmoke(signal.x, signal.y, signal.phase, .86 * pulse * visibility);
    // Resolve a false smoke lead into its toaster only after the first close stage.
    if (camera.zoomIndex >= 2) drawFalseSmokeSource(signal);
  }
  for (const cluster of collectFireClusters()) {
    const phase = cluster[0].phase;
    const representativeCount = Math.min(3, Math.max(1, Math.ceil(cluster.length / 16)));
    const ordered = [...cluster].sort((a, b) => a.id - b.id);
    for (let i = 0; i < representativeCount; i++) {
      const tree = ordered[Math.floor((i + .5) * ordered.length / representativeCount) % ordered.length];
      const smokeScale = .72 + (tree.id % 4) * .045;
      drawSmoke(tree.x, tree.y - 3, tree.phase, .8, smokeScale);
    }
    if (isFireClusterVisible(cluster)) {
      drawFireSprites(cluster);
      drawFireEmbers(cluster);
    }
  }
  for (const tree of forest.trees) {
    if (camera.zoomIndex >= 3 && !zooming() && tree.state === 'green' && tree.heat > .15) {
      ctx.globalAlpha = tree.heat * .4; ctx.fillStyle = palette.ember; ctx.beginPath(); ctx.arc(tree.x, tree.y, 3 + tree.heat * 4, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    }
  }
}
function collectFireClusters() {
  const visited = new Set(), clusters = [];
  for (const tree of forest.trees) {
    if (tree.state !== 'fire' || visited.has(tree.id)) continue;
    const cluster = [], queue = [tree]; visited.add(tree.id);
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]; cluster.push(current);
      for (const id of current.neighbors) {
        const next = forest.cells[id];
        if (next.state !== 'fire' || visited.has(id)) continue;
        visited.add(id); queue.push(next);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}
function drawToasterBread(drawW, drawH, spriteIndex) {
  // Actual slot endpoints in each source image define the bread's perspective.
  const slots = [
    [127, 54, 164, 64, 27, .07], [94, 119, 157, 106, 34, .03],
    [91, 114, 147, 100, 33, -.03], [117, 90, 150, 82, 30, .02],
    [90, 114, 149, 89, 33, -.10], [86, 94, 135, 74, 31, -.06]
  ];
  const sprite = toasterSprites[spriteIndex % toasterSprites.length];
  const [ax, ay, bx, by, lift, lean] = slots[spriteIndex % slots.length];
  const sx = drawW / sprite.naturalWidth, sy = drawH / sprite.naturalHeight;
  const ox = -drawW / 2, oy = -drawH;
  ctx.save();
  // Shear the face along the slot while keeping its upright edges aligned to the body.
  ctx.transform((bx - ax) * sx / .86, (by - ay) * sy / .86,
    lift * lean * sx, lift * sy, ox + (ax + bx) * .5 * sx, oy + (ay + by) * .5 * sy);
  // One exposed slice, with a rounded crown, toasted crust and a soft crumb face.
  ctx.beginPath(); ctx.moveTo(-.43, .02); ctx.lineTo(-.43, -.56);
  ctx.bezierCurveTo(-.65, -.67, -.59, -.96, -.26, -1);
  ctx.bezierCurveTo(-.09, -1.04, .11, -1.03, .27, -.99);
  ctx.bezierCurveTo(.59, -.94, .64, -.67, .43, -.56);
  ctx.lineTo(.43, .02); ctx.closePath();
  const crumb = ctx.createLinearGradient(0, -1, 0, 0);
  crumb.addColorStop(0, '#e7d8b7'); crumb.addColorStop(.6, '#dfcba3'); crumb.addColorStop(1, '#b48b59');
  ctx.fillStyle = crumb; ctx.fill();
  ctx.strokeStyle = '#a46c34'; ctx.lineWidth = .055; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.save(); ctx.clip();
  const grain = random(4127 + spriteIndex * 97);
  for (let i = 0; i < 95; i++) {
    const px = grain() - .5, py = -grain();
    ctx.fillStyle = i % 3 === 0 ? 'rgba(246,229,190,.28)' : 'rgba(130,87,43,.26)';
    ctx.beginPath();
    ctx.ellipse(px, py, .015 + grain() * .045, .008 + grain() * .035, grain() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(136,83,39,.38)';
  for (const [px, py, size] of [[-.22,-.69,.025],[.12,-.79,.025],[.25,-.42,.03],[-.12,-.29,.025],[.02,-.54,.035],[-.28,-.47,.02]]) {
    ctx.beginPath(); ctx.ellipse(px, py, size, size * .7, px * 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // Redraw the original metal lip over the lower crust so the slice enters the slot.
  ctx.save(); ctx.beginPath();
  ctx.moveTo(ox + (ax - 3) * sx, oy + (ay - 1.5) * sy);
  ctx.lineTo(ox + (bx + 3) * sx, oy + (by - 1.5) * sy);
  ctx.lineTo(ox + (bx + 3) * sx, oy + (by + 7) * sy);
  ctx.lineTo(ox + (ax - 3) * sx, oy + (ay + 7) * sy); ctx.closePath(); ctx.clip();
  ctx.filter = 'saturate(1.55) brightness(1.16) contrast(1.08)';
  ctx.drawImage(sprite, ox, oy, drawW, drawH);
  ctx.restore();
}
function drawFalseSmokeSource(signal) {
  // Smoke can be a false lead: resolve it into one of the actual salvaged toaster sprites.
  if (!signal.robotLook) {
    const seed = Math.floor(Math.abs(Math.sin(signal.phase * 981.73) * 4294967295)) || 1;
    const choose = random(seed);
    signal.robotLook = {
      spriteIndex: Math.floor(choose() * toasterSprites.length),
      scale: .86 + choose() * .28,
      flip: choose() > .5 ? 1 : -1,
      tilt: (choose() - .5) * .12,
      seed
    };
  }
  const look = signal.robotLook;
  const sprite = toasterSprites[look.spriteIndex % toasterSprites.length];
  if (!sprite?.complete || !sprite.naturalWidth) return;
  const scale = camera.scale;
  const reveal = 1;
  const target = (scale < ZOOMS[8]
    ? 9 + clamp((scale - ZOOMS[5]) / (ZOOMS[8] - ZOOMS[5]), 0, 1) * 4
    : scale < ZOOMS[11]
      ? 13 + clamp((scale - ZOOMS[8]) / (ZOOMS[11] - ZOOMS[8]), 0, 1) * 3
      : 16 + clamp((scale - ZOOMS[11]) / (ZOOMS[12] - ZOOMS[11]), 0, 1) * 2) * look.scale;
  const fit = target * (.68 + .32 * reveal) / Math.max(sprite.naturalWidth, sprite.naturalHeight);
  const drawW = sprite.naturalWidth * fit, drawH = sprite.naturalHeight * fit;
  const bob = Math.sin(forest.time * 4.6 + signal.phase) * .34;
  ctx.save();
  ctx.translate(signal.x, signal.y + bob);
  ctx.rotate(look.tilt + Math.sin(forest.time * 1.5 + signal.phase) * .018);
  ctx.scale(look.flip, 1);
  // The cutout's own feet and weeds meet a subtle irregular ground shadow.
  ctx.globalAlpha = .42;
  ctx.fillStyle = '#020302';
  organicPatchPath(0, 1.4, drawW * .3, 1.35, look.seed, .52);
  ctx.fill();
  ctx.globalAlpha = reveal;
  ctx.filter = 'saturate(1.55) brightness(1.16) contrast(1.08)';
  ctx.drawImage(sprite, -drawW / 2, -drawH, drawW, drawH);
  ctx.filter = 'none';
  drawToasterBread(drawW, drawH, look.spriteIndex);
  ctx.restore();
}
function drawAnimal(a) {
  const spriteIndex = (a.id * 5 + a.kind * 3) % creatureSprites.length;
  const sprite = creatureSprites[spriteIndex];
  if (!sprite?.complete || !sprite.naturalWidth) return;
  const moving = a.state === 'walking';
  const following = a.state === 'walking', waiting = a.state === 'waiting';
  const stage = Math.max(1, Math.min(4, camera.zoomIndex));
  const maxDimension = stage === 2
    ? (a.small ? 9 : 13)
    : stage === 3 ? (a.small ? 12 : 18)
      : stage === 4 ? (a.small ? 10 : 14) : (a.small ? 7 : 10);
  const naturalMax = Math.max(sprite.naturalWidth, sprite.naturalHeight);
  const fit = maxDimension / naturalMax;
  const drawW = sprite.naturalWidth * fit, drawH = sprite.naturalHeight * fit;
  const breath = 1 + Math.sin(forest.time * (moving ? 5.2 : 1.8) + a.phase) * (moving ? .012 : .01);
  const bob = waiting ? 0 : Math.sin(forest.time * (moving ? 6.2 : 1.7) + a.phase) * (moving ? .12 : .14);
  const sway = waiting ? 0 : Math.sin(forest.time * (moving ? 3.1 : .7) + a.phase * 1.3) * (moving ? .022 : .03);
  const clickAge = forest.time - (a.joinedAt ?? -10);
  const clickPulse = following && clickAge < .5 ? Math.sin(clickAge / .5 * Math.PI) : 0;
  ctx.save(); ctx.translate(a.x, a.y + bob); ctx.rotate(sway); ctx.scale(breath, breath);
  ctx.scale(1 + clickPulse * .18, 1 + clickPulse * .18);
  ctx.globalAlpha = a.state === 'saved' ? .88 : 1;
  if (following || waiting) {
    const pulse = following ? .5 + .5 * Math.sin(forest.time * 5 + a.phase) : 0;
    ctx.shadowColor = following ? '#a7ffd8' : '#efc882';
    ctx.shadowBlur = following ? 8 + pulse * 6 + clickPulse * 10 : 5;
  }
  // Reference-sheet creatures stay botanically illustrated at every depth;
  // deeper zoom changes their apparent scale, not their rendering style.
  ctx.drawImage(sprite, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.shadowBlur = 0;
  if (following || waiting) {
    // Shape as well as color distinguishes an active follower from a waiting animal.
    // Keep markers small on screen, even at the deepest magnification.
    const markerUnit = 1 / (camera.scale * fitScale() * breath * (1 + clickPulse * .18));
    const markerY = -drawH / 2 - 5 * markerUnit;
    ctx.fillStyle = following ? '#baffdf' : '#efc882';
    ctx.beginPath();
    if (following) {
      ctx.moveTo(-2.5 * markerUnit, markerY - 1.5 * markerUnit);
      ctx.lineTo(2.5 * markerUnit, markerY - 1.5 * markerUnit);
      ctx.lineTo(0, markerY + 2 * markerUnit);
      ctx.closePath();
    } else {
      ctx.arc(0, markerY, 1.5 * markerUnit, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.restore(); ctx.globalAlpha = 1;
}
function animalAppearance(a) {
  if (a.state === 'lost') return 'hidden';
  if (a.state === 'saved') return camera.zoomIndex >= 4 || forest.ended ? 'body' : 'hidden';
  if (!a.revealed || camera.zoomIndex < 3) return 'hidden';
  return camera.zoomIndex === 3 ? 'eyes' : 'body';
}
function drawAnimalEyes(a) {
  const screenScale = camera.scale * fitScale();
  const radius = clamp(screenScale * .65, 1.4, 2.4) * 1.3 / screenScale;
  const blinkPhase = (forest.time + a.phase * 1.7) % 4.8;
  ctx.save(); ctx.translate(a.x, a.y - 1);
  // A single soft glint hints at a creature, without inventing a second eye shape.
  ctx.globalAlpha = (blinkPhase < .16 ? .25 : 1) * (.84 + .16 * Math.sin(forest.time * 1.5 + a.phase));
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 2.8);
  glow.addColorStop(0, 'rgba(249,245,217,.98)');
  glow.addColorStop(.2, 'rgba(232,226,184,.85)');
  glow.addColorStop(.48, 'rgba(193,204,158,.3)');
  glow.addColorStop(1, 'rgba(193,204,158,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, radius * 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawAnimals(behindCanopy = false) {
  if (zooming() || behindCanopy) return;
  const viewW = width / (camera.scale * fitScale()), viewH = height / (camera.scale * fitScale());
  for (const a of forest.animals) {
    const appearance = animalAppearance(a);
    if (appearance === 'hidden') continue;
    if (Math.abs(a.x - camera.x) > viewW / 2 + 20 || Math.abs(a.y - camera.y) > viewH / 2 + 20) continue;
    if (appearance === 'eyes') drawAnimalEyes(a);
    else drawAnimal(a);
  }
}
function cursorStroke(path, color = '#e4e8d3', width = 1.7) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); path(); ctx.strokeStyle = '#050806'; ctx.lineWidth = width + 4.5; ctx.stroke();
  ctx.beginPath(); path(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
function drawObserveCursor() {
  cursorStroke(() => {
    ctx.moveTo(-6, 0); ctx.lineTo(-2.5, 0);
    ctx.moveTo(2.5, 0); ctx.lineTo(6, 0);
    ctx.moveTo(0, -6); ctx.lineTo(0, -2.5);
    ctx.moveTo(0, 2.5); ctx.lineTo(0, 6);
  }, '#dce3cf', 1.2);
}
function drawExtinguisherCursor() {
  ctx.save();
  ctx.beginPath(); ctx.moveTo(-3, -3); ctx.lineTo(-3, -7); ctx.lineTo(1, -7); ctx.lineTo(1, -4); ctx.lineTo(4, -4); ctx.quadraticCurveTo(8, -4, 7, 0);
  ctx.strokeStyle = '#050806'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.strokeStyle = '#e5e7d4'; ctx.lineWidth = 1.7; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-3, -3); ctx.lineTo(2.5, -3); ctx.lineTo(3, 6); ctx.quadraticCurveTo(0, 9, -3, 6); ctx.closePath();
  ctx.fillStyle = '#bd4d37'; ctx.fill(); ctx.strokeStyle = '#050806'; ctx.lineWidth = 4.8; ctx.stroke();
  ctx.strokeStyle = '#f0ddc2'; ctx.lineWidth = 1.5; ctx.stroke();
  cursorStroke(() => { ctx.moveTo(7, -1); ctx.lineTo(11, -3); ctx.moveTo(8, 1); ctx.lineTo(13, 1); ctx.moveTo(7, 3); ctx.lineTo(11, 5); }, '#e4e8d3', 1.5);
  ctx.restore();
}
function drawRescueCursor() {
  cursorStroke(() => {
    ctx.moveTo(-5, 4); ctx.lineTo(-5, -2); ctx.quadraticCurveTo(-5, -4, -3, -4);
    ctx.lineTo(-3, 0); ctx.lineTo(-2, -7); ctx.quadraticCurveTo(0, -9, 1, -7);
    ctx.lineTo(1, -1); ctx.lineTo(3, -6); ctx.quadraticCurveTo(5, -7, 5, -4);
    ctx.lineTo(4, 2); ctx.quadraticCurveTo(3, 7, -1, 8); ctx.lineTo(-5, 4);
  }, '#dce5ce', 1.7);
}
function drawPanCursor() {
  cursorStroke(() => {
    ctx.moveTo(0, -10); ctx.lineTo(0, 10); ctx.moveTo(-10, 0); ctx.lineTo(10, 0);
    ctx.moveTo(0, -10); ctx.lineTo(-3, -6); ctx.moveTo(0, -10); ctx.lineTo(3, -6);
    ctx.moveTo(0, 10); ctx.lineTo(-3, 6); ctx.moveTo(0, 10); ctx.lineTo(3, 6);
    ctx.moveTo(-10, 0); ctx.lineTo(-6, -3); ctx.moveTo(-10, 0); ctx.lineTo(-6, 3);
    ctx.moveTo(10, 0); ctx.lineTo(6, -3); ctx.moveTo(10, 0); ctx.lineTo(6, 3);
  }, '#e4e8d3', 1.6);
}
function drawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.globalAlpha = p.life / p.max; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
let roadTrailCache = { revision: -1, trails: [] };
function simplifyRoadTrail(points) {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]), pending = [[0, points.length - 1]];
  while (pending.length) {
    const [first, last] = pending.pop(); let furthest = -1, maxDistance = ROAD_CELL * .55;
    for (let i = first + 1; i < last; i++) {
      const closest = distanceToSegment(points[i], points[first], points[last]);
      const d = distance(points[i], closest);
      if (d > maxDistance) { maxDistance = d; furthest = i; }
    }
    if (furthest !== -1) { keep.add(furthest); pending.push([first, furthest], [furthest, last]); }
  }
  return [...keep].sort((a, b) => a - b).map(i => points[i]);
}
function roadTrails() {
  if (roadTrailCache.revision === forest.roadRevision) return roadTrailCache.trails;
  const neighbors = new Map([...forest.roads].map(id => [id, forest.roadNeighbors(id).filter(n => forest.roads.has(n))]));
  const visited = new Set(), trails = [];
  const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const trace = (start, next) => {
    const ids = [start]; let previous = start, current = next;
    while (!visited.has(edgeKey(previous, current))) {
      visited.add(edgeKey(previous, current)); ids.push(current);
      const links = neighbors.get(current);
      if (links.length !== 2) break;
      const following = links.find(id => id !== previous);
      previous = current; current = following;
    }
    trails.push(ids);
  };
  for (const [id, links] of neighbors) {
    if (!links.length) trails.push([id]);
    if (links.length === 2) continue;
    for (const next of links) if (!visited.has(edgeKey(id, next))) trace(id, next);
  }
  // Closed loops have no endpoints, but still need a continuous trail.
  for (const [id, links] of neighbors) {
    for (const next of links) if (!visited.has(edgeKey(id, next))) trace(id, next);
  }
  roadTrailCache = { revision: forest.roadRevision, trails: trails.map(ids => simplifyRoadTrail(ids.map(id => {
    const p = forest.roadPoint(id);
    return { x: p.x + Math.sin(id * 1.73) * .35, y: p.y + Math.cos(id * .91) * .35 };
  }))) };
  return roadTrailCache.trails;
}
function drawRoadsAndSafeZones(visibleReach) {
  ctx.save(); ctx.globalAlpha = 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const points of roadTrails()) {
    if (!points.some(p => Math.abs(p.x - camera.x) < visibleReach && Math.abs(p.y - camera.y) < visibleReach)) continue;
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 1) ctx.lineTo(points[0].x + .1, points[0].y);
    else {
      for (let i = 1; i < points.length - 1; i++) {
        const p = points[i], next = points[i + 1];
        ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
      }
      const end = points[points.length - 1]; ctx.lineTo(end.x, end.y);
    }
    // Match the refuge rings; keep dashes light and legible at every magnification.
    const screenScale = camera.scale * fitScale();
    ctx.setLineDash([3 / screenScale, 6 / screenScale]);
    ctx.lineWidth = 1.7 / screenScale;
    ctx.strokeStyle = '#dfbf70';
    ctx.shadowColor = 'rgba(222,179,82,.35)'; ctx.shadowBlur = 3;
    ctx.stroke();
    ctx.shadowBlur = 0; ctx.setLineDash([]);
  }
  for (const zone of forest.safeZones) {
    ctx.fillStyle = 'rgba(78,116,82,.3)';
    organicPatchPath(zone.x, zone.y, 32, 27, zone.id + 918, .25); ctx.fill();
    ctx.fillStyle = 'rgba(144,171,123,.14)';
    organicPatchPath(zone.x, zone.y, 24, 19, zone.id + 234, .25); ctx.fill();
  }
  ctx.restore();
}
function drawRoadCursor() {
  cursorStroke(() => {
    ctx.moveTo(-6, 8); ctx.lineTo(-3, -5); ctx.lineTo(4, -9);
    ctx.moveTo(1, 10); ctx.lineTo(4, 0); ctx.lineTo(9, -4);
  }, '#e8dba5', 1.8);
}
function drawWaterMeter() {
  for (let i = 0; i < WATER_CAPACITY; i++) {
    const x = -10 + i * 10, y = 21;
    const amount = i < forest.water ? 1 : i === forest.water ? forest.waterRefill / WATER_REFILL_SECONDS : 0;
    ctx.save(); ctx.translate(x, y);
    ctx.beginPath(); ctx.moveTo(0, -4); ctx.bezierCurveTo(-7, 2, -3, 7, 0, 7);
    ctx.bezierCurveTo(3, 7, 7, 2, 0, -4); ctx.closePath();
    ctx.fillStyle = '#071311'; ctx.fill(); ctx.strokeStyle = forest.water ? '#8cbcbc' : '#ba8c69'; ctx.lineWidth = 1; ctx.stroke();
    ctx.clip(); ctx.fillStyle = '#a1dce0'; ctx.fillRect(-5, 7 - amount * 11, 10, amount * 11);
    ctx.restore();
  }
}
function drawRoadOverlay() {
  const r = scopeRadius(), cx = width / 2, cy = scopeCenterY();
  ctx.save();
  // Direction markers stay at the edge when a refuge is outside the current lens.
  for (const zone of forest.safeZones) {
    const p = worldToScreen(zone.x, zone.y), dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy);
    const offscreen = d > r - 16;
    const x = offscreen ? cx + dx / d * (r - 16) : p.x;
    const y = offscreen ? cy + dy / d * (r - 16) : p.y;
    ctx.save(); ctx.translate(x, y);
    // Screen-sized rings stay legible from the widest observation stage.
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(181,140,55,.13)'; ctx.fill();
    ctx.strokeStyle = '#dfbf70'; ctx.lineWidth = 1.8;
    ctx.shadowColor = 'rgba(222,179,82,.55)'; ctx.shadowBlur = 7; ctx.stroke();
    ctx.shadowBlur = 0;
    if (offscreen) {
      ctx.save(); ctx.rotate(Math.atan2(dy, dx)); ctx.beginPath(); ctx.moveTo(-3, -3); ctx.lineTo(2, 0); ctx.lineTo(-3, 3); ctx.stroke(); ctx.restore();
    }
    ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#dfbf70';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
    const saved = forest.animals.filter(a => a.state === 'saved' && a.zoneId === zone.id).length;
    if (saved) ctx.fillText(String(saved), 0, -17);
    ctx.restore();
  }
  if (camera.zoomIndex >= 4 && !zooming()) {
    for (const handle of roadHandles()) {
      const hovered = pointer.inside && Math.hypot(pointer.x - handle.x, pointer.y - handle.y) < 27;
      ctx.save(); ctx.translate(handle.x, handle.y);
      // A solid gold action tile stays distinct from foliage and the thin refuge rings.
      ctx.shadowColor = '#020604'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
      ctx.fillStyle = hovered ? '#ffe5a2' : '#dfbf70';
      ctx.strokeStyle = hovered ? '#fff5cf' : '#fff0bb'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.roundRect(-18, -18, 36, 36, 7); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.strokeStyle = '#24321f'; ctx.fillStyle = '#24321f';
      ctx.lineWidth = 2.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // Starting point, bent trail, and arrow describe making a route.
      ctx.beginPath(); ctx.arc(-8, 9, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-8, 3); ctx.lineTo(-8, -1);
      ctx.quadraticCurveTo(-8, -5, -3, -5); ctx.lineTo(9, -5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(4, -10); ctx.lineTo(9, -5); ctx.lineTo(4, 0); ctx.stroke();
      ctx.restore();
    }
    if (roadTool && pointer.inside && !dragState?.moved) {
      const start = worldToScreen(roadTool.anchor.x, roadTool.anchor.y);
      const target = { x: pointer.worldX, y: pointer.worldY };
      const end = forest.traceRoadSegment(roadTool.anchor, target);
      const screenEnd = worldToScreen(end.x, end.y);
      const blocked = forest.roadCellAt(end.x, end.y).id !== forest.roadCellAt(target.x, target.y).id;
      ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(screenEnd.x, screenEnd.y);
      ctx.strokeStyle = 'rgba(223,191,112,.6)'; ctx.stroke();
      if (blocked) {
        ctx.beginPath(); ctx.moveTo(screenEnd.x, screenEnd.y); ctx.lineTo(pointer.x, pointer.y);
        ctx.strokeStyle = '#d87963'; ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = '#e4d7a2'; ctx.beginPath(); ctx.arc(start.x, start.y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function drawSky() {
  drawRoadOverlay();
  if (!pointer.inside) return;
  const near = nearestRoadHandle(pointer.x, pointer.y);
  const fireTarget = nearestVisibleFireEmber(pointer.x, pointer.y);
  const nearFire = !!fireTarget;
  const nearToaster = !!nearestVisibleToaster(pointer.x, pointer.y);
  const s = camera.scale * fitScale();
  ctx.save(); ctx.translate(pointer.x, pointer.y);
  // Show the water footprint only when a real, visible ember can be targeted.
  if (!zooming() && !dragState?.moved && nearFire) {
    const center = worldToScreen(fireTarget.x, fireTarget.y);
    const dx = center.x - pointer.x, dy = center.y - pointer.y;
    ctx.beginPath(); ctx.arc(dx, dy, BREAK_RADIUS * s, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(5,8,6,.96)'; ctx.lineWidth = 5; ctx.stroke();
    ctx.beginPath(); ctx.arc(dx, dy, BREAK_RADIUS * s, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(220,235,211,.98)'; ctx.lineWidth = 2.2; ctx.stroke();
  }
  // Cursors describe the action at the pointer, independently of stage icons.
  ctx.scale(1.05, 1.05);
  if (zooming()) {
    drawObserveCursor();
  } else if (dragState?.moved) {
    drawPanCursor();
  } else if (nearFire) {
    drawExtinguisherCursor();
  } else if ((roadTool || nearestRoadPoint(pointer.x, pointer.y)) && camera.zoomIndex >= 4) {
    drawRoadCursor();
  } else if (near || nearToaster) {
    drawRescueCursor();
  } else {
    drawObserveCursor();
  }
  drawWaterMeter();
  ctx.restore();
}

function drawScope() {
  const cx = width / 2, cy = scopeCenterY(), r = scopeRadius();
  // A single circular aperture makes the whole scene read as the telescope view.
  ctx.save();
  ctx.fillStyle = '#030604';
  ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.arc(cx, cy, r, 0, Math.PI * 2, true); ctx.fill('evenodd');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(2,5,3,.96)'; ctx.lineWidth = 12; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(178,195,168,.58)'; ctx.lineWidth = 1.4; ctx.stroke();
  drawZoomStepMarks(cx, cy, r);
  ctx.restore();
}

function drawZoomStepMarks(cx, cy, r) {
  // A continuous outer ring, twelve fine ratchets, and four strong detents show
  // both the mechanical steps and the four major magnification stages.
  const start = .22, end = 2.9, radius = r + 16;
  let progress = 0;
  const scale = clamp(camera.scale, ZOOMS[0], ZOOMS[ZOOMS.length - 1]);
  for (let i = 0; i < ZOOMS.length - 1; i++) {
    if (scale <= ZOOMS[i + 1]) {
      const a = Math.log(ZOOMS[i]), b = Math.log(ZOOMS[i + 1]);
      const within = (Math.log(scale) - a) / (b - a);
      progress = (i + clamp(within, 0, 1)) / (ZOOMS.length - 1);
      break;
    }
    progress = 1;
  }
  const angle = start + (end - start) * progress;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, radius, start, end);
  ctx.strokeStyle = 'rgba(183,197,172,.58)'; ctx.lineWidth = 1.35; ctx.stroke();
  for (let i = 0; i < ZOOMS.length; i++) {
    const tickAngle = start + (end - start) * i / (ZOOMS.length - 1);
    const major = i % 3 === 0;
    const active = major && i === currentStage() * 3;
    const inner = radius - (major ? 10 : 3.5), outer = radius + (major ? 10 : 3.5);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(tickAngle) * inner, cy + Math.sin(tickAngle) * inner);
    ctx.lineTo(cx + Math.cos(tickAngle) * outer, cy + Math.sin(tickAngle) * outer);
    ctx.strokeStyle = active ? '#f0edcf' : major ? 'rgba(220,225,202,.94)' : 'rgba(200,210,186,.64)';
    ctx.lineWidth = major ? 2.5 : 1; ctx.stroke();
    if (major) {
      ctx.beginPath(); ctx.arc(cx + Math.cos(tickAngle) * (radius + 15), cy + Math.sin(tickAngle) * (radius + 15), active ? 3.3 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#f0edcf' : 'rgba(200,210,186,.76)'; ctx.fill();
    }
  }
  drawZoomStageIcons(cx, cy, r, start, end, radius);
  const px = cx + Math.cos(angle) * radius, py = cy + Math.sin(angle) * radius;
  ctx.shadowColor = '#dce7c3'; ctx.shadowBlur = zooming() ? 11 : 6;
  ctx.fillStyle = '#f0edcf'; ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(240,237,207,.9)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(px, py, 5.5, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function currentStage() { return Math.max(1, camera.zoomIndex); }
function drawStageGlyph(stage, active = false) {
  const icon = stageIcons[stage - 1];
  if (!icon?.raster) return;
  const scale = 30 / Math.max(icon.w, icon.h);
  const w = icon.w * scale, h = icon.h * scale;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = active ? 1 : .72;
  ctx.filter = 'brightness(3.5)';
  ctx.drawImage(icon.raster, -w / 2, -h / 2, w, h);
  ctx.restore();
}
function drawZoomStageIcons(cx, cy, r, start, end, radius) {
  const stage = currentStage();
  for (let n = 1; n <= 4; n++) {
    const a = start + (end - start) * (n - .5) / 4;
    const x = cx + Math.cos(a) * (radius + 30);
    const y = cy + Math.sin(a) * (radius + 30);
    const active = stage === n;
    ctx.save(); ctx.translate(x, y);
    drawStageGlyph(n, active);
    ctx.restore();
  }
}
function pulseCounter(reason = 'rescue') {
  counter.classList.remove('pulse-rescue', 'pulse-loss');
  void counter.offsetWidth;
  counter.classList.add(reason === 'loss' ? 'pulse-loss' : 'pulse-rescue');
  lastPulse = performance.now();
}

function update(dt) {
  updateCamera(dt);
  const cursorWorld = screenToWorld(pointer.x, pointer.y);
  pointer.worldX = cursorWorld.x; pointer.worldY = cursorWorld.y;
  forest.update(dt);
  roadDone.hidden = !roadTool;
  // Bend each visible hiding patch once, regardless of how many animals share it.
  activeHiddenAnimals = [];
  if (camera.zoomIndex >= 3) {
    const reach = scopeRadius() / (camera.scale * fitScale()) + WORLD.cell * 3;
    const groups = new Set();
    for (const animal of forest.animals) {
      if (animal.state !== 'idle' || animal.revealed || groups.has(animal.groupId)) continue;
      if (Math.abs(animal.x - camera.x) > reach || Math.abs(animal.y - camera.y) > reach) continue;
      groups.add(animal.groupId);
      activeHiddenAnimals.push(animal);
    }
  }
  sound.update(dt, {
    view: { x: camera.x, y: camera.y, radius: scopeRadius() / (camera.scale * fitScale()) },
    trees: forest.trees, toasters: forest.smokeSignals, hidden: activeHiddenAnimals,
    signs: forestSigns, probe: { x: pointer.worldX, y: pointer.worldY, inside: pointer.inside },
    stage: camera.zoomIndex, zooming: zooming(), time: forest.time, ended: forest.ended
  });
  for (let i = brushTraces.length - 1; i >= 0; i--) {
    if (forest.time - brushTraces[i].time > 1.35) brushTraces.splice(i, 1);
  }
  if (forest.events.length) {
    for (const event of forest.events.splice(0)) {
      if (event.type === 'count') { counter.textContent = String(Math.max(0, event.remaining)).padStart(3, '0'); pulseCounter(event.reason); }
      else if (event.type === 'outcome') pulseCounter(event.result === 'lost' ? 'loss' : 'rescue');
      else if (event.type === 'end') { endTime = performance.now(); endRoadTool(); }
      else if (event.type === 'burned') burst(event.x, event.y, 14, '#e78851', 25);
      else if (event.type === 'blocked') burst(event.x, event.y, 5, '#b9b59f', 20);
    }
  }
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .99; p.vy *= .99; p.life -= dt; }
  if (forest.ended && camera.zoomStep !== 0 && performance.now() - endTime > 1000) {
    camera.zoomIndex = 1; camera.zoomStep = 0; camera.fromX = camera.x; camera.fromY = camera.y; camera.fromScale = camera.scale;
    camera.toScale = ZOOMS[0]; camera.toX = WORLD.width / 2; camera.toY = WORLD.height / 2; camera.elapsed = 0; camera.duration = 4.2;
  }
}
function frame(now) {
  const dt = Math.min(.05, (now - previous) / 1000); previous = now;
  update(dt); drawBackground(); drawForestBase(); drawSky(); drawScope();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
