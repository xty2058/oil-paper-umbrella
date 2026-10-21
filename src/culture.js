// 文化内容只取自当前记录；不把演示参数、插画或空条目补成历史事实。
const root = document.querySelector('#culture');
const panels = Object.fromEntries(['form', 'craft', 'pattern'].map(key => [key, document.querySelector(`#panel-${key}`)]));
const tabs = [...root.querySelectorAll('[role="tab"]')];
const projectURL = new URL('../', import.meta.url);
let activeTab = 'form';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function safeURL(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, projectURL);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function sourceDetails(sources) {
  const entries = Array.isArray(sources) ? sources.filter(s => s && typeof s === 'object') : [];
  const details = element('details');
  details.append(element('summary', `查看来源（${entries.length}）`));
  if (!entries.length) {
    details.append(element('p', '暂无来源资料', 'empty-text'));
    return details;
  }
  const list = element('ul', null, 'source-list');
  for (const source of entries) {
    const li = element('li');
    const url = safeURL(source.url);
    if (url) {
      const link = element('a', source.title || '来源');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      li.append(link);
    } else li.append(element('span', `${source.title || '来源'}（链接不可用）`));
    if (source.publisher) li.append(element('p', source.publisher));
    if (source.locator) li.append(element('p', `支持位置：${source.locator}`));
    list.append(li);
  }
  details.append(list);
  return details;
}
function tag(text, pending = false) { return element('span', text, pending ? 'tag tag-pending' : 'tag'); }
function grade(record) {
  const fragment = document.createDocumentFragment();
  fragment.append(tag(['史实', '推断', '传说'].includes(record.level) ? record.level : '分级未注明'));
  if (record.pendingVerification) fragment.append(tag('待核实', true));
  return fragment;
}
function image(path, alt) {
  const wrapper = element('div');
  const url = safeURL(path);
  if (!url) { wrapper.append(element('p', '暂无图片资料', 'empty-text')); return wrapper; }
  const img = element('img');
  img.alt = alt;
  img.loading = 'lazy';
  img.addEventListener('error', () => wrapper.replaceChildren(element('p', '图片暂无法显示', 'empty-text')), { once: true });
  img.src = url;
  wrapper.append(img);
  return wrapper;
}
function showTab(key, focus = false) {
  activeTab = key;
  for (const tab of tabs) {
    const selected = tab.id === `tab-${key}`;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  for (const [id, panel] of Object.entries(panels)) panel.hidden = id !== key;
}
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => showTab(tab.id.slice(4)));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); showTab(tabs[next].id.slice(4), true); }
  });
}

function renderForm(record) {
  const panel = panels.form;
  panel.append(element('h3', '形制资料'));
  const measurements = record.realDimensions?.measurements;
  if (Array.isArray(measurements) && measurements.length) {
    const list = element('ul');
    for (const measurement of measurements) {
      const li = element('li', `${measurement.name || measurement.field || '尺寸'}：${measurement.value ?? '暂无数值'} ${measurement.unit || ''}`);
      if (measurement.pendingVerification) li.append(tag('待核实', true));
      li.append(sourceDetails(measurement._source));
      list.append(li);
    }
    panel.append(list);
  } else panel.append(element('p', '暂无实物尺寸资料。', 'empty-text'));
  const demoFields = [['ribCount', '骨数', '根'], ['ribLength', '骨长', '米'], ['canopyRise', '伞面拱高', '米'], ['shaftLength', '中棒长度', '米']];
  const available = demoFields.filter(([key]) => Number.isFinite(record.geometry?.[key]));
  if (available.length) {
    panel.append(element('h3', '演示模型形制'), tag('设计演示'));
    panel.append(element('p', '以下为设计演示参数，不代表实物测量或历史尺寸。', 'body-text'));
    if (record.modelProvenance?.note) {
      const explanation = element('details');
      explanation.append(element('summary', '查看设计演示说明'), element('p', record.modelProvenance.note));
      panel.append(explanation);
    }
    const table = element('table', null, 'parameter-table');
    const tbody = element('tbody');
    for (const [key, label, unit] of available) {
      const tr = element('tr');
      const th = element('th', label); th.scope = 'row';
      tr.append(th, element('td', `${record.geometry[key]} ${unit}`));
      tbody.append(tr);
    }
    table.append(tbody); panel.append(table);
    if (record.modelProvenance?.presetStatus) panel.append(element('p', `参数预设：${record.modelProvenance.presetStatus}`, 'empty-text'));
  }
  const entries = Array.isArray(record.culture) ? record.culture : [];
  if (entries.length) panel.append(element('h3', '相关资料'));
  for (const entry of entries) {
    const section = element('section', null, 'fact');
    section.append(element('h3', entry.title || '资料条目'), grade(entry));
    if (entry.text?.trim()) section.append(element('p', entry.text, 'body-text'));
    else section.append(element('p', entry.pendingVerification ? '暂无已核实资料' : '暂无资料', 'empty-text'));
    const details = sourceDetails(entry._source);
    if (entry.pendingVerification && entry.verificationNote) details.append(element('p', `待核实说明：${entry.verificationNote}`));
    section.append(details); panel.append(section);
  }
  if (!entries.length && !available.length && !(Array.isArray(measurements) && measurements.length)) panel.append(element('p', '暂无形制资料', 'empty-text'));
}
function renderCraft(record) {
  const steps = Array.isArray(record.craftSteps) ? record.craftSteps : [];
  const panel = panels.craft;
  if (!steps.length) {
    panel.append(element('h3', '工艺步骤'), element('p', '暂无工艺资料，尚未录入可核对的八步教学流程及对应插画。', 'empty-text'));
    const gap = record.researchGaps?.find(item => item.topic === '完整工艺流程');
    if (gap?.note) {
      const details = element('details');
      details.append(element('summary', '查看资料缺口'), element('p', gap.note));
      panel.append(details);
    }
    return;
  }
  if (record.craftOverview?.note) panel.append(element('p', record.craftOverview.note, 'body-text'));
  else panel.append(element('p', `共 ${steps.length} 步，按本条资料的步骤顺序展示。`, 'empty-text'));
  const list = element('ol', null, 'steps');
  for (const [index, step] of steps.entries()) {
    const li = element('li', null, 'step');
    li.append(image(step.image, `${step.name || '工艺步骤'}工艺插画`));
    const content = element('div');
    content.append(element('h3', `${index + 1}. ${step.name || '未命名步骤'}`), grade(step));
    content.append(element('p', step.desc?.trim() || '暂无步骤说明', step.desc?.trim() ? 'body-text' : 'empty-text'));
    content.append(element('p', '工艺插画仅作教学示意，不作为实物或历史影像证据。', 'empty-text'));
    content.append(sourceDetails(step._source));
    li.append(content); list.append(li);
  }
  panel.append(list);
}
function renderPattern(record) {
  const panel = panels.pattern;
  const texture = record.textureAssets?.canopy;
  if (!texture?.path) { panel.append(element('p', '暂无纹样资料', 'empty-text')); return; }
  panel.append(element('h3', '当前资料卡纹样'));
  if (texture.kind === 'AI-generated-design-demonstration') panel.append(tag('AI 设计演示'));
  if (texture.isVerifiedTraditionalReplica === false) panel.append(tag('未经实物复原核对', true));
  const figure = element('figure', null, 'pattern-figure');
  figure.append(image(texture.path, `${record.name}的资料卡纹样`));
  figure.append(element('figcaption', '资料卡中的纹样图片'));
  panel.append(figure);
  if (texture.note) panel.append(element('p', texture.note, 'body-text'));
  panel.append(element('h3', '纹样说明'));
  panel.append(element('p', texture.desc?.trim() || '暂无更多纹样资料，不据图案自动推定寓意或地域来源。', texture.desc?.trim() ? 'body-text' : 'empty-text'));
  panel.append(sourceDetails(texture._source));
}
export function renderCulture(record) {
  root.dataset.umbrellaId = record?.id || '';
  document.querySelector('#culture-record').textContent = record?.name || '尚未选择';
  for (const panel of Object.values(panels)) panel.replaceChildren();
  if (!record) {
    for (const panel of Object.values(panels)) panel.append(element('p', '暂无资料', 'empty-text'));
  } else {
    renderForm(record); renderCraft(record); renderPattern(record);
  }
  showTab(activeTab);
}
