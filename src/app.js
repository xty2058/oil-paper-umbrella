import { showUmbrella } from './exhibit.js';
// 目录、文化区和三维展台随当前记录更新。
import { renderCulture } from './culture.js';
const list = document.querySelector('#umbrella-list');
const mobileSelect = document.querySelector('#umbrella-select');
const count = document.querySelector('#catalog-count');
const status = document.querySelector('#catalog-status');
const selectedName = document.querySelector('#selected-name');
const exhibition = document.querySelector('#exhibition');
const retry = document.querySelector('#retry');
const dataURL = new URL('../data/umbrellas.json', import.meta.url);
let umbrellas = [];
let selectedId = null;
let loading = false;

function selectUmbrella(id) {
  const selected = umbrellas.find(umbrella => umbrella.id === id);
  if (!selected) return;
  selectedId = selected.id;
  mobileSelect.value = selectedId;
  for (const button of list.querySelectorAll('button[data-umbrella-id]')) {
    button.setAttribute('aria-pressed', String(button.dataset.umbrellaId === selectedId));
  }
  selectedName.textContent = selected.name;
  exhibition.dataset.umbrellaId = selectedId;
  renderCulture(selected);
  showUmbrella(selected);
}

function validateDirectory(data) {
  if (!data || !Array.isArray(data.umbrellas)) throw new Error('数据缺少 umbrellas 列表');
  const ids = new Set();
  for (const item of data.umbrellas) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()
        || typeof item.name !== 'string' || !item.name.trim()) {
      throw new Error('目录条目缺少有效的 id 或名称');
    }
    if (ids.has(item.id)) throw new Error('目录条目 id 重复');
    ids.add(item.id);
  }
  return data.umbrellas;
}

function renderDirectory() {
  const fragment = document.createDocumentFragment();
  for (const umbrella of umbrellas) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'umbrella-choice';
    button.dataset.umbrellaId = umbrella.id;
    button.setAttribute('aria-pressed', 'false');
    const name = document.createElement('span');
    name.className = 'choice-name';
    name.textContent = umbrella.name;
    const mark = document.createElement('span');
    mark.className = 'selection-mark';
    mark.textContent = '已选中';
    mark.setAttribute('aria-hidden', 'true');
    button.append(name, mark);
    item.append(button);
    fragment.append(item);
  }
  list.replaceChildren(fragment);
  mobileSelect.replaceChildren(...umbrellas.map(record => new Option(record.name, record.id)));
  mobileSelect.disabled = !umbrellas.length;
  if (!umbrellas.length) mobileSelect.add(new Option('暂无伞资料', ''));
  count.textContent = `${umbrellas.length} 把`;
  if (umbrellas.length) {
    selectUmbrella(umbrellas.some(item => item.id === selectedId) ? selectedId : umbrellas[0].id);
    status.textContent = '点击目录切换当前选择';
  } else {
    selectedId = null;
    delete exhibition.dataset.umbrellaId;
    selectedName.textContent = '尚未选择';
    status.textContent = '目录暂无记录';
    renderCulture(null);
    document.querySelector('#stage').setAttribute('aria-busy', 'false');
    document.querySelector('#exhibit-status').textContent = '暂无可展示的伞，请稍后重试目录。';
  }
}

async function loadDirectory() {
  if (loading) return;
  loading = true;
  retry.hidden = true;
  list.setAttribute('aria-busy', 'true');
  status.dataset.error = 'false';
  status.textContent = '正在读取目录…';
  if (!selectedId) {
    document.querySelector('#stage').setAttribute('aria-busy', 'true');
    document.querySelector('#exhibit-status').textContent = '正在读取目录，随后载入三维展台…';
    document.querySelector('#exhibit-status').dataset.error = 'false';
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(dataURL, { signal: controller.signal });
    if (!response.ok) throw new Error(`数据请求失败（HTTP ${response.status}）`);
    umbrellas = validateDirectory(await response.json());
    renderDirectory();
  } catch (error) {
    status.dataset.error = 'true';
    const reason = error.name === 'AbortError' ? '读取超时' : error.message;
    status.textContent = `目录读取失败：${reason}。请重新读取。`;
    retry.hidden = false;
    if (!selectedId) {
      document.querySelector('#stage').setAttribute('aria-busy', 'false');
      document.querySelector('#exhibit-status').textContent = '目录未能载入，展台暂不可用。请重试目录或重新加载页面。';
      document.querySelector('#exhibit-status').dataset.error = 'true';
      document.querySelector('#page-retry').hidden = false;
    }
  } finally {
    clearTimeout(timer);
    loading = false;
    list.setAttribute('aria-busy', 'false');
  }
}

list.addEventListener('click', event => {
  const button = event.target.closest('button[data-umbrella-id]');
  if (button && list.contains(button)) selectUmbrella(button.dataset.umbrellaId);
});
mobileSelect.addEventListener('change', () => { if (mobileSelect.value !== selectedId) selectUmbrella(mobileSelect.value); });
retry.addEventListener('click', loadDirectory);
loadDirectory();
