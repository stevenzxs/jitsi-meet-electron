// Runs in sandboxed isolated preloads; the installed main-world function has no
// Node access. Only this frame's explicitly authorized display capture is wrapped.
function installCaptureRuntime() {
  const bridge = window.cloudmeetShareTransport;
  const devices = navigator.mediaDevices;
  if (!devices?.getDisplayMedia || window.__cloudmeetCapture) return;
  const nativeDisplayMedia = devices.getDisplayMedia.bind(devices);
  let capture = null;
  let meeting = null;

  // Keep the public External API instance used by the embedded meeting page.
  // This uses its documented methods, not Jitsi's private store or tracks.
  const wrapAPI = Constructor => typeof Constructor !== 'function' ? Constructor : new Proxy(Constructor, {
    construct(target, args, newTarget) {
      const api = Reflect.construct(target, args, newTarget);
      meeting = api;
      return api;
    },
  });
  const apiDescriptor = Object.getOwnPropertyDescriptor(window, 'JitsiMeetExternalAPI');
  if (!apiDescriptor || apiDescriptor.configurable) {
    let Constructor = wrapAPI(window.JitsiMeetExternalAPI);
    Object.defineProperty(window, 'JitsiMeetExternalAPI', {
      configurable: true, enumerable: true,
      get: () => Constructor,
      set: value => { Constructor = wrapAPI(value); },
    });
  }
  const stopStream = stream => stream?.getTracks().forEach(track => track.stop());
  async function deadline(promise, ms, onLate = () => {}) {
    let expired = false;
    let timer;
    try {
      return await Promise.race([
        promise.then(value => { if (expired) onLate(value); return value; }),
        new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('操作超时，请重试')); }, ms); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  async function makeInput(stream) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      await deadline(video.play(), 10000);
      // A successful play() provides current frame dimensions before the first
      // canvas draw; wait for loadeddata when metadata arrives separately.
      if (!video.videoWidth) await deadline(new Promise((resolve, reject) => {
        video.addEventListener('loadeddata', resolve, { once: true });
        video.addEventListener('error', reject, { once: true });
      }), 5000);
      if (!video.videoWidth) throw new Error('共享源没有可用画面');
      return { stream, video, disconnect() { video.pause(); video.srcObject = null; stopStream(stream); } };
    } catch (error) { video.srcObject = null; stopStream(stream); throw error; }
  }

  async function createCapture(stream, grant, options) {
    let input = await makeInput(stream);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) { input.disconnect(); throw new Error('无法创建共享画面'); }
    const frozen = document.createElement('canvas');
    const frozenContext = frozen.getContext('2d', { alpha: false });
    if (!frozenContext) { input.disconnect(); throw new Error('无法创建暂停画面'); }
    let paused = false;
    let ended = false;
    let busy = false;
    let timer;
    let output;
    let audioContext;
    let audioSource;
    let audioGain;
    let destination;
    function draw() {
      if (ended) return;
      if (!paused) {
        const width = input.video.videoWidth;
        const height = input.video.videoHeight;
        if (!width || !height) return;
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        context.drawImage(input.video, 0, 0, canvas.width, canvas.height);
      } else {
        context.drawImage(frozen, 0, 0);
        const label = '共享已暂停';
        context.fillStyle = 'rgba(15, 23, 42, 0.8)';
        context.fillRect(16, 16, 164, 44);
        context.fillStyle = '#ffffff';
        context.font = '20px sans-serif';
        context.fillText(label, 36, 46);
      }
      output?.getVideoTracks()[0]?.requestFrame?.();
    }
    function dispose(notify = true) {
      if (ended) return;
      ended = true;
      clearInterval(timer);
      input.disconnect();
      audioSource?.disconnect();
      audioGain?.disconnect();
      void audioContext?.close().catch(() => {});
      if (output) {
        for (const track of output.getTracks()) {
          nativeStops.get(track)?.();
          // Track.stop() itself does not dispatch ended. Consumers (including
          // Jitsi) must observe source closure when the floater stops capture.
          if (notify) track.dispatchEvent(new Event('ended'));
        }
      }
      if (capture?.token === grant.token) capture = null;
      bridge.ended(grant.token);
    }
    const nativeStops = new Map();
    function bindSource(source) {
      source.stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (input === source) dispose();
      }, { once: true });
    }
    function connectAudio(source) {
      if (!audioContext) return;
      audioSource?.disconnect();
      audioSource = source.stream.getAudioTracks().length ? audioContext.createMediaStreamSource(source.stream) : null;
      audioSource?.connect(audioGain);
    }
    try {
      draw();
      output = canvas.captureStream(0);
      const videoTrack = output.getVideoTracks()[0];
      videoTrack.contentHint = 'detail';
      const canvasSettings = videoTrack.getSettings.bind(videoTrack);
      videoTrack.getSettings = () => ({ ...input.stream.getVideoTracks()[0].getSettings(), ...canvasSettings(), frameRate: 30 });
      // A stable audio destination allows later source switches to change the
      // computer audio without replacing the track already published by Jitsi.
      if (options?.audio) {
        audioContext = new AudioContext();
        destination = audioContext.createMediaStreamDestination();
        audioGain = audioContext.createGain();
        audioGain.connect(destination);
        connectAudio(input);
        await deadline(audioContext.resume(), 5000);
        output.addTrack(destination.stream.getAudioTracks()[0]);
      }
      for (const track of output.getTracks()) {
        nativeStops.set(track, track.stop.bind(track));
        if (track.kind === 'video') track.stop = () => dispose(false);
      }
      bindSource(input);
      timer = setInterval(draw, 1000 / 30);
      draw();
      return {
        token: grant.token, output,
        async command({ action, shareAudio, expiresAt = Infinity }) {
          if (action === 'stop') { dispose(); return { ok: true }; }
          if (ended) return { ok: false, error: '共享已经结束' };
          if (Date.now() > expiresAt) return { ok: false, error: '操作已过期，请重试' };
          if (busy) return { ok: false, error: '正在处理上一项操作' };
          busy = true;
          try {
            if (action === 'pause' && !paused) {
              frozen.width = canvas.width; frozen.height = canvas.height;
              frozenContext.drawImage(canvas, 0, 0);
              paused = true;
              if (audioGain) audioGain.gain.value = 0;
              draw();
            } else if (action === 'resume') {
              paused = false;
              if (audioGain) audioGain.gain.value = 1;
              draw();
            } else if (action === 'switch') {
              if (shareAudio && !destination) throw new Error('本次共享未建立电脑声音轨道，请停止后重新开启声音共享');
              // The main process grants only the source confirmed in its picker.
              // The old stream stays alive until the candidate supplies a frame.
              const nextStream = await deadline(nativeDisplayMedia({ video: true, audio: Boolean(destination) }), 15000, stopStream);
              if (ended) { stopStream(nextStream); throw new Error('共享已经结束'); }
              const next = await makeInput(nextStream);
              if (ended) { next.disconnect(); throw new Error('共享已经结束'); }
              if (Date.now() > expiresAt) { next.disconnect(); throw new Error('操作已过期，请重试'); }
              const previous = input;
              const previousPaused = paused;
              const previousAudio = audioSource;
              let nextAudio;
              try {
                nextAudio = audioContext && next.stream.getAudioTracks().length
                  ? audioContext.createMediaStreamSource(next.stream) : null;
                nextAudio?.connect(audioGain);
                input = next;
                bindSource(input);
                paused = false;
                draw();
                previousAudio?.disconnect();
                audioSource = nextAudio;
                if (audioGain) audioGain.gain.value = 1;
                previous.disconnect();
              } catch (error) {
                input = previous;
                paused = previousPaused;
                nextAudio?.disconnect();
                next.disconnect();
                draw();
                throw error;
              }
            }
            return { ok: true, paused };
          } catch (error) { return { ok: false, error: error.message || '共享操作失败' }; }
          finally { busy = false; }
        },
      };
    } catch (error) { dispose(); throw error; }
  }

  Object.defineProperty(window, '__cloudmeetCapture', { value: {
    async command(payload) {
      if (!capture || payload?.token !== capture.token) return { ok: false, error: '共享会话已经失效' };
      return capture.command(payload);
    },
    async meetingState() {
      if (!meeting) return null;
      try {
        const [audioMuted, videoMuted] = await deadline(Promise.all([meeting.isAudioMuted(), meeting.isVideoMuted()]), 2000);
        return { audioMuted, videoMuted, available: true,
          recording: window.__cloudmeetRecording?.getState() || { available: false } };
      } catch { return { available: false }; }
    },
    async meetingCommand(action) {
      if (action === 'recording') {
        return window.__cloudmeetRecording?.toggle() || { ok: false, error: '录制控制尚未就绪' };
      }
      if (!meeting) return { ok: false, error: '会议控制尚未就绪' };
      const name = { audio: 'toggleAudio', video: 'toggleVideo', participants: 'toggleParticipantsPane' }[action];
      if (!name) return { ok: false, error: '不支持的会议操作' };
      if (action === 'participants') meeting.executeCommand(name, true);
      else meeting.executeCommand(name);
      return { ok: true };
    },
  } });
  devices.getDisplayMedia = async options => {
    const stream = await nativeDisplayMedia(options);
    let grant;
    try { grant = await bridge.claim(); }
    catch (error) { stopStream(stream); throw error; }
    if (!grant) return stream; // Recording/other non-sharing capture is untouched.
    let next;
    try {
      next = await createCapture(stream, grant, options);
      capture = next;
      if (!await bridge.ready(grant.token)) {
        await next.command({ action: 'stop' });
        throw new Error('共享授权已过期，请重新选择');
      }
      return next.output;
    } catch (error) {
      if (next) await next.command({ action: 'stop' });
      else { stopStream(stream); bridge.ended(grant.token); }
      throw error;
    }
  };
  window.addEventListener('pagehide', () => { void capture?.command({ action: 'stop' }); });
}

if (typeof process !== 'undefined' && process.type === 'renderer') {
  const { contextBridge, ipcRenderer } = require('electron');
  if (/^https?:$/.test(location.protocol)) {
    contextBridge.exposeInMainWorld('cloudmeetShareTransport', {
      claim: () => ipcRenderer.invoke('desktop-capture-claim'),
      ready: token => ipcRenderer.invoke('desktop-capture-ready', String(token)),
      ended: token => ipcRenderer.send('desktop-capture-ended', String(token)),
    });
    contextBridge.executeInMainWorld({ func: installCaptureRuntime });
  }
} else if (typeof module !== 'undefined') {
  module.exports = { installCaptureRuntime };
}
