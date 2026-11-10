const tabButtons = Array.from(document.querySelectorAll('.picker__tab'));
const sourceGrid = document.querySelector('#sourceGrid');
const statusText = document.querySelector('#statusText');
const cancelBtn = document.querySelector('#cancelBtn');
const shareBtn = document.querySelector('#shareBtn');
const shareAudioToggle = document.querySelector('#shareAudioToggle');
const screenWarning = document.querySelector('#screenWarning');

let sources = { windows: [], screens: [] };
let activeType = 'window';
let selectedSourceId = '';
let loadError = '';
let requestId = new URLSearchParams(window.location.search).get('requestId') || '';

function getActiveSources() {
  return activeType === 'screen' ? sources.screens : sources.windows;
}

function getSourceById(sourceId) {
  return [...sources.windows, ...sources.screens].find((source) => source.id === sourceId) || null;
}

function getTypeLabel(type) {
  return type === 'screen' ? '整个屏幕' : '窗口';
}

function updateTabs() {
  tabButtons.forEach((button) => {
    const type = button.dataset.type;
    const count = type === 'screen' ? sources.screens.length : sources.windows.length;
    button.textContent = `${getTypeLabel(type)} ${count}`;
    button.classList.toggle('is-active', type === activeType);
    button.disabled = count === 0;
  });
}

function updateFooter() {
  const selectedSource = getSourceById(selectedSourceId);
  // 整屏共享会连会议窗口一起采进画面（递归嵌套），选中屏幕源时给出预告提示。
  screenWarning.hidden = !selectedSource || selectedSource.type !== 'screen';
  if (loadError) {
    shareBtn.disabled = true;
    shareBtn.textContent = '共享';
    statusText.textContent = loadError;
    return;
  }
  shareBtn.disabled = !selectedSource;
  shareBtn.textContent = '共享';
  statusText.textContent = selectedSource ? `将共享：${selectedSource.name}` : '请选择要共享的内容';
}

function createThumbnail(source) {
  const thumb = document.createElement('div');
  thumb.className = 'source-card__thumb';

  if (source.thumbnail) {
    const image = document.createElement('img');
    image.src = source.thumbnail;
    image.alt = source.name;
    thumb.appendChild(image);
  } else {
    // 暂无有效缩略图时回退为"图标+名称"占位。
    thumb.classList.add('source-card__thumb--placeholder');
    if (source.appIcon) {
      const icon = document.createElement('img');
      icon.className = 'source-card__thumb-icon';
      icon.src = source.appIcon;
      icon.alt = '';
      thumb.appendChild(icon);
    }
    const label = document.createElement('span');
    label.className = 'source-card__thumb-label';
    label.textContent = source.name;
    thumb.appendChild(label);
  }

  return thumb;
}

function createSourceCard(source) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'source-card';
  button.classList.toggle('is-selected', source.id === selectedSourceId);
  button.title = source.name;

  button.appendChild(createThumbnail(source));

  const name = document.createElement('div');
  name.className = 'source-card__name';
  if (source.appIcon) {
    const icon = document.createElement('img');
    icon.className = 'source-card__icon';
    icon.src = source.appIcon;
    icon.alt = '';
    name.appendChild(icon);
  }

  const title = document.createElement('span');
  title.className = 'source-card__title';
  title.textContent = source.name;
  name.appendChild(title);
  button.appendChild(name);

  // 单击先选中，双击直接共享，和常见文件/窗口选择体验一致。
  button.addEventListener('click', () => {
    selectedSourceId = source.id;
    render();
  });
  button.addEventListener('dblclick', () => submitSelection());

  return button;
}

function renderEmptyState() {
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = loadError || (activeType === 'screen' ? '没有可共享的屏幕' : '没有可共享的应用窗口');
  sourceGrid.appendChild(empty);
}

function renderLoading() {
  tabButtons.forEach((button) => {
    const type = button.dataset.type;
    button.textContent = getTypeLabel(type);
    button.classList.toggle('is-active', type === activeType);
    button.disabled = true;
  });
  sourceGrid.replaceChildren();

  const loading = document.createElement('div');
  loading.className = 'loading';
  const spinner = document.createElement('div');
  spinner.className = 'loading__spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = '正在加载可共享内容...';
  loading.append(spinner, text);
  sourceGrid.appendChild(loading);

  shareBtn.disabled = true;
  shareBtn.textContent = '共享';
  statusText.textContent = '正在加载可共享内容...';
}

function render() {
  updateTabs();
  sourceGrid.replaceChildren();

  const activeSources = getActiveSources();
  if (activeSources.length === 0) {
    selectedSourceId = '';
    renderEmptyState();
    updateFooter();
    return;
  }

  activeSources.forEach((source) => sourceGrid.appendChild(createSourceCard(source)));
  updateFooter();
}

function switchType(type) {
  if (!['window', 'screen'].includes(type) || type === activeType) return;
  activeType = type;
  selectedSourceId = '';
  render();
}

function submitSelection() {
  const selectedSource = getSourceById(selectedSourceId);
  if (!selectedSource) return;
  // 共享授权交给主进程完成，这里先给用户明确反馈，避免点击后误以为无效。
  shareBtn.disabled = true;
  shareBtn.textContent = '正在开启...';
  statusText.textContent = `正在共享：${selectedSource.name}`;
  window.screenSharePicker.select(requestId, selectedSource.id, Boolean(shareAudioToggle?.checked));
}

function cancelSelection() {
  window.screenSharePicker.cancel(requestId);
}

async function boot() {
  const currentRequestId = requestId;
  sources = { windows: [], screens: [] };
  activeType = 'window';
  selectedSourceId = '';
  loadError = '';
  renderLoading();

  try {
    sources = await window.screenSharePicker.getSources(currentRequestId);
  } catch {
    sources = { windows: [], screens: [], error: '获取共享内容失败，请稍后重试。' };
  }
  // 用户可能已经取消并触发了下一次共享请求，旧请求返回时不能覆盖新界面。
  if (currentRequestId !== requestId) {
    return;
  }
  loadError = sources.error || '';
  activeType = sources.windows.length > 0 ? 'window' : 'screen';
  render();
}

tabButtons.forEach((button) => {
  button.addEventListener('click', () => switchType(button.dataset.type));
});

shareBtn.addEventListener('click', submitSelection);
cancelBtn.addEventListener('click', cancelSelection);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    cancelSelection();
  } else if (event.key === 'Enter') {
    submitSelection();
  }
});

if (requestId) {
  void boot();
}
