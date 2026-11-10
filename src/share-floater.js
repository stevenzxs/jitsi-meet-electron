const floater = document.querySelector('#floater');
const statusText = document.querySelector('#statusText');
const sourceName = document.querySelector('#sourceName');
const errorText = document.querySelector('#errorText');
const pauseBtn = document.querySelector('#pauseBtn');
const switchBtn = document.querySelector('#switchBtn');
const stopBtn = document.querySelector('#stopBtn');
const audioBtn = document.querySelector('#audioBtn');
const videoBtn = document.querySelector('#videoBtn');
const recordingBtn = document.querySelector('#recordingBtn');
const participantsBtn = document.querySelector('#participantsBtn');
let state = { active: false, paused: false, busy: '' };

function setLabel(button, text) {
  const label = button.querySelector('.label');
  if (label) label.textContent = text;
}

/** 双图标按钮（如麦克风/摄像头/暂停）：isOff=true 显示"关闭态"图标。
 *  注意 SVG 元素没有 hidden IDL 属性，必须用 toggleAttribute 操作内容属性。 */
function setIconState(button, isOff) {
  const onIcon = button.querySelector('.icon--on');
  const offIcon = button.querySelector('.icon--off');
  if (!onIcon || !offIcon) return;
  onIcon.toggleAttribute('hidden', Boolean(isOff));
  offIcon.toggleAttribute('hidden', !isOff);
}

function render(next) {
  if (!next) return;
  state = next;
  floater.classList.toggle('is-paused', Boolean(state.paused));
  floater.classList.toggle('is-collapsed', Boolean(state.collapsed));
  const busyLabels = { pause: '正在暂停', resume: '正在恢复', switch: '正在选择新内容', stop: '正在结束共享' };
  statusText.textContent = busyLabels[state.busy] || (state.paused ? '共享已暂停'
    : state.sourceHidden ? '共享窗口已隐藏' : '正在共享');
  sourceName.textContent = state.sourceName || '';
  sourceName.title = state.sourceName || '';
  errorText.textContent = state.error || state.media?.recording?.error || '';
  errorText.title = errorText.textContent;
  setLabel(pauseBtn, state.paused ? '恢复共享' : '暂停共享');
  setIconState(pauseBtn, Boolean(state.paused));
  pauseBtn.disabled = switchBtn.disabled = !state.active || Boolean(state.busy);
  stopBtn.disabled = !state.active || state.busy === 'stop';
  setLabel(stopBtn, state.busy === 'stop' ? '正在结束…' : '结束共享');
  const media = state.media || {};
  audioBtn.disabled = videoBtn.disabled = participantsBtn.disabled = !media.available;
  setLabel(audioBtn, media.audioMuted ? '解除静音' : '静音');
  setIconState(audioBtn, Boolean(media.audioMuted));
  setLabel(videoBtn, media.videoMuted ? '开启摄像头' : '关闭摄像头');
  setIconState(videoBtn, Boolean(media.videoMuted));
  audioBtn.setAttribute('aria-pressed', String(media.audioMuted === false));
  videoBtn.setAttribute('aria-pressed', String(media.videoMuted === false));
  const recording = media.recording || {};
  recordingBtn.hidden = !media.available || !recording.available;
  recordingBtn.disabled = !media.available || !recording.available || Boolean(recording.busy || state.mediaBusy);
  setLabel(recordingBtn, recording.busy ? '正在处理…' : recording.active ? '停止录屏' : '录屏');
  setIconState(recordingBtn, Boolean(recording.active));
  recordingBtn.classList.toggle('is-recording', Boolean(recording.active));
  recordingBtn.setAttribute('aria-pressed', String(Boolean(recording.active)));
}
pauseBtn.addEventListener('click', () => window.shareFloater.action(state.paused ? 'resume' : 'pause'));
switchBtn.addEventListener('click', () => window.shareFloater.action('switch'));
stopBtn.addEventListener('click', () => window.shareFloater.action('stop'));
document.querySelector('#showMeetingBtn').addEventListener('click', () => window.shareFloater.showMeeting());
audioBtn.addEventListener('click', () => window.shareFloater.media('audio'));
videoBtn.addEventListener('click', () => window.shareFloater.media('video'));
recordingBtn.addEventListener('click', () => {
  if (recordingBtn.disabled) return;
  recordingBtn.disabled = true;
  window.shareFloater.media('recording');
});
participantsBtn.addEventListener('click', () => window.shareFloater.media('participants'));
floater.addEventListener('mouseenter', () => window.shareFloater.hover(true));
floater.addEventListener('mouseleave', () => window.shareFloater.hover(false));
floater.addEventListener('focusin', () => window.shareFloater.hover(true));
floater.addEventListener('focusout', event => {
  if (!floater.contains(event.relatedTarget)) window.shareFloater.hover(false);
});
window.shareFloater.onState(render);
window.shareFloater.getState().then(render);
