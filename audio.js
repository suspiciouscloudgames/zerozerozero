/* Procedural soundscape: no external audio requests or licensed samples. */
class ForestAudio {
  constructor() {
    this.context = null;
    this.muted = false;
    this.fires = new Map();
    this.toasters = new WeakMap();
    this.rustles = new Map();
    this.nextBird = 0;
    this.nextRustle = 0;
    this.nextIgnition = 0;
    this.nextToaster = 0;
    this.signCooldowns = new WeakMap();
    this.nearSigns = new Set();
    this.signProbe = null;
    this.nextWhisper = 0;
    this.tick = 0;
    try { this.muted = localStorage.getItem('000-muted') === 'true'; } catch {}
  }

  static spatial(point, view, range = 1) {
    const radius = Math.max(30, view.radius);
    const d = Math.hypot(point.x - view.x, point.y - view.y) / radius;
    const fade = Math.max(0, 1 - d / (1.65 * range));
    return { gain: fade * fade / (1 + d * .65), pan: Math.max(-.92, Math.min(.92, (point.x - view.x) / radius)), distance: d };
  }

  static fireSources(trees, view) {
    // One bed per small patch, rather than hundreds of overlapping tree loops.
    const patches = new Map();
    for (const tree of trees) {
      if (tree.state !== 'fire') continue;
      const key = `${Math.floor(tree.x / 95)},${Math.floor(tree.y / 95)}`;
      const patch = patches.get(key) || { key, x: 0, y: 0, count: 0 };
      patch.x += tree.x; patch.y += tree.y; patch.count++;
      patches.set(key, patch);
    }
    return [...patches.values()].map(p => {
      p.x /= p.count; p.y /= p.count;
      return { ...p, ...ForestAudio.spatial(p, view, 1.65) };
    }).filter(p => p.gain > .004).sort((a, b) => b.gain - a.gain).slice(0, 8);
  }

  init() {
    if (this.context) return;
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) return;
    const c = this.context = new Audio();
    c.onstatechange = () => this.onStateChange?.();
    this.master = c.createGain(); this.master.gain.value = 0;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -16; limiter.knee.value = 16; limiter.ratio.value = 5;
    limiter.attack.value = .008; limiter.release.value = .25;
    this.master.connect(limiter); limiter.connect(c.destination);
    this.buffers = {};
    this.buffers.wind = this.buffer(11, 2, (t, i, state) => {
      const noise = Math.random() * 2 - 1;
      state.low = (state.low || 0) * .985 + noise * .015;
      state.air = (state.air || 0) * .8 + noise * .2;
      // A little midrange canopy air keeps the bed audible on small speakers.
      return (state.low * 2.4 + state.air * .55) * (.72 + .13 * Math.sin(t * .8) + .1 * Math.sin(t * 1.7));
    });
    this.buffers.fire = this.buffer(7, 1, (t, i, state) => {
      const white = Math.random() * 2 - 1;
      state.low = (state.low || 0) * .975 + white * .025;
      if (Math.random() < 13 / c.sampleRate) state.pop = .3 + Math.random() * .65;
      state.pop = (state.pop || 0) * .992;
      return state.low * 1.7 + white * (.025 + state.pop) * (.7 + .3 * Math.sin(t * 2.3));
    });
    this.buffers.leaves = this.buffer(.68, 1, (t, i, state) => {
      const white = Math.random() * 2 - 1;
      const high = white - (state.last || 0); state.last = white;
      const swish = Math.sin(Math.PI * Math.min(1, t / .68)) ** 1.4;
      const strokes = .18 + .82 * Math.sin(t * 23) ** 6;
      return high * swish * strokes * .32;
    });
    this.buffers.whisper = this.buffer(1.5, 1, (t, i, state) => {
      // Unvoiced breath with irregular syllable-shaped envelopes: no words or pitch.
      const white = Math.random() * 2 - 1;
      state.low = (state.low || 0) * .85 + white * .15;
      const syllables = [[.16,.085], [.41,.12], [.69,.075], [1.02,.16], [1.29,.07]];
      let envelope = 0;
      for (const [center, spread] of syllables) envelope += Math.exp(-(((t - center) / spread) ** 2));
      return (white - state.low) * Math.min(1, envelope) * (.35 + .12 * Math.sin(t * 61));
    });
    this.ambience = this.loop(this.buffers.wind, 'lowpass', 1900);
    // This fixed, non-spatial bed is never changed by camera distance or zoom.
    this.ambience.gain.gain.value = .24;
    this.nextBird = c.currentTime + .65;
  }

  buffer(seconds, channels, sample) {
    const c = this.context, buffer = c.createBuffer(channels, Math.ceil(seconds * c.sampleRate), c.sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch), state = {};
      for (let i = 0; i < data.length; i++) {
        const t = i / c.sampleRate;
        // Taper the seam so randomized loop boundaries cannot click.
        const edge = Math.min(1, t / .04, (seconds - t) / .04);
        data[i] = sample(t, i, state) * edge;
      }
    }
    return buffer;
  }

  loop(buffer, type, frequency) {
    const c = this.context, source = c.createBufferSource(), filter = c.createBiquadFilter();
    const gain = c.createGain(), pan = c.createStereoPanner();
    source.buffer = buffer; source.loop = true;
    filter.type = type; filter.frequency.value = frequency; filter.Q.value = .6;
    gain.gain.value = 0;
    source.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(this.master);
    source.start(0, Math.random() * buffer.duration);
    return { source, filter, gain, pan };
  }

  async unlock() {
    if (this.muted || document.hidden) return;
    try {
      this.init();
      if (!this.context) return;
      await this.context.resume();
      // A visibility/mute change can arrive while resume is pending.
      if (this.muted || document.hidden) { await this.context.suspend(); return; }
      this.master.gain.setTargetAtTime(.7, this.context.currentTime, .25);
    } catch { /* Audio failure must never stop the game. */ }
    this.onStateChange?.();
  }

  async toggle() {
    // Autoplay may already have created a suspended context. "Enable" must resume it.
    this.muted = !this.muted && this.context?.state === 'running';
    try { localStorage.setItem('000-muted', String(this.muted)); } catch {}
    if (this.muted) {
      if (this.context) await this.context.suspend().catch(() => {});
    } else await this.unlock();
    this.onStateChange?.();
  }

  visibilityChanged() {
    if (!this.context) return;
    if (document.hidden) this.context.suspend().catch(() => {});
    else this.unlock();
  }

  tone(start, duration, frequencies, gain, pan = 0, type = 'sine') {
    const c = this.context, oscillator = c.createOscillator(), envelope = c.createGain(), stereo = c.createStereoPanner();
    oscillator.type = type;
    frequencies.forEach((frequency, i) => {
      const t = start + duration * i / Math.max(1, frequencies.length - 1);
      if (i === 0) oscillator.frequency.setValueAtTime(frequency, t);
      else oscillator.frequency.exponentialRampToValueAtTime(frequency, t);
    });
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(gain, start + .015);
    envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
    stereo.pan.value = pan;
    oscillator.connect(envelope); envelope.connect(stereo); stereo.connect(this.master);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); stereo.disconnect(); };
    oscillator.start(start); oscillator.stop(start + duration + .02);
  }

  rustle(position, view) {
    const spatial = ForestAudio.spatial(position, view);
    if (spatial.gain < .015) return;
    const c = this.context, source = c.createBufferSource(), filter = c.createBiquadFilter();
    const gain = c.createGain(), pan = c.createStereoPanner();
    source.buffer = this.buffers.leaves; source.playbackRate.value = .87 + Math.random() * .25;
    filter.type = 'bandpass'; filter.frequency.value = 2700; filter.Q.value = .65;
    gain.gain.value = spatial.gain * .9; pan.pan.value = spatial.pan;
    source.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(this.master);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); pan.disconnect(); };
    source.start();
  }

  ignition(position, view) {
    const c = this.context, source = c.createBufferSource(), filter = c.createBiquadFilter();
    const gain = c.createGain(), pan = c.createStereoPanner();
    const spatial = ForestAudio.spatial(position, view, 1.65), now = c.currentTime;
    source.buffer = this.buffers.fire;
    filter.type = 'lowpass'; filter.frequency.value = 1400;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(spatial.gain * .3, now + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .23);
    pan.pan.value = spatial.pan;
    source.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(this.master);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); pan.disconnect(); };
    source.start(now, Math.random() * 5, .25);
  }

  whisperSign(position, view) {
    if (!this.context || this.context.state !== 'running' || this.muted || document.hidden) return;
    const c = this.context, spatial = ForestAudio.spatial(position, view);
    const volume = .35 + .65 * spatial.gain;
    // Two overlapping, airy fragments with shifting mouth resonances, never voiced speech.
    for (let layer = 0; layer < 2; layer++) {
      const source = c.createBufferSource(), low = c.createBiquadFilter(), high = c.createBiquadFilter();
      const gain = c.createGain(), pan = c.createStereoPanner();
      const start = c.currentTime + layer * .18;
      source.buffer = this.buffers.whisper;
      source.playbackRate.value = .92 + Math.random() * .18;
      low.type = high.type = 'bandpass'; low.Q.value = 3.5; high.Q.value = 4;
      low.frequency.setValueAtTime(850 + layer * 180, start);
      high.frequency.setValueAtTime(2600 - layer * 250, start);
      for (let i = 1; i <= 5; i++) {
        low.frequency.exponentialRampToValueAtTime(650 + Math.random() * 800, start + i * .26);
        high.frequency.exponentialRampToValueAtTime(1600 + Math.random() * 1500, start + i * .26);
      }
      gain.gain.value = volume * (layer ? .34 : .46);
      pan.pan.value = Math.max(-.95, Math.min(.95, spatial.pan + (layer ? .12 : -.12)));
      source.connect(low); source.connect(high); low.connect(gain); high.connect(gain);
      gain.connect(pan); pan.connect(this.master);
      source.onended = () => { source.disconnect(); low.disconnect(); high.disconnect(); gain.disconnect(); pan.disconnect(); };
      source.start(start);
    }
  }

  updateSigns(scene) {
    const probe = scene.probe;
    if (scene.stage < 2 || scene.ended || scene.zooming || !probe?.inside) {
      this.signProbe = null; this.nearSigns.clear(); return;
    }
    const from = this.signProbe || probe;
    this.signProbe = { x: probe.x, y: probe.y };
    const dx = probe.x - from.x, dy = probe.y - from.y, length = dx * dx + dy * dy;
    const radius = Math.max(6, scene.view.radius * .16), near = new Set(), crossings = [];
    for (const sign of scene.signs || []) {
      if (Math.hypot(sign.x - scene.view.x, sign.y - scene.view.y) > scene.view.radius) continue;
      const y = sign.y - 6 * (sign.scale || 1);
      const distance = Math.hypot(sign.x - probe.x, y - probe.y);
      if (distance < radius * 1.25) near.add(sign);
      const t = length ? Math.max(0, Math.min(1, ((sign.x - from.x) * dx + (y - from.y) * dy) / length)) : 0;
      const sweptDistance = Math.hypot(sign.x - from.x - dx * t, y - from.y - dy * t);
      if (!this.nearSigns.has(sign) && sweptDistance < radius &&
          this.context.currentTime >= (this.signCooldowns.get(sign) || 0)) crossings.push({ sign, distance });
    }
    this.nearSigns = near;
    if (this.context.currentTime < this.nextWhisper || !crossings.length) return;
    const { sign } = crossings.sort((a,b) => a.distance - b.distance)[0];
    this.whisperSign(sign, scene.view);
    this.signCooldowns.set(sign, this.context.currentTime + 9);
    this.nextWhisper = this.context.currentTime + 2;
  }

  popToaster(position, view) {
    if (!this.context || this.context.state !== 'running' || this.muted || document.hidden) return;
    const spatial = ForestAudio.spatial(position, view);
    const now = this.context.currentTime, volume = Math.max(.3, spatial.gain);
    // A tiny rounded pop, distinct from the longer discovery boing.
    this.tone(now, .16, [680, 340, 170], .16 * volume, spatial.pan);
    this.tone(now + .008, .065, [1150, 720], .035 * volume, spatial.pan);
    this.nextToaster = Math.max(this.nextToaster, now + .4);
  }

  discoverToaster(signal, view) {
    const position = `${signal.x},${signal.y}`;
    if (this.toasters.get(signal) === position) return;
    this.toasters.set(signal, position);
    const spatial = ForestAudio.spatial(signal, view);
    const now = this.context.currentTime;
    // A short elastic "boing", followed by a tiny bright toast-pop overtone.
    this.tone(now, .48, [240, 690, 310, 430, 270], .18 * Math.max(.25, spatial.gain), spatial.pan, 'triangle');
    this.tone(now + .035, .22, [1240, 920], .045 * Math.max(.25, spatial.gain), spatial.pan);
  }

  update(dt, scene) {
    if (!this.context || this.context.state !== 'running' || this.muted || document.hidden) {
      this.signProbe = null; this.nearSigns.clear(); return;
    }
    this.tick += dt;
    if (this.tick < .09) return;
    this.tick = 0;
    const c = this.context, now = c.currentTime, { view } = scene;
    const audible = scene.ended ? [] : ForestAudio.fireSources(scene.trees, view);
    const keys = new Set(audible.map(p => p.key));
    const normalization = 1 / Math.sqrt(Math.max(1, audible.length));
    for (const patch of audible) {
      let voice = this.fires.get(patch.key);
      if (!voice) {
        voice = this.loop(this.buffers.fire, 'lowpass', 3400);
        this.fires.set(patch.key, voice);
        // New burning patches fade in with a crackle, never a full-volume alert.
        if (now >= this.nextIgnition) {
          this.ignition(patch, view);
          this.nextIgnition = now + .5;
        }
      }
      const fuel = Math.min(1.7, .65 + Math.sqrt(patch.count) * .18);
      voice.gain.gain.setTargetAtTime(patch.gain * fuel * .46 * normalization, now, .16);
      voice.pan.pan.setTargetAtTime(patch.pan, now, .14);
      voice.filter.frequency.setTargetAtTime(650 + 4300 / (1 + patch.distance * 2), now, .2);
    }
    for (const [key, voice] of this.fires) {
      if (keys.has(key)) continue;
      voice.gain.gain.setTargetAtTime(0, now, .09);
      voice.source.stop(now + .45);
      voice.source.onended = () => { voice.source.disconnect(); voice.filter.disconnect(); voice.gain.disconnect(); voice.pan.disconnect(); };
      this.fires.delete(key);
    }
    if (now >= this.nextBird) {
      const pan = Math.random() * 1.6 - .8, pitch = 1850 + Math.random() * 1300;
      const calls = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < calls; i++) {
        this.tone(now + i * .19, .13, [pitch * .83, pitch * 1.2, pitch], .024, pan);
      }
      this.nextBird = now + 4 + Math.random() * 6;
    }
    this.updateSigns(scene);
    if (scene.ended || scene.zooming) return;
    if (scene.stage >= 2) {
      for (const signal of scene.toasters) {
        if (!signal.fake || now < this.nextToaster || this.toasters.get(signal) === `${signal.x},${signal.y}`) continue;
        if (Math.hypot(signal.x - view.x, signal.y - view.y) < view.radius * .94) {
          this.discoverToaster(signal, view);
          this.nextToaster = now + .65;
        }
      }
    }
    if (scene.stage < 3 || now < this.nextRustle) return;
    const groups = scene.hidden.filter(a => a.state === 'idle' && !a.revealed)
      .sort((a, b) => Math.hypot(a.x - view.x, a.y - view.y) - Math.hypot(b.x - view.x, b.y - view.y));
    for (const animal of groups) {
      // This is the exact pulse used by foliageBendAt: the sound peaks with that patch.
      const pulse = Math.sin(scene.time * 3.4 + animal.phase * 1.7);
      if (pulse < .72 || now < (this.rustles.get(animal.groupId) || 0)) continue;
      if (ForestAudio.spatial(animal, view).gain < .015) continue;
      this.rustle(animal, view);
      this.rustles.set(animal.groupId, now + 3.2);
      this.nextRustle = now + .45;
      break;
    }
  }
}
