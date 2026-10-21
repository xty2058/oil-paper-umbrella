// 全馆共用的视觉照明初值；每把伞仍通过记录的 lighting 覆盖，不按伞名分支。
export const LIGHTING_DEFAULTS = Object.freeze({
  keyAzimuth: 232 * Math.PI / 180, keyIntensity: 5,
  keyElevation: 35 * Math.PI / 180, keyTemperature: 5800,
  fillIntensity: 1.8, ambientIntensity: 0.85,
});
const limits = {
  keyAzimuth: [0, Math.PI * 2], keyIntensity: [0, 12],
  keyElevation: [5 * Math.PI / 180, 85 * Math.PI / 180], keyTemperature: [2700, 9000],
  fillIntensity: [0, 4], ambientIntensity: [0, 2],
};
export function normalizeLighting(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('lighting 必须是参数对象。');
  for (const key of Object.keys(value)) if (!(key in limits)) throw new Error('未知灯光参数：' + key);
  const result = { ...LIGHTING_DEFAULTS, ...value };
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (!Number.isFinite(result[key]) || result[key] < min || result[key] > max) throw new RangeError('灯光参数超出范围：' + key);
  }
  return result;
}
// Tanner Helland 的色温转 sRGB 近似，用于视觉调光，不作为实测光谱。
// https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html
export function temperatureRGB(kelvin) {
  if (!Number.isFinite(kelvin) || kelvin < 2700 || kelvin > 9000) throw new RangeError('色温范围为 2700—9000 K。');
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [r, g, b].map(n => Math.max(0, Math.min(255, n)) / 255);
}
