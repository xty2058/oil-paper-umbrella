// 正式展台只管理资源与输入；网格、UV、透光均复用现有生成器和场景。
const stage = document.querySelector('#stage');
const fieldset = document.querySelector('#exhibit-controls');
const open = document.querySelector('#exhibit-open');
const openValue = document.querySelector('#exhibit-open-value');
const pattern = document.querySelector('#exhibit-pattern');
const rotation = document.querySelector('#exhibit-rotation');
const status = document.querySelector('#exhibit-status');
const retry = document.querySelector('#exhibit-retry');
const projectURL = new URL('../', import.meta.url);
const patterns = [
  ['assets/optimized/patterns/peony-crimson.webp', '朱红牡丹'], ['assets/optimized/patterns/westlake-ink.webp', '西湖水墨'],
  ['assets/optimized/patterns/plum-ink.webp', '水墨梅花'], ['assets/optimized/patterns/lotus-scroll.webp', '缠枝莲纹'],
  ['assets/optimized/patterns/bat-fortune.webp', '蝙蝠福寿'], ['assets/optimized/patterns/rain-bamboo.webp', '雨竹清韵'],
  ['assets/optimized/patterns/cloud-thunder.webp', '云雷纹'], ['assets/optimized/patterns/crane-cloud.webp', '白鹤祥云'], ['', '无贴图'],
];
for (const [path, label] of patterns) pattern.add(new Option(label, path));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
rotation.checked = !reducedMotion.matches;
function syncMotionPreference() {
  rotation.disabled = reducedMotion.matches;
  rotation.title = reducedMotion.matches ? '系统已开启减少动态效果，自动旋转已停止' : '';
  if (reducedMotion.matches) { rotation.checked = false; view?.setAutoRotate(false); }
}
reducedMotion.addEventListener('change', syncMotionPreference);
let enginePromise, view, active, requestedRecord, revision = 0, closed = false, frame;
syncMotionPreference();
function message(text, error = false, busy = false) {
  status.textContent = text; status.dataset.error = String(error);
  stage.setAttribute('aria-busy', String(busy));
  document.querySelector('#page-retry').hidden = !error;
}
function within(promise, milliseconds, reason) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(reason)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}
function release(resources) { resources?.canopy?.dispose(); resources?.wood?.dispose(); }
function engine() {
  if (!enginePromise) {
    enginePromise = within(Promise.all([import('three'), import('./umbrella.js'), import('./scene.js')]), 15000,
      '三维组件加载超时，请检查网络或 CDN 连接').then(([THREE, generator, scene]) => {
      if (closed) throw new Error('页面已关闭');
      view = scene.createScene(stage, { autoRotate: rotation.checked, viewFromAbove: true });
      view.pauseAutoRotate();
      stage.querySelector('canvas').setAttribute('aria-label', '油纸伞三维展示：方向键旋转，加减键缩放，也可拖动旋转、滚轮缩放');
      stage.querySelector('canvas').setAttribute('aria-describedby', 'exhibit-help');
      return { THREE, ...generator };
    }).catch(error => { enginePromise = null; throw error; });
  }
  return enginePromise;
}
async function loadCanopy(THREE, path) {
  if (!path) return null;
  const url = new URL(path, projectURL);
  return new Promise((resolve, reject) => {
    let settled = false;
    const loader = new THREE.TextureLoader();
    const texture = loader.load(url.href, () => {
      if (settled) { texture.dispose(); return; }
      settled = true; clearTimeout(timer);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = 4;
      resolve(texture);
    }, undefined, () => {
      if (settled) return;
      settled = true; clearTimeout(timer); texture.dispose();
      reject(new Error('纹样图片无法读取：' + path));
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true; texture.dispose(); reject(new Error('纹样加载超时：' + path));
    }, 15000);
  });
}
function modelParams(record, canopy, amount) {
  return { ...record.geometry, ...record.material, canopyTexture: canopy, openAmount: amount };
}
export async function showUmbrella(record) {
  if (closed) return;
  requestedRecord = record;
  const token = ++revision;
  if (frame) cancelAnimationFrame(frame);
  frame = null;
  fieldset.disabled = true; retry.hidden = true;
  message(`正在载入 ${record.name}…`, false, true);
  let resources;
  try {
    const api = await engine();
    if (token !== revision || closed) return;
    const path = record.textureAssets?.canopy?.path || '';
    const results = await Promise.allSettled([
      api.loadUmbrellaTextures(record.textureAssets || {}), loadCanopy(api.THREE, path),
    ]);
    resources = { wood: results[0].status === 'fulfilled' ? results[0].value : null, canopy: results[1].status === 'fulfilled' ? results[1].value : null };
    if (token !== revision || closed) { release(resources); return; }
    const failed = results.find(r => r.status === 'rejected');
    if (failed) throw failed.reason;
    const amount = Number.isFinite(record.geometry?.openAmount) ? record.geometry.openAmount : 1;
    const next = api.createUmbrella(modelParams(record, resources.canopy, amount), resources.wood);
    try { view.setLighting(record.lighting); view.setModel(next); }
    catch (error) { disposeGroup(next); throw error; }
    const previous = active;
    active = { record, ...resources, path, amount, api };
    resources = null;
    release(previous);
    if (path && ![...pattern.options].some(o => o.value === path)) pattern.add(new Option('资料卡纹样', path));
    pattern.value = path;
    open.value = amount; openValue.value = `${Math.round(amount * 100)}%`;
    open.setAttribute('aria-valuetext', openValue.value);
    stage.dataset.loadedId = record.id;
    fieldset.disabled = false;
    view.pauseAutoRotate(1800);
    message('模型已就绪 · 纹样为设计演示');
  } catch (error) {
    release(resources);
    if (token !== revision || closed) return;
    message(`模型载入失败：${error.message}。${active ? '展台仍显示「' + active.record.name + '」模型，请重试所选资料。' : '请重试；仍失败可重新加载页面。'}`, true);
    retry.hidden = false;
  }
}
function disposeGroup(group) {
  const geometries = new Set(), materials = new Set();
  group.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}
open.addEventListener('input', () => {
  if (!active || fieldset.disabled) return;
  view.pauseAutoRotate();
  openValue.value = `${Math.round(Number(open.value) * 100)}%`;
  open.setAttribute('aria-valuetext', openValue.value);
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    if (closed || fieldset.disabled) return;
    try {
      const amount = Number(open.value);
      const next = active.api.createUmbrella(modelParams(active.record, active.canopy, amount), active.wood);
      view.setModel(next, { reframe: false }); active.amount = amount;
    } catch (error) {
      open.value = active.amount; openValue.value = `${Math.round(active.amount * 100)}%`;
      open.setAttribute('aria-valuetext', openValue.value);
      message('开合未应用：' + error.message, true);
    }
  });
});
pattern.addEventListener('change', async () => {
  if (!active || fieldset.disabled) return;
  const current = active, token = ++revision, path = pattern.value;
  view.pauseAutoRotate(); message('正在切换纹样…', false, true);
  let candidate, next;
  try {
    candidate = await loadCanopy(current.api.THREE, path);
    if (closed || token !== revision || active !== current) { candidate?.dispose(); return; }
    // 预编译期间仍能开合或拖动；提交前对齐最新开合量。
    let amount;
    do {
      if (next) { disposeGroup(next); next = null; }
      amount = current.amount;
      next = current.api.createUmbrella(modelParams(current.record, candidate, amount), current.wood);
      await within(view.prepareModel(next), 15000, '纹样预处理超时，请重试或重新加载页面');
      if (closed || token !== revision || active !== current) {
        disposeGroup(next); next = null; candidate?.dispose(); return;
      }
    } while (amount !== current.amount);
    view.setModel(next, { reframe: false, transition: true }); next = null;
    const previous = current.canopy;
    current.canopy = candidate; current.path = path; candidate = null;
    previous?.dispose(); message(`纹样已更新：${pattern.selectedOptions[0].textContent}`);
  } catch (error) {
    if (next) disposeGroup(next);
    candidate?.dispose();
    if (token !== revision || closed) return;
    pattern.value = current.path;
    message('纹样切换失败，保留原纹样：' + error.message, true);
  }
});
rotation.addEventListener('change', () => view?.setAutoRotate(rotation.checked));
fieldset.addEventListener('pointerdown', () => view?.pauseAutoRotate());
retry.addEventListener('click', () => { if (requestedRecord) showUmbrella(requestedRecord); });
window.addEventListener('pagehide', () => {
  closed = true; revision++;
  reducedMotion.removeEventListener('change', syncMotionPreference);
  if (frame) cancelAnimationFrame(frame);
  view?.dispose(); release(active); active = null;
}, { once: true });
