import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LIGHTING_DEFAULTS, normalizeLighting, temperatureRGB } from './lighting.js';

/** 调参台场景。单位为米，+Y 向上；不生成伞，不含业务数据。 */
export function createScene(container, { autoRotate = false, viewFromAbove = false, ...lightingOptions } = {}) {
  const initialLighting = normalizeLighting(lightingOptions);
  const scene = new THREE.Scene();
  scene.background = viewFromAbove ? null : new THREE.Color(0xf0eee8);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 30);
  camera.position.set(1.4, viewFromAbove ? 3.7 : -0.40, 1.8);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: viewFromAbove });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = viewFromAbove ? 1.1 : 1.2;
  if (viewFromAbove) renderer.setClearColor(0xefeee7, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', '油纸伞三维调参预览，可用鼠标拖动旋转、滚轮缩放');
  canvas.tabIndex = 0;
  container.append(canvas);
  const controls = new OrbitControls(camera, canvas);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  controls.enableDamping = !reducedMotion.matches;
  controls.enablePan = false;
  // 浏览器处理纵向滚动与页面双指缩放，横向触摸交给 OrbitControls。
  const compactTouch = matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px) and (orientation: landscape)');
  const hint = container.parentElement?.querySelector('.exhibit-hint');
  const desktopHint = hint?.textContent;
  function syncTouchLayout() {
    if (!viewFromAbove) return;
    canvas.style.touchAction = compactTouch.matches ? 'pan-y pinch-zoom' : 'none';
    if (hint) hint.textContent = compactTouch.matches ? '左右拖动旋转 · 上下滑动浏览 · 双指缩放页面。外接键盘聚焦展台后：方向键旋转，+ / - 缩放。' : desktopHint;
  }
  compactTouch.addEventListener('change', syncTouchLayout);
  syncTouchLayout();
  controls.autoRotateSpeed = 0.15; // 约 400 秒一圈；原值 0.3 约 200 秒一圈。
  let rotationEnabled = autoRotate;
  let interacting = false;
  let resumeAfter = 0;
  let lastTick = performance.now();
  function pauseAutoRotate(delay = 2200) { resumeAfter = performance.now() + delay; controls.autoRotate = false; }
  controls.addEventListener('start', () => { interacting = true; pauseAutoRotate(); cancelTransition(); });
  controls.addEventListener('end', () => { interacting = false; pauseAutoRotate(); });
  function keyboardView(event) {
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(key)
        || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    pauseAutoRotate(); cancelTransition();
    // 只响应聚焦画布上的按键，不拦截页面滚动或其他控件。
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const step = THREE.MathUtils.degToRad(5);
    if (key === 'ArrowLeft') spherical.theta -= step;
    if (key === 'ArrowRight') spherical.theta += step;
    if (key === 'ArrowUp') spherical.phi -= step;
    if (key === 'ArrowDown') spherical.phi += step;
    if (key === '+' || key === '=') spherical.radius /= 1.1;
    if (key === '-' || key === '_') spherical.radius *= 1.1;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi, Math.max(0.01, controls.minPolarAngle), Math.min(Math.PI - 0.01, controls.maxPolarAngle));
    spherical.radius = THREE.MathUtils.clamp(spherical.radius, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
    controls.update();
    controls.enableDamping = damping;
  }
  canvas.addEventListener('keydown', keyboardView);
  controls.target.set(0, 0.42, 0);
  const ambient = new THREE.HemisphereLight(0xfff7ed, 0x8c9690, LIGHTING_DEFAULTS.ambientIntensity);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, initialLighting.keyIntensity);
  key.target.position.set(0, 0.6, 0);
  scene.add(key.target);
  scene.add(key);
  // 宽松的正面补光抬起竹骨与纸背暗部，不改变纸张 alpha。
  const fill = new THREE.DirectionalLight(0xf1f5ff, LIGHTING_DEFAULTS.fillIntensity);
  fill.position.set(2, 1.5, 3);
  fill.target.position.set(0, 0.5, 0);
  scene.add(fill.target, fill);
  setLighting(initialLighting);
  // 纸张背光散射近似：视觉模拟，不是纸纤维的真实多次散射模型。
  // 原生 MeshPhysicalMaterial 继续负责粗糙表面和折射；不改变 opacity。
  const paperLightDirection = { value: new THREE.Vector3() };
  const paperLightColor = { value: key.color };
  const paperLightIntensity = { value: key.intensity };
  const lightWorldDirection = new THREE.Vector3();
  const preparedPapers = new WeakSet();
  function preparePaperBacklight(group) {
    const paper = group.getObjectByName('canopy')?.material;
    if (!paper?.isMeshPhysicalMaterial) throw new TypeError('伞面需要 MeshPhysicalMaterial。');
    if (preparedPapers.has(paper)) return;
    preparedPapers.add(paper);
    paper.userData.backlightMode = 'diffuse-backlight-approximation';
    const prepareCanopyMap = paper.onBeforeCompile;
    const canopyCacheKey = paper.customProgramCacheKey();
    paper.onBeforeCompile = shader => {
      prepareCanopyMap.call(paper, shader);
      shader.uniforms.paperLightDirection = paperLightDirection;
      shader.uniforms.paperLightColor = paperLightColor;
      shader.uniforms.paperLightIntensity = paperLightIntensity;
      shader.uniforms.paperTransmission = { value: paper.transmission };
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
#include <common>
uniform vec3 paperLightDirection;
uniform vec3 paperLightColor;
uniform float paperLightIntensity;
uniform float paperTransmission;
`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
// 近似薄纸背面漫散射；没有降低 alpha，也没有伪造骨纹贴图。
float paperBackFacing = max(0.0, -dot(normal, normalize(paperLightDirection)));
vec3 paperScattering = diffuseColor.rgb * paperLightColor
  * paperLightIntensity * paperTransmission
  * (0.3 + 0.7 * roughness) * paperBackFacing * 0.55;
outgoingLight += paperScattering;
#include <opaque_fragment>
`);
    };
    paper.customProgramCacheKey = () => canopyCacheKey + ':paper-backlight-approximation-v1';
    paper.needsUpdate = true;
  }
  let model;
  let frame;
  let disposed = false;
  let fitRadius = 0.7;
  let frameRings = [];
  const center = new THREE.Vector3(0, 0.42, 0);
  let transitionLayer = null, transitionAnimation = null;
  function cancelTransition() {
    transitionAnimation?.cancel(); transitionAnimation = null;
    transitionLayer?.remove(); transitionLayer = null;
  }
  function syncMotionPreference() {
    controls.enableDamping = !reducedMotion.matches;
    if (reducedMotion.matches) { controls.autoRotate = false; cancelTransition(); }
  }
  reducedMotion.addEventListener('change', syncMotionPreference);
  // 同步复制已渲染的旧画面，不开启 preserveDrawingBuffer，不阻挡鼠标或触摸。
  function snapshotForTransition() {
    if (!model || interacting || reducedMotion.matches) return null;
    try {
      renderer.render(scene, camera);
      const layer = document.createElement('canvas');
      layer.width = canvas.width; layer.height = canvas.height;
      const context = layer.getContext('2d');
      if (!context) return null;
      context.drawImage(canvas, 0, 0);
      layer.setAttribute('aria-hidden', 'true');
      layer.dataset.patternTransition = '';
      Object.assign(layer.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '2', pointerEvents: 'none' });
      container.append(layer);
      return layer;
    } catch { return null; } // 无法取快照时直接更新，不显示空白占位。
  }
  async function prepareModel(next) {
    if (disposed) throw new Error('场景已关闭。');
    preparePaperBacklight(next);
    const map = next.getObjectByName('canopy')?.material.map;
    if (map) renderer.initTexture(map);
    // 与旧模型同时保留，先完成 shader 编译再提交新画面。
    await renderer.compileAsync(next, camera, scene);
    if (disposed) throw new Error('场景已关闭。');
  }

  function fit() {
    const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect);
    let distance = fitRadius / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov)) * 1.12;
    const direction = camera.position.clone().sub(controls.target).normalize();
    if (direction.lengthSq() === 0) direction.set(1, 0.6, 1).normalize();
    if (viewFromAbove) {
      // 按实际网格的径向轮廓取景，避免把手柄也当作伞面那么宽。
      // 每段轮廓绕轴采样，确保缓慢自转一圈仍保留完整边缘。
      const right = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
      if (right.lengthSq() === 0) right.set(1, 0, 0);
      const up = new THREE.Vector3().crossVectors(direction, right).normalize();
      distance = 0;
      for (const ring of frameRings) for (const y of [ring.minY, ring.maxY]) for (let i = 0; i < 64; i++) {
        const a = i * Math.PI * 2 / 64;
        const point = new THREE.Vector3(ring.radius * Math.cos(a), y - center.y, ring.radius * Math.sin(a));
        const depth = point.dot(direction);
        distance = Math.max(distance, depth + Math.abs(point.dot(right)) / Math.tan(horizontalHalfFov), depth + Math.abs(point.dot(up)) / Math.tan(verticalHalfFov));
      }
      distance *= 1.10;
    }
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction, distance);
    controls.minDistance = fitRadius * 0.65;
    controls.maxDistance = distance * 4;
    camera.near = Math.max(0.002, fitRadius / 200);
    camera.far = distance * 12;
    camera.updateProjectionMatrix();
    controls.update();
  }
  function release(group) {
    const geometries = new Set();
    const materials = new Set();
    group.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }
  function setModel(next, { reframe = true, transition = false } = {}) {
    if (!next?.isGroup) throw new TypeError('场景需要一个 Three.js Group。');
    preparePaperBacklight(next);
    cancelTransition();
    transitionLayer = transition ? snapshotForTransition() : null;
    if (model) {
      scene.remove(model);
      release(model);
    }
    model = next;
    scene.add(next);
    const p = next.userData.params;
    const radius = next.userData.mechanism.openRadius;
    if (!viewFromAbove) center.set(0, p.shaftLength / 2, 0);
    // 预留整把张开伞的空间；改变开合量不自动拉近相机。
    fitRadius = Math.hypot(radius + p.ribRadius, p.shaftLength / 2 + p.hubHeight);
    if (reframe) {
      const box = new THREE.Box3().setFromObject(next);
      if (viewFromAbove) {
        center.set(0, box.min.y + (box.max.y - box.min.y) * 0.62, 0);
        const bins = new Map();
        const point = new THREE.Vector3();
        const height = Math.max(box.max.y - box.min.y, 0.001);
        next.updateMatrixWorld(true);
        next.traverse(object => {
          const positions = object.geometry?.attributes.position;
          if (!positions) return;
          for (let i = 0; i < positions.count; i++) {
            point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
            const bin = Math.min(63, Math.floor((point.y - box.min.y) / height * 64));
            const ring = bins.get(bin) || { radius: 0, minY: point.y, maxY: point.y };
            ring.radius = Math.max(ring.radius, Math.hypot(point.x, point.z));
            ring.minY = Math.min(ring.minY, point.y); ring.maxY = Math.max(ring.maxY, point.y);
            bins.set(bin, ring);
          }
        });
        frameRings = [...bins.values()];
      }
      fit();
    }
    if (transitionLayer) {
      // 新纹样已经加载/编译；两幅实画面交叠，不经白色或黑色中间态。
      renderer.render(scene, camera);
      if (transitionLayer.animate) {
        transitionAnimation = transitionLayer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: 'ease-in-out' });
        transitionAnimation.onfinish = cancelTransition;
      } else cancelTransition();
    }
  }
  function resize() {
    cancelTransition();
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (model) fit();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  function tick() {
    if (disposed) return;
    const now = performance.now();
    controls.enableDamping = !reducedMotion.matches;
    controls.autoRotate = rotationEnabled && !reducedMotion.matches && !!model && !interacting && now >= resumeAfter && !document.hidden;
    controls.update(Math.min((now - lastTick) / 1000, 0.1));
    lastTick = now;
    camera.updateMatrixWorld();
    lightWorldDirection.copy(key.position).sub(key.target.position).normalize();
    paperLightDirection.value.copy(lightWorldDirection).transformDirection(camera.matrixWorldInverse);
    paperLightIntensity.value = key.intensity;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  }
  tick();
  function setLighting(value) {
    // 先验证全部字段；无效输入不会部分改动现有照明。
    const light = normalizeLighting(value);
    const elevation = light.keyElevation;
    key.position.set(
      3 * Math.cos(elevation) * Math.cos(light.keyAzimuth),
      key.target.position.y + 3 * Math.sin(elevation),
      3 * Math.cos(elevation) * Math.sin(light.keyAzimuth),
    );
    key.color.setRGB(...temperatureRGB(light.keyTemperature), THREE.SRGBColorSpace);
    key.intensity = light.keyIntensity;
    fill.intensity = light.fillIntensity;
    ambient.intensity = light.ambientIntensity;
  }
  return {
    setModel,
    prepareModel,
    setLighting,
    pauseAutoRotate,
    setAutoRotate(enabled) { rotationEnabled = !!enabled; controls.autoRotate = false; },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      compactTouch.removeEventListener('change', syncTouchLayout);
      reducedMotion.removeEventListener('change', syncMotionPreference);
      cancelTransition();
      canvas.removeEventListener('keydown', keyboardView);
      controls.dispose();
      if (model) release(model);
      renderer.dispose();
      canvas.remove();
    },
  };
}
