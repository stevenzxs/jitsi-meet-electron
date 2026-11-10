const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { installCaptureRuntime } = require('../src/share-capture-preload');

function harness() {
  const intervals = new Set();
  const canvases = [];
  const gains = [];
  const ended = [];
  let next;
  let rejectNext;
  let nativeCalls = 0;
  class Track extends EventTarget {
    constructor(kind) { super(); this.kind = kind; this.readyState = 'live'; }
    stop() { this.readyState = 'ended'; }
    getSettings() { return { displaySurface: 'monitor', width: 800, height: 600 }; }
    requestFrame() {}
  }
  class Stream {
    constructor(tracks = []) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
    getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
    addTrack(track) { this.tracks.push(track); }
  }
  function source(pixel = 1) {
    const stream = new Stream([new Track('video'), new Track('audio')]);
    stream.pixel = pixel; return stream;
  }
  const original = source(); next = original;
  const devices = { async getDisplayMedia() {
    nativeCalls++;
    if (rejectNext) throw new Error(rejectNext);
    return next;
  } };
  const window = Object.assign(new EventTarget(), {
    cloudmeetShareTransport: {
      claim: async () => ({ token: 'authorized', shareAudio: true }),
      ready: async () => true, ended: token => ended.push(token),
    },
  });
  class AudioContext {
    createMediaStreamDestination() { return { stream: new Stream([new Track('audio')]) }; }
    createGain() { const gain = { gain: { value: 1 }, connect() {}, disconnect() {} }; gains.push(gain); return gain; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    async resume() {} async close() {}
  }
  const document = { createElement(type) {
    if (type === 'video') return Object.assign(new EventTarget(), {
      videoWidth: 800, videoHeight: 600, srcObject: null,
      async play() { if (this.srcObject.failPlay) throw new Error('no first frame'); }, pause() {},
    });
    if (type === 'canvas') {
      const canvas = { width: 0, height: 0, pixel: 0,
        getContext() { return {
          drawImage(input) { canvas.pixel = input.srcObject ? input.srcObject.pixel : input.pixel; },
          fillRect() {}, fillText() {},
        }; },
        captureStream() { return new Stream([new Track('video')]); },
      };
      canvases.push(canvas); return canvas;
    }
    throw new Error(type);
  } };
  vm.runInNewContext(`(${installCaptureRuntime.toString()})()`, {
    window, navigator: { mediaDevices: devices }, document, AudioContext, Event,
    setInterval(fn) { intervals.add(fn); return fn; }, clearInterval(fn) { intervals.delete(fn); },
    setTimeout, clearTimeout, console,
  });
  return {
    window, devices, original, source, canvases, gains, ended,
    setNext(value) { next = value; rejectNext = null; },
    fail(message) { rejectNext = message; },
    draw() { intervals.forEach(fn => fn()); }, nativeCalls: () => nativeCalls,
    command: action => window.__cloudmeetCapture.command({ token: 'authorized', action, shareAudio: true }),
  };
}

test('recording command uses the meeting recorder and reports its live state', async () => {
  const app = harness(); let toggles = 0;
  app.window.JitsiMeetExternalAPI = class {
    async isAudioMuted() { return false; }
    async isVideoMuted() { return true; }
  };
  new app.window.JitsiMeetExternalAPI();
  let active = false;
  app.window.__cloudmeetRecording = {
    getState: () => ({ available: true, active, busy: false, error: '' }),
    toggle() { toggles++; active = !active; return { ok: true }; },
  };
  assert.equal((await app.window.__cloudmeetCapture.meetingState()).recording.active, false);
  assert.equal((await app.window.__cloudmeetCapture.meetingCommand('recording')).ok, true);
  assert.equal(toggles, 1);
  assert.equal((await app.window.__cloudmeetCapture.meetingState()).recording.active, true);
  delete app.window.__cloudmeetRecording;
  assert.equal((await app.window.__cloudmeetCapture.meetingCommand('recording')).ok, false);
});

test('pause freezes pixels and computer audio without ending or replacing output tracks', async t => {
  const app = harness(); const output = await app.devices.getDisplayMedia({ video: true, audio: true });
  t.after(() => app.command('stop'));
  const video = output.getVideoTracks()[0]; const audio = output.getAudioTracks()[0];
  assert.equal(app.canvases[0].pixel, 1);
  await app.command('pause'); app.original.pixel = 2; app.draw();
  assert.equal(app.canvases[0].pixel, 1); assert.equal(app.gains[0].gain.value, 0);
  assert.equal(video.readyState, 'live'); assert.equal(app.original.getVideoTracks()[0].readyState, 'live');
  await app.command('resume'); app.draw();
  assert.equal(app.canvases[0].pixel, 2); assert.equal(app.gains[0].gain.value, 1);
  assert.equal(output.getVideoTracks()[0], video); assert.equal(output.getAudioTracks()[0], audio);
  assert.equal(app.nativeCalls(), 1);
});
test('switch keeps published tracks stable and closes old input only after candidate succeeds', async t => {
  const app = harness(); const output = await app.devices.getDisplayMedia({ video: true, audio: true });
  t.after(() => app.command('stop'));
  const track = output.getVideoTracks()[0]; const next = app.source(7); app.setNext(next);
  assert.equal((await app.command('switch')).ok, true);
  assert.equal(app.canvases[0].pixel, 7); assert.equal(output.getVideoTracks()[0], track);
  assert.equal(app.original.getVideoTracks()[0].readyState, 'ended');
  assert.equal(next.getVideoTracks()[0].readyState, 'live');
});
test('failed capture and failed first frame both preserve original paused output', async t => {
  const app = harness(); const output = await app.devices.getDisplayMedia({ video: true, audio: true });
  t.after(() => app.command('stop')); await app.command('pause');
  app.fail('permission denied'); assert.equal((await app.command('switch')).ok, false);
  const broken = app.source(8); broken.failPlay = true; app.setNext(broken);
  assert.equal((await app.command('switch')).ok, false);
  app.original.pixel = 3; app.draw();
  assert.equal(app.canvases[0].pixel, 1); assert.equal(output.getVideoTracks()[0].readyState, 'live');
  assert.equal(app.original.getVideoTracks()[0].readyState, 'live');
  assert.equal(broken.getVideoTracks()[0].readyState, 'ended');
});
test('source closure ends published tracks and notifies the main process once', async () => {
  const app = harness(); const output = await app.devices.getDisplayMedia({ video: true, audio: true });
  let events = 0; output.getVideoTracks()[0].addEventListener('ended', () => events++);
  app.original.getVideoTracks()[0].dispatchEvent(new Event('ended'));
  assert.equal(output.getVideoTracks()[0].readyState, 'ended'); assert.equal(events, 1);
  assert.equal(app.ended.length, 1);
});
test('consumer stopping video releases raw capture and output audio', async () => {
  const app = harness(); const output = await app.devices.getDisplayMedia({ video: true, audio: true });
  output.getVideoTracks()[0].stop();
  assert.ok(output.getTracks().every(t => t.readyState === 'ended'));
  assert.ok(app.original.getTracks().every(t => t.readyState === 'ended'));
});
test('meeting commands use the captured External API instance', async () => {
  const app = harness(); const commands = [];
  app.window.JitsiMeetExternalAPI = class {
    async isAudioMuted() { return true; } async isVideoMuted() { return false; }
    executeCommand(...args) { commands.push(args); }
  };
  new app.window.JitsiMeetExternalAPI();
  const state = await app.window.__cloudmeetCapture.meetingState();
  assert.equal(state.audioMuted, true); assert.equal(state.videoMuted, false);
  await app.window.__cloudmeetCapture.meetingCommand('audio');
  await app.window.__cloudmeetCapture.meetingCommand('participants');
  assert.deepEqual(commands, [['toggleAudio'], ['toggleParticipantsPane', true]]);
});
test('an expired operation cannot switch the capture after a renderer stall', async t => {
  const app = harness(); await app.devices.getDisplayMedia({ video: true, audio: true });
  t.after(() => app.command('stop'));
  const result = await app.window.__cloudmeetCapture.command({ token: 'authorized', action: 'switch', expiresAt: 0 });
  assert.equal(result.ok, false); assert.equal(app.nativeCalls(), 1);
  assert.equal(app.original.getVideoTracks()[0].readyState, 'live');
});
