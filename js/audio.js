/* Microphone input -> a smoothed 0..1 loudness level. */
(function (PT) {
  PT.Audio = {
    ctx: null, stream: null, analyser: null, buf: null,
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
