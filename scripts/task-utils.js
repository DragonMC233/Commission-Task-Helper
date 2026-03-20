// 任务系统共享工具函数
// 同时被 task-card-shared.js 和 task-modal-shared.js 依赖
// 需在两者之前加载
(() => {
  // ======== 颜色转换工具 ========

  const hexToRgb = (hex) => {
    let v = (hex || "#6B7280").replace("#", "");
    if (v.length === 3) v = v.split("").map((c) => c + c).join("");
    return {
      r: parseInt(v.slice(0, 2), 16),
      g: parseInt(v.slice(2, 4), 16),
      b: parseInt(v.slice(4, 6), 16),
    };
  };

  const parseRgbString = (rgbStr) => {
    if (!rgbStr) return null;
    const m = rgbStr.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!m) return null;
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  };

  const rgbToHsv = (r255, g255, b255) => {
    const rn = r255 / 255, gn = g255 / 255, bn = b255 / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0, s = 0, v = max;
    if (d !== 0) {
      s = d / max;
      if (max === rn) h = ((gn - bn) / d) % 6;
      else if (max === gn) h = (bn - rn) / d + 2;
      else h = (rn - gn) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h, s, v };
  };

  const hsvToRgb = (h, s, v) => {
    const c = v * s, hh = h / 60;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    let r1 = 0, g1 = 0, b1 = 0;
    if (hh >= 0 && hh < 1) { r1 = c; g1 = x; }
    else if (hh < 2) { r1 = x; g1 = c; }
    else if (hh < 3) { g1 = c; b1 = x; }
    else if (hh < 4) { g1 = x; b1 = c; }
    else if (hh < 5) { r1 = x; b1 = c; }
    else { r1 = c; b1 = x; }
    const m = v - c;
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255),
    };
  };

  /** hex → {h°, s(0-1), l(0-1)} */
  const hexToHsl = (hex) => {
    let c = (hex || "").replace("#", "").trim();
    if (c.length === 3) c = c.split("").map((ch) => ch + ch).join("");
    if (c.length !== 6) return { h: 0, s: 0, l: 0.5 };
    const r = parseInt(c.slice(0, 2), 16) / 255;
    const g = parseInt(c.slice(2, 4), 16) / 255;
    const b = parseInt(c.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0;
    const l = (max + min) / 2;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (d !== 0) {
      switch (max) {
        case r: h = ((g - b) / d) % 6; break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h *= 60;
    }
    if (h < 0) h += 360;
    return { h, s, l };
  };

  /** 将颜色（hex 或 rgb(...)）与白色按 percent(0-1) 混合，percent=1 → 纯白 */
  const blendWithWhite = (color, percent = 0.7) => {
    try {
      let rgb = null;
      if (typeof color === "string" && color.startsWith("rgb")) {
        rgb = parseRgbString(color);
      } else {
        rgb = hexToRgb(color);
      }
      if (!rgb) return color;
      const p = Math.min(1, Math.max(0, Number(percent) || 0));
      const r = Math.round(rgb.r + (255 - rgb.r) * p);
      const g = Math.round(rgb.g + (255 - rgb.g) * p);
      const b = Math.round(rgb.b + (255 - rgb.b) * p);
      return `rgb(${r}, ${g}, ${b})`;
    } catch (e) {
      return color;
    }
  };

  // Tailwind 色相调色板（共享 palette，内含 500 级参考色 & -700 文字色 hex）
  const TAILWIND_PALETTE = [
    { name: "red",     hex: "#ef4444", text700: "#b91c1c" },
    { name: "orange",  hex: "#f97316", text700: "#c2410c" },
    { name: "amber",   hex: "#f59e0b", text700: "#b45309" },
    { name: "yellow",  hex: "#eab308", text700: "#a16207" },
    { name: "lime",    hex: "#84cc16", text700: "#4d7c0f" },
    { name: "green",   hex: "#22c55e", text700: "#15803d" },
    { name: "emerald", hex: "#10b981", text700: "#047857" },
    { name: "teal",    hex: "#14b8a6", text700: "#0f766e" },
    { name: "cyan",    hex: "#06b6d4", text700: "#0e7490" },
    { name: "sky",     hex: "#0ea5e9", text700: "#0369a1" },
    { name: "blue",    hex: "#3b82f6", text700: "#1d4ed8" },
    { name: "indigo",  hex: "#6366f1", text700: "#4338ca" },
    { name: "violet",  hex: "#8b5cf6", text700: "#6d28d9" },
    { name: "purple",  hex: "#a855f7", text700: "#7e22ce" },
    { name: "fuchsia", hex: "#d946ef", text700: "#a21caf" },
    { name: "pink",    hex: "#ec4899", text700: "#be185d" },
    { name: "rose",    hex: "#f43f5e", text700: "#be123c" },
    { name: "slate",   hex: "#475569", text700: "#334155" },
  ];

  /** 判断颜色是否接近无彩色/极亮/极暗（应使用中性文字色） */
  const _isNeutralBg = ({ s, l }) =>
    (l === 1.0 && s < 0.03) ||
    (l < 1.0 && l > 0.94 && !(s >= 0.94)) ||
    (l < 0.9 && s < 0.15) ||
    (l >= 0.9 && l <= 0.95 && s < 0.15) ||
    l < 0.15;

  /**
   * 根据背景 hex 推断最近似的 Tailwind -700 文字 CSS 类名
   * 例：getNearestTailwindTextClass("#dbeafe") → "text-blue-700"
   */
  const getNearestTailwindTextClass = (hexColor) => {
    const hsl = hexToHsl(hexColor || "#e5e7eb");
    if (_isNeutralBg(hsl)) return "text-stone-700";
    let best = TAILWIND_PALETTE[0], bestDelta = Infinity;
    for (const c of TAILWIND_PALETTE) {
      const { h: ph } = hexToHsl(c.hex);
      const delta = Math.min(Math.abs(ph - hsl.h), 360 - Math.abs(ph - hsl.h));
      if (delta < bestDelta) { bestDelta = delta; best = c; }
    }
    return `text-${best.name}-700`;
  };

  /**
   * 根据背景 hex 推断最近似的 Tailwind -700 文字颜色 hex 值
   * 例：getNearestTailwindTextHex("#dbeafe") → "#1d4ed8"
   * 用于需要 inline style color 而非 Tailwind class 的场合（如 bar.js）
   */
  const getNearestTailwindTextHex = (hexColor) => {
    const hsl = hexToHsl(hexColor || "#e5e7eb");
    if (_isNeutralBg(hsl)) return "#44403c"; // stone-700
    let best = TAILWIND_PALETTE[0], bestDelta = Infinity;
    for (const c of TAILWIND_PALETTE) {
      const { h: ph } = hexToHsl(c.hex);
      const delta = Math.min(Math.abs(ph - hsl.h), 360 - Math.abs(ph - hsl.h));
      if (delta < bestDelta) { bestDelta = delta; best = c; }
    }
    return best.text700;
  };

  // ======== OKLCH 颜色空间转换 ========

  /** 检测浏览器是否支持 oklch() CSS 函数 */
  const supportsOKLCH = () => {
    try {
      return (
        typeof CSS !== "undefined" &&
        CSS.supports &&
        CSS.supports("color", "oklch(0.5 0.1 50)")
      );
    } catch (e) {
      return false;
    }
  };

  /** 将 RGB (0-255) 转换为线性 sRGB (0..1) */
  const srgbToLinear = (v) => {
    v = v / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };

  /** 将线性 sRGB 转换回 sRGB (0-255) */
  const linearToSrgb = (v) => {
    const srgb =
      v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, srgb)) * 255);
  };

  const rgbToXyz = (r, g, b) => {
    const R = srgbToLinear(r);
    const G = srgbToLinear(g);
    const B = srgbToLinear(b);
    const X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
    const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
    const Z = 0.0193339 * R + 0.119192 * G + 0.9503041 * B;
    return { X, Y, Z };
  };

  const xyzToOklab = (X, Y, Z) => {
    const Xnrm = X / 0.95047;
    const Ynrm = Y / 1.0;
    const Znrm = Z / 1.08883;
    const l = 0.8189330101 * Xnrm + 0.3618667424 * Ynrm - 0.1288597137 * Znrm;
    const m = 0.0329845436 * Xnrm + 0.9293118715 * Ynrm + 0.0361456387 * Znrm;
    const s = 0.0482003018 * Xnrm + 0.2643662691 * Ynrm + 0.633851707 * Znrm;
    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);
    const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
    const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
    const b = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
    return { L, a, b };
  };

  const oklabToOklch = ({ L, a, b }) => {
    const C = Math.sqrt(a * a + b * b);
    let h = Math.atan2(b, a) * (180 / Math.PI);
    if (h < 0) h += 360;
    return { L, C, h };
  };

  const oklchToOklab = ({ L, C, h }) => {
    const hr = (h * Math.PI) / 180;
    return { L, a: C * Math.cos(hr), b: C * Math.sin(hr) };
  };

  const oklabToXyz = ({ L, a, b }) => {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    const X = 1.2270138511 * l - 0.5577999807 * m + 0.281256149 * s;
    const Y = -0.0405801784 * l + 1.1122568696 * m - 0.0716766787 * s;
    const Z = -0.0763812845 * l - 0.4214819784 * m + 1.5861632204 * s;
    return { X, Y, Z };
  };

  const xyzToRgb = (X, Y, Z) => {
    const Rl = 3.2409699419 * X - 1.5373831776 * Y - 0.4986107603 * Z;
    const Gl = -0.9692436363 * X + 1.8759675015 * Y + 0.0415550574 * Z;
    const Bl = 0.0556300797 * X - 0.2039769589 * Y + 1.0569715142 * Z;
    return {
      r: linearToSrgb(Rl),
      g: linearToSrgb(Gl),
      b: linearToSrgb(Bl),
    };
  };

  /** 将 hex 颜色转为 OKLCH {L,C,h} */
  const hexToOklch = (hex) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const xyz = rgbToXyz(rgb.r, rgb.g, rgb.b);
    const oklab = xyzToOklab(xyz.X, xyz.Y, xyz.Z);
    return oklabToOklch(oklab);
  };

  /** 将 OKLCH 转为 RGB {r,g,b} */
  const oklchToRgb = ({ L, C, h }) => {
    const oklab = oklchToOklab({ L, C, h });
    const xyz = oklabToXyz(oklab);
    return xyzToRgb(xyz.X, xyz.Y, xyz.Z);
  };

  /** 根据指定规则使用 OKLCH 计算 ring 颜色 */
  const computeOklchAdjustedRing = (hex) => {
    try {
      const o = hexToOklch(hex);
      if (!o) return null;
      let L = Math.max(0.73, Math.min(1, o.L - 0.05));
      let C = Math.min(0.37, o.C + 0.1);
      let h = o.h;
      const oklchStr = `oklch(${L.toFixed(4)} ${C.toFixed(4)} ${Math.round(h)}deg)`;
      const rgb = oklchToRgb({ L, C, h });
      const rgbStr = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
      return { oklch: oklchStr, rgb: rgbStr };
    } catch (e) {
      return null;
    }
  };

  /** 依据输入 hex 颜色，计算 HSV 后将 S（饱和度）增加指定增量，返回 rgb(...) 字符串 */
  const computeRingFromHex = (hex, deltaS = 0.5, deltaV = 0) => {
    const rgb = hexToRgb(hex);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    const newS = Math.min(1, Math.max(0, hsv.s + deltaS));
    const newV = Math.min(1, Math.max(0, hsv.v + deltaV));
    const out = hsvToRgb(hsv.h, newS, newV);
    return `rgb(${out.r}, ${out.g}, ${out.b})`;
  };

  /** 标准 sRGB→OKLab 参考实现（直接 sRGB→LMS→OKLab，不经过 XYZ D65 归一化） */
  const rgbToOklchDirect = (r, g, b) => {
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const R = lin(r), G = lin(g), B = lin(b);
    const l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
    const m = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
    const s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;
    const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    const bk = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    const C = Math.sqrt(a * a + bk * bk);
    let h = Math.atan2(bk, a) * (180 / Math.PI);
    if (h < 0) h += 360;
    return { L, C, h };
  };

  /**
   * 从 rgb(...) 字符串计算按钮用 oklch CSS 值
   * L 限制在 maxL 以下；chroma 保留原始值，但保证不低于色域内最大 chroma 的 minRatio，
   * 仅对天然低饱和色相（如黄色）做提升，不降低其他颜色
   */
  const computeButtonOklch = (rgbStr, { maxL = 0.9, yellowMaxL = 0.95, minRatio = 0.5, yellowChromaBoost = 1.15, yellowHueShiftMax = 6 } = {}) => {
    const parsed = parseRgbString(rgbStr);
    if (!parsed) return null;
    const oklch = rgbToOklchDirect(parsed.r, parsed.g, parsed.b);
    const isYellow = oklch.h >= 70 && oklch.h <= 120;
    // 黄色色相明度放宽，chroma 比例上浮，色相向暖色非线性偏移
    const effectiveMaxL = isYellow ? yellowMaxL : maxL;
    const L = Math.min(oklch.L, effectiveMaxL);
    const maxC = maxChromaInSrgb(L, oklch.h);
    const effectiveRatio = isYellow ? minRatio * yellowChromaBoost : minRatio;
    const C = Math.max(oklch.C, maxC * effectiveRatio);
    // 非线性色相偏移：以 109°（柠檬黄）为峰值
    // 左侧 [80, 109] sqrt 曲线爬升，右侧 [109, 120] 二次曲线衰减
    let h = oklch.h;
    if (isYellow && yellowHueShiftMax > 0) {
      let shift = 0;
      if (h >= 80 && h <= 109) {
        shift = yellowHueShiftMax * Math.sqrt((h - 80) / 29);
      } else if (h > 109 && h <= 120) {
        const t = (120 - h) / 11;
        shift = yellowHueShiftMax * t * t;
      }
      h -= shift;
    }
    return `oklch(${(L * 100).toFixed(2)}% ${C.toFixed(4)} ${h.toFixed(4)})`;
  };

  /** 在给定 (L, h) 下，二分查找 sRGB 色域内可用的最大 chroma */
  const maxChromaInSrgb = (L, h) => {
    const hr = (h * Math.PI) / 180;
    const cosH = Math.cos(hr), sinH = Math.sin(hr);
    let lo = 0, hi = 0.4;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (isOklchInSrgb(L, mid, cosH, sinH)) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  /** 判断 (L, C, h) 是否在 sRGB [0,1] 范围内（使用预计算的 cosH/sinH） */
  const isOklchInSrgb = (L, C, cosH, sinH) => {
    const a = C * cosH, b = C * sinH;
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    const R =  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const B = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    const eps = -0.001;
    return R >= eps && R <= 1.001 && G >= eps && G <= 1.001 && B >= eps && B <= 1.001;
  };

  /** 计算线性化相对亮度（WCAG） */
  const luminanceFromRgb = ({ r, g, b }) => {
    const srgb = [r / 255, g / 255, b / 255].map((c) => {
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  };

  // ======== UI 工具 ========

  /**
   * 根据图标来源组 (icons/symbols) 和样式返回对应的 material icon CSS class 名
   */
  const getIconClassForSource = (group, style) => {
    if (group === "symbols") {
      const symbolMap = {
        outlined: "material-symbols-outlined",
        rounded: "material-symbols-rounded",
        sharp: "material-symbols-sharp",
      };
      return symbolMap[style] || symbolMap.outlined;
    }
    const iconMap = {
      regular: "material-icons",
      outlined: "material-icons-outlined",
      round: "material-icons-round",
      sharp: "material-icons-sharp",
      twotone: "material-icons-two-tone",
    };
    return iconMap[style] || iconMap.regular;
  };

  /**
   * 解析任务节点的展示属性（图标/背景/文字颜色 class）
   * 被 task-card-shared.js 的 createTaskCardHtml 用作默认实现
   */
  const defaultGetNodePresentation = (node, presetNodes) => {
    const name = node && node.name;
    const id = node && node.id;
    const presetMatch = (presetNodes || []).find(
      (p) => (name && p.name === name) || (id && String(p.id) === String(id))
    );
    const background = presetMatch?.background || (node && node.background) || "";
    const icon = presetMatch?.icon || (node && node.icon) || "label";
    const iconGroup = presetMatch?.iconGroup || node?.iconGroup || "icons";
    const iconStyle =
      presetMatch?.iconStyle ||
      node?.iconStyle ||
      (iconGroup === "symbols" ? "outlined" : "regular");
    const iconClass = getIconClassForSource(iconGroup, iconStyle);
    const textClass =
      presetMatch?.text ||
      (node && node.text) ||
      (node && node.textClass) ||
      "text-stone-700";
    return {
      presetMatch,
      icon,
      background,
      textClass,
      iconGroup,
      iconStyle,
      iconClass,
    };
  };

  window.taskUtils = Object.assign(window.taskUtils || {}, {
    // 颜色转换
    hexToRgb,
    parseRgbString,
    rgbToHsv,
    hsvToRgb,
    hexToHsl,
    blendWithWhite,
    // Tailwind 文字颜色推断
    getNearestTailwindTextClass,
    getNearestTailwindTextHex,
    // OKLCH 颜色空间转换
    supportsOKLCH,
    srgbToLinear,
    linearToSrgb,
    rgbToXyz,
    xyzToOklab,
    oklabToOklch,
    oklchToOklab,
    oklabToXyz,
    xyzToRgb,
    hexToOklch,
    oklchToRgb,
    computeOklchAdjustedRing,
    computeRingFromHex,
    rgbToOklchDirect,
    computeButtonOklch,
    maxChromaInSrgb,
    luminanceFromRgb,
    // UI 工具
    getIconClassForSource,
    defaultGetNodePresentation,
  });
})();
