/* Microphone input -> a smoothed 0..1 loudness level, and a rough guess at the vowel being said. */
(function (PT) {
  /* Which vowel shape a sound is nearest to, from how its energy is spread over three bands:
       low  250-600 Hz    where "ee", "eh", "oh" and "oo" have their first (strongest) formant
       mid  600-1400 Hz   where "ah" has its first two
       high 1700-3400 Hz  where "ee" and "eh" have their second; "oh" and "oo" have next to nothing
     So: more in mid than in low is 'a'; otherwise a real share up high is 'e'; otherwise 'o'.
     '' when there is no sound to go by. The numbers come from typical formant positions, not from
     measuring voices: it is a rough guide for a mouth picture, not speech recognition. */
  PT.vowelFromBands = (low, mid, high) => {
    const total = low + mid + high;
    if (!(total > 0)) return '';
    if (mid > low) return 'a';
    if (high / total > 0.01) return 'e';   // within 20 dB of the rest
    return 'o';
  };
  // the power in each band, from an analyser's frequency data in dB
  PT.bandPowers = (db, sampleRate, fftSize) => {
    const hz = sampleRate / fftSize, sum = (from, to) => {
      let s = 0;
      for (let i = Math.max(1, Math.round(from / hz)); i <= Math.min(db.length - 1, Math.round(to / hz)); i++) s += Math.pow(10, db[i] / 10);
      return s;
    };
    return [sum(250, 600), sum(600, 1400), sum(1700, 3400)];
  };

  PT.Audio = {
    ctx: null, stream: null, analyser: null, buf: null, freq: null,
    running: false, level: 0, raw: 0,
    onTick: null,

    async devices() {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        return list.filter((d) => d.kind === 'audioinput');
      } catch (e) { return []; }
    },

    async start(deviceId) {
      this.stop();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone needs a secure page. Run start.bat and open http://localhost:8777');
      }
      const audio = { echoCancellation: false, noiseSuppression: true, autoGainControl: false };
      if (deviceId) audio.deviceId = { exact: deviceId };
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio });
      } catch (e) {
        if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
          delete audio.deviceId;   // saved device is gone: fall back to default
          this.stream = await navigator.mediaDevices.getUserMedia({ audio });
        } else throw e;
      }
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.buf = new Float32Array(this.analyser.fftSize);
      src.connect(this.analyser);
      // Audio callbacks keep firing when the tab is hidden (unlike requestAnimationFrame), so
      // the editor can keep feeding the OBS stage page. The output is silent.
      try {
        const proc = this.ctx.createScriptProcessor(2048, 1, 1);
        let last = performance.now();
        proc.onaudioprocess = () => {
          const now = performance.now();
          if (this.onTick) this.onTick(Math.min(0.1, (now - last) / 1000));
          last = now;
        };
        src.connect(proc);
        proc.connect(this.ctx.destination);
      } catch (e) { /* not supported: no background relay */ }
      if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (e) { /* needs gesture */ } }
      this.running = true;
    },

    get suspended() { return !!this.ctx && this.ctx.state === 'suspended'; },
    resume() { if (this.ctx) return this.ctx.resume(); },

    stop() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.ctx) this.ctx.close().catch(() => {});
      this.stream = this.ctx = this.analyser = null;
      this.running = false;
      this.level = 0;
    },

    // the vowel being said right now: 'a', 'o', 'e' or '' (see PT.vowelFromBands)
    vowel() {
      if (!this.running || !this.analyser) return '';
      if (!this.freq || this.freq.length !== this.analyser.frequencyBinCount) this.freq = new Float32Array(this.analyser.frequencyBinCount);
      this.analyser.getFloatFrequencyData(this.freq);
      const [low, mid, high] = PT.bandPowers(this.freq, this.ctx.sampleRate, this.analyser.fftSize);
      return PT.vowelFromBands(low, mid, high);
    },

    // sensitivity 0..100 (50 = neutral). Returns 0..1
    read(dt, sensitivity) {
      if (!this.running || !this.analyser) { this.level = PT.approach(this.level, 0, 12, dt); return this.level; }
      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
      const rms = Math.sqrt(sum / this.buf.length);
      const db = 20 * Math.log10(rms + 1e-8) + (sensitivity - 50) * 0.6;
      // -60 dB -> 0, -10 dB -> 1
      this.raw = PT.clamp((db + 60) / 50, 0, 1);
      // fast attack, gentle release
      this.level = this.raw > this.level ? this.raw : PT.approach(this.level, this.raw, 9, dt);
      return this.level;
    },
  };
})(window.PT);
