const WORLD = { width: 1500, height: 1000, cell: 19, cols: 79, rows: 53 };
const ANIMAL_COUNT = 19;
const BREAK_RADIUS = 28;
const ROAD_CELL = WORLD.cell / 3;
const ROAD_COLS = WORLD.cols * 3, ROAD_ROWS = WORLD.rows * 3;
const WATER_CAPACITY = 3;
const WATER_REFILL_SECONDS = 10;
// Four visual information bands, with three mechanical notches between each.
const ZOOMS = [1, 1.28, 1.64, 2.1, 2.44, 2.84, 3.3, 3.83, 4.46, 5.2, 6.03, 6.99, 8.1];
function random(seed) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function insideForestPerimeter(x, y) {
  const nx = (x - 740) / 630, ny = (y - 480) / 338;
  const angle = Math.atan2(ny, nx);
  const edge = 1 + .075 * Math.sin(angle * 5 + 1) + .06 * Math.sin(angle * 9 - 2);
  return nx * nx + ny * ny < edge * edge;
}
function forestShape(x, y) {
  const meadow = ((x - 1050) / 140) ** 2 + ((y - 730) / 95) ** 2 < 1;
  return insideForestPerimeter(x, y) && !meadow;
}

// Shared by the painted flames, extinguishing targets and damage checks.
function fireGeometry(tree) {
  const width = 40 * (.76 + (tree.id % 5) * .045);
  const height = width * 4 / 3;
  return { x: tree.x, y: tree.y + 7 - height * .44,
    rx: width * .5, ry: height * .5, width, height, baseY: tree.y + 7 };
}
function pointInFire(tree, x, y, padding = 0) {
  const f = fireGeometry(tree);
  const flame = ((x - f.x) / (f.rx + padding)) ** 2 + ((y - f.y) / (f.ry + padding)) ** 2 <= 1;
  // Burning fuel remains dangerous at its ground footprint as well as in the flames.
  const left = tree.col * WORLD.cell, top = tree.row * WORLD.cell;
  return flame || (x >= left - padding && x <= left + WORLD.cell + padding && y >= top - padding && y <= top + WORLD.cell + padding);
}

class Forest {
  constructor(seed = Math.floor(Math.random() * 0x100000000)) {
    const rng = random(seed);
    this.time = 0; this.remaining = ANIMAL_COUNT; this.saved = 0; this.lost = 0;
    this.ended = false; this.revision = 0; this.events = [];
    this.trees = []; this.cells = []; this.breaks = []; this.animals = [];
    this.roads = new Set();
    this.roadOrder = new Map(); this.roadSequence = 0;
    this.roadRevision = 0; this.navigationRevision = -1;
    this.roadNext = new Map(); this.roadZone = new Map();
    this.water = WATER_CAPACITY; this.waterRefill = 0;
    this.safeZones = [
      { id: 0, x: 330, y: 170 },
      { id: 1, x: 1180, y: 170 },
      { id: 2, x: 1170, y: 820 },
      { id: 3, x: 330, y: 820 }
 ];
    this.ignitionSchedule = [];
    this.smokeSignals = [];
    this.accumulator = 0;
    for (let row = 0; row < WORLD.rows; row++) {
      for (let col = 0; col < WORLD.cols; col++) {
        const id = row * WORLD.cols + col;
        const x = col * WORLD.cell + 9 + (rng() - .5) * 9;
        const y = row * WORLD.cell + 9 + (rng() - .5) * 9;
        const occupied = forestShape(x, y) && rng() > .045;
        const cell = { id, row, col, x, y, original: occupied, state: occupied ? 'green' : 'empty', heat: 0, burn: 0, variant: Math.floor(rng() * 12), size: .7 + rng() * .7, phase: rng() * Math.PI * 2, neighbors: [] };
        this.cells.push(cell);
        if (occupied) this.trees.push(cell);
      }
    }
    for (const cell of this.cells) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = cell.col + dx, r = cell.row + dy;
        if (c >= 0 && c < WORLD.cols && r >= 0 && r < WORLD.rows) cell.neighbors.push(r * WORLD.cols + c);
      }
      cell.edge = cell.original && cell.neighbors.some(i => !forestShape(this.cells[i].x, this.cells[i].y));
    }
    // Pick a fresh set of well-separated ignition points for each run. Keeping the
    // generated layout in this seeded world makes its spread coherent until restart.
    const ignitionTrees = [];
    const pickIgnition = minDistance => {
      const candidates = this.trees.filter(tree => tree.state === 'green' &&
        ignitionTrees.every(other => distance(tree, other) >= minDistance));
      if (!candidates.length) return this.trees.find(tree => tree.state === 'green');
      const tree = candidates[Math.floor(rng() * candidates.length)];
      ignitionTrees.push(tree);
      return tree;
    };
    const firstFire = pickIgnition(0), secondFire = pickIgnition(330);
    const laterFireA = pickIgnition(220), laterFireB = pickIgnition(220);
    this.ignite(firstFire); this.ignite(secondFire);
    this.ignitionSchedule = [
      { at: 68, point: { x: laterFireA.x, y: laterFireA.y }, started: false },
      { at: 140, point: { x: laterFireB.x, y: laterFireB.y }, started: false }
    ];
    // Two truthful smoke leads mark the starting fires; a third, false plume hides a toaster.
    const fakeCandidates = this.trees.filter(tree => ignitionTrees.every(other => distance(tree, other) >= 190));
    const fakeTree = fakeCandidates[Math.floor(rng() * fakeCandidates.length)] || this.trees[0];
    this.smokeSignals = [
      { x: firstFire.x, y: firstFire.y, phase: rng() * Math.PI * 2, fake: false },
      { x: secondFire.x, y: secondFire.y, phase: rng() * Math.PI * 2, fake: false },
      { x: fakeTree.x, y: fakeTree.y, phase: rng() * Math.PI * 2, fake: true }
    ];
    const starting = [[520, 470], [555, 440], [590, 505], [420, 580], [700, 415], [770, 560], [1020, 420], [1060, 510], [890, 340]];
    const usedHomes = new Set();
    let groupId = 0;
    while (this.animals.length < ANIMAL_COUNT) {
      const point = groupId < starting.length
        ? { x: starting[groupId][0], y: starting[groupId][1] }
        : this.trees[Math.floor(rng() * this.trees.length)];
      const tree = this.nearestTree(point, t => t.state === 'green' && !usedHomes.has(t.id));
      usedHomes.add(tree.id);
      const groupSize = Math.min(1 + Math.floor(rng() * 3), ANIMAL_COUNT - this.animals.length);
      for (let member = 0; member < groupSize; member++) {
        const i = this.animals.length;
        let x = tree.x + (member - (groupSize - 1) / 2) * 12 + (rng() - .5) * 2;
        let y = tree.y + (member % 2 - .5) * 6 + (rng() - .5) * 2;
        // Keep every member on living cover, including groups close to the edge.
        while (!forestShape(x, y) || this.cellAt(x, y).state !== 'green') {
          x = tree.x + (rng() - .5) * 10; y = tree.y + (rng() - .5) * 10;
        }
        this.animals.push({ id: i, groupId, home: tree.id, x, y, originX: x, originY: y,
          phase: rng() * 6.28, kind: i % 3, revealAt: 3, small: i % 4 === 3,
          revealed: false, state: 'idle', route: [], routeIndex: 0,
          sanctuary: { x: 480 + (i % 50) * 10 + rng() * 3, y: 850 + Math.floor(i / 50) * 7 + rng() * 2 },
          displacement: null });
      }
      groupId++;
    }
  }
  nearestTree(point, predicate = t => t.state === 'green') {
    let closest = null, best = Infinity;
    for (const tree of this.trees) {
      if (!predicate(tree)) continue;
      const d = distance(point, tree);
      if (d < best) { best = d; closest = tree; }
    }
    return closest;
  }
  cellAt(x, y) { return this.cells[clamp(Math.floor(y / WORLD.cell), 0, WORLD.rows - 1) * WORLD.cols + clamp(Math.floor(x / WORLD.cell), 0, WORLD.cols - 1)]; }
  ignite(cell) {
    if (!cell || cell.state !== 'green') return;
    cell.state = 'fire'; cell.burn = 0; cell.heat = 1; this.revision++;
    this.burnRoadsAt(cell);
  }
  fireAt(x, y, padding = 0) {
    const col = Math.floor(x / WORLD.cell), row = Math.floor(y / WORLD.cell);
    // Include sources below the point: their tall flames overhang adjacent cells.
    for (let r = Math.max(0, row - 2); r <= Math.min(WORLD.rows - 1, row + 3); r++) {
      for (let c = Math.max(0, col - 2); c <= Math.min(WORLD.cols - 1, col + 2); c++) {
        const tree = this.cells[r * WORLD.cols + c];
        if (tree.state === 'fire' && pointInFire(tree, x, y, padding)) return tree;
      }
    }
    return null;
  }
  burnRoadsAt(tree) {
    const shape = fireGeometry(tree), padding = ROAD_CELL * .65;
    const min = this.roadCellAt(Math.min(shape.x - shape.rx, tree.col * WORLD.cell) - padding,
      Math.min(shape.y - shape.ry, tree.row * WORLD.cell) - padding);
    const max = this.roadCellAt(Math.max(shape.x + shape.rx, (tree.col + 1) * WORLD.cell) + padding,
      Math.max(shape.y + shape.ry, (tree.row + 1) * WORLD.cell) + padding);
    for (let row = min.row; row <= max.row; row++) {
      for (let col = min.col; col <= max.col; col++) {
        const id = row * ROAD_COLS + col;
        if (!this.roads.has(id)) continue;
        const point = this.roadPoint(id);
        if (pointInFire(tree, point.x, point.y, padding)) {
          this.roads.delete(id); this.roadOrder.delete(id); this.roadRevision++;
        }
      }
    }
  }
  canClear(point) { return this.trees.some(t => t.state === 'fire' && distance(t, point) < BREAK_RADIUS); }
  addRoadSegment(from, to) { return this.traceRoadSegment(from, to, true); }
  traceRoadSegment(from, to, place = false) {
    if (this.ended) return { ...from };
    const start = this.roadCellAt(from.x, from.y), end = this.roadCellAt(to.x, to.y);
    let col = start.col, row = start.row, last = start;
    const put = (c, r) => {
      const cell = { id: r * ROAD_COLS + c, col: c, row: r };
      const point = this.roadPoint(cell.id);
      if (this.fireAt(point.x, point.y, ROAD_CELL * .65)) return false;
      if (place && !this.roads.has(cell.id)) { this.roads.add(cell.id); this.roadOrder.set(cell.id, ++this.roadSequence); this.roadRevision++; }
      last = cell; return true;
    };
    if (!put(col, row)) return { ...from };
    // A four-neighbour grid keeps drawn segments, routing and fire damage identical.
    const dx = Math.abs(end.col - col), dy = Math.abs(end.row - row);
    const sx = Math.sign(end.col - col), sy = Math.sign(end.row - row);
    let ix = 0, iy = 0;
    while (ix < dx || iy < dy) {
      if (ix < dx && (iy >= dy || (ix + .5) / dx < (iy + .5) / dy)) { col += sx; ix++; }
      else { row += sy; iy++; }
      if (!put(col, row)) break;
    }
    return this.roadPoint(last.id);
  }
  roadCellAt(x, y) {
    const col = clamp(Math.floor(x / ROAD_CELL), 0, ROAD_COLS - 1);
    const row = clamp(Math.floor(y / ROAD_CELL), 0, ROAD_ROWS - 1);
    return { id: row * ROAD_COLS + col, col, row };
  }
  roadPoint(id) {
    return { x: (id % ROAD_COLS + .5) * ROAD_CELL, y: (Math.floor(id / ROAD_COLS) + .5) * ROAD_CELL };
  }
  roadNeighbors(id) {
    const col = id % ROAD_COLS, row = Math.floor(id / ROAD_COLS), neighbors = [];
    if (col > 0) neighbors.push(id - 1);
    if (col < ROAD_COLS - 1) neighbors.push(id + 1);
    if (row > 0) neighbors.push(id - ROAD_COLS);
    if (row < ROAD_ROWS - 1) neighbors.push(id + ROAD_COLS);
    return neighbors;
  }
  startRoad(groupId) {
    const members = this.animals.filter(a => a.groupId === groupId && a.revealed && ['idle', 'waiting'].includes(a.state));
    if (!members.length) return null;
    const anchor = { x: members[0].x, y: members[0].y };
    if (this.fireAt(anchor.x, anchor.y)) return null;
    for (const animal of members) this.addRoadSegment({ x: animal.x, y: animal.y }, anchor);
    return this.addRoadSegment(anchor, anchor);
  }
  rebuildRoadNavigation() {
    if (this.navigationRevision === this.roadRevision) return;
    this.roadNext.clear(); this.roadZone.clear();
    const queue = [];
    for (const zone of this.safeZones) {
      const id = this.roadCellAt(zone.x, zone.y).id;
      if (!this.roads.has(id)) continue;
      this.roadNext.set(id, null); this.roadZone.set(id, zone.id); queue.push(id);
    }
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head];
      for (const neighbor of this.roadNeighbors(id)) {
        if (!this.roads.has(neighbor) || this.roadNext.has(neighbor)) continue;
        this.roadNext.set(neighbor, id); this.roadZone.set(neighbor, this.roadZone.get(id)); queue.push(neighbor);
      }
    }
    this.navigationRevision = this.roadRevision;
  }
  roadRoute(animal) {
    this.rebuildRoadNavigation();
    const start = this.roadCellAt(animal.x, animal.y).id;
    if (!this.roads.has(start)) return null;
    const route = [];
    if (this.roadNext.has(start)) {
      for (let id = start; id !== null; id = this.roadNext.get(id)) route.push({ ...this.roadPoint(id), cell: id });
      return { route, zoneId: this.roadZone.get(start) };
    }
    // Follow the newest reachable construction, even before it reaches a refuge.
    // Remember visited construction order so a broken path never sends animals backwards.
    const previous = new Map([[start, null]]), queue = [start];
    let target = start, newest = Math.max(this.roadOrder.get(start) || 0, animal.roadProgressOrder || 0);
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head], order = this.roadOrder.get(id) || 0;
      if (order > newest) { newest = order; target = id; }
      for (const next of this.roadNeighbors(id)) {
        if (!this.roads.has(next) || previous.has(next)) continue;
        previous.set(next, id); queue.push(next);
      }
    }
    if (target === start) return null;
    for (let id = target; id !== null; id = previous.get(id)) route.push({ ...this.roadPoint(id), cell: id });
    route.reverse();
    return { route, zoneId: null };
  }
  assignRoadRoute(animal, plan) {
    animal.route = plan.route; animal.routeIndex = 0; animal.zoneId = plan.zoneId;
    if (animal.state !== 'walking') animal.joinedAt = this.time;
    animal.state = 'walking';
  }
  moveOnRoad(animal, dt) {
    const bodyRadius = animal.small ? 3 : 4.2;
    if (this.fireAt(animal.x, animal.y, bodyRadius)) { this.resolve(animal, 'lost'); return; }
    if (!animal.revealed) return;
    if (animal.routeRevision !== this.roadRevision) {
      const needsRoute = !animal.route.length || animal.state === 'waiting' || animal.route.slice(animal.routeIndex).some(p => !this.roads.has(p.cell));
      const plan = needsRoute ? this.roadRoute(animal) : null;
      if (plan) this.assignRoadRoute(animal, plan);
      animal.routeRevision = this.roadRevision;
    }
    if (!animal.route.length || (animal.state === 'waiting' && animal.routeIndex >= animal.route.length)) return;
    let budget = dt * 24;
    while (budget > 0) {
      const next = animal.route[animal.routeIndex];
      if (!next) {
        const zone = this.safeZones[animal.zoneId];
        if (zone && distance(animal, zone) < WORLD.cell * 1.5) {
          const rank = this.animals.filter(a => a.state === 'saved' && a.zoneId === zone.id).length;
          animal.sanctuary = { x: zone.x + (rank % 6 - 2.5) * 5, y: zone.y + (Math.floor(rank / 6) - 2) * 5 };
          this.resolve(animal, 'saved'); return;
        }
        const plan = this.roadRoute(animal);
        if (plan) { this.assignRoadRoute(animal, plan); continue; }
        animal.state = 'waiting'; return;
      }
      if (!this.roads.has(next.cell) || this.fireAt(next.x, next.y, ROAD_CELL * .65)) {
        animal.state = 'waiting'; return;
      }
      animal.state = 'walking';
      const d = distance(animal, next);
      if (d <= budget) {
        animal.x = next.x; animal.y = next.y; animal.routeIndex++; budget -= d;
        animal.roadProgressOrder = Math.max(animal.roadProgressOrder || 0, this.roadOrder.get(next.cell) || 0);
      } else {
        animal.heading = Math.atan2(next.y - animal.y, next.x - animal.x);
        animal.x += (next.x - animal.x) / d * budget; animal.y += (next.y - animal.y) / d * budget; budget = 0;
      }
      if (this.fireAt(animal.x, animal.y, bodyRadius)) { this.resolve(animal, 'lost'); return; }
    }
  }
  clear(point) {
    if (this.ended || this.water < 1 || !this.canClear(point)) return false;
    this.water--;
    this.breaks.push({ x: point.x, y: point.y, time: this.time });
    for (const tree of this.trees) {
      if (distance(tree, point) < BREAK_RADIUS && (tree.state === 'green' || tree.state === 'fire')) { tree.state = 'cleared'; tree.heat = 0; this.revision++; }
    }
    this.events.push({ type: 'clear', ...point });
    return true;
  }
  resolve(animal, state) {
    if (animal.state === 'saved' || animal.state === 'lost') return;
    const alreadyCounted = animal.counted;
    animal.counted = true;
    animal.state = state;
    if (!alreadyCounted) this.remaining--;
    if (state === 'saved') { this.saved++; animal.x = animal.sanctuary.x; animal.y = animal.sanctuary.y; }
    else { this.lost++; this.events.push({ type: 'burned', x: animal.x, y: animal.y }); }
    // The count changes once, while later resolution still reports whether the animal survived.
    if (!alreadyCounted) {
      this.events.push({ type: 'count', remaining: this.remaining, reason: state === 'saved' ? 'rescue' : 'loss' });
    } else {
      this.events.push({ type: 'outcome', result: state });
    }
  }
  update(dt) {
    if (this.ended) return;
    this.accumulator += dt;
    while (this.accumulator >= .1 && !this.ended) { this.step(.1); this.accumulator -= .1; }
  }
  step(dt) {
    this.time += dt;
    if (this.water < WATER_CAPACITY) {
      this.waterRefill += dt;
      while (this.waterRefill >= WATER_REFILL_SECONDS && this.water < WATER_CAPACITY) {
        this.water++; this.waterRefill -= WATER_REFILL_SECONDS;
      }
      if (this.water === WATER_CAPACITY) this.waterRefill = 0;
    }
    for (const ignition of this.ignitionSchedule) {
      if (ignition.started || this.time < ignition.at) continue;
      this.ignite(this.nearestTree(ignition.point));
      ignition.started = true;
    }
    const ignitions = [];
    for (const tree of this.trees) {
      if (tree.state === 'fire') {
        this.burnRoadsAt(tree);
        tree.burn += dt;
        if (tree.burn >= 27) { tree.state = 'ash'; this.revision++; }
      } else if (tree.state === 'green') {
        let heat = 0;
        for (const id of tree.neighbors) {
          const other = this.cells[id];
          if (other.state === 'fire') heat += .04;
        }
        tree.heat = Math.max(0, tree.heat + dt * (heat || -.12));
        if (tree.heat >= 1) ignitions.push(tree);
      }
    }
    for (const tree of ignitions) this.ignite(tree);
    for (const animal of this.animals) {
      if (animal.state === 'saved' || animal.state === 'lost') continue;
      this.moveOnRoad(animal, dt);
    }
    if (this.animals.every(a => a.state === 'saved' || a.state === 'lost')) this.finish();
  }
  finish() {
    // Ending reports resolved outcomes; it never assigns outcomes to living animals.
    if (this.ended || this.animals.some(a => a.state !== 'saved' && a.state !== 'lost')) return;
    this.ended = true;
    this.events.push({ type: 'end' });
  }
}
