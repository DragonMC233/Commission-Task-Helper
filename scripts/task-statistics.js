// 统计引擎（MainView / BarView 共用）
// ---------------------------------------------------------------
// 抽出来的原因：app.js 与 bar.js 各自实现了一遍同样的统计算法，
// 且已经出现真实分叉：
//   1. extractCompletionSample：app.js 会扣除 pauseHistory 里的暂停天数，bar.js 不会
//   2. typeName 解析优先级相反：app.js 以任务类型列表为准，bar.js 以已有值为准
// 统一到本模块后，两边的口径强制一致。
// 口径采用 app.js 版本（扣除暂停天数、类型列表优先），它是两者的超集。
//
// 加载顺序：必须先于 app.js / bar.js。
(function () {
  const DEFAULT_MAX_SAMPLES = 10;
  // 时间衰减半衰期（天）：委托约半年到一年开一次，故取一年
  // 注意：分位数是「取某个具体样本值」的跳跃式统计，权重只能微调排列位置，
  // 样本量 < 15 时调整本参数几乎不会改变结果 —— 别指望靠它解决「旧数据过时」
  const DEFAULT_HALF_LIFE_DAYS = 365;

  const emptyAggregates = () => ({
    avgDailyHours: null,
    avgRequireDays: null,
    avgCompletedHours: null,
    sampleCount: 0,
  });

  /**
   * 样本聚合：按「越新权重越大」求和（w = 1/(idx+1)，samples 需已按时间倒序）
   */
  const computeStatisticsAggregates = (samples) => {
    if (!Array.isArray(samples) || samples.length === 0) {
      return emptyAggregates();
    }
    let sumDaily = 0;
    let sumDays = 0;
    let sumHours = 0;
    let weightSum = 0;
    samples.forEach((s, idx) => {
      if (!s) return;
      const weight = 1 / (idx + 1);
      sumDaily += s.dailyHours * weight;
      sumDays += s.requireDays * weight;
      sumHours += s.hours * weight;
      weightSum += weight;
    });
    if (weightSum === 0) {
      return emptyAggregates();
    }
    return {
      avgDailyHours: sumDaily / weightSum,
      avgRequireDays: sumDays / weightSum,
      avgCompletedHours: sumHours / weightSum,
      sampleCount: samples.length,
    };
  };

  /**
   * 时间衰减加权分位数：按值升序累积权重，取首次达到 q*W 的样本值
   * 权重 w = 0.5^(距今 / 半衰期)，半衰期见 halfLifeDays
   */
  const weightedQuantile = (pairs, q) => {
    const sorted = (Array.isArray(pairs) ? pairs : [])
      .slice()
      .sort((a, b) => a.value - b.value);
    let total = 0;
    sorted.forEach((p) => {
      total += p.weight;
    });
    if (total <= 0) return null;
    let acc = 0;
    for (const p of sorted) {
      acc += p.weight;
      if (acc >= q * total - 1e-9) return p.value;
    }
    return sorted.length ? sorted[sorted.length - 1].value : null;
  };

  /**
   * 近期体感统计：参考工时 / 参考价格 / 费率
   * 费率由「中位价格 ÷ 中位工时」反推，保证 价格 = 工时 × 费率 恒等自洽
   */
  const computeQuantileStats = (samples, halfLifeDays = DEFAULT_HALF_LIFE_DAYS) => {
    const empty = {
      hoursP25: null,
      hoursP375: null,
      hoursP50: null,
      hoursP75: null,
      priceP25: null,
      priceP375: null,
      priceP50: null,
      priceP75: null,
      rate: null,
      rateCheck: null,
      quantileSampleCount: 0,
      pricedSampleCount: 0,
    };
    const now = Date.now();
    const rows = [];
    (Array.isArray(samples) ? samples : []).forEach((s) => {
      if (!s) return;
      const hours = Number(s.hours);
      if (!Number.isFinite(hours) || hours <= 0) return;
      const endMs = new Date(s.completedAt).getTime();
      const ageDays = Number.isFinite(endMs)
        ? Math.max(0, (now - endMs) / 86400000)
        : 0;
      const payment = Number(s.payment);
      rows.push({
        hours,
        weight: Math.pow(0.5, ageDays / halfLifeDays),
        payment: Number.isFinite(payment) && payment > 0 ? payment : null,
      });
    });
    if (rows.length === 0) return empty;
    const priced = rows.filter((r) => r.payment !== null);
    const hoursPairs = rows.map((r) => ({ value: r.hours, weight: r.weight }));
    const pricePairs = priced.map((r) => ({ value: r.payment, weight: r.weight }));
    const hoursP25 = weightedQuantile(hoursPairs, 0.25);
    const hoursP375 = weightedQuantile(hoursPairs, 0.375);
    const hoursP50 = weightedQuantile(hoursPairs, 0.5);
    const hoursP75 = weightedQuantile(hoursPairs, 0.75);
    const priceP25 = weightedQuantile(pricePairs, 0.25);
    const priceP375 = weightedQuantile(pricePairs, 0.375);
    const priceP50 = weightedQuantile(pricePairs, 0.5);
    const priceP75 = weightedQuantile(pricePairs, 0.75);
    return {
      hoursP25,
      hoursP375,
      hoursP50,
      hoursP75,
      priceP25,
      priceP375,
      priceP50,
      priceP75,
      rate: hoursP50 && priceP50 ? priceP50 / hoursP50 : null,
      // 交叉校验量：单均时薪的加权中位数；与 rate 偏差过大说明价格与工时脱钩
      rateCheck: weightedQuantile(
        priced.map((r) => ({ value: r.payment / r.hours, weight: r.weight })),
        0.5
      ),
      quantileSampleCount: rows.length,
      pricedSampleCount: priced.length,
    };
  };

  /**
   * 从已完成任务提取一个统计样本
   */
  const extractCompletionSample = (task) => {
    if (!task || !task.completed) return null;
    const endRaw = task.completedAt || task.completed_at;
    if (!endRaw) return null;
    const end = new Date(endRaw);
    if (Number.isNaN(end.getTime())) return null;
    // 优先使用 actualStartTime（实际开始作画时间），避免将排期等待期计入消耗天数
    // startTime 仅作 fallback（pauseHistory 记录的是绝对时间戳，与起始点无关，不存在重复扣除问题）
    const startRaw =
      task.actualStartTime ||
      task.startTime ||
      task.starttime ||
      task.startDate ||
      task.deadline;
    if (!startRaw) return null;
    const start = new Date(startRaw);
    if (Number.isNaN(start.getTime())) return null;
    const hoursCandidates = [
      task.actualHours,
      task.completedHours,
      task.estimatedHours,
    ];
    let hours = null;
    for (const h of hoursCandidates) {
      if (Number.isFinite(Number(h)) && Number(h) > 0) {
        hours = Number(h);
        break;
      }
    }
    if (!hours) return null;
    // 从 pauseHistory 动态计算已完成的暂停总时长（避免依赖可能过时的 totalPausedDays）
    const pauseHistory = Array.isArray(task.pauseHistory) ? task.pauseHistory : [];
    const pausedMs = pauseHistory.reduce((sum, entry) => {
      if (!entry || !entry.pausedAt || !entry.resumedAt) return sum;
      const ps = new Date(entry.pausedAt).getTime();
      const pe = new Date(entry.resumedAt).getTime();
      const diff = pe - ps;
      return sum + (diff > 0 ? diff : 0);
    }, 0);
    const pausedDays = pausedMs / (1000 * 60 * 60 * 24);
    const calendarDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    const requireDays = Math.max(1, Math.ceil(calendarDays - pausedDays));
    const dailyHours = hours / requireDays;
    return {
      hours,
      requireDays,
      dailyHours,
      completedAt: end.toISOString(),
      // 成交金额：用于计算参考价格与费率
      payment: Number(task.payment) > 0 ? Number(task.payment) : 0,
      sourceTaskId: task.id,
      sourceTaskName: task.name || task.title || null,
    };
  };

  /**
   * 为样本补齐缺失的成交金额：历史样本可能早于金额统计
   * 返回是否发生过回填（调用方可据此决定是否写盘）
   */
  const backfillSamplePayments = (samples, tasks) => {
    const list = Array.isArray(tasks) ? tasks : [];
    let changed = false;
    (Array.isArray(samples) ? samples : []).forEach((s) => {
      if (!s || Number(s.payment) > 0 || s.sourceTaskId == null) return;
      const foundTask = list.find(
        (t) => String(t.id) === String(s.sourceTaskId)
      );
      const pay = Number(foundTask && foundTask.payment);
      if (Number.isFinite(pay) && pay > 0) {
        s.payment = pay;
        changed = true;
      }
    });
    return changed;
  };

  /**
   * 统计存储适配器：把「读/写统计对象、取任务列表、解析类型名」从两个视图里解耦
   *
   * options: {
   *   getStatistics(): 返回统计对象（可能被整体替换）
   *   setStatistics(stat): 统计对象被重建时回写（可选）
   *   getTasks(): 返回当前任务数组
   *   getTypeName(typeId): 返回类型显示名（可选）
   *   maxSamples?: number
   *   halfLifeDays?: number
   * }
   */
  class StatisticsEngine {
    constructor(options = {}) {
      this.getStatistics = options.getStatistics || (() => null);
      this.setStatistics = options.setStatistics || (() => {});
      this.getTasks = options.getTasks || (() => []);
      this.getTypeName = options.getTypeName || (() => undefined);
      this.maxSamples = options.maxSamples || DEFAULT_MAX_SAMPLES;
      this.halfLifeDays = options.halfLifeDays || DEFAULT_HALF_LIFE_DAYS;
    }

    _ensureStatistics() {
      let stats = this.getStatistics();
      if (!stats || typeof stats !== "object") {
        stats = { version: 1, types: {} };
        this.setStatistics(stats);
      }
      if (!stats.types || typeof stats.types !== "object") stats.types = {};
      return stats;
    }

    _resolveTypeName(taskType, fallback) {
      // 类型列表优先，找不到再退回统计条目里已有的名字
      return this.getTypeName(taskType) ?? fallback;
    }

    _rebuildEntry(taskType, samples, fallbackTypeName) {
      const trimmed = samples.slice(0, this.maxSamples);
      backfillSamplePayments(trimmed, this.getTasks());
      const agg = computeStatisticsAggregates(trimmed);
      const quant = computeQuantileStats(trimmed, this.halfLifeDays);
      const typeName = this._resolveTypeName(taskType, fallbackTypeName);
      return {
        ...(typeName !== undefined ? { typeName } : {}),
        samples: trimmed,
        avgDailyHours: agg.avgDailyHours,
        avgRequireDays: agg.avgRequireDays,
        avgCompletedHours: agg.avgCompletedHours,
        ...quant,
        sampleCount: agg.sampleCount,
        updatedAt: new Date().toISOString(),
      };
    }

    /** 写入一条完成样本（同源任务会覆盖，避免重复） */
    upsertSample(taskType, sample) {
      if (!taskType || !sample) return null;
      const stats = this._ensureStatistics();
      const types = stats.types;
      const existing = types[taskType] || { samples: [] };
      const samples = Array.isArray(existing.samples) ? [...existing.samples] : [];
      const tasks = this.getTasks();
      const srcId =
        sample && (sample.sourceTaskId || sample.source_task_id || sample.sourceTask);
      if (srcId !== null && srcId !== undefined) {
        const idx = samples.findIndex(
          (s) => s && (s.sourceTaskId || s.source_task_id || s.sourceTask) == srcId
        );
        if (idx >= 0) {
          // 保留已有样本中的名称，若新样本没有提供
          if (!sample.sourceTaskName) {
            sample.sourceTaskName =
              samples[idx]?.sourceTaskName ||
              samples[idx]?.source_task_name ||
              samples[idx]?.name ||
              null;
          }
          // 若仍无名称，尝试从当前 tasks 列表查找
          if (!sample.sourceTaskName) {
            const foundTask = tasks.find((t) => String(t.id) === String(srcId));
            if (foundTask && foundTask.name) sample.sourceTaskName = foundTask.name;
          }
          samples[idx] = sample;
        } else {
          // 若新样本没有名称，尝试从当前 tasks 列表查找并填充
          if (!sample.sourceTaskName) {
            const foundTask = tasks.find((t) => String(t.id) === String(srcId));
            if (foundTask && foundTask.name) sample.sourceTaskName = foundTask.name;
          }
          samples.push(sample);
        }
      } else {
        // 否则直接追加（兼容旧样本）
        samples.push(sample);
      }
      samples.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
      types[taskType] = this._rebuildEntry(taskType, samples, existing.typeName);
      stats.version = stats.version || 1;
      return types[taskType];
    }

    /** 删除某个源任务对应的样本（任务取消完成或改类型时用） */
    removeSample(taskType, sourceTaskId) {
      if (!taskType || sourceTaskId === null || sourceTaskId === undefined) {
        return null;
      }
      const stats = this.getStatistics();
      if (!stats || !stats.types) return null;
      const entry = stats.types[taskType];
      if (!entry || !Array.isArray(entry.samples)) return null;
      const filtered = entry.samples.filter(
        (s) => (s && (s.sourceTaskId || s.source_task_id || s.sourceTask)) != sourceTaskId
      );
      // 如果长度未变，则无删除
      if (filtered.length === entry.samples.length) return null;
      filtered.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
      stats.types[taskType] = this._rebuildEntry(taskType, filtered, entry.typeName);
      return stats.types[taskType];
    }

    /** 任务完成时记录样本 */
    recordCompletion(task) {
      const sample = extractCompletionSample(task);
      if (!sample || !task || !task.type) return null;
      return this.upsertSample(task.type, sample);
    }
  }

  window.taskStatistics = {
    computeStatisticsAggregates,
    weightedQuantile,
    computeQuantileStats,
    extractCompletionSample,
    backfillSamplePayments,
    StatisticsEngine,
    DEFAULT_MAX_SAMPLES,
    DEFAULT_HALF_LIFE_DAYS,
  };
})();
