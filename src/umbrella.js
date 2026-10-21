import * as THREE from 'three';

/**
 * 可开合的油纸伞设计示意，非历史实物或工程复原。
 * 运行环境：Three.js 0.169.0；由调用页面的 CDN importmap 解析 'three'。
 * 单位：米；角度：弧度。右手坐标，+Y 向上，XZ 为水平面。
 * 原点：手柄底端、中棒轴心；第一根骨沿 +X，方位角增大时转向 +Z。
 * 方位公式固定为 (r*cos(theta), y, r*sin(theta))。
 * 所有长度均为设计演示值，不代表历史尺寸。
 *
 * 参数（未传时使用 DEFAULTS）：
 * openAmount        0—1；0 为保留杆件间隙的收拢极限，1 为完全张开。
 * ribCount          骨数，整数 3—64。
 * ribLength         上巢中心到骨尖的曲线长度，数值积分误差约毫米以下。
 * canopyRise        张开时伞顶相对伞缘的拱高（米），即上巢中心到骨尖的高度差。
 * canopyDrop        旧名称兼容输入；不能和 canopyRise 同时传入。实际参数只记录 canopyRise。
 * ribBend           伞骨相对于直弦向上拱起的最大量。
 * canopySag         张开时骨间下垂设定值；按骨间距限幅，收拢时减小，骨线上为零。
 * shaftLength       中棒从原点到上巢中心的长度。
 * stretcherAttach   撑骨固定接点在伞骨参数 t 上的位置，0—1；并非弧长比例。
 * lowerHubDrop      完全张开时两巢落差；用于确定撑骨固定长度。
 * shaftRadius / ribRadius / stretcherRadius  各杆半径。
 * hubRadius / hubHeight                     两个巢的外半径和高度。
 * handleLength / handleRadius               直手柄长度和半径。
 * transmission      0—1，光学透射量；不是透明度，opacity 固定为 1。
 * roughness         0—1，伞面粗糙度；纸面建议使用较高值。
 * canopyColor       #rrggbb 格式的伞面颜色，优先于旧 colors.canopy。
 * canopyTexture     已加载的 THREE.Texture 或 null；由调用方设置 sRGB、ClampToEdge，并负责释放。
 *                   贴图时保留图片本色；null/未传时使用 canopyColor 纯色。
 * ribColor          #rrggbb 格式的竹骨叠加色，白色保留贴图本色；兼容 colors.ribs。
 * colors            可选颜色对象：shaft、ribs、hubs、canopy、handle。
 *
 * 返回 Group；直属子对象按部件命名，可用 getObjectByName 查找。
 * group.userData.params 为实际参数；parts 为部件名称映射。
 * group.userData.canopyRadius 为计算得到的水平半径。
 * 修改参数后重新调用本生成器；不包含场景、灯光；竹木贴图由外部资源参数传入，伞面使用 MeshPhysicalMaterial。
 * 开合为恒长撑骨的单自由度示意，不模拟纸张弹性、铰链与真实折痕。
 * 第二参数为 loadUmbrellaTextures() 返回的已加载资源；不传时保留纯色模式。
 * 竹木贴图沿 V 方向排列纤维；UV 按 0.20 米为一幅图采样，仅修改 UV，不改几何形状。
 * 调用方负责释放 geometry/material；外部共享贴图仅在整个调参台关闭时释放。
 */
const DEFAULTS = Object.freeze({
  transmission: 0.35,
  roughness: 0.85,
  canopyColor: '#e5c58b',
  canopyTexture: null,
  ribColor: '#ffffff',
  openAmount: 1,
  ribCount: 24,
  ribLength: 0.58,
  canopyRise: 0.18,
  ribBend: 0.025,
  canopySag: 0.012,
  shaftLength: 0.82,
  stretcherAttach: 0.48,
  lowerHubDrop: 0.32,
  shaftRadius: 0.008,
  ribRadius: 0.0025,
  stretcherRadius: 0.002,
  hubRadius: 0.018,
  hubHeight: 0.024,
  handleLength: 0.14,
  handleRadius: 0.014,
});

/** 加载当前模块相对路径下的两张贴图；失败时明确报错，不用占位图。 */
export async function loadUmbrellaTextures(paths = {}) {
  const loader = new THREE.TextureLoader();
  function load(file) {
    const assetPath = paths[file === 'bamboo-rib.png' ? 'bamboo' : 'wood'] || 'assets/optimized/textures/' + file.replace(/\.png$/, '.webp');
    const url = new URL(assetPath, new URL('../', import.meta.url)).href;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        texture.dispose();
        reject(new Error(`贴图加载超时：${assetPath}`));
      }, 15000);
      const texture = loader.load(url, () => {
        clearTimeout(timer);
        if (settled) { texture.dispose(); return; }
        settled = true;
        texture.colorSpace = THREE.SRGBColorSpace;
        // 镜像平铺避免原图未经无缝处理时出现突兀接缝，纵向不做密集重复。
        texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        resolve(texture);
      }, undefined, () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        texture.dispose();
        reject(new Error(`贴图加载失败：${assetPath}`));
      });
    });
  }
  const results = await Promise.allSettled([load('bamboo-rib.png'), load('wood-handle.png')]);
  const failed = results.find(result => result.status === 'rejected');
  if (failed) {
    results.forEach(result => { if (result.status === 'fulfilled') result.value.dispose(); });
    throw failed.reason;
  }
  const [bamboo, wood] = results.map(result => result.value);
  // 用原图亮度做非常轻微的凹凸示意；不是实测高度图。与颜色贴图分开颜色空间。
  const relief = texture => {
    const copy = texture.clone();
    copy.colorSpace = THREE.NoColorSpace;
    copy.needsUpdate = true;
    return copy;
  };
  const bambooRelief = relief(bamboo);
  const woodRelief = relief(wood);
  let disposed = false;
  return {
    bamboo, wood, bambooRelief, woodRelief,
    dispose() {
      if (disposed) return;
      disposed = true;
      [bamboo, wood, bambooRelief, woodRelief].forEach(texture => texture.dispose());
    },
  };
}

export function createUmbrella(params = {}, textures = {}) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new TypeError('params 必须是参数对象。');
  }
  // 旧版 canopyDrop 与拱高是同一竖直尺寸，统一使用 canopyRise 记录。
  const input = { ...params };
  if (Object.hasOwn(input, 'canopyDrop')) {
    if (Object.hasOwn(input, 'canopyRise')) throw new Error('canopyDrop 和 canopyRise 不能同时传入。');
    input.canopyRise = input.canopyDrop;
    delete input.canopyDrop;
  }
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(DEFAULTS, key) && key !== 'colors') throw new Error(`未知参数：${key}`);
  }
  const p = { ...DEFAULTS, ...input };
  if (input.canopyColor === undefined && input.colors?.canopy !== undefined) {
    p.canopyColor = '#' + new THREE.Color(input.colors.canopy).getHexString();
  }
  if (input.ribColor === undefined && input.colors?.ribs !== undefined) {
    p.ribColor = '#' + new THREE.Color(input.colors.ribs).getHexString();
  }
  if (typeof p.ribColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.ribColor)) {
    throw new TypeError('ribColor 必须是 #rrggbb 格式的颜色。');
  }
  if (typeof p.canopyColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.canopyColor)) {
    throw new TypeError('canopyColor 必须是 #rrggbb 格式的颜色。');
  }
  if (p.canopyTexture !== null && !p.canopyTexture?.isTexture) {
    throw new TypeError('canopyTexture 必须是已加载的 THREE.Texture 或 null。');
  }
  for (const key of Object.keys(DEFAULTS)) {
    if (key === 'canopyColor' || key === 'ribColor' || key === 'canopyTexture') continue;
    if (!Number.isFinite(p[key])) throw new TypeError(`${key} 必须是有限数字。`);
    if (p[key] < 0 || (p[key] === 0 && key !== 'canopySag' && key !== 'ribBend' && key !== 'openAmount' && key !== 'transmission' && key !== 'roughness')) {
      throw new RangeError(`${key} 超出允许范围。`);
    }
  }
  if (p.transmission > 1 || p.roughness > 1) throw new RangeError('transmission、roughness 必须在 0—1 之间。');
  if (p.openAmount > 1) throw new RangeError('openAmount 必须在 0—1 之间。');
  if (p.canopySag > p.ribLength * 0.08) throw new RangeError('canopySag 不得超过骨长的 8%。');
  if (!Number.isInteger(p.ribCount) || p.ribCount < 3 || p.ribCount > 64) {
    throw new RangeError('ribCount 必须是 3—64 的整数。');
  }
  if (p.ribLength <= p.canopyRise || p.ribBend * Math.PI >= p.canopyRise) {
    throw new RangeError('骨长必须大于落差，且 ribBend * π 必须小于 canopyRise。');
  }
  if (p.stretcherAttach <= 0 || p.stretcherAttach >= 1) {
    throw new RangeError('stretcherAttach 必须在 0 和 1 之间。');
  }
  const attachDrop = p.canopyRise * p.stretcherAttach
    - p.ribBend * Math.sin(Math.PI * p.stretcherAttach);
  if (p.lowerHubDrop <= attachDrop + p.hubHeight
      || p.lowerHubDrop + p.hubHeight / 2 >= p.shaftLength - p.handleLength
      || p.hubRadius <= p.shaftRadius
      || p.handleRadius < p.shaftRadius
      || p.canopyRise + p.canopySag >= p.shaftLength - p.handleLength) {
    throw new RangeError('巢、手柄或伞面的位置不合理，请检查落差、半径与中棒长度。');
  }
  if (p.colors !== undefined && (!p.colors || typeof p.colors !== 'object' || Array.isArray(p.colors))) {
    throw new TypeError('colors 必须是颜色对象。');
  }
  const colors = {
    shaft: 0x9c7949, ribs: 0x78805a, hubs: 0x86653e,
    canopy: 0xe5c58b, handle: 0x513a29, ...p.colors, canopy: p.canopyColor, ribs: p.ribColor,
  };
  // y(t) 是光滑弧线；求水平半径，使曲线长度等于 ribLength。
  const openHeight = (t) => p.shaftLength - p.canopyRise * t
    + p.ribBend * Math.sin(Math.PI * t);
  const arcLength = (radius) => {
    let length = 0;
    let lastY = openHeight(0);
    for (let i = 1; i <= 512; i++) {
      const y = openHeight(i / 512);
      length += Math.hypot(radius / 512, y - lastY);
      lastY = y;
    }
    return length;
  };
  let low = 0;
  let high = p.ribLength;
  for (let i = 0; i < 48; i++) {
    const mid = (low + high) / 2;
    if (arcLength(mid) < p.ribLength) low = mid;
    else high = mid;
  }
  const radius = (low + high) / 2;
  if (radius * p.stretcherAttach <= p.hubRadius + p.ribRadius
      || 2 * radius * Math.sin(Math.PI / p.ribCount) <= 2 * p.ribRadius) {
    throw new RangeError('骨尖或撑骨接点过密，请调整骨数、骨长、半径或固定接点。');
  }
  // 将整条弯骨绕上巢转动，保持曲线长度；撑骨固定长度由张开态确定。
  const openAttachRadius = radius * p.stretcherAttach;
  const strutLength = Math.hypot(openAttachRadius - p.hubRadius, p.lowerHubDrop - attachDrop);
  const at = (t, rotation) => {
    const y = openHeight(t) - p.shaftLength;
    return {
      r: radius * t * Math.cos(rotation) + y * Math.sin(rotation),
      y: p.shaftLength + y * Math.cos(rotation) - radius * t * Math.sin(rotation),
    };
  };
  const runnerDrop = (rotation) => {
    const joint = at(p.stretcherAttach, rotation);
    const radial = joint.r - p.hubRadius;
    const square = strutLength ** 2 - radial ** 2;
    return square >= 0 ? p.shaftLength - joint.y + Math.sqrt(square) : NaN;
  };
  const canRotate = (rotation) => {
    const tip = at(1, rotation);
    const joint = at(p.stretcherAttach, rotation);
    const drop = runnerDrop(rotation);
    // 骨尖和撑骨接点保留周向间隙；下巢不能进入手柄。
    return joint.r > p.hubRadius + 4 * p.ribRadius
      && 2 * joint.r * Math.sin(Math.PI / p.ribCount) > 2.5 * p.ribRadius
      && tip.r > Math.max(0.045, p.canopySag * 3)
      && Number.isFinite(drop)
      && drop + p.hubHeight / 2 < p.shaftLength - p.handleLength - 0.008;
  };
  if (!canRotate(0)) throw new RangeError('张开态没有足够的杆件间隙或下巢行程。');
  let closeLow = 0;
  let closeHigh = Math.atan2(radius, p.canopyRise) - 0.04;
  for (let i = 0; i < 48; i++) {
    const mid = (closeLow + closeHigh) / 2;
    if (canRotate(mid)) closeLow = mid;
    else closeHigh = mid;
  }
  const closedRotation = closeLow * 0.995;
  // 由两巢行程线性控制开合，再反解弯骨转角，保留恒长连杆约束。
  const closedDrop = runnerDrop(closedRotation);
  const currentDrop = closedDrop + (p.lowerHubDrop - closedDrop) * p.openAmount;
  let rotationLow = 0;
  let rotationHigh = closedRotation;
  for (let i = 0; i < 48; i++) {
    const mid = (rotationLow + rotationHigh) / 2;
    if (runnerDrop(mid) < currentDrop) rotationLow = mid;
    else rotationHigh = mid;
  }
  const rotation = (rotationLow + rotationHigh) / 2;
  const profile = (t) => at(t, rotation);
  const paperOffset = p.ribRadius + 0.001;
  const root = new THREE.Group();
  root.name = 'umbrella';
  const names = {
    shaft: 'shaft', ribs: 'ribs', stretchers: 'stretchers',
    upperHub: 'upper-hub', lowerHub: 'lower-hub', canopy: 'canopy', handle: 'handle',
  };
  root.userData = {
    params: { ...p, colors: { ...colors } }, parts: names,
    units: 'meters', upAxis: '+Y', canopyRadius: profile(1).r,
    mechanism: { rotation, closedRotation, strutLength, currentDrop, closedDrop,
      openDrop: p.lowerHubDrop, openRadius: radius, openAmount: p.openAmount },
    state: p.openAmount === 1 ? 'fully-open' : p.openAmount === 0 ? 'closed-limit' : 'partly-open', designDemonstration: true,
  };
  const material = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const wood = material(colors.shaft);
  const bamboo = new THREE.MeshStandardMaterial({
    color: p.ribColor, map: textures.bamboo || null,
    bumpMap: textures.bambooRelief || null, bumpScale: 0.00006,
    roughness: 0.82, metalness: 0,
  });
  const hubs = material(colors.hubs);
  // 原生物理材质的透射与 alpha 透明分开；薄纸厚度为视觉演示值。
  const paper = new THREE.MeshPhysicalMaterial({
    color: p.canopyTexture ? 0xffffff : p.canopyColor, map: p.canopyTexture,
    transmission: p.transmission, roughness: p.roughness,
    thickness: 0.0005, ior: 1.35, metalness: 0, clearcoat: 0,
    specularIntensity: 0.15, opacity: 1, transparent: false, side: THREE.DoubleSide,
  });
  if (p.canopyTexture) {
    // 纹样 PNG 的透明区代表未印刷纸面，而不是纸上的洞。
    // 按 alpha 将印色与底层纸色合成，避免圆外透明像素的黑 RGB 形成黑边。
    paper.onBeforeCompile = shader => {
      shader.uniforms.canopyPaperColor = { value: new THREE.Color(p.canopyColor) };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 canopyPaperColor;')
        .replace('#include <map_fragment>', `
#include <map_fragment>
#ifdef USE_MAP
  diffuseColor.rgb = mix(canopyPaperColor, diffuseColor.rgb, sampledDiffuseColor.a);
  diffuseColor.a = opacity;
#endif
`);
    };
    paper.customProgramCacheKey = () => 'canopy-paper-map-v1';
  }
  const handleMaterial = new THREE.MeshStandardMaterial({
    // 原图已有深棕色，不再与深棕纯色相乘，以免木纹被压黑。
    color: textures.wood ? 0xffffff : colors.handle,
    map: textures.wood || null, bumpMap: textures.woodRelief || null,
    bumpScale: 0.00006, roughness: 0.64, metalness: 0,
  });
  const textureSpan = 0.20;
  function lengthwiseCylinderUV(geometry, radius, length) {
    const uv = geometry.getAttribute('uv');
    // CylinderGeometry 的 V 已沿轴向；只给侧面做等比例采样，保留端面 UV。
    const sideVertices = (geometry.parameters.radialSegments + 1)
      * (geometry.parameters.heightSegments + 1);
    for (let i = 0; i < sideVertices; i++) {
      uv.setXY(i, 0.15 + uv.getX(i) * Math.PI * 2 * radius / textureSpan,
        uv.getY(i) * length / textureSpan);
    }
    uv.needsUpdate = true;
  }
  function cylinder(name, r, length, centerY, mat) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, length, 16), mat);
    mesh.name = name;
    mesh.position.y = centerY;
    root.add(mesh);
    return mesh;
  }
  cylinder(names.shaft, p.shaftRadius, p.shaftLength, p.shaftLength / 2, wood);
  const handle = cylinder(names.handle, p.handleRadius, p.handleLength, p.handleLength / 2, handleMaterial);
  lengthwiseCylinderUV(handle.geometry, p.handleRadius, p.handleLength);
  cylinder(names.upperHub, p.hubRadius, p.hubHeight, p.shaftLength, hubs);
  cylinder(names.lowerHub, p.hubRadius, p.hubHeight, p.shaftLength - currentDrop, hubs);

  class RibCurve extends THREE.Curve {
    getPoint(t, target = new THREE.Vector3()) {
      const point = profile(t);
      return target.set(point.r, point.y, 0);
    }
  }
  const ribs = new THREE.Group();
  ribs.name = names.ribs;
  const stretchers = new THREE.Group();
  stretchers.name = names.stretchers;
  root.add(ribs, stretchers);
  const ribGeometry = new THREE.TubeGeometry(new RibCurve(), 64, p.ribRadius, 6, false);
  // TubeGeometry 默认 U 沿长度、V 绕周向；换成 V 沿长度，纤维才不会横着绕圈。
  const ribUV = ribGeometry.getAttribute('uv');
  for (let i = 0; i < ribUV.count; i++) {
    const along = ribUV.getX(i);
    const around = ribUV.getY(i);
    ribUV.setXY(i, 0.15 + around * Math.PI * 2 * p.ribRadius / textureSpan,
      along * p.ribLength / textureSpan);
  }
  ribUV.needsUpdate = true;
  const angleStep = Math.PI * 2 / p.ribCount;
  for (let i = 0; i < p.ribCount; i++) {
    const angle = i * angleStep;
    const rib = new THREE.Mesh(ribGeometry, bamboo);
    rib.name = `rib-${String(i + 1).padStart(2, '0')}`;
    rib.rotation.y = -angle;
    ribs.add(rib);
    const start = new THREE.Vector3(
      p.hubRadius * Math.cos(angle), p.shaftLength - currentDrop,
      p.hubRadius * Math.sin(angle),
    );
    const end = new THREE.Vector3(
      profile(p.stretcherAttach).r * Math.cos(angle), profile(p.stretcherAttach).y,
      profile(p.stretcherAttach).r * Math.sin(angle),
    );
    const direction = end.clone().sub(start);
    const strut = new THREE.Mesh(
      new THREE.CylinderGeometry(p.stretcherRadius, p.stretcherRadius, direction.length(), 8), bamboo,
    );
    lengthwiseCylinderUV(strut.geometry, p.stretcherRadius, direction.length());
    strut.name = `stretcher-${String(i + 1).padStart(2, '0')}`;
    strut.position.copy(start).add(end).multiplyScalar(0.5);
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    strut.userData.endpoints = { start: start.toArray(), end: end.toArray() };
    stretchers.add(strut);
  }

  // 纸面沿同一弯骨轮廓转动，留出骨半径与 1mm 间隙；骨线处弧垂为零。
  // 收拢时抑制弧垂，避免角间距缩小后纸面切入相邻杆件。
  // 中心共用一个顶点，避免重复中心点产生退化三角形。
  const radialSteps = 32;
  const angularSteps = p.ribCount * 8;
  const positions = [0, p.shaftLength + paperOffset, 0];
  // 参考展开圆盘的坐标，不用开合后的 XZ 投影：折叠时纹样不会向圆心滑动。
  // 中心 (0.5, 0.5)，外圆半径 0.5；+Z 对应图片下方（TextureLoader 默认 flipY）。
  // 周向顶点共享且 UV 连续跨过 0/2π，不采用会产生径向接缝的条带展开。
  const uvs = [0.5, 0.5];
  const indices = [];
  for (let j = 1; j <= radialSteps; j++) {
    const t = j / radialSteps;
    for (let i = 0; i < angularSteps; i++) {
      const angle = i * Math.PI * 2 / angularSteps;
      const desiredSag = p.canopySag * (profile(t).r / (radius * t)) ** 2;
      const safeSag = 0.3 * profile(t).r ** 2 / (p.ribCount ** 2 * p.ribRadius);
      const sag = Math.min(desiredSag, safeSag) * Math.sin(Math.PI * t)
        * Math.sin(p.ribCount * angle / 2) ** 2;
      const point = profile(t);
      const r = point.r + (paperOffset - sag) * Math.sin(rotation);
      const y = point.y + (paperOffset - sag) * Math.cos(rotation);
      positions.push(r * Math.cos(angle), y, r * Math.sin(angle));
      uvs.push(0.5 + 0.5 * t * Math.cos(angle), 0.5 - 0.5 * t * Math.sin(angle));
    }
  }
  for (let i = 0; i < angularSteps; i++) {
    const next = (i + 1) % angularSteps;
    indices.push(0, 1 + next, 1 + i);
    for (let j = 0; j < radialSteps - 1; j++) {
      const a = 1 + j * angularSteps + i;
      const b = 1 + j * angularSteps + next;
      const c = a + angularSteps;
      const d = b + angularSteps;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const canopy = new THREE.Mesh(geometry, paper);
  canopy.name = names.canopy;
  root.add(canopy);
  return root;
}
