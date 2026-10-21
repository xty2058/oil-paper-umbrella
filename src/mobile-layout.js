// 仅管理手机控制区的展开状态；不参与模型、目录选择或文化数据。
const compact = matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px) and (orientation: landscape)');
const exhibition = document.querySelector('#exhibition');
const toggle = document.querySelector('#mobile-controls-toggle');
const controls = document.querySelector('#exhibit-controls');
let collapsed = true;
function sync() {
  if (!compact.matches) {
    delete exhibition.dataset.mobileControlsCollapsed;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.textContent = '收起控制';
    return;
  }
  exhibition.dataset.mobileControlsCollapsed = String(collapsed);
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.textContent = collapsed ? '展开控制 · 开合 / 纹样' : '收起控制';
}
toggle.addEventListener('click', () => {
  if (!compact.matches) return;
  collapsed = !collapsed;
  sync();
});
function onBreakpointChange() {
  if (compact.matches && controls.contains(document.activeElement)) collapsed = false;
  sync();
}
compact.addEventListener('change', onBreakpointChange);
window.addEventListener('pagehide', () => compact.removeEventListener('change', onBreakpointChange), { once: true });
sync();
