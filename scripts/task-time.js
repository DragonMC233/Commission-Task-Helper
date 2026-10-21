/**
 * 统一时间层
 *
 * 约定：
 *   - 存储：所有带时刻的字段一律 ISO UTC（`2026-10-18T03:16:46.472Z`）
 *   - 展示：按访问者设备的本地时区
 *   - 纯日期（`2027-07-14`）：按本地日历解析，不带时区语义
 *
 * 因为数据已经是 UTC，读出来 `new Date(...)` 就是绝对时刻，用原生本地方法即可拿到
 * 「当前设备看到的年月日时分」，不需要 Intl 反推偏移那一套。
 *
 * 这个模块存在的意义是**统一入口**：散在三个视图里的 100 多处时间处理，
 * 将来要调整格式或时区策略，只改这里。
 */
(() => {
  const pad = (v) => String(v).padStart(2, "0");

  const valid = (d) => d instanceof Date && !Number.isNaN(d.getTime());

  /** 该值是否带明确时刻（纯日期返回 false） */
  const hasExplicitTime = (value) => /[T ]\d{1,2}:\d{2}/.test(String(value == null ? "" : value));

  /** 绝对时刻 → 本地日历字段 */
  const parts = (value) => {
    const d = value instanceof Date ? value : parse(value);
    if (!valid(d)) return null;
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
      weekday: d.getDay(),
    };
  };

  /** 本地日历字段 → 绝对时刻（日期溢出自动进位） */
  const make = (year, month, day, hour = 0, minute = 0, second = 0, ms = 0) =>
    new Date(year, month - 1, day, hour, minute, second, ms);

  /**
   * 解析时间值 → 绝对时刻；无法解析返回 null。
   * - 带 Z / ±offset：已经是绝对时刻，直接交给引擎
   * - 纯日期：本地零点（它表示「日历上的哪一天」，不能按某个固定时区解释）
   * - 无标记的墙上时间：按本地时区解释（兼容历史数据）
   */
  const parse = (value) => {
    if (value instanceof Date) return value;
    if (value == null) return null;
    // 毫秒时间戳：`Date.parse(x)` / `getTime()` 的结果。
    // 重构后解析入口从 `new Date(x)` 换成这里，必须补上数字分支，
    // 否则 `parseOrInvalid(ms)` 会得到 Invalid Date。
    if (typeof value === "number") return valid(new Date(value)) ? new Date(value) : null;
    const s = String(value).trim();
    if (!s) return null;

    if (/[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
      const d = new Date(s);
      return valid(d) ? d : null;
    }
    const m = s.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?)?$/
    );
    if (m) {
      return make(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), +(m[7] || 0));
    }
    const fallback = new Date(s);
    return valid(fallback) ? fallback : null;
  };

  /** 同 parse，但解析失败返回 Invalid Date（替换 new Date(x) 时保持旧语义） */
  const parseOrInvalid = (value) => parse(value) || new Date(NaN);

  /** YYYY-MM-DD（本地） */
  const formatDate = (value) => {
    const p = parts(value);
    return p ? `${p.year}-${pad(p.month)}-${pad(p.day)}` : "";
  };

  /** YYYY-MM-DDTHH:mm（本地，给界面用） */
  const formatDateTime = (value) => {
    const p = parts(value);
    return p ? `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}` : "";
  };

  /** 写盘格式：带时刻的存 ISO UTC（纯日期仍给本地日期串） */
  const formatForStorage = (value) => {
    const d = value instanceof Date ? value : parse(value);
    return valid(d) ? d.toISOString() : "";
  };

  /** 存储值（ISO UTC）→ 界面输入框的值（本地） */
  const toDisplay = (value) => {
    if (value == null || value === "") return "";
    if (!hasExplicitTime(value)) return String(value).slice(0, 10);
    return formatDateTime(value);
  };

  /** 按本地日历加天，时分秒保持不变 */
  const addDays = (value, days) => {
    const p = parts(value);
    return p ? make(p.year, p.month, p.day + days, p.hour, p.minute, p.second) : null;
  };

  /** 只取日期部分（本地当天零点） */
  const toDateOnly = (value) => {
    const p = parts(value);
    return p ? make(p.year, p.month, p.day) : null;
  };

  /** 按日历天算相差天数（b - a），不受时刻和夏令时影响 */
  const daysBetween = (a, b) => {
    const pa = parts(a);
    const pb = parts(b);
    if (!pa || !pb) return null;
    return Math.round(
      (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86400000
    );
  };

  /** 今天的本地零点 */
  const today = (now = new Date()) => toDateOnly(now);

  window.taskTime = {
    // 解析
    parse,
    parseOrInvalid,
    hasExplicitTime,
    // 日历字段
    parts,
    make,
    // 展示（本地时区）
    formatDate,
    formatDateTime,
    toDisplay,
    // 写盘（ISO UTC）
    formatForStorage,
    // 日历运算
    addDays,
    toDateOnly,
    daysBetween,
    today,
  };
})();
