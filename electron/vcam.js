/* Virtual camera: shows the avatar as a camera ("OBS Virtual Camera") in Zoom, Discord, Teams, etc.

   EASY-TUBER has no camera driver of its own (on a Mac that needs a paid, notarised system
   extension). It feeds the driver that OBS Studio installs, the same way OBS does:
   - Windows: OBS's DirectShow camera reads frames from a shared-memory queue named
     "OBSVirtualCamVideo" (NV12, three frame slots). Layout: obs-studio/shared/obs-shared-memory-queue.
   - macOS 13+: OBS 30+'s camera extension has a sink stream; frames go in as UYVY sample buffers.

   So OBS has to be installed (it doesn't need to be running), and only one program can feed
   the camera at a time. System calls are made with koffi (FFI), loaded only when the camera starts. */
const { execFile } = require('child_process');

const FPS = 30;
const DEVICE_NAME = 'OBS Virtual Camera';

/* ---------------- colour conversion (BGRA from the offscreen page -> what the camera wants) ---------------- */
// BT.709, limited range: what OBS sends by default, so programs show the same colours
const lumaOf = (r, g, b) => (47 * r + 157 * g + 16 * b + 4224) >> 8;     // 16..235
const cbOf = (r, g, b) => (-26 * r - 87 * g + 112 * b + 32896) >> 8;     // 16..240
const crOf = (r, g, b) => (112 * r - 102 * g - 10 * b + 32896) >> 8;

/* NV12: a full-size Y plane, then one interleaved Cb/Cr pair per 2x2 block. w and h must be even. */
function bgraToNv12(src, w, h, out) {
  const uv0 = w * h;
  for (let y = 0; y < h; y++) {
    let s = y * w * 4, d = y * w;
    for (let x = 0; x < w; x++, s += 4) out[d++] = lumaOf(src[s + 2], src[s + 1], src[s]);
  }
  for (let y = 0; y < h; y += 2) {
    let a = y * w * 4, b = a + w * 4, d = uv0 + (y >> 1) * w;
    for (let x = 0; x < w; x += 2, a += 8, b += 8) {
      const r = (src[a + 2] + src[a + 6] + src[b + 2] + src[b + 6] + 2) >> 2;
      const g = (src[a + 1] + src[a + 5] + src[b + 1] + src[b + 5] + 2) >> 2;
      const bl = (src[a] + src[a + 4] + src[b] + src[b + 4] + 2) >> 2;
      out[d++] = cbOf(r, g, bl);
      out[d++] = crOf(r, g, bl);
    }
  }
  return out;
}

/* UYVY ('2vuy'): Cb Y0 Cr Y1 for each pair of pixels. stride = bytes per output row (>= w * 2). */
function bgraToUyvy(src, w, h, out, stride = w * 2) {
  for (let y = 0; y < h; y++) {
    let s = y * w * 4, d = y * stride;
    for (let x = 0; x < w; x += 2, s += 8) {
      const r0 = src[s + 2], g0 = src[s + 1], b0 = src[s], r1 = src[s + 6], g1 = src[s + 5], b1 = src[s + 4];
      const r = (r0 + r1 + 1) >> 1, g = (g0 + g1 + 1) >> 1, b = (b0 + b1 + 1) >> 1;
      out[d++] = cbOf(r, g, b);
      out[d++] = lumaOf(r0, g0, b0);
      out[d++] = crOf(r, g, b);
      out[d++] = lumaOf(r1, g1, b1);
    }
  }
  return out;
}

/* ---------------- Windows: the OBS shared-memory queue ---------------- */
/* struct queue_header { uint32 write_idx, read_idx, state; uint32 offsets[3]; uint32 type;
                         uint32 cx, cy; uint64 interval; uint32 reserved[8]; }   = 80 bytes */
const Q = { WRITE_IDX: 0, READ_IDX: 4, STATE: 8, OFFSETS: 12, TYPE: 24, CX: 28, CY: 32, INTERVAL: 40, SIZE: 80 };
const Q_STATE = { STARTING: 1, READY: 2, STOPPING: 3 };
const FRAME_HEADER = 32;   // each slot: a uint64 timestamp (ns), padded to 32 bytes, then the NV12 frame
const align32 = (n) => (n + 31) & ~31;

function queueLayout(w, h) {
  const frameSize = w * h * 3 / 2;
  const offsets = [];
  let size = align32(Q.SIZE);
  for (let i = 0; i < 3; i++) { offsets.push(size); size = align32(size + frameSize + FRAME_HEADER); }
  return { frameSize, offsets, size };
}

function queueHeader(w, h, fps) {
  const { offsets } = queueLayout(w, h);
  const b = Buffer.alloc(Q.SIZE);
  b.writeUInt32LE(Q_STATE.STARTING, Q.STATE);
  offsets.forEach((o, i) => b.writeUInt32LE(o, Q.OFFSETS + i * 4));
  b.writeUInt32LE(w, Q.CX);
  b.writeUInt32LE(h, Q.CY);
  b.writeBigUInt64LE(BigInt(Math.floor(10000000 / fps)), Q.INTERVAL);   // frame time in 100 ns units
  return b;
}

const fail = (code, message) => Object.assign(new Error(message), { code });

function obsCameraRegistered() {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCR\\CLSID\\{A3FCE0F5-3493-419F-958A-ABA1250EC20B}'], { windowsHide: true }, (err) => resolve(!err));
  });
}

async function openWindows(w, h) {
  if (!(await obsCameraRegistered())) {
    throw fail('no-driver', 'The camera needs OBS Studio installed (it does not have to be running). Install OBS, then try again.');
  }
  const koffi = require('koffi');
  const k32 = koffi.load('kernel32.dll');
  const OpenFileMappingW = k32.func('void *__stdcall OpenFileMappingW(uint32_t access, int inherit, str16 name)');
  const CreateFileMappingW = k32.func('void *__stdcall CreateFileMappingW(void *file, void *attrs, uint32_t protect, uint32_t sizeHigh, uint32_t sizeLow, str16 name)');
  const MapViewOfFile = k32.func('void *__stdcall MapViewOfFile(void *handle, uint32_t access, uint32_t offHigh, uint32_t offLow, size_t bytes)');
  const UnmapViewOfFile = k32.func('int __stdcall UnmapViewOfFile(void *base)');
  const CloseHandle = k32.func('int __stdcall CloseHandle(void *handle)');
  // Electron doesn't allow JS views of outside memory, so frames are copied in with a memcpy
  const copy = k32.func('void __stdcall RtlMoveMemory(void *dst, void *src, size_t len)');

  const NAME = 'OBSVirtualCamVideo', FILE_MAP_READ = 4, FILE_MAP_ALL_ACCESS = 0xF001F, PAGE_READWRITE = 4;
  const busy = OpenFileMappingW(FILE_MAP_READ, 0, NAME);
  if (busy) {
    CloseHandle(busy);
    throw fail('busy', 'Another program (OBS?) is already sending to the OBS Virtual Camera. Stop its virtual camera first.');
  }
  const { frameSize, offsets, size } = queueLayout(w, h);
  const handle = CreateFileMappingW(0xFFFFFFFFFFFFFFFFn, null, PAGE_READWRITE, 0, size, NAME);
  if (!handle) throw fail('failed', 'Could not create the camera\'s shared memory.');
  const base = MapViewOfFile(handle, FILE_MAP_ALL_ACCESS, 0, 0, 0);
  if (!base) { CloseHandle(handle); throw fail('failed', 'Could not open the camera\'s shared memory.'); }
  const at = (off) => BigInt(base) + BigInt(off);
  const word = Buffer.alloc(8);
  const put32 = (off, v) => { word.writeUInt32LE(v >>> 0, 0); copy(at(off), word, 4); };

  copy(at(0), queueHeader(w, h, FPS), Q.SIZE);
  const nv12 = Buffer.alloc(frameSize);
  let inc = 0, open = true;

  return {
    width: w, height: h,
    send(bgra) {
      if (!open) return;
      bgraToNv12(bgra, w, h, nv12);
      inc = (inc + 1) >>> 0;
      const slot = offsets[inc % 3];
      put32(Q.WRITE_IDX, inc);
      word.writeBigUInt64LE(process.hrtime.bigint(), 0);
      copy(at(slot), word, 8);
      copy(at(slot + FRAME_HEADER), nv12, frameSize);
      put32(Q.READ_IDX, inc);
      put32(Q.STATE, Q_STATE.READY);
    },
    close() {
      if (!open) return;
      open = false;
      put32(Q.STATE, Q_STATE.STOPPING);
      UnmapViewOfFile(base);
      CloseHandle(handle);
    },
  };
}

/* ---------------- macOS: the OBS camera extension's sink stream ---------------- */
const fourcc = (s) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
const OBS_DEVICE_UID = '7626645E-4425-469E-9D8B-97E0FA59AC75';

function openMac(w, h) {
  const koffi = require('koffi');
  const F = '/System/Library/Frameworks/';
  const cf = koffi.load(F + 'CoreFoundation.framework/CoreFoundation');
  const cmio = koffi.load(F + 'CoreMediaIO.framework/CoreMediaIO');
  const cm = koffi.load(F + 'CoreMedia.framework/CoreMedia');
  const cv = koffi.load(F + 'CoreVideo.framework/CoreVideo');
  const sys = koffi.load('/usr/lib/libSystem.B.dylib');

  const Address = koffi.struct('CMIOObjectPropertyAddress', { mSelector: 'uint32_t', mScope: 'uint32_t', mElement: 'uint32_t' });
  const CMTime = koffi.struct('CMTime', { value: 'int64_t', timescale: 'int32_t', flags: 'uint32_t', epoch: 'int64_t' });
  koffi.struct('CMSampleTimingInfo', { duration: CMTime, presentationTimeStamp: CMTime, decodeTimeStamp: CMTime });
  const Altered = koffi.proto('void EasyTuberQueueAltered(uint32_t stream, void *token, void *refCon)');

  const GetSize = cmio.func('int32_t CMIOObjectGetPropertyDataSize(uint32_t id, const CMIOObjectPropertyAddress *address, uint32_t qualSize, void *qual, _Out_ uint32_t *size)');
  const GetData = cmio.func('int32_t CMIOObjectGetPropertyData(uint32_t id, const CMIOObjectPropertyAddress *address, uint32_t qualSize, void *qual, uint32_t size, _Out_ uint32_t *used, void *data)');
  const CopyBufferQueue = cmio.func('int32_t CMIOStreamCopyBufferQueue(uint32_t stream, EasyTuberQueueAltered *proc, void *refCon, _Out_ void **queue)');
  const StartStream = cmio.func('int32_t CMIODeviceStartStream(uint32_t device, uint32_t stream)');
  const StopStream = cmio.func('int32_t CMIODeviceStopStream(uint32_t device, uint32_t stream)');

  const CFRelease = cf.func('void CFRelease(void *obj)');
  const CFStringGetCString = cf.func('bool CFStringGetCString(void *str, void *buf, long size, uint32_t encoding)');
  const CFStringCreateWithCString = cf.func('void *CFStringCreateWithCString(void *alloc, const char *str, uint32_t encoding)');
  const CFDictionaryCreate = cf.func('void *CFDictionaryCreate(void *alloc, void *keys, void *values, long count, void *keyCallbacks, void *valueCallbacks)');
  const keyCallbacks = cf.symbol('kCFTypeDictionaryKeyCallBacks');
  const valueCallbacks = cf.symbol('kCFTypeDictionaryValueCallBacks');

  const PixelBufferCreate = cv.func('int32_t CVPixelBufferCreate(void *alloc, size_t width, size_t height, uint32_t format, void *attrs, _Out_ void **buffer)');
  const Lock = cv.func('int32_t CVPixelBufferLockBaseAddress(void *buffer, uint64_t flags)');
  const Unlock = cv.func('int32_t CVPixelBufferUnlockBaseAddress(void *buffer, uint64_t flags)');
  const BaseAddress = cv.func('void *CVPixelBufferGetBaseAddress(void *buffer)');
  const BytesPerRow = cv.func('size_t CVPixelBufferGetBytesPerRow(void *buffer)');

  const FormatCreate = cm.func('int32_t CMVideoFormatDescriptionCreate(void *alloc, uint32_t codec, int32_t width, int32_t height, void *extensions, _Out_ void **format)');
  const SampleCreate = cm.func('int32_t CMSampleBufferCreateForImageBuffer(void *alloc, void *image, bool ready, void *callback, void *refCon, void *format, const CMSampleTimingInfo *timing, _Out_ void **sample)');
  const Enqueue = cm.func('int32_t CMSimpleQueueEnqueue(void *queue, void *element)');

  const memcpy = sys.func('void *memcpy(void *dst, void *src, size_t len)');
  const uptimeNs = sys.func('uint64_t clock_gettime_nsec_np(int clock)');
  const CLOCK_UPTIME_RAW = 8, UTF8 = 0x08000100, UYVY = fourcc('2vuy');

  // a property that is a list of object IDs (devices, streams)
  const ids = (object, selector) => {
    const address = { mSelector: fourcc(selector), mScope: fourcc('glob'), mElement: 0 };
    const size = [0], used = [0];
    if (GetSize(object, address, 0, null, size) !== 0 || !size[0]) return [];
    const buf = Buffer.alloc(size[0]);
    if (GetData(object, address, 0, null, size[0], used, buf) !== 0) return [];
    const out = [];
    for (let i = 0; i + 4 <= used[0]; i += 4) out.push(buf.readUInt32LE(i));
    return out;
  };
  const uidOf = (device) => {
    const address = { mSelector: fourcc('uid '), mScope: fourcc('glob'), mElement: 0 };
    const ref = Buffer.alloc(8), used = [0], text = Buffer.alloc(256);
    if (GetData(device, address, 0, null, 8, used, ref) !== 0) return '';
    const str = ref.readBigUInt64LE(0);
    if (!str) return '';
    const ok = CFStringGetCString(str, text, text.length, UTF8);
    CFRelease(str);
    return ok ? text.toString('utf8', 0, text.indexOf(0)) : '';
  };

  const device = ids(1 /* the system object */, 'dev#').find((d) => uidOf(d) === OBS_DEVICE_UID);
  if (!device) {
    throw fail('no-driver', 'The camera needs OBS Studio 30 or newer. Install OBS, click "Start Virtual Camera" in it once, allow the camera extension in System Settings, then stop it and try again.');
  }
  const streams = ids(device, 'stm#');
  if (streams.length < 2) throw fail('failed', 'The OBS camera has no input stream.');
  const stream = streams[1];   // [0] is what other programs watch, [1] is where frames go in

  const altered = koffi.register(() => {}, koffi.pointer(Altered));
  const queueOut = [null];
  if (CopyBufferQueue(stream, altered, null, queueOut) !== 0 || !queueOut[0]) {
    koffi.unregister(altered);
    throw fail('failed', 'Could not connect to the OBS camera.');
  }
  const queue = queueOut[0];
  const formatOut = [null];
  FormatCreate(null, UYVY, w, h, null, formatOut);
  const format = formatOut[0];

  // pixel buffers have to be IOSurface-backed to cross over to the camera extension
  const key = CFStringCreateWithCString(null, 'IOSurfaceProperties', UTF8);
  const empty = CFDictionaryCreate(null, null, null, 0, keyCallbacks, valueCallbacks);
  const keys = Buffer.alloc(8), values = Buffer.alloc(8);
  keys.writeBigUInt64LE(BigInt(key)); values.writeBigUInt64LE(BigInt(empty));
  const attrs = CFDictionaryCreate(null, keys, values, 1, keyCallbacks, valueCallbacks);

  if (StartStream(device, stream) !== 0) {
    for (const o of [attrs, empty, key, format, queue]) if (o) CFRelease(o);
    koffi.unregister(altered);
    throw fail('busy', 'Could not start the OBS camera. If OBS is using its virtual camera, stop it there first.');
  }

  let open = true, uyvy = null;
  return {
    width: w, height: h,
    send(bgra) {
      if (!open) return;
      const bufOut = [null];
      if (PixelBufferCreate(null, w, h, UYVY, attrs, bufOut) !== 0 || !bufOut[0]) return;
      const pixels = bufOut[0];
      Lock(pixels, 0);
      const stride = Number(BytesPerRow(pixels));
      if (!uyvy || uyvy.length !== stride * h) uyvy = Buffer.alloc(stride * h);
      bgraToUyvy(bgra, w, h, uyvy, stride);
      memcpy(BaseAddress(pixels), uyvy, uyvy.length);
      Unlock(pixels, 0);

      const none = { value: 0, timescale: 0, flags: 0, epoch: 0 };
      const timing = { duration: none, presentationTimeStamp: { value: uptimeNs(CLOCK_UPTIME_RAW), timescale: 1000000000, flags: 1, epoch: 0 }, decodeTimeStamp: none };
      const sampleOut = [null];
      const made = SampleCreate(null, pixels, true, null, null, format, timing, sampleOut) === 0 && sampleOut[0];
      // the queue keeps the sample when it takes it; a full queue (nobody watching) hands it back
      if (made && Enqueue(queue, sampleOut[0]) !== 0) CFRelease(sampleOut[0]);
      CFRelease(pixels);
    },
    close() {
      if (!open) return;
      open = false;
      StopStream(device, stream);
      for (const o of [attrs, empty, key, format, queue]) if (o) CFRelease(o);
      koffi.unregister(altered);
    },
  };
}

/* Opens the camera for w x h BGRA frames. Resolves { width, height, send(bgra), close() };
   rejects with an Error whose .code is 'no-driver' | 'busy' | 'unsupported' | 'failed'. */
async function open(w, h, platform = process.platform) {
  try {
    if (platform === 'win32') return await openWindows(w, h);
    if (platform === 'darwin') return openMac(w, h);
  } catch (e) {
    if (e.code) throw e;
    throw fail('failed', 'The virtual camera could not start: ' + e.message);
  }
  throw fail('unsupported', 'The virtual camera works on Windows and macOS.');
}

module.exports = { open, FPS, DEVICE_NAME, bgraToNv12, bgraToUyvy, queueLayout, queueHeader, Q, Q_STATE, FRAME_HEADER };
