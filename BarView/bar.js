(() => {
  const BAR_THEME_VERSION = "20260217b";
  const state = {
    data: null,
    tasks: [],
    order: [],
    rows: new Map(),
    layout: new Map(),
    editMode: false,
    selection: new Set(),
    selectionBox: null,
    drag: null,
    undoStack: [],
    redoStack: [],
    preview: { currentId: null, snapshots: [] },
    _baseTasksCache: null, // 内存缓存，不写入 preview.json
    taskPreviewId: null,
    options: {
      wheelScroll: true,
      openNewTab: true,
      theme: "standard",
    },
    zoomSteps: [
      // 1-day group (very fine control): from wide editing to compact
      { dayWidth: 60, tickStep: 1 },
      { dayWidth: 48, tickStep: 1 },
      { dayWidth: 40, tickStep: 1 },
      { dayWidth: 36, tickStep: 1 },
      { dayWidth: 30, tickStep: 1 },
      { dayWidth: 24, tickStep: 1 },

      // 3-day group (labels 1/3/6/9/12/15/18/21/24/27)
      { dayWidth: 20, tickStep: 3 },
      { dayWidth: 16, tickStep: 3 },
      { dayWidth: 13, tickStep: 3 },
      { dayWidth: 12, tickStep: 3 },

      // 5-day group (labels 1/5/10/15/20/25)
      { dayWidth: 10, tickStep: 5 },
      { dayWidth: 8, tickStep: 5 },
      { dayWidth: 7, tickStep: 5 },
      { dayWidth: 6, tickStep: 5 },

      // 10-day group (labels 1/10/20)
      { dayWidth: 5, tickStep: 10 },
      { dayWidth: 4, tickStep: 10 },

      // 15-day group (labels 1/15)
      { dayWidth: 3, tickStep: 15 },
      { dayWidth: 2.5, tickStep: 15 },
      { dayWidth: 2, tickStep: 15 },
    ],
    zoomIndex: parseInt(localStorage.getItem('barview-zoom-index')) || 0,
    range: { start: null, end: null },
    rowHeight: 50,
    barHeight: 35,
    scrolledToToday: false,
    _historySnapshotOnOpen: undefined, // 打开历史面板时的快照 ID，关闭时用于判断是否自动保存
  };

  const els = {
    ganttScroll: document.getElementById("gantt-scroll"),
    ganttContent: document.getElementById("gantt-content"),
    grid: document.getElementById("gantt-grid"),
    bars: document.getElementById("gantt-bars"),
    links: document.getElementById("gantt-links"),
    year: document.getElementById("timeline-year"),
    month: document.getElementById("timeline-month"),
    dayLabel: document.getElementById("timeline-day-label"),
    dayTicks: document.getElementById("timeline-day-ticks"),
    btnEdit: document.getElementById("btn-edit"),
    btnSave: document.getElementById("btn-save"),
    btnUndo: document.getElementById("btn-undo"),
    btnRedo: document.getElementById("btn-redo"),
    btnHistory: document.getElementById("btn-history"),
    btnRecycle: document.getElementById("btn-recycle"),
    btnGoCards: document.getElementById("btn-go-cards"),
    btnSettings: document.getElementById("btn-settings"),
    settingsModal: document.getElementById("settings-modal"),
    closeSettingsBtn: document.getElementById("close-settings-btn"),
    saveSettingsBtn: document.getElementById("save-settings-btn"),
    historyPanel: document.getElementById("history-panel"),
    historyList: document.getElementById("history-list"),
    historyClose: document.getElementById("history-close"),
    recyclePanel: document.getElementById("recycle-panel"),
    recycleList: document.getElementById("recycle-list"),
    recycleClose: document.getElementById("recycle-close"),
    addTask: document.getElementById("add-task-btn"),
    optWheel: document.getElementById("opt-wheel-scroll"),
    optOpenNewTab: document.getElementById("opt-open-new-tab"),
    optTheme: document.getElementById("opt-theme"),
    insertIndicator: document.getElementById("insert-indicator"),
    selectionRect: document.getElementById("selection-rect"),
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const toDateOnly = (value) => {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };

  // ---- color helpers（委托到 taskUtils 共享实现） ----
  const { hexToRgb, parseRgbString, rgbToHsv, hsvToRgb, blendWithWhite, hexToHsl, getNearestTailwindTextHex,
    supportsOKLCH, srgbToLinear, linearToSrgb, rgbToXyz, xyzToOklab, oklabToOklch, oklchToOklab,
    oklabToXyz, xyzToRgb, hexToOklch, oklchToRgb, computeOklchAdjustedRing } = window.taskUtils;

  const computeLightBgFromHex = (hex, capS, capV) => {
    const rgb = hexToRgb(hex);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    const defaultS = state.data?.hsvMaxS ?? 1;
    const defaultV = state.data?.hsvMaxV ?? 1;
    const cappedS = Math.min(hsv.s, Math.max(0, capS ?? defaultS));
    const cappedV = Math.min(1, Math.max(0, capV ?? defaultV));
    const out = hsvToRgb(hsv.h, cappedS, cappedV);
    return `rgb(${out.r}, ${out.g}, ${out.b})`;
  };

  const addDays = (date, days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  };

  const formatDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const daysBetween = (start, end) => {
    const ms = end.getTime() - start.getTime();
    return Math.round(ms / 86400000);
  };

  const loadOptions = () => {
    try {
      const saved = JSON.parse(localStorage.getItem("barview-options") || "{}");
      state.options = { ...state.options, ...saved };
    } catch (e) {
      // ignore
    }
    if (els.optWheel) els.optWheel.checked = !!state.options.wheelScroll;
    if (els.optOpenNewTab) els.optOpenNewTab.checked = !!state.options.openNewTab;
    if (els.optTheme) els.optTheme.value = state.options.theme || "standard";
    applyTheme(state.options.theme);
  };

  const saveOptions = () => {
    localStorage.setItem("barview-options", JSON.stringify(state.options));
  };

  const applyTheme = (theme) => {
    // 更新根目录主题CSS
    const themeLink = document.getElementById("theme-stylesheet");
    if (themeLink) {
      themeLink.setAttribute(
        "href",
        theme === "warm" ? "../MainView/暖色.css" : "../MainView/标准.css"
      );
    }
    
    // 更新bar专属CSS（使用 TW 版本，保持 rem + Tailwind token）
    const barThemeLink = document.getElementById("bar-theme-stylesheet");
    if (barThemeLink) {
      const barCssMap = {
        warm: `bar-warm.css?v=${BAR_THEME_VERSION}`,
        lite: `bar-lite.css?v=${BAR_THEME_VERSION}`,
      };
      barThemeLink.setAttribute(
        "href",
        barCssMap[theme] ?? `bar-standard.css?v=${BAR_THEME_VERSION}`
      );
    }
    
    document.documentElement.setAttribute("data-theme", theme);
    updateTaskPreviewTheme(theme);
  };

  const getTaskStart = (task) =>
    (task.urgentA && task.actualStartTime)
      ? task.actualStartTime
      : task.startTime || task.starttime || task.deadline;

  const getTaskEnd = (task) =>
    (task.completed && task.completedAt) || task.completedAt || task.deadline;

  const normalizeTask = (task) => {
    const startRaw = getTaskStart(task);
    const endRaw = getTaskEnd(task) || startRaw;
    const start = toDateOnly(startRaw) || new Date();
    const end = toDateOnly(endRaw) || start;
    const today = toDateOnly(new Date());
    let safeEnd = end < start ? start : end;
    if (task.abandoned) {
      // 废弃任务以 abandonedAt 为结尾（若有），不延伸到今天
      const abandonedEnd = task.abandonedAt ? (toDateOnly(task.abandonedAt) || safeEnd) : safeEnd;
      safeEnd = abandonedEnd < start ? start : abandonedEnd;
    } else if (!task.completed && today && safeEnd < today) {
      safeEnd = today;
    }
    return {
      ...task,
      __startDate: start,
      __endDate: safeEnd,
      __duration: Math.max(1, daysBetween(start, safeEnd) + 1),
    };
  };

  // ---- Statistics helpers (mirror app.js logic) ----
  const STATISTICS_MAX_SAMPLES = 10;

  const getStatistics = () => {
    if (!state.data) return { version: 1, types: {} };
    if (!state.data.statistics || typeof state.data.statistics !== 'object') {
      state.data.statistics = { version: 1, types: {} };
    }
    return state.data.statistics;
  };

  const computeStatisticsAggregates = (samples) => {
    if (!Array.isArray(samples) || samples.length === 0) {
      return { avgDailyHours: null, avgRequireDays: null, avgCompletedHours: null, sampleCount: 0 };
    }
    let sumDaily = 0, sumDays = 0, sumHours = 0, weightSum = 0;
    samples.forEach((s, idx) => {
      if (!s) return;
      const weight = 1 / (idx + 1);
      sumDaily += s.dailyHours * weight;
      sumDays += s.requireDays * weight;
      sumHours += s.hours * weight;
      weightSum += weight;
    });
    if (weightSum === 0) {
      return { avgDailyHours: null, avgRequireDays: null, avgCompletedHours: null, sampleCount: 0 };
    }
    return {
      avgDailyHours: sumDaily / weightSum,
      avgRequireDays: sumDays / weightSum,
      avgCompletedHours: sumHours / weightSum,
      sampleCount: samples.length,
    };
  };

  const extractCompletionSample = (task) => {
    if (!task || !task.completed) return null;
    const endRaw = task.completedAt || task.completed_at;
    if (!endRaw) return null;
    const end = new Date(endRaw);
    if (Number.isNaN(end.getTime())) return null;
    const startRaw = task.actualStartTime || task.startTime || task.starttime || task.startDate || task.deadline;
    if (!startRaw) return null;
    const start = new Date(startRaw);
    if (Number.isNaN(start.getTime())) return null;
    const hoursCandidates = [task.actualHours, task.completedHours, task.estimatedHours];
    let hours = null;
    for (const h of hoursCandidates) {
      if (Number.isFinite(Number(h)) && Number(h) > 0) { hours = Number(h); break; }
    }
    if (!hours) return null;
    const requireDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    const dailyHours = hours / requireDays;
    return { hours, requireDays, dailyHours, completedAt: end.toISOString(), sourceTaskId: task.id };
  };

  const upsertStatisticsSample = (taskType, sample) => {
    if (!taskType || !sample) return null;
    const stats = getStatistics();
    const types = stats.types || {};
    const existing = types[taskType] || { samples: [] };
    const samples = Array.isArray(existing.samples) ? [...existing.samples] : [];
    const srcId = sample && (sample.sourceTaskId || sample.source_task_id || sample.sourceTask);
    if (srcId !== null && srcId !== undefined) {
      const idx = samples.findIndex((s) => s && (s.sourceTaskId || s.source_task_id || s.sourceTask) == srcId);
      if (idx >= 0) { samples[idx] = sample; } else { samples.push(sample); }
    } else {
      samples.push(sample);
    }
    samples.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    const trimmed = samples.slice(0, STATISTICS_MAX_SAMPLES);
    const agg = computeStatisticsAggregates(trimmed);
    types[taskType] = {
      samples: trimmed,
      avgDailyHours: agg.avgDailyHours,
      avgRequireDays: agg.avgRequireDays,
      avgCompletedHours: agg.avgCompletedHours,
      sampleCount: agg.sampleCount,
      updatedAt: new Date().toISOString(),
    };
    stats.version = stats.version || 1;
    stats.types = types;
    return types[taskType];
  };

  const removeStatisticsSample = (taskType, sourceTaskId) => {
    if (!taskType || sourceTaskId === null || sourceTaskId === undefined) return null;
    const stats = getStatistics();
    if (!stats || !stats.types) return null;
    const entry = stats.types[taskType];
    if (!entry || !Array.isArray(entry.samples)) return null;
    const filtered = entry.samples.filter(
      (s) => (s && (s.sourceTaskId || s.source_task_id || s.sourceTask)) != sourceTaskId
    );
    if (filtered.length === entry.samples.length) return null;
    filtered.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    const trimmed = filtered.slice(0, STATISTICS_MAX_SAMPLES);
    const agg = computeStatisticsAggregates(trimmed);
    stats.types[taskType] = {
      samples: trimmed,
      avgDailyHours: agg.avgDailyHours,
      avgRequireDays: agg.avgRequireDays,
      avgCompletedHours: agg.avgCompletedHours,
      sampleCount: agg.sampleCount,
      updatedAt: new Date().toISOString(),
    };
    return stats.types[taskType];
  };

  const recordCompletionStatistics = (task) => {
    const sample = extractCompletionSample(task);
    if (!sample || !task || !task.type) return null;
    return upsertStatisticsSample(task.type, sample);
  };

  // Helper: walk up the chain to find the root (ancestor without lineTaskId)
  const getChainRootId = (task, byId) => {
    const seen = new Set();
    let cur = task;
    while (cur && cur.lineTaskId) {
      if (seen.has(String(cur.id))) break; // cycle
      seen.add(String(cur.id));
      const parent = byId.get(String(cur.lineTaskId));
      if (!parent) break;
      cur = parent;
    }
    return String((cur && cur.id) || task.id);
  };

  // Build ordered chains and flatten to state.order so that each chain is contiguous
  const buildOrder = () => {
    const byId = new Map(state.tasks.map((t) => [String(t.id), t]));

    // If using a snapshot ordering, preserve it but ensure chain contiguity
    if (state.preview.currentId) {
      const current = state.preview.snapshots.find(
        (s) => s.id === state.preview.currentId
      );
      if (current && Array.isArray(current.order)) {
        // Start from snapshot order, but regroup into chains
        const orderedTasks = current.order
          .map((id) => byId.get(String(id)))
          .filter(Boolean);
        // Group by chain root in the order they appear
        const groups = [];
        const seenRoots = new Set();
        orderedTasks.forEach((t) => {
          const rootId = getChainRootId(t, byId);
          if (!seenRoots.has(rootId)) {
            seenRoots.add(rootId);
            groups.push({ rootId, tasks: [] });
          }
          groups[groups.length - 1].tasks.push(t);
        });
        // Append missing tasks not in snapshot
        const missing = state.tasks
          .filter((t) => !current.order.includes(String(t.id)))
          .sort(sortTasks);
        missing.forEach((t) => {
          const rootId = getChainRootId(t, byId);
          let g = groups.find((x) => x.rootId === rootId);
          if (!g) {
            g = { rootId, tasks: [] };
            groups.push(g);
          }
          g.tasks.push(t);
        });

        state.order = groups.flatMap((g) => g.tasks.map((t) => String(t.id)));
        return;
      }
    }

    // Default: group tasks by chain root and sort chains by earliest start
    const chainMap = new Map();
    state.tasks.forEach((t) => {
      const rootId = getChainRootId(t, byId);
      if (!chainMap.has(rootId)) chainMap.set(rootId, []);
      chainMap.get(rootId).push(t);
    });

    // For deterministic ordering inside a chain, perform DFS from root following children
    const children = new Map();
    state.tasks.forEach((t) => {
      if (t.lineTaskId) {
        const pid = String(t.lineTaskId);
        if (!children.has(pid)) children.set(pid, []);
        children.get(pid).push(t);
      }
    });

    const chains = [];
    for (const [rootId, tasks] of chainMap.entries()) {
      const root = byId.get(rootId);
      const order = [];
      const visited = new Set();
      const dfs = (node) => {
        if (!node || visited.has(String(node.id)) || !chainMap.get(rootId).includes(node)) return;
        visited.add(String(node.id));
        order.push(node);
        const ch = (children.get(String(node.id)) || []).slice();
        ch.sort((a, b) => a.__startDate - b.__startDate);
        ch.forEach((c) => dfs(c));
      };
      if (root && chainMap.get(rootId).includes(root)) dfs(root);
      else {
        // Fallback: sort tasks by start and run dfs from each
        const arr = chainMap.get(rootId).slice().sort((a, b) => a.__startDate - b.__startDate);
        arr.forEach((n) => dfs(n));
      }
      const chainStart = order.reduce((min, t) => Math.min(min, t.__startDate.getTime()), Infinity);
      const chainEnd = order.reduce((max, t) => Math.max(max, t.__endDate.getTime()), -Infinity);
      chains.push({ rootId, order, chainStart, chainEnd });
    }

    chains.sort((a, b) => a.chainStart - b.chainStart || a.rootId.localeCompare(b.rootId));
    state.order = chains.flatMap((c) => c.order.map((t) => String(t.id)));
  };

  const sortTasks = (a, b) => {
    const aStart = a.__startDate.getTime();
    const bStart = b.__startDate.getTime();
    if (aStart !== bStart) return aStart - bStart;
    const aEnd = a.__endDate.getTime();
    const bEnd = b.__endDate.getTime();
    if (aEnd !== bEnd) return aEnd - bEnd;
    return (a.name || "").localeCompare(b.name || "");
  };

  const assignRows = () => {
    // Interval-based row assignment for compact layout.
    // Each global row tracks a list of occupied [start, end] intervals,
    // allowing later tasks to fill gaps between earlier tasks on the same row.
    // Chains are placed as contiguous blocks of rows to stay visually grouped,
    // but independent tasks can reuse gap space in any row.
    const rowIntervals = []; // rowIntervals[i] = [{s, e}, ...] per row
    state.rows.clear();
    const byId = new Map(state.tasks.map((t) => [String(t.id), t]));

    // Check if interval [s, e] fits in a row without overlapping existing intervals
    const fitsInRow = (rowIdx, s, e) => {
      if (rowIdx >= rowIntervals.length) return true;
      return rowIntervals[rowIdx].every(iv => s >= iv.e || e <= iv.s);
    };

    // Add an interval to a row
    const addToRow = (rowIdx, s, e) => {
      while (rowIntervals.length <= rowIdx) rowIntervals.push([]);
      rowIntervals[rowIdx].push({ s, e });
    };

    // Build groups by scanning state.order and grouping by chain root
    const groups = [];
    let lastRoot = null;
    let curGroup = null;
    const getRootIdLocal = (task) => {
      const seen = new Set();
      let cur = task;
      while (cur && cur.lineTaskId) {
        if (seen.has(String(cur.id))) break;
        seen.add(String(cur.id));
        const parent = byId.get(String(cur.lineTaskId));
        if (!parent) break;
        cur = parent;
      }
      return String((cur && cur.id) || task.id);
    };

    state.order.forEach((id) => {
      const task = byId.get(String(id));
      if (!task) return;
      const rootId = getRootIdLocal(task);
      if (rootId !== lastRoot) {
        curGroup = { rootId, tasks: [] };
        groups.push(curGroup);
        lastRoot = rootId;
      }
      curGroup.tasks.push(task);
    });

    // Apply a bounded chain-priority: chains receive a small "boost" upward proportional to their size,
    // but the boost is capped so tasks that start much earlier won't be pushed below late chains.
    groups.sort((a, b) => {
      const aStart = Math.min(...a.tasks.map((t) => t.__startDate.getTime()));
      const bStart = Math.min(...b.tasks.map((t) => t.__startDate.getTime()));
      const aIsChain = a.tasks.length > 1;
      const bIsChain = b.tasks.length > 1;
      const MAX_BOOST_DAYS = 14; // cap chain boost to 2 weeks
      const BOOST_PER_NODE_DAYS = 2; // each additional node provides this many days of boost
      const aBoostDays = aIsChain ? Math.min(MAX_BOOST_DAYS, a.tasks.length * BOOST_PER_NODE_DAYS) : 0;
      const bBoostDays = bIsChain ? Math.min(MAX_BOOST_DAYS, b.tasks.length * BOOST_PER_NODE_DAYS) : 0;
      const MS_PER_DAY = 86400000;
      const aScore = aStart - aBoostDays * MS_PER_DAY;
      const bScore = bStart - bBoostDays * MS_PER_DAY;
      if (aScore !== bScore) return aScore - bScore;
      return String(a.rootId).localeCompare(String(b.rootId));
    });

    // For each group, assign local rows then map to global rows
    groups.forEach((group) => {
      const tasks = group.tasks.slice().sort((a, b) => a.__startDate - b.__startDate);
      // Pack into local rows within the group (greedy non-overlap)
      const localRowEnds = [];
      const localRows = []; // array of arrays
      tasks.forEach((t) => {
        const s = t.__startDate.getTime();
        const e = t.__endDate.getTime();
        // find first local row where s > end
        let r = localRowEnds.findIndex((end) => s > end);
        if (r === -1) {
          r = localRowEnds.length;
          localRowEnds.push(e);
          localRows.push([t]);
        } else {
          localRowEnds[r] = Math.max(localRowEnds[r], e);
          localRows[r].push(t);
        }
      });

      // locate which local row contains the root (root task should be in group.tasks)
      const rootId = group.rootId;
      let rootLocalIndex = -1;
      for (let i = 0; i < localRows.length; i++) {
        if (localRows[i].some((x) => String(x.id) === String(rootId))) {
          rootLocalIndex = i;
          break;
        }
      }
      if (rootLocalIndex === -1) rootLocalIndex = 0; // fallback

      // Order local rows so root's local row is assigned first, others follow (branches below)
      const localOrder = [rootLocalIndex, ...Array.from({ length: localRows.length }, (_, i) => i).filter(i => i !== rootLocalIndex)];
      const numLocalRows = localRows.length;

      // Compute intervals per local row
      const localIvs = localRows.map(lr =>
        lr.map(t => ({ s: t.__startDate.getTime(), e: t.__endDate.getTime() }))
      );

      // Find first starting global row where ALL local rows fit in a contiguous block
      const maxTry = rowIntervals.length + numLocalRows;
      let bestStart = maxTry; // fallback: append at end
      for (let startRow = 0; startRow <= maxTry; startRow++) {
        let allFit = true;
        for (let offset = 0; offset < numLocalRows; offset++) {
          const globalRow = startRow + offset;
          const ivs = localIvs[localOrder[offset]];
          for (const iv of ivs) {
            if (!fitsInRow(globalRow, iv.s, iv.e)) {
              allFit = false;
              break;
            }
          }
          if (!allFit) break;
        }
        if (allFit) {
          bestStart = startRow;
          break;
        }
      }

      // Place tasks into global rows
      localOrder.forEach((localIndex, offset) => {
        const globalRow = bestStart + offset;
        localRows[localIndex].forEach(t => {
          state.rows.set(String(t.id), globalRow);
          addToRow(globalRow, t.__startDate.getTime(), t.__endDate.getTime());
        });
      });
    });
  };

  const computeRange = () => {
    if (!state.tasks.length) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = addDays(start, 30);
      state.range = { start, end };
      return;
    }
    const starts = state.tasks.map((t) => t.__startDate.getTime());
    const ends = state.tasks.map((t) => t.__endDate.getTime());
    const min = new Date(Math.min(...starts));
    const max = new Date(Math.max(...ends));
    // 增加额外 3 个月的时间范围，确保末尾任务能显示在屏幕中部
    const rangeEnd = new Date(max.getFullYear(), max.getMonth() + 3, max.getDate());
    state.range = { start: addDays(min, -7), end: rangeEnd };
  };

  // Compute an auto-start date string for a successor based on predecessor task and bufferDays
  const computeAutoStartFromPredecessor = (prevTask, bufferDays) => {
    if (!prevTask) return null;
    const baseRaw = prevTask.completedAt || prevTask.deadline;
    if (!baseRaw) return null;
    let base = new Date(baseRaw);
    if (Number.isNaN(base.getTime())) return null;

    // If predecessor not completed and its deadline is in the past, use today as base
    const today = new Date();
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (!prevTask.completedAt && prevTask.deadline) {
      const dl = new Date(prevTask.deadline);
      if (!Number.isNaN(dl.getTime()) && dl < todayOnly) {
        base = new Date(todayOnly.getTime());
      }
    }

    const rawProvided = Number.isFinite(Number(bufferDays)) ? Math.round(Number(bufferDays)) : 1;
    const raw = Math.max(-1, rawProvided);
    const add = raw + 1; // keep same semantic mapping as app.js
    const newStart = addDays(base, add);
    return formatDate(newStart);
  };

  // Reflow chain successors starting from taskId recursively
  // Reflow chain successors starting from taskId recursively (hybrid strategy)
  const reflowChainFrom = (taskId) => {
    const children = state.tasks.filter((t) => String(t.lineTaskId) === String(taskId));
    if (!children.length) return;
    const parent = state.tasks.find((t) => String(t.id) === String(taskId));
    children.forEach((child) => {
      // 仅当后继勾选了自动计算开始时间时才调整
      if (!child.autoSchedule) {
        reflowChainFrom(child.id);
        return;
      }

      const newStartStr = computeAutoStartFromPredecessor(parent, parent?.bufferDays);
      if (!newStartStr) return;

      const newStartDate = new Date(newStartStr);
      let newEndDate;

      // urgentA 任务：已实际提前开工，截止日基于 actualStartTime 计算，与 app.js adjustChainFrom 保持一致
      const isUrgentA = !!(child.urgentA && child.actualStartTime);
      const deadlineBase = isUrgentA ? child.actualStartTime : newStartStr;

      if (child.autoCalcEnd) {
        // 使用统计数据计算截止日期
        const autoEnd = modalController
          ? modalController.computeAutoDeadline(deadlineBase, child.estimatedHours, child.type)
          : null;
        if (autoEnd) {
          newEndDate = new Date(autoEnd);
        } else if (Number.isFinite(child.estimatedDay) && child.estimatedDay >= 0) {
          // 回退：优先使用 estimatedDay
          newEndDate = addDays(new Date(deadlineBase), child.estimatedDay);
        } else {
          // 回退：使用原始 startTime/deadline 计算工期（避免 normalizeTask 膨胀 __endDate 到今天导致偏差）
          const rawStart = toDateOnly(child.startTime || child.starttime) || child.__startDate;
          const rawEnd = toDateOnly(child.deadline) || child.__endDate;
          const oldDuration = Math.max(1, daysBetween(rawStart, rawEnd) + 1);
          newEndDate = addDays(new Date(deadlineBase), oldDuration - 1);
        }
      } else if (Number.isFinite(child.estimatedDay) && child.estimatedDay >= 0) {
        // 使用手动工期向后传播（支持 0 = 当天完成）
        newEndDate = addDays(new Date(deadlineBase), child.estimatedDay);
      } else {
        // 仅调整开始时间，使用原始 startTime/deadline 计算工期（避免 __endDate 膨胀偏差）
        const rawStart = toDateOnly(child.startTime || child.starttime) || child.__startDate;
        const rawEnd = toDateOnly(child.deadline) || child.__endDate;
        const oldDuration = Math.max(1, daysBetween(rawStart, rawEnd) + 1);
        newEndDate = addDays(new Date(deadlineBase), oldDuration - 1);
      }

      // 保留原始时间部分：若新计算日期与已有日期部分相同，不截断含时间的字符串
      const calcStartStr = formatDate(newStartDate);
      const calcEndStr = formatDate(newEndDate);
      const existingStartRaw = child.startTime || child.starttime || "";
      const existingEndRaw = child.deadline || "";
      const finalStart = existingStartRaw.startsWith(calcStartStr) ? existingStartRaw : calcStartStr;
      const finalEnd = existingEndRaw.startsWith(calcEndStr) ? existingEndRaw : calcEndStr;

      state.tasks = state.tasks.map((t) => {
        if (String(t.id) !== String(child.id)) return t;
        return normalizeTask({ ...t, startTime: finalStart, deadline: finalEnd });
      });

      // recurse for next level
      reflowChainFrom(child.id);
    });
  };

  // 处理"actualStartTime 早于 startTime"的加急冲突（对标 app.js handleAccelerateConflict）
  const handleAccelerateConflict = (task) => {
    const tasks = state.tasks || [];
    // 构建有序前序链 [链头, ..., 紧前任务]（头插法）
    const orderedPreds = [];
    const seen = new Set();
    let cur = task;
    while (cur && cur.lineTaskId && !seen.has(String(cur.lineTaskId))) {
      seen.add(String(cur.lineTaskId));
      const pred = tasks.find((t) => String(t.id) === String(cur.lineTaskId));
      if (!pred) break;
      orderedPreds.unshift(pred);
      cur = pred;
    }

    // 根据 actualStartTime 定位分支锚点
    // urgentA 永远为分支，主链排期保持不变
    // 找 Q = 最后一个 startTime <= actualStart 的前序
    //   无 Q              → 独立任务（lineTaskId = null）
    //   gap <= 7天（含重叠）→ 分支自 Q（同档并行/紧随）
    //   gap > 7天          → 往前一级（避免分支悬空过长）
    const BRANCH_GAP_DAYS = 7;
    let newLineTaskId = null;
    if (task.actualStartTime) {
      const actualStart = new Date(task.actualStartTime).getTime();
      let qIdx = -1;
      for (let i = orderedPreds.length - 1; i >= 0; i--) {
        if (new Date(orderedPreds[i].startTime).getTime() <= actualStart) {
          qIdx = i;
          break;
        }
      }
      if (qIdx !== -1) {
        const Q = orderedPreds[qIdx];
        const gapDays = (actualStart - new Date(Q.deadline).getTime()) / 86400000;
        if (gapDays <= BRANCH_GAP_DAYS) {
          newLineTaskId = Q.id;
        } else {
          newLineTaskId = qIdx > 0 ? orderedPreds[qIdx - 1].id : null;
        }
      }
      // qIdx === -1: actualStart 早于所有前序 → 独立任务
    }

    const message = `任务"${task.name}"已实际开始，早于链式计算的开始时间。是否确认加急并调整链顺序？`;
    const dialogEl = document.createElement('div');
    dialogEl.className = 'fixed inset-0 z-50 flex items-center justify-center p-4';
    dialogEl.style.backgroundColor = 'rgba(0,0,0,0.5)';
    dialogEl.innerHTML = `
      <div class="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
        <div class="mb-4"><p class="text-stone-800">${message}</p></div>
        <div class="flex gap-3">
          <button class="confirm-cancel flex-1 px-4 py-2 border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors">取消</button>
          <button class="confirm-ok flex-1 px-4 py-2 rounded-lg transition-colors btn-save">确认</button>
        </div>
      </div>`;
    document.body.appendChild(dialogEl);
    dialogEl.querySelector('.confirm-cancel').addEventListener('click', () =>
      dialogEl.parentNode && document.body.removeChild(dialogEl)
    );
    dialogEl.querySelector('.confirm-ok').addEventListener('click', () => {
      task.urgentA = true;
      task.lineTaskId = newLineTaskId;
      task.dependencyType = newLineTaskId ? 'line' : 'none';
      // urgentA 任务截止日期基于实际开始时间重新计算
      if (task.autoCalcEnd && task.actualStartTime && modalController) {
        const autoEnd = modalController.computeAutoDeadline(
          task.actualStartTime,
          task.estimatedHours,
          task.type
        );
        if (autoEnd) {
          task.deadline = autoEnd;
          const norm = normalizeTask(task);
          Object.assign(task, { __startDate: norm.__startDate, __endDate: norm.__endDate, __duration: norm.__duration });
        }
      }
      dialogEl.parentNode && document.body.removeChild(dialogEl);
      saveData();
      renderBars();
      renderLinks();
    });
    dialogEl.addEventListener('click', (e) => {
      if (e.target === dialogEl) dialogEl.parentNode && document.body.removeChild(dialogEl);
    });
  };

  const renderTimeline = () => {
    const { start, end } = state.range;
    const { dayWidth, tickStep } = state.zoomSteps[state.zoomIndex];
    const totalDays = daysBetween(start, end) + 1;

    els.ganttContent.style.width = `${totalDays * dayWidth}px`;

    const yearFragments = [];
    const monthFragments = [];
    const dayLabelFragments = [];
    const dayTickFragments = [];

    let cursor = new Date(start);
    while (cursor <= end) {
      const yearStart = new Date(cursor.getFullYear(), 0, 1);
      const yearEnd = new Date(cursor.getFullYear(), 11, 31);
      const yearBlockEnd = yearEnd < end ? yearEnd : end;
      const yearSpan = daysBetween(cursor, yearBlockEnd) + 1;
      yearFragments.push(
        `<div class="timeline-block" style="width:${
          yearSpan * dayWidth
        }px">${cursor.getFullYear()}</div>`
      );
      cursor = addDays(yearBlockEnd, 1);
    }

    cursor = new Date(start);
    while (cursor <= end) {
      const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const monthBlockEnd = monthEnd < end ? monthEnd : end;
      const monthSpan = daysBetween(cursor, monthBlockEnd) + 1;
      monthFragments.push(
        `<div class="timeline-block" style="width:${
          monthSpan * dayWidth
        }px">${cursor.getMonth() + 1}月</div>`
      );
      cursor = addDays(monthBlockEnd, 1);
    }

    // Build merged label/tick blocks according to tickStep so large-scale tick modes
    // render as wider blocks instead of single-day blocks (removes daily gridlines)
    let cursorDate = new Date(start);
    const isLabelDay = (date) => {
      const day = date.getDate();
      if (tickStep === 1) return true;
      return day % tickStep === 1;
    };
    const gridLineFragments = [];
    // Track which block index each month is at so we can apply month-specific rules (e.g., Feb block 1 or 2)
    const monthBlockIndex = new Map();
    while (cursorDate <= end) {
      const showLabel = isLabelDay(cursorDate);
      // find how many days until next showLabel (or end)
      let spanDays = 1;
      let probe = addDays(cursorDate, 1);
      while (probe <= end) {
        const probeShow = isLabelDay(probe);
        if (probeShow) break;
        spanDays++;
        probe = addDays(probe, 1);
      }
      const blockStartPx = daysBetween(start, cursorDate) * dayWidth;
      const blockWidthPx = spanDays * dayWidth;
      const shouldShowLabel = showLabel && (spanDays === tickStep || tickStep === 1); // Only show label on complete blocks
      const alignStartClass = tickStep > 1 && shouldShowLabel ? " align-start" : "";
      // Vertical grid line placed at block start (left edge) so day boundaries align with block beginnings
      const lineLeftPx = blockStartPx;

      // Determine month block index for special per-month handling (e.g., Feb first/second block)
      const ymKey = `${cursorDate.getFullYear()}-${String(cursorDate.getMonth() + 1).padStart(2, "0")}`;
      const idx = (monthBlockIndex.get(ymKey) || 0) + 1;
      monthBlockIndex.set(ymKey, idx);

      // Only show faint vertical lines for narrow blocks when not in 10-day or 15-day major tick modes
      if (shouldShowLabel) {
        gridLineFragments.push(`<div class="grid-line" style="left:${lineLeftPx}px"></div>`);
      } else {
        if (tickStep !== 10 && tickStep !== 15) {
          gridLineFragments.push(`<div class="grid-line faint" style="left:${lineLeftPx}px"></div>`);
        }
      }

      // Special-case: force both-side lines for Feb in certain modes
      const month = cursorDate.getMonth(); // 0-indexed; Feb is 1
      const isFebSpecial15 = tickStep === 15 && month === 1 && idx === 1;
      const isFebSpecial10 = tickStep === 10 && month === 1 && idx === 2;
      if (isFebSpecial15 || isFebSpecial10) {
        const rightPx = blockStartPx + blockWidthPx;
        // Add right-side strong line
        gridLineFragments.push(`<div class="grid-line" style="left:${rightPx}px"></div>`);
      }

      dayLabelFragments.push(
        `<div class="timeline-block${alignStartClass}" style="width:${blockWidthPx}px">${
          shouldShowLabel ? cursorDate.getDate() : ""
        }</div>`
      );
      dayTickFragments.push(
        `<div class="tick-block${alignStartClass}" style="width:${blockWidthPx}px">${
          shouldShowLabel ? '<span class="tick-mark"></span>' : ''
        }</div>`
      );
      cursorDate = addDays(cursorDate, spanDays);
    }

    els.year.innerHTML = yearFragments.join("");
    els.month.innerHTML = monthFragments.join("");
    els.dayLabel.innerHTML = dayLabelFragments.join("");
    els.dayTicks.innerHTML = dayTickFragments.join("");
    els.grid.innerHTML = gridLineFragments.join("");
  };

  const renderBars = () => {
    const { start } = state.range;
    const { dayWidth } = state.zoomSteps[state.zoomIndex];
    const rowHeight = state.rowHeight;
    const barHeight = state.barHeight;
    const layout = new Map();
    els.bars.innerHTML = "";

    state.tasks.forEach((task) => {
      const row = state.rows.get(String(task.id)) || 0;
      const left = daysBetween(start, task.__startDate) * dayWidth;
      const width = task.__duration * dayWidth;
      const top = row * rowHeight + (rowHeight - barHeight) / 2;
      layout.set(String(task.id), { left, top, width, row });

      const type = state.data?.taskTypes?.find((t) => t.id === task.type);
      const baseColor = type ? type.color : "#6B7280";
      const barBg = computeLightBgFromHex(baseColor);
      const blendedBg = blendWithWhite(barBg, 0.25);
      const ok = computeOklchAdjustedRing(baseColor);
      const ring = ok
        ? supportsOKLCH()
          ? ok.oklch
          : ok.rgb
        : baseColor;
      // 用户自定义系数（0~1），控制已完成任务整体透明度
      const userCoeff = state.data?.completedTaskOpacity ?? 0.8;
      // 废弃任务：固定低透明度（0.45），灰色覆盖
      const isAbandoned = !!task.abandoned;
      // 已完成任务：整体 userCoeff（文字透明度保持一致）；废弃任务：0.45；未完成任务：1
      const opacity = isAbandoned ? 0.45 : task.completed ? userCoeff : 1;
      // 废弃任务使用灰色，覆盖原本的类型颜色
      const effectiveBarBg = isAbandoned ? "#e5e7eb" : blendedBg;
      const effectiveRing = isAbandoned ? "#94a3b8" : ring;

      // ── 实际开始时间分段计算 ──
      // 如果任务已完成且有 actualStartTime，且落在 bar 范围内，则计算分割像素位置
      let splitPx = null;
      if (task.completed && task.actualStartTime) {
        const actualStartDate = toDateOnly(task.actualStartTime);
        if (actualStartDate) {
          const daysFromStart = daysBetween(task.__startDate, actualStartDate);
          // 仅在 actualStartTime 严格位于 bar 范围内时启用分段
          if (daysFromStart > 0 && daysFromStart < task.__duration) {
            splitPx = daysFromStart * dayWidth;
          }
        }
      }

      const bar = document.createElement("div");
      bar.className = `gantt-bar ${task.dependencyType === "line" ? "chain" : ""} ${isAbandoned ? "abandoned" : ""} ${task.completed ? "completed" : ""}`;
      if (state.editMode) bar.classList.add("editable");
      if (state.selection.has(String(task.id))) bar.classList.add("selected");
      bar.dataset.id = String(task.id);
      bar.style.left = `${left}px`;
      bar.style.top = `${top}px`;
      bar.style.width = `${width}px`;
      bar.style.height = `${barHeight}px`;
      bar.style.borderColor = effectiveRing;
      const typeName = type ? type.name : "";
      const sourceName = state.data?.sourcePlatforms?.find(s => s.id === task.source)?.name || "";
      const fullTitle = [task.name || "未命名", typeName, sourceName].filter(Boolean).join(" - ");
      bar.title = fullTitle; // 鼠标悬浮显示任务全名-类型-来源

      // 文字 + 端点圆点（始终在最顶层，通过 DOM 顺序保证在两个 bg 层之上）
      // 废弃任务：显示 block 图标+删除线；已完成任务：显示 check 图标
      let labelHtml;
      if (isAbandoned) {
        labelHtml = `<span class="bar-label-wrapper"><span class="bar-check material-icons-outlined" style="color:#94a3b8;">block</span><span class="bar-label" style="text-decoration:line-through;color:#94a3b8;">${task.name || "未命名"}</span></span>`;
      } else if (task.completed) {
        labelHtml = `<span class="bar-label-wrapper"><span class="bar-check material-icons-outlined">check</span><span class="bar-label">${task.name || "未命名"}</span></span>`;
      } else {
        // lite 主题：根据任务类型颜色推断近似 Tailwind 文字颜色，替代固定橙色
        const liteNodeColor = state.options.theme === "lite" ? getNearestTailwindTextHex(baseColor) : null;
        const labelStyle = liteNodeColor ? ` style="color:${liteNodeColor}"` : "";
        labelHtml = `<span class="bar-label-wrapper"><span class="bar-label"${labelStyle}>${task.name || "未命名"}</span></span>`;
      }
      const innerContent = `
        <span class="bar-dot start" style="background:${effectiveRing};"></span>
        ${labelHtml}
        <span class="bar-dot end" style="background:${effectiveRing};"></span>
      `;

      if (splitPx !== null) {
        // ── 双段模式 ──
        // 父层承载 userCoeff 作为整体不透明度（文字/点同步变暗到 userCoeff）
        // 左段（实际开始前）：相对 opacity 0.2 => 视觉 userCoeff × 0.2（偏暗）
        // 右段（实际开始后）：相对 opacity 0.7 => 视觉 userCoeff × 0.7（偏亮）
        // 两段均为全圆角 pill；在分割点互相叠加 barHeight/2 px → 形成「(O(O」圆形衔接
        // overflow:hidden 让两段 pill 被 bar 自身 border-radius 完全裁剪，端点完美对齐
        bar.style.background = "transparent";
        bar.style.opacity = String(userCoeff);
        bar.style.overflow = "hidden";

        const overlapPx = Math.round(barHeight / 2); // ≈ 17px，使两端圆形自然衔接

        const leftSeg = document.createElement("div");
        leftSeg.className = "bar-bg-seg bar-bg-left";
        leftSeg.style.cssText = [
          "position:absolute", "top:0", "left:0",
          `width:${splitPx + overlapPx}px`,
          "height:100%", "border-radius:9999px",
          `background:${effectiveBarBg}`, "opacity:0.2",
          "pointer-events:none",
        ].join(";") + ";";

        const rightSeg = document.createElement("div");
        rightSeg.className = "bar-bg-seg bar-bg-right";
        rightSeg.style.cssText = [
          "position:absolute", "top:0",
          `left:${Math.max(0, splitPx - overlapPx)}px`,
          "right:0", "height:100%", "border-radius:9999px",
          `background:${effectiveBarBg}`, "opacity:0.7",
          "pointer-events:none",
        ].join(";") + ";";

        // 分割点圆弧描边：以右段 pill 左圆头为中心，宽高均为 barHeight，border-radius 使其为圆形
        // border 宽度略小于 bar 本身的描边（bar 用 1px，此处用 0.75px 呈现细一圈的效果）
        const splitRing = document.createElement("div");
        splitRing.style.cssText = [
          "position:absolute",
          "top:0",
          `left:${Math.max(0, splitPx - overlapPx)}px`,
          `width:${barHeight}px`,
          "height:100%",
          "border-radius:9999px",
          `border:0.75px solid ${effectiveRing}`,
          "background:transparent",
          "box-sizing:border-box",
          "clip-path:inset(0 50% 0 0)",  // 只显示左半圆弧
          "opacity:0.5",  // 半透明
          "pointer-events:none",
        ].join(";") + ";";

        bar.innerHTML = innerContent;
        // insertBefore → segs 排在 DOM 前面，文字/点在后 → 文字/点渲染在最上层
        bar.insertBefore(rightSeg, bar.firstChild);
        bar.insertBefore(leftSeg, bar.firstChild);
        // splitRing 在两段背景之上、文字/点之下（DOM 顺序决定层级）
        bar.insertBefore(splitRing, rightSeg.nextSibling);
      } else {
        // ── 单色模式（废弃任务使用灰色）──
        bar.style.background = effectiveBarBg;
        bar.style.opacity = String(opacity);
        bar.innerHTML = innerContent;
      }

      els.bars.appendChild(bar);
    });

    state.layout = layout;
    const totalHeight =
      (Math.max(0, ...state.rows.values()) + 1) * rowHeight + 40;
    els.bars.style.height = `${totalHeight}px`;
    // Let CSS control grid height (top/bottom); removing explicit height avoids overflow caused by top offset
    if (els.grid) els.grid.style.removeProperty('height');
    // Ensure links SVG covers either the bars area or the visible scroll area, whichever is larger
    const scrollH = els.ganttScroll ? els.ganttScroll.clientHeight : 0;
    if (els.links) els.links.setAttribute("height", Math.max(totalHeight, scrollH));
  };

  const renderLinks = () => {
    els.links.innerHTML = "";
    const { dayWidth } = state.zoomSteps[state.zoomIndex];
    const dotOffset = 6;
    const barHeight = state.barHeight;

    state.tasks.forEach((task) => {
      if (!task.lineTaskId) return;
      const from = state.layout.get(String(task.lineTaskId));
      const to = state.layout.get(String(task.id));
      if (!from || !to) return;

      const startX = from.left + from.width - dotOffset;
      const startY = from.top + barHeight / 2;
      const endX = to.left + dotOffset;
      const endY = to.top + barHeight / 2;

      let path;
      if (from.row === to.row) {
        path = `M ${startX} ${startY} L ${endX} ${endY}`;
      } else {
        const dx = Math.max(20, Math.abs(endX - startX));
        // produce an S-curve that starts horizontal, bends vertically in the middle, then ends horizontal
        // increase horizontal segments (factor) and enforce a minimum pixel offset to avoid diagonal appearance at low zoom
        const H_FACTOR = 0.45; // proportion of dx to use for horizontal handles
        const MIN_H_PX = 40; // minimum horizontal handle in pixels
        // cap to avoid handles crossing (never exceed half the distance)
        const hOffset = Math.min(Math.max(dx * H_FACTOR, MIN_H_PX), dx * 0.49);
        const cp1x = startX + hOffset;
        const cp1y = startY;
        const cp2x = endX - hOffset;
        const cp2y = endY;
        path = `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
      }
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg", //svg命名空间标识符
        "path"
      );
      line.setAttribute("d", path);
      // Use CSS classes for styling so themes can override without JS changes
      line.setAttribute("fill", "none");
      line.dataset.taskId = String(task.id);
      line.classList.add("gantt-link");
      if (task.dependencyType === "line") line.classList.add("chain");
      else line.classList.add("dependency");
      els.links.appendChild(line);
    });
  };

  const updateStickyLabels = () => {
    if (state._stickyQueued) return;
    state._stickyQueued = true;
    requestAnimationFrame(() => {
      state._stickyQueued = false;
      const scrollLeft = els.ganttScroll.scrollLeft;
      // Define safe zones (padding) inside the bar where text must NOT go (to avoid dots)
      const padLeft = 24; // 1.5rem
      const padRight = 32; // 2rem (right safety)
      const viewMargin = 10; // Keep text at least 10px inside view

      document.querySelectorAll(".gantt-bar").forEach((bar) => {
        // use wrapper if exists (contains icon + text) otherwise fall back to label
        let label = bar.querySelector(".bar-label-wrapper");
        if (!label) {
          label = bar.querySelector(".bar-label");
        }
        if (!label) return;

        const barLeft = bar.offsetLeft;
        const barWidth = bar.offsetWidth;

        // 1. Constrain content width so it truncates before overlapping end dot area
        // This is the absolute maximum width available for the label in the bar context
        const availableWidth = Math.max(0, barWidth - padLeft - padRight);
        // We set maxWidth so that CSS ellipsis can work if text is longer than the bar
        label.style.maxWidth = `${availableWidth}px`;

        // 2. Calculate horizontal position to keep text in view (Sticky behavior)
        const currentLabelWidth = label.offsetWidth; // width after maxWidth constraint

        // Calculate where we WANT the text to be (absolute X relative to bar start)
        // We want it at (scrollLeft - barLeft) + margin
        const desiredX = scrollLeft - barLeft + viewMargin;

        // Clamp the desired position to the safe zone:
        // Min: padLeft (start of content area)
        // Max: barWidth - padRight - labelWidth (end of content area)
        const minX = padLeft;
        const maxX = Math.max(minX, barWidth - padRight - currentLabelWidth);

        const targetX = clamp(desiredX, minX, maxX);

        // 3. Apply shift
        // Since default layout puts label at 'padLeft' (due to CSS padding),
        // we shift by (targetX - padLeft).
        const shift = targetX - padLeft;

        label.style.transform = `translateX(${shift}px)`;
      });
    });
  };

  const renderAll = () => {
    buildOrder();
    assignRows();
    computeRange();
    renderTimeline();
    renderBars();
    renderLinks();
    updateStickyLabels();
    scrollToToday();
  };

  // ── Lightweight drag-only renderer ──
  // Only repositions the dragged bar DOM elements and redraws connected SVG links.
  // Avoids full DOM teardown/rebuild for smooth 60fps dragging.
  const renderDragFrame = () => {
    if (!state.drag) return;
    const { start } = state.range;
    const { dayWidth } = state.zoomSteps[state.zoomIndex];
    const barHeight = state.barHeight;
    const dotOffset = 6;
    const dragSet = new Set(state.drag.taskIds.map(String));

    // 计算纵向偏移（仅 move 类型）
    const deltaY = (state.drag.type === "move" && state.drag.startY != null)
      ? (state.drag.lastClientY - state.drag.startY) : 0;

    // 1. Update positions of dragged bar elements & layout cache
    dragSet.forEach((id) => {
      const task = state.tasks.find((t) => String(t.id) === id);
      if (!task) return;
      const barEl = els.bars.querySelector(`.gantt-bar[data-id="${id}"]`);
      if (!barEl) return;

      const left = daysBetween(start, task.__startDate) * dayWidth;
      const width = task.__duration * dayWidth;
      barEl.style.left = `${left}px`;
      barEl.style.width = `${width}px`;

      // 垂直跟随鼠标
      if (deltaY !== 0) {
        const origRow = state.rows.get(id) || 0;
        const origTop = origRow * state.rowHeight + (state.rowHeight - barHeight) / 2;
        barEl.style.top = `${origTop + deltaY}px`;
        barEl.style.zIndex = '100';
      }

      // Update layout cache so link redraws use the latest position
      const layoutEntry = state.layout.get(id);
      if (layoutEntry) {
        layoutEntry.left = left;
        layoutEntry.width = width;
        if (deltaY !== 0) {
          const origRow = state.rows.get(id) || 0;
          layoutEntry.top = origRow * state.rowHeight + (state.rowHeight - barHeight) / 2 + deltaY;
        }
      }
    });

    // 2. Redraw only SVG links connected to dragged tasks
    // Collect all task IDs whose links might have changed
    const affectedIds = new Set(dragSet);
    state.tasks.forEach((t) => {
      if (dragSet.has(String(t.lineTaskId))) affectedIds.add(String(t.id));
    });

    // Remove old link paths for affected tasks and redraw them
    const existingPaths = els.links.querySelectorAll('path');
    existingPaths.forEach((p) => {
      const taskId = p.dataset.taskId;
      if (taskId && affectedIds.has(taskId)) p.remove();
    });

    affectedIds.forEach((id) => {
      const task = state.tasks.find((t) => String(t.id) === id);
      if (!task || !task.lineTaskId) return;
      const from = state.layout.get(String(task.lineTaskId));
      const to = state.layout.get(String(task.id));
      if (!from || !to) return;

      const startX = from.left + from.width - dotOffset;
      const startY = from.top + barHeight / 2;
      const endX = to.left + dotOffset;
      const endY = to.top + barHeight / 2;

      let path;
      if (from.row === to.row) {
        path = `M ${startX} ${startY} L ${endX} ${endY}`;
      } else {
        const dx = Math.max(20, Math.abs(endX - startX));
        const H_FACTOR = 0.45;
        const MIN_H_PX = 40;
        const hOffset = Math.min(Math.max(dx * H_FACTOR, MIN_H_PX), dx * 0.49);
        path = `M ${startX} ${startY} C ${startX + hOffset} ${startY}, ${endX - hOffset} ${endY}, ${endX} ${endY}`;
      }
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('d', path);
      line.setAttribute('fill', 'none');
      line.dataset.taskId = id;
      line.classList.add('gantt-link');
      if (task.dependencyType === 'line') line.classList.add('chain');
      else line.classList.add('dependency');
      els.links.appendChild(line);
    });

    // 脱链 / 插入预览：重绘连线后重新应用 fade 效果（新建 path 会覆盖之前的淡化）
    if (state.drag.type === 'move' && (state.drag.detached || state.drag.insertTarget)) {
      updateInsertIndicator(state.drag.lastClientX, state.drag.lastClientY);
    }
  };

  const scrollToToday = () => {
    if (state.scrolledToToday) return;
    const today = toDateOnly(new Date());
    if (!today || !state.range.start) return;
    const { dayWidth } = state.zoomSteps[state.zoomIndex];
    const offsetDays = daysBetween(state.range.start, today);
    const target = Math.max(0, offsetDays * dayWidth - els.ganttScroll.clientWidth * 0.3);
    els.ganttScroll.scrollLeft = target;
    state.scrolledToToday = true;
  };

  const sanitizeTaskForSnapshot = (task) => {
    const { __startDate, __endDate, __duration, ...rest } = task;
    const startRaw = task.startTime || task.starttime || "";
    const endRaw = task.deadline || "";
    // 保留原始字符串（可能含时间部分），仅在为空时用 __startDate/__endDate 兜底
    const start = startRaw || (task.__startDate ? formatDate(task.__startDate) : "");
    const end = endRaw || (task.__endDate ? formatDate(task.__endDate) : "");
    return { ...rest, startTime: start, starttime: start, deadline: end };
  };

  const snapshotSignature = (snapshot) => {
    const sorted = [...snapshot].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return JSON.stringify(sorted);
  };

  const captureCurrentSnapshot = () => state.tasks.map(sanitizeTaskForSnapshot);

  const pushUndoSnapshot = (snapshot) => {
    state.undoStack.push(snapshot);
    if (state.undoStack.length > 20) state.undoStack.shift();
    state.redoStack = [];
    updateUndoRedoButtons();
  };

  const pushUndo = () => {
    pushUndoSnapshot(captureCurrentSnapshot());
  };

  const applySnapshot = (snapshot) => {
    if (!snapshot) return;
    state.tasks = snapshot.map((t) => normalizeTask(t));
    renderAll();
  };

  const updateUndoRedoButtons = () => {
    if (els.btnUndo) els.btnUndo.disabled = state.undoStack.length === 0;
    if (els.btnRedo) els.btnRedo.disabled = state.redoStack.length === 0;
  };

  const toggleEditMode = async () => {
    const next = !state.editMode;
    state.editMode = next;
    els.btnEdit.classList.toggle("active", state.editMode);
    if (!next) {
      await commitEditsToIndex();
    }
    renderAll();
  };

  const handleBarClick = (e, taskId) => {
    if (!state.editMode) return;
    if (e.ctrlKey && e.shiftKey) {
      selectTaskAndDescendants(taskId);
      return;
    }
    if (e.ctrlKey) {
      toggleSelection(taskId);
      return;
    }
    if (!state.selection.has(taskId) || state.selection.size > 1) {
      state.selection.clear();
      state.selection.add(taskId);
      renderAll();
    }
  };

  const toggleSelection = (taskId) => {
    if (state.selection.has(taskId)) state.selection.delete(taskId);
    else state.selection.add(taskId);
    renderAll();
  };

  const selectTaskAndDescendants = (taskId) => {
    const descendants = getDescendants(taskId);
    state.selection = new Set([taskId, ...descendants]);
    renderAll();
  };

  const getDescendants = (taskId) => {
    const children = state.tasks.filter(
      (t) => String(t.lineTaskId) === String(taskId)
    );
    const result = [];
    children.forEach((child) => {
      result.push(String(child.id));
      result.push(...getDescendants(String(child.id)));
    });
    return result;
  };

  const handleDragStart = (e, taskId) => {
    if (!state.editMode) return;
    // 防止拖拽过程中选中文本
    document.body.classList.add('barview-no-select');
    const target = e.target;
    if (target.classList.contains("bar-dot")) {
      state.drag = {
        type: target.classList.contains("start") ? "resize-start" : "resize-end",
        taskIds: [taskId],
        startX: e.clientX,
        origin: captureTaskDates([taskId]),
        lastDeltaDays: 0,
      };
      state.drag.undoSnapshot = captureCurrentSnapshot();
      state.drag.undoSignature = snapshotSignature(state.drag.undoSnapshot);
      return;
    }

    if (!state.selection.has(taskId)) {
      state.selection = new Set([taskId]);
    }
    if (e.shiftKey && state.selection.size === 1) {
      const descendants = getDescendants(taskId);
      state.selection = new Set([taskId, ...descendants]);
    }

    // 记录拖拽的任务的原始行号（用于判断脱链阈值）
    const originalRow = state.rows.get(String(taskId)) || 0;
    const task = state.tasks.find(t => String(t.id) === String(taskId));
    const isChainTask = task && (task.lineTaskId || state.tasks.some(t => String(t.lineTaskId) === String(taskId)));

    state.drag = {
      type: "move",
      taskIds: Array.from(state.selection),
      startX: e.clientX,
      startY: e.clientY,
      origin: captureTaskDates(Array.from(state.selection)),
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      lastDeltaDays: 0,
      originalRow,
      currentRow: originalRow,
      isChainTask: !!isChainTask,
      detached: false,       // 是否已触发脱链预览
      insertTarget: null,    // { prevId, nextId } 插入目标
    };
    state.drag.undoSnapshot = captureCurrentSnapshot();
    state.drag.undoSignature = snapshotSignature(state.drag.undoSnapshot);
  };

  const captureTaskDates = (taskIds) => {
    const map = new Map();
    taskIds.forEach((id) => {
      const task = state.tasks.find((t) => String(t.id) === String(id));
      if (!task) return;
      map.set(String(id), {
        start: new Date(task.__startDate),
        end: new Date(task.__endDate),
      });
    });
    return map;
  };

  const handleDragMove = (e) => {
    if (!state.drag) return;
    const { dayWidth } = state.zoomSteps[state.zoomIndex];
    const deltaDays = Math.round((e.clientX - state.drag.startX) / dayWidth);

    state.drag.lastClientX = e.clientX;
    state.drag.lastClientY = e.clientY;

    // 计算当前鼠标对应的行号（用于 move 类型的脱链/插入判断）
    if (state.drag.type === "move") {
      const rect = els.ganttScroll.getBoundingClientRect();
      const y = e.clientY - rect.top + els.ganttScroll.scrollTop;
      const timelineH = els.bars.offsetTop;
      state.drag.currentRow = Math.max(0, Math.floor((y - timelineH) / state.rowHeight));

      // 判断脱链：链式任务拖出超过3行
      const rowDelta = Math.abs(state.drag.currentRow - state.drag.originalRow);
      if (state.drag.isChainTask && rowDelta > 3) {
        state.drag.detached = true;
        state.drag.insertTarget = null; // 脱链时清除插入预览
      } else {
        state.drag.detached = false;
      }

      // 判断插入：检测鼠标是否靠近某条链的间隔位置
      const draggedId = state.drag.taskIds[0];
      const insertResult = findChainInsertionPoint(e.clientX, e.clientY, state.drag.taskIds);
      if (insertResult && !state.drag.detached) {
        // 非脱链状态下检测到插入目标
        state.drag.insertTarget = insertResult;
      } else if (state.drag.detached) {
        // 脱链后也可以检测插入目标（拖入另一个链）
        state.drag.insertTarget = insertResult;
      } else {
        state.drag.insertTarget = null;
      }

      // 更新插入指示器
      updateInsertIndicator(e.clientX, e.clientY);
    }

    // Skip date update if nothing horizontally changed
    if (deltaDays === state.drag.lastDeltaDays) {
      // 仍需安排垂直跟随的视觉更新
      if (state.drag.type === "move") scheduleDragVisualUpdate();
      return;
    }
    state.drag.lastDeltaDays = deltaDays;

    // Update task data in-place (no array copy)
    state.drag.taskIds.forEach(id => {
      const task = state.tasks.find(t => String(t.id) === id);
      if (!task) return;
      const origin = state.drag.origin.get(id);
      if (!origin) return;

      let start = new Date(origin.start);
      let end = new Date(origin.end);

      if (state.drag.type === "move") {
        start = addDays(start, deltaDays);
        end = addDays(end, deltaDays);
      } else if (state.drag.type === "resize-start") {
        start = addDays(start, deltaDays);
        if (start > end) start = end;
      } else if (state.drag.type === "resize-end") {
        end = addDays(end, deltaDays);
        if (end < start) end = start;
      }

      task.startTime = formatDate(start);
      task.starttime = task.startTime;
      task.deadline = formatDate(end);
      task.__startDate = start;
      task.__endDate = end;
      task.__duration = daysBetween(start, end) + 1;
    });

    // Use lightweight drag renderer (only moves bar CSS + redraws affected SVG links)
    // Coalesce into a single animation frame
    if (state._dragRafId) cancelAnimationFrame(state._dragRafId);
    state._dragRafId = requestAnimationFrame(() => {
      state._dragRafId = null;
      renderDragFrame();
    });
  };

  // 仅垂直移动（无水平日期变化）也需要更新视觉位置
  const scheduleDragVisualUpdate = () => {
    if (state._dragRafId) return; // 已有排程
    state._dragRafId = requestAnimationFrame(() => {
      state._dragRafId = null;
      renderDragFrame();
    });
  };

  const handleDragEnd = (e) => {
    if (!state.drag) return;
    // Cancel any pending drag render frame
    if (state._dragRafId) {
      cancelAnimationFrame(state._dragRafId);
      state._dragRafId = null;
    }

    if (state.drag.type === "move") {
      applyDragChainOps();
    }

    if (state.drag.undoSnapshot) {
      const currentSnapshot = captureCurrentSnapshot();
      if (snapshotSignature(currentSnapshot) !== state.drag.undoSignature) {
        pushUndoSnapshot(state.drag.undoSnapshot);
      }
    }
    addSnapshot(Array.from(state.drag.taskIds));
    hideInsertIndicator();
    clearPreviewLinks();
    state.drag = null;
    // 恢复可选中文本
    document.body.classList.remove('barview-no-select');
    // One full render to sync everything after drag completes
    renderAll();
  };

  // ── 以下为重构后的链操作函数 ──

  // ── 链插入位置检测 ──
  const findChainInsertionPoint = (clientX, clientY, draggedIds) => {
    const rect = els.ganttScroll.getBoundingClientRect();
    const cursorX = clientX - rect.left + els.ganttScroll.scrollLeft;
    const cursorY = clientY - rect.top + els.ganttScroll.scrollTop;
    const timelineH = els.bars.offsetTop;
    const cursorRow = Math.max(0, Math.floor((cursorY - timelineH) / state.rowHeight));
    const draggedSet = new Set((draggedIds || []).map(String));

    const tasksInRow = [];
    state.layout.forEach((layoutInfo, taskId) => {
      if (draggedSet.has(taskId)) return;
      if (layoutInfo.row !== cursorRow) return;
      const task = state.tasks.find(t => String(t.id) === taskId);
      if (!task) return;
      const isChain = task.lineTaskId || state.tasks.some(t => String(t.lineTaskId) === taskId);
      if (!isChain) return;
      tasksInRow.push({ task, layout: layoutInfo });
    });

    if (tasksInRow.length === 0) return null;
    tasksInRow.sort((a, b) => a.layout.left - b.layout.left);

    for (const { task, layout } of tasksInRow) {
      if (cursorX >= layout.left && cursorX <= layout.left + layout.width) {
        const midX = layout.left + layout.width / 2;
        if (cursorX < midX) {
          const predId = task.lineTaskId ? String(task.lineTaskId) : null;
          if (!predId) return { prevId: null, nextId: String(task.id) };
          if (draggedSet.has(predId)) return null;
          return { prevId: predId, nextId: String(task.id) };
        } else {
          const successors = state.tasks.filter(t => String(t.lineTaskId) === String(task.id) && !draggedSet.has(String(t.id)));
          if (successors.length === 0) return { prevId: String(task.id), nextId: null };
          const sameRowSucc = successors.find(s => { const sl = state.layout.get(String(s.id)); return sl && sl.row === cursorRow; });
          const chosenSucc = sameRowSucc || successors[0];
          return { prevId: String(task.id), nextId: String(chosenSucc.id) };
        }
      }
    }

    for (let i = 0; i < tasksInRow.length - 1; i++) {
      const a = tasksInRow[i], b = tasksInRow[i + 1];
      if (cursorX > a.layout.left + a.layout.width && cursorX < b.layout.left) {
        if (String(b.task.lineTaskId) === String(a.task.id)) return { prevId: String(a.task.id), nextId: String(b.task.id) };
        if (String(a.task.lineTaskId) === String(b.task.id)) return { prevId: String(b.task.id), nextId: String(a.task.id) };
      }
    }

    if (cursorX < tasksInRow[0].layout.left) {
      const first = tasksInRow[0];
      if (first.task.lineTaskId && !draggedSet.has(String(first.task.lineTaskId))) {
        return { prevId: String(first.task.lineTaskId), nextId: String(first.task.id) };
      }
    }
    return null;
  };

  const updateInsertIndicator = (clientX, clientY) => {
    if (!els.insertIndicator) return;
    const insert = state.drag?.insertTarget;
    if (!insert) {
      hideInsertIndicator();
      clearPreviewLinks();
      if (state.drag?.detached) renderDetachPreview();
      return;
    }

    const prevLayout = insert.prevId ? state.layout.get(insert.prevId) : null;
    const nextLayout = insert.nextId ? state.layout.get(insert.nextId) : null;
    let indicatorX, indicatorRow;
    if (prevLayout && nextLayout) {
      indicatorX = (prevLayout.left + prevLayout.width + nextLayout.left) / 2;
      indicatorRow = prevLayout.row;
    } else if (prevLayout) {
      indicatorX = prevLayout.left + prevLayout.width + 10;
      indicatorRow = prevLayout.row;
    } else if (nextLayout) {
      indicatorX = nextLayout.left - 10;
      indicatorRow = nextLayout.row;
    } else {
      hideInsertIndicator(); clearPreviewLinks(); return;
    }
    const timelineH = els.bars.offsetTop;
    const top = timelineH + indicatorRow * state.rowHeight + 2;
    els.insertIndicator.style.left = `${indicatorX}px`;
    els.insertIndicator.style.top = `${top}px`;
    els.insertIndicator.classList.add("visible");
    renderInsertPreviewLinks(insert, state.drag.taskIds[0]);
  };

  const hideInsertIndicator = () => {
    if (!els.insertIndicator) return;
    els.insertIndicator.classList.remove("visible");
  };

  const clearPreviewLinks = () => {
    els.links.querySelectorAll('.gantt-link-preview').forEach(p => p.remove());
    els.links.querySelectorAll('path.gantt-link').forEach(p => {
      if (p.style.opacity === '0.15') { p.style.opacity = ''; p.style.strokeDasharray = ''; }
    });
  };

  const createPreviewLinkPath = (fromLayout, toLayout) => {
    const dotOffset = 6, barHeight = state.barHeight;
    const startX = fromLayout.left + fromLayout.width - dotOffset;
    const startY = fromLayout.top + barHeight / 2;
    const endX = toLayout.left + dotOffset;
    const endY = toLayout.top + barHeight / 2;
    let d;
    if (fromLayout.row === toLayout.row) {
      d = `M ${startX} ${startY} L ${endX} ${endY}`;
    } else {
      const dx = Math.max(20, Math.abs(endX - startX));
      const hOffset = Math.min(Math.max(dx * 0.45, 40), dx * 0.49);
      d = `M ${startX} ${startY} C ${startX + hOffset} ${startY}, ${endX - hOffset} ${endY}, ${endX} ${endY}`;
    }
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', d); line.setAttribute('fill', 'none');
    line.classList.add('gantt-link', 'gantt-link-preview');
    return line;
  };

  const renderInsertPreviewLinks = (insertTarget, draggedId) => {
    clearPreviewLinks();
    if (!insertTarget) return;
    const dragLayout = state.layout.get(String(draggedId));
    if (!dragLayout) return;
    const { prevId, nextId } = insertTarget;

    if (prevId && nextId) {
      const existingLink = els.links.querySelector(`path[data-task-id="${nextId}"]`);
      if (existingLink) { existingLink.style.opacity = '0.15'; existingLink.style.strokeDasharray = '6 4'; }
    }
    if (prevId) {
      const prevLayout = state.layout.get(prevId);
      if (prevLayout) { const link = createPreviewLinkPath(prevLayout, dragLayout); link.style.strokeDasharray = '8 4'; link.style.stroke = 'var(--bar-danger)'; els.links.appendChild(link); }
    }
    if (nextId) {
      const nextLayout = state.layout.get(nextId);
      if (nextLayout) { const link = createPreviewLinkPath(dragLayout, nextLayout); link.style.strokeDasharray = '8 4'; link.style.stroke = 'var(--bar-danger)'; els.links.appendChild(link); }
    }
  };

  const renderDetachPreview = () => {
    clearPreviewLinks();
    if (!state.drag || state.drag.taskIds.length !== 1) return;
    const draggedId = String(state.drag.taskIds[0]);
    const task = state.tasks.find(t => String(t.id) === draggedId);
    if (!task) return;
    // 既不是链中任务也不是链首（无后续链式任务），则无需预览
    const hasSuccessors = state.tasks.some(t => String(t.lineTaskId) === draggedId);
    const isChainMember = task.lineTaskId || hasSuccessors;
    if (!isChainMember) return;

    // 不在脱链预览中显示与拖拽任务相关的连线
    // 直接移除涉及拖拽任务的真实 path 元素，避免它们成为实线显示。
    els.links.querySelectorAll('path.gantt-link').forEach(p => {
      const tid = p.dataset.taskId;
      // 如果这条 link 关联了拖拽任务，无论是作为目标还是来源，都移除
      if (tid === draggedId) {
        p.remove();
      } else {
        // 也可能它是某个任务的链接，而该任务的前序是 draggedId
        const succ = state.tasks.find(t => String(t.id) === tid);
        if (succ && String(succ.lineTaskId) === draggedId) {
          p.remove();
        }
      }
    });
    // 注意：pred→succ 虚线将在下面生成，真实链接会在 drag 结束后由 renderDragFrame/ops 重新绘制。

    // 链首任务：只需断线，没有前序可以连接到后继，不画新虚线
    if (!task.lineTaskId) return;

    // 有前序：画 pred→succ 的虚线预览（表示脱链后前后任务会直连）
    const predLayout = state.layout.get(String(task.lineTaskId));
    state.tasks.filter(t => String(t.lineTaskId) === draggedId).forEach(succ => {
      const succLayout = state.layout.get(String(succ.id));
      if (predLayout && succLayout) {
        const link = createPreviewLinkPath(predLayout, succLayout);
        link.style.strokeDasharray = '8 4'; link.style.opacity = '0.6';
        els.links.appendChild(link);
      }
    });
  };

  const applyDragChainOps = () => {
    if (!state.drag || state.drag.taskIds.length !== 1) return;
    const draggedId = String(state.drag.taskIds[0]);
    const task = state.tasks.find(t => String(t.id) === draggedId);
    if (!task) return;
    const insertTarget = state.drag.insertTarget;
    const detached = state.drag.detached;

    els.links.querySelectorAll('path.gantt-link').forEach(p => { p.style.opacity = ''; p.style.strokeDasharray = ''; });
    if (!detached && !insertTarget) return;

    // 脱链操作（拖出超过3行且无插入目标）
    if (detached && task.lineTaskId && !insertTarget) {
      const predId = String(task.lineTaskId);
      const successors = state.tasks.filter(t => String(t.lineTaskId) === draggedId);
      state.tasks = state.tasks.map(t => {
        if (String(t.id) === draggedId) return normalizeTask({ ...t, lineTaskId: null, dependencyType: null });
        if (successors.some(s => String(s.id) === String(t.id))) return normalizeTask({ ...t, lineTaskId: Number(predId) });
        return t;
      });
      // 脱链后：前序任务的后续链需要重新排期
      reflowChainFrom(predId);
      return;
    }
    // 链首脱链处理
    if (detached && !task.lineTaskId && !insertTarget) {
      const successors = state.tasks.filter(t => String(t.lineTaskId) === draggedId);
      if (successors.length > 0) {
        state.tasks = state.tasks.map(t => {
          if (successors.some(s => String(s.id) === String(t.id))) return normalizeTask({ ...t, lineTaskId: null, dependencyType: null });
          return t;
        });
        // 链首脱链：原后续任务已独立，各自从自身已有 startTime 重算截止日
        successors.forEach(s => reflowChainFrom(String(s.id)));
      }
      return;
    }
    // 插入操作
    if (insertTarget) {
      const { prevId, nextId } = insertTarget;
      const descendants = getDescendants(draggedId);
      if (prevId && descendants.includes(prevId)) return;
      if (nextId && descendants.includes(nextId)) return;

      if (task.lineTaskId) {
        const oldPredId = String(task.lineTaskId);
        const oldSuccessors = state.tasks.filter(t => String(t.lineTaskId) === draggedId);
        state.tasks = state.tasks.map(t => {
          if (oldSuccessors.some(s => String(s.id) === String(t.id))) return normalizeTask({ ...t, lineTaskId: Number(oldPredId) });
          return t;
        });
      } else {
        const oldSuccessors = state.tasks.filter(t => String(t.lineTaskId) === draggedId);
        state.tasks = state.tasks.map(t => {
          if (oldSuccessors.some(s => String(s.id) === String(t.id))) return normalizeTask({ ...t, lineTaskId: null, dependencyType: null });
          return t;
        });
      }

      state.tasks = state.tasks.map(t => {
        if (String(t.id) === draggedId) {
          return prevId
            ? normalizeTask({ ...t, dependencyType: "line", lineTaskId: Number(prevId) })
            : normalizeTask({ ...t, lineTaskId: null, dependencyType: null });
        }
        if (nextId && String(t.id) === nextId) return normalizeTask({ ...t, lineTaskId: Number(draggedId) });
        return t;
      });
      // 插入后：从前序位置向后重算日期链
      if (prevId) {
        reflowChainFrom(prevId);
      } else if (draggedId) {
        // 插入到链首（draggedId 无前序），直接从自身向后重算
        reflowChainFrom(draggedId);
      }
    }
  };

  const ensurePreviewBase = () => {
    // 若内存缓存不存在（页面刷新后由 init 设置，这里仅为防御性兜底）
    if (!state._baseTasksCache) {
      state._baseTasksCache = state.tasks.map(sanitizeTaskForSnapshot);
    }
    if (state.preview.currentId === undefined) state.preview.currentId = null;
    if (!Array.isArray(state.preview.snapshots)) state.preview.snapshots = [];
  };

  const resetPreviewBaseFromIndex = () => {
    // base.tasks 仅存内存，preview.json 只写时间戳供 UI 显示
    state._baseTasksCache = state.tasks.map(sanitizeTaskForSnapshot);
    state.preview.base = { time: new Date().toISOString() };
    state.preview.currentId = null;
    state.preview.snapshots = [];
    savePreview();
  };

  const getSnapshotChain = (snapshotId) => {
    if (!snapshotId) return [];
    const byId = new Map(state.preview.snapshots.map((s) => [s.id, s]));
    const chain = [];
    const seen = new Set();
    let cur = snapshotId;
    while (cur && byId.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const snap = byId.get(cur);
      chain.push(snap);
      cur = snap.prevId;
    }
    return chain.reverse();
  };

  const buildSnapshotStateMap = (snapshotId) => {
    ensurePreviewBase();
    // 使用内存缓存作为隐式 base，不在 preview.json 中存储任务镜像
    const baseTasks = state._baseTasksCache || state.tasks.map(sanitizeTaskForSnapshot);
    // Deep copy base to avoid mutations
    const map = new Map(baseTasks.map((t) => [String(t.id), JSON.parse(JSON.stringify(t))]));
    const chain = getSnapshotChain(snapshotId);
    chain.forEach((snap) => {
      (snap.changes || []).forEach((partial) => {
        const id = String(partial.id);
        const existing = map.get(id);
        if (existing) {
          // Merge partial changes
          Object.assign(existing, partial);
        } else {
          // New task - partial should contain enough data
          map.set(id, JSON.parse(JSON.stringify(partial)));
        }
      });
      (snap.removedIds || []).forEach((id) => map.delete(String(id)));
    });
    return map;
  };

  const applyHistorySnapshot = (snapshotId) => {
    const map = buildSnapshotStateMap(snapshotId);
    state.tasks = Array.from(map.values()).map((t) => normalizeTask(t));
    state.selection.clear();
    state.drag = null;
    state.undoStack = [];
    state.redoStack = [];
    updateUndoRedoButtons();
    renderAll();
  };

  const diffTasks = (prevMap, nextTasks) => {
    const changes = [];
    const nextMap = new Map();
    nextTasks.forEach((t) => {
      const snap = sanitizeTaskForSnapshot(t);
      const id = String(t.id);
      nextMap.set(id, snap);
      const prev = prevMap.get(id);
      
      if (!prev) {
        // It is a new task, record it fully
        changes.push(snap);
      } else {
        // Record only changed fields
        const partial = { id: snap.id };
        let changed = false;
        
        // Compare specific fields
        for (const key in snap) {
          const valNew = snap[key];
          const valOld = prev[key];
          
          // Use JSON.stringify for deep comparison of objects/arrays if any
          if (JSON.stringify(valNew) !== JSON.stringify(valOld)) {
            partial[key] = valNew;
            changed = true;
          }
        }
        
        if (changed) {
          changes.push(partial);
        }
      }
    });

    const removedIds = [];
    prevMap.forEach((_val, id) => {
      if (!nextMap.has(id)) removedIds.push(String(id));
    });
    return { changes, removedIds };
  };

  const addSnapshot = (changedIds) => {
    if (!state.editMode) return;
    ensurePreviewBase();
    const now = new Date();
    const id = `snap_${now.getTime()}`;
    const prevId = state.preview.currentId;
    const prevMap = buildSnapshotStateMap(prevId);
    const { changes, removedIds } = diffTasks(prevMap, state.tasks);
    if (changes.length === 0 && removedIds.length === 0) return;
    const changedSet = new Set([...(changedIds || []).map(String)]);
    changes.forEach((t) => changedSet.add(String(t.id)));
    removedIds.forEach((rid) => changedSet.add(String(rid)));

    // Record the names of changed tasks for UI display
    const changedTaskNames = [];
    changedSet.forEach(id => {
      const t = state.tasks.find(task => String(task.id) === id);
      if (t && t.name) changedTaskNames.push(t.name);
      else if (prevMap.has(id)) changedTaskNames.push(prevMap.get(id).name);
    });

    const snapshot = {
      id,
      time: now.toISOString(),
      prevId,
      changes,
      removedIds,
      changedIds: Array.from(changedSet),
      changedTaskNames,
    };
    state.preview.snapshots.push(snapshot);
    if (state.preview.snapshots.length > 20) state.preview.snapshots.shift();
    state.preview.currentId = id;
    savePreview();
    renderHistory();
  };

  const commitEditsToIndex = async () => {
    await saveData();
    renderHistory();
  };

  const renderHistory = () => {
    if (!els.historyList) return;
    els.historyList.innerHTML = "";

    if (state.preview.base) {
      const baseCard = document.createElement("div");
      baseCard.className = "history-card";
      if (!state.preview.currentId) baseCard.classList.add("active");
      const baseTime = new Date(state.preview.base.time || Date.now());
      baseCard.innerHTML = `
        <div class="card-main">初始版本</div>
        <div class="card-sub">${baseTime.toLocaleString("zh-CN")}</div>
        <div class="card-items">无快照时的版本</div>
      `;
      baseCard.addEventListener("click", () => {
        state.preview.currentId = null;
        savePreview();
        applyHistorySnapshot(null);
        renderHistory();
      });
      els.historyList.appendChild(baseCard);
    }

    const snapshots = [...state.preview.snapshots].reverse();
    snapshots.forEach((snap) => {
      const card = document.createElement("div");
      card.className = "history-card";
      if (snap.id === state.preview.currentId) card.classList.add("active");
      const time = new Date(snap.time);
      const prev = snap.prevId
        ? new Date(
            state.preview.snapshots.find((s) => s.id === snap.prevId)?.time ||
              snap.time
          )
        : null;
      
      const names = snap.changedTaskNames || (snap.changes || []).map(t => t.name).filter(Boolean);

      card.innerHTML = `
        <div class="card-main">${time.toLocaleString("zh-CN")}</div>
        <div class="card-sub">${
          prev ? `上一个版本：${prev.toLocaleString("zh-CN")}` : ""
        }</div>
        <div class="card-items">变更项目：<br>${
          names.slice(0, 3).join("、") || "-"
        }${names.length > 3 ? " 等" : ""}</div>
      `;
      card.addEventListener("click", () => {
        state.preview.currentId = snap.id;
        savePreview();
        applyHistorySnapshot(snap.id);
        renderHistory();
      });
      els.historyList.appendChild(card);
    });
  };

  const showToast = (msg, duration = 3000) => {
    let toast = document.getElementById('bar-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'bar-toast';
      toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);' +
        'background:#333;color:#fff;padding:8px 20px;border-radius:8px;z-index:9999;' +
        'font-size:14px;transition:opacity .3s;pointer-events:none;opacity:0;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, duration);
  };

  const isHistoryOpen = () =>
    !!(els.historyPanel && els.historyPanel.classList.contains("open"));

  const closeHistoryPanel = async () => {
    if (!els.historyPanel) return;
    // 关闭时检查是否切换了快照，若有则自动保存
    const snapshotChanged = state._historySnapshotOnOpen !== undefined &&
      state._historySnapshotOnOpen !== state.preview.currentId;
    state._historySnapshotOnOpen = undefined;
    els.historyPanel.classList.remove("open");
    els.historyPanel.setAttribute("aria-hidden", "true");
    if (snapshotChanged) {
      await commitEditsToIndex();
      showToast('版本更新成功');
    }
  };

  const isRecycleOpen = () =>
    !!(els.recyclePanel && els.recyclePanel.classList.contains("open"));

  const closeRecyclePanel = () => {
    if (!els.recyclePanel) return;
    els.recyclePanel.classList.remove("open");
    els.recyclePanel.setAttribute("aria-hidden", "true");
  };

  const restoreImageFromRecycle = async (imagePath) => {
    if (!imagePath || typeof imagePath !== "string") return imagePath;
    if (!imagePath.startsWith("recyclepic/")) return imagePath;
    try {
      const res = await fetch("/restore-image-from-recycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: imagePath }),
      });
      if (!res.ok) return imagePath;
      const data = await res.json();
      return data.newPath || imagePath;
    } catch (e) {
      console.warn("restoreImageFromRecycle error", e);
      return imagePath;
    }
  };

  const renderRecycleBinPanel = () => {
    if (!els.recycleList) return;
    els.recycleList.classList.add("portrait-layout");
    const recycleBin = Array.isArray(state.data?.recycleBin)
      ? state.data.recycleBin
      : [];
    if (!recycleBin.length) {
      els.recycleList.innerHTML = '<div class="recycle-empty">回收站为空</div>';
      return;
    }

    const cardsHtml = recycleBin
      .slice()
      .sort((a, b) => {
        const ta = new Date(a?.deletedAt || 0).getTime();
        const tb = new Date(b?.deletedAt || 0).getTime();
        if (tb !== ta) return tb - ta;
        return Number(b?.id || 0) - Number(a?.id || 0);
      })
      .map((task) => {
        if (window.taskCardShared?.createTaskCardHtml) {
          try {
            return window.taskCardShared.createTaskCardHtml(task, {
              taskTypes: state.data?.taskTypes || [],
              sourcePlatforms: state.data?.sourcePlatforms || [],
              presetNodes: state.data?.presetNodes || [],
              computeLightBgFromHex,
              blendWithWhite,
              cardBodyWhiteBlend: state.data?.cardBodyWhiteBlend,
              dateOnlyDeadlineMode: !!state.data?.dateOnlyDeadlineMode,
              showingRecycleBin: true,
              getTimerButton: () => "",
            });
          } catch (e) {
            console.warn("render recycle card failed", e);
          }
        }
        return `
          <div class="history-card" data-task-id="${task.id}">
            <div class="card-main">${task.name || "未命名任务"}</div>
            <div class="card-sub">${task.type || "未知类型"} · ${task.source || "未知来源"}</div>
            <div class="card-items">已删除：${task.deletedAt ? new Date(task.deletedAt).toLocaleString("zh-CN") : "-"}</div>
            <div class="mt-2 flex gap-2">
              <button class="restore-btn px-2 py-1 border rounded" data-task-id="${task.id}">还原</button>
              <button class="delete-btn px-2 py-1 border rounded" data-task-id="${task.id}">彻底删除</button>
            </div>
          </div>
        `;
      })
      .join("");

    els.recycleList.innerHTML = cardsHtml;
    els.recycleList.querySelectorAll(".task-card").forEach((card) => {
      card.classList.add("is-laid-out");
    });
  };

  const removeFromRecycleBinPermanently = async (taskId) => {
    if (!state.data) return;
    const before = Array.isArray(state.data.recycleBin)
      ? JSON.parse(JSON.stringify(state.data.recycleBin))
      : [];
    state.data.recycleBin = (state.data.recycleBin || []).filter(
      (task) => String(task.id) !== String(taskId)
    );
    try {
      await saveData();
      renderRecycleBinPanel();
      modalController?.dataSource?.showMessage?.("已从回收站永久删除");
    } catch (e) {
      console.warn("removeFromRecycleBinPermanently failed", e);
      state.data.recycleBin = before;
      renderRecycleBinPanel();
      modalController?.dataSource?.showMessage?.("删除失败");
    }
  };

  const restoreTaskFromRecycleBin = async (taskId) => {
    if (!state.data) return;
    const recycleBin = Array.isArray(state.data.recycleBin) ? state.data.recycleBin : [];
    const target = recycleBin.find((task) => String(task.id) === String(taskId));
    if (!target) return;

    const beforeTasks = captureCurrentSnapshot();
    const beforeRecycle = JSON.parse(JSON.stringify(recycleBin));

    const restored = { ...target };
    delete restored.deletedAt;
    if (restored.image && typeof restored.image === "string" && restored.image.startsWith("recyclepic/")) {
      restored.image = await restoreImageFromRecycle(restored.image);
    }

    state.tasks.push(normalizeTask(restored));
    state.data.recycleBin = recycleBin.filter((task) => String(task.id) !== String(taskId));

    try {
      await saveData();
      renderAll();
      renderRecycleBinPanel();
      modalController?.dataSource?.showMessage?.("任务已恢复");
    } catch (e) {
      console.warn("restoreTaskFromRecycleBin failed", e);
      state.tasks = beforeTasks.map((t) => normalizeTask(t));
      state.data.recycleBin = beforeRecycle;
      renderAll();
      renderRecycleBinPanel();
      modalController?.dataSource?.showMessage?.("恢复失败");
    }
  };

  const savePreview = async () => {
    const payload = JSON.stringify(state.preview);
    try {
      const res = await fetch("/save-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      if (!res.ok) {
        if (res.status === 405) {
          const url = `/save-preview?data=${encodeURIComponent(payload)}`;
          const fallback = await fetch(url, { method: "GET" });
          if (fallback.ok) return;
        }
        throw new Error(`save-preview failed: ${res.status}`);
      }
    } catch (e) {
      localStorage.setItem("barview-preview", payload);
    }
  };

  const loadPreview = async () => {
    try {
      const res = await fetch("/load-preview");
      if (res.ok) {
        state.preview = await res.json();
        return;
      }
    } catch (e) {
      // ignore
    }
    try {
      const saved = JSON.parse(localStorage.getItem("barview-preview") || "{}");
      if (saved.snapshots) state.preview = saved;
    } catch (e) {
      // ignore
    }
  };

  const moveImageToRecycle = async (imagePath) => {
    if (!imagePath || typeof imagePath !== "string") return imagePath;
    if (!imagePath.startsWith("pic/")) return imagePath;
    try {
      const res = await fetch("/move-image-to-recycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: imagePath }),
      });
      if (!res.ok) return imagePath;
      const data = await res.json();
      return data.newPath || imagePath;
    } catch (e) {
      console.warn("moveImageToRecycle error", e);
      return imagePath;
    }
  };

  const saveData = async () => {
    if (!state.data) return;
    const updatedTasks = state.tasks.map((t) => {
      const startRaw = t.startTime || t.starttime || "";
      const endRaw = t.deadline || "";
      // 保留原始字符串（可能含时间部分），仅在为空时用 __startDate/__endDate 兜底
      const start = startRaw || (t.__startDate ? formatDate(t.__startDate) : "");
      const end = endRaw || (t.__endDate ? formatDate(t.__endDate) : "");
      // 解构已知字段以确保输出字段顺序统一
      const {
        name, createdAt, completed, actualStartTime, completedAt,
        estimatedHours, completedHours, actualHours, bufferDays,
        dependencyType, estimatedDay, autoCalcEnd, autoSchedule,
        id, lineTaskId, source, type, image, nodes, payment, progress,
        w, h,
        abandoned, abandonedAt, paymentMode, paymentRecords, urgentA,
        __duration, __endDate, __startDate,
        // eslint-disable-next-line no-unused-vars
        startTime: _st, starttime: _stt, deadline: _dl,
        ...rest
      } = t;
      const taskOut = {
        name,
        ...(createdAt !== undefined ? { createdAt } : {}),
        completed,
        startTime: start,
        starttime: start,
        actualStartTime: actualStartTime ?? null,
        deadline: end,
        completedAt: completedAt ?? null,
        estimatedHours,
        completedHours,
        actualHours,
        bufferDays,
        dependencyType,
        estimatedDay: estimatedDay ?? 0,
        autoCalcEnd,
        autoSchedule,
        id,
        lineTaskId,
        source,
        type,
        image,
        nodes,
        payment,
        progress,
        w,
        h,
        ...rest,
      };
      // 额外字段按固定顺序追加，确保与 MainView 保存结果一致
      if (abandoned !== undefined) taskOut.abandoned = abandoned;
      if (abandonedAt !== undefined) taskOut.abandonedAt = abandonedAt;
      if (paymentMode !== undefined) taskOut.paymentMode = paymentMode;
      if (paymentRecords !== undefined) taskOut.paymentRecords = paymentRecords;
      if (urgentA !== undefined) taskOut.urgentA = urgentA;
      // __duration/__endDate/__startDate 由 normalizeTask 运行时计算，不持久化
      return taskOut;
    });
    const payload = { ...state.data, tasks: updatedTasks, statistics: getStatistics() };
    const res = await fetch("/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`save failed: ${res.status}`);
    }
  };

  const applyZoomAt = (nextIndex, clientX) => {
    const oldIndex = state.zoomIndex;
    if (nextIndex === oldIndex) return;
    const rect = els.ganttScroll.getBoundingClientRect();
    const localX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const oldDayWidth = state.zoomSteps[oldIndex].dayWidth;
    const newDayWidth = state.zoomSteps[nextIndex].dayWidth;
    const focusDay = (els.ganttScroll.scrollLeft + localX) / oldDayWidth;
    state.zoomIndex = nextIndex;
    localStorage.setItem('barview-zoom-index', nextIndex);
    renderAll();
    const targetLeft = focusDay * newDayWidth - localX;
    const maxLeft = Math.max(0, els.ganttContent.scrollWidth - rect.width);
    els.ganttScroll.scrollLeft = clamp(targetLeft, 0, maxLeft);
  };

  // ---- Modal & Editing Logic ----
  // 逻辑已迁移至 scripts/task-modal-logic.js
  let modalController = null;
  
  const initModalController = () => {
     if (modalController) return;
     modalController = new TaskModalController({
         dataSource: {
             getTask: (id) => state.tasks.find(t => t.id === id),
             getTasks: () => state.tasks,
             get taskTypes() { return state.data?.taskTypes || []; },
             get sourcePlatforms() { return state.data?.sourcePlatforms || []; },
             get presetNodes() { return state.data?.presetNodes || []; },
             get statistics() { return state.data?.statistics || null; },
             allowDuplicateNodes: false,
             showQuickAddInputs: true,
             showMessage: (msg) => showToast(msg)
         },
         onSave: async (taskData, editingId) => {
           pushUndo();

           // ── Quick-add 类型创建（处理 __quick-add-type__ 占位值）──
           let resolvedType = taskData.type;
           try {
             const qtName = document.getElementById('quick-add-type-name')?.value?.trim();
             if (qtName) {
               const color = (document.getElementById('quick-add-type-color')?.value || '#3b82f6').trim();
               const baseId = qtName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
               const types = state.data?.taskTypes || [];
               const existingIds = new Set(types.map(t => t.id));
               let idCandidate = baseId || `type-${Date.now()}`;
               let counter = 1;
               while (existingIds.has(idCandidate)) idCandidate = `${baseId || 'type'}-${counter++}`;
               types.push({ id: idCandidate, name: qtName, color });
               if (!state.data) state.data = {};
               state.data.taskTypes = types;
               resolvedType = idCandidate;
             } else if (resolvedType === '__quick-add-type__') {
               resolvedType = (state.data?.taskTypes?.[0]?.id) || null;
             }
             const qtNameEl = document.getElementById('quick-add-type-name');
             if (qtNameEl) qtNameEl.value = '';
           } catch (e) { console.warn('quick-add type failed', e); }

           // ── Quick-add 来源创建（处理 __quick-add-source__ 占位值）──
           let resolvedSource = taskData.source;
           try {
             const qsName = document.getElementById('quick-add-source-name')?.value?.trim();
             if (qsName) {
               const color = (document.getElementById('quick-add-source-color')?.value || '#3b82f6').trim();
               const baseId = qsName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
               const platforms = state.data?.sourcePlatforms || [];
               const existingIds = new Set(platforms.map(t => t.id));
               let idCandidate = baseId || `source-${Date.now()}`;
               let counter = 1;
               while (existingIds.has(idCandidate)) idCandidate = `${baseId || 'source'}-${counter++}`;
               platforms.push({ id: idCandidate, name: qsName, color });
               if (!state.data) state.data = {};
               state.data.sourcePlatforms = platforms;
               resolvedSource = idCandidate;
             } else if (resolvedSource === '__quick-add-source__') {
               resolvedSource = (state.data?.sourcePlatforms?.[0]?.id) || null;
             }
             const qsNameEl = document.getElementById('quick-add-source-name');
             if (qsNameEl) qsNameEl.value = '';
           } catch (e) { console.warn('quick-add source failed', e); }

           const norm = normalizeTask({ ...taskData, type: resolvedType, source: resolvedSource });
           const oldTask = editingId ? state.tasks.find(t => t.id === editingId) : null;
           if (editingId) {
             const idx = state.tasks.findIndex(t => t.id === editingId);
             if (idx >= 0) state.tasks[idx] = norm;
           } else {
             state.tasks.push(norm);
           }

           // Reflow chain successors to pick up changes like bufferDays, deadline, completion
           try {
             if (oldTask && oldTask.lineTaskId && oldTask.lineTaskId !== norm.lineTaskId) {
               reflowChainFrom(oldTask.lineTaskId);
             }
             reflowChainFrom(norm.id);
             if (norm.lineTaskId) reflowChainFrom(norm.lineTaskId);
           } catch (e) {
             console.warn('reflowChainFrom failed', e);
           }

           // 关键：先持久化到 index.json，失败时抛出让 modal 保持打开并提示失败
           try {
             await saveData();
           } catch (err) {
             console.warn('saveData failed in modal onSave', err);
             modalController?.dataSource?.showMessage?.("保存到 index.json 失败");
             throw err;
           }

           // 写盘成功后再更新 UI / 快照基线
           addSnapshot([String(norm.id)]);
           renderAll();
           resetPreviewBaseFromIndex();
           renderHistory();
           modalController?.dataSource?.showMessage?.("已保存到 index.json");
         },
         helpers: {
             formatDate: (d) => {
                 const dt = new Date(d);
                 if (isNaN(dt)) return "";
                 return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
             } 
         }
     });
     modalController.initEvents();
  };

  const showModal = (taskId) => {
      if (!modalController) initModalController();
      modalController.showModal(taskId);
  };

  // 显示设置弹窗
  const showSettingsModal = () => {
    // 同步当前设置到弹窗
    const wheelScroll = document.getElementById("opt-wheel-scroll");
    const openNewTab = document.getElementById("opt-open-new-tab");
    const themeWarm = document.getElementById("theme-warm");
    const themeStandard = document.getElementById("theme-standard");
    const themeLite = document.getElementById("theme-lite");

    if (wheelScroll) wheelScroll.checked = state.options.wheelScroll || false;
    if (openNewTab) openNewTab.checked = state.options.openNewTab || false;

    if (themeWarm && themeStandard) {
      if (state.options.theme === "warm") {
        themeWarm.checked = true;
      } else if (state.options.theme === "lite" && themeLite) {
        themeLite.checked = true;
      } else {
        themeStandard.checked = true;
      }
    }

    // 显示弹窗
    if (els.settingsModal) {
      els.settingsModal.classList.remove("hidden");
    }
  };

  // 隐藏设置弹窗
  const hideSettingsModal = () => {
    if (els.settingsModal) {
      els.settingsModal.classList.add("hidden");
    }
  };



  // Preview Logic
  const getTaskCardThemeHref = (theme) =>
    theme === "warm" ? "../MainView/暖色.css" : "../MainView/标准.css";
  let previewHost = null;

  // Custom styles for Shadow DOM elements that need overrides or aren't covered by base-style.css
  const buildShadowUtilityStyles = () => `
    /* progress bar specific overrides */
    .progress-bar { height: 12px; border-radius: 9999px; transition: width 0.3s ease; }
    .task-card .flex-1.bg-stone-200 { background: var(--color-stone-200, #e5e7eb); border-radius: 9999px; height: 12px; }

    /* node item customizations - ensure font sizes match main app */
    .node-item { border-left: 3px solid #e2e8f0; padding: 4px 0 4px 12px; border-radius: 8px; transition: all 0.3s ease; }
    .node-item.active { border-left-color: #667eea; background: rgba(102, 126, 234, 0.05); }
    .node-item.completed { border-left-color: #10b981; }
    .node-item.completed span { color: #999; text-decoration: line-through; }
    .node-item label { display: flex; align-items: center; gap: 4px; }
    .node-item .material-icons, .node-item .material-symbols-outlined, .node-item .material-symbols-rounded, .node-item .material-symbols-sharp { font-size: 14px; }
    .node-item .text-sm { font-size: 14px; line-height: 1.25rem; } /* ensure text-sm applies */

    /* badges - let theme CSS control colors, just ensure layout */
    .deadline-badge, .daily-time-badge { border-radius: 9999px; padding: 4px 10px; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }

    /* timer button - let theme CSS control if needed, but provide base */
    .timer-btn { background: #ffa23f; color: #ffffff; padding: 0.5rem 1rem; border-radius: 9999px; transition: background 0.2s ease, filter 0.2s ease; }
    .timer-btn.running { background: #ef4444; }
    .timer-btn.not-started { background: #a3e635; color: #ffffff; }
    .timer-btn:hover { filter: brightness(0.95); }

    /* hours controls */
    .decrement-hours-btn, .increment-hours-btn { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; border: 1px solid #e5e7eb; }

    /* edit button - ensure theme colors apply */
    .edit-btn { color: var(--color-blue-500, #3b82f6); }
    .edit-btn:hover { color: var(--color-blue-700, #1d4ed8); }
  `;
  const ensureTaskCardSharedLoaded = (taskId) => {
    if (window.taskCardShared?.createTaskCardHtml) return true;
    if (document.getElementById("task-card-shared-script")) return false;
    const script = document.createElement("script");
    script.id = "task-card-shared-script";
    script.src = "../scripts/task-card-shared.js";
    script.async = true;
    script.onload = () => {
      if (typeof taskId === "number") {
        showTaskPreview(taskId);
      }
    };
    script.onerror = () => {
      console.warn("task-card-shared.js load failed");
    };
    document.head.appendChild(script);
    return false;
  };

  const closeTaskPreview = () => {
    if (previewHost) {
      previewHost.remove();
      previewHost = null;
    }
    state.taskPreviewId = null;
  };

  const updateTaskPreviewTheme = (theme) => {
    if (!previewHost) return;
    const themeLink = previewHost.querySelector(
      'link[data-role="task-card-theme"]'
    );
    if (themeLink) {
      const newHref = getTaskCardThemeHref(theme);
      if (themeLink.getAttribute("href") !== newHref) {
        themeLink.setAttribute("href", newHref);
      }
    }
  };

  const createTaskCardFallback = (task) => {
    const type = state.data?.taskTypes?.find((t) => t.id === task.type) || {};
    const source = state.data?.sourcePlatforms?.find((s) => s.id === task.source) || {};
    const lightBg = computeLightBgFromHex(type.color || "#ccc");
    const headerBg = lightBg;
    const bodyBg = blendWithWhite(lightBg, 0.7);

    const nodesHtml = (task.nodes || [])
      .map(
        (n) => `
        <div class="flex items-center gap-1 text-sm text-stone-700">
            <span class="material-icons text-sm text-stone-500">${
              n.completed ? "check_box" : "check_box_outline_blank"
            }</span>
            <span class="${
              n.completed ? "line-through text-stone-400" : ""
            }">${n.name}</span>
        </div>
      `
      )
      .join("");

    const imgHtml = task.image
      ? `<img src="${task.image}" class="w-full h-32 object-cover rounded mb-2">`
      : "";

    return `
        <div class="task-card rounded-xl overflow-hidden shadow-lg bg-white w-full pointer-events-auto">
            <div class="p-4" style="background: ${headerBg}">
                <div class="flex justify-between items-start">
                    <h3 class="font-bold text-lg text-slate-800 ${
                      task.completed ? "line-through" : ""
                    }">${task.name}</h3>
                    <div class="flex gap-1">
                        <button class="p-1 hover:bg-white/50 rounded edit-btn" data-id="${
                          task.id
                        }"><span class="material-icons text-sm">edit</span></button>
                        <button class="p-1 hover:bg-white/50 rounded delete-btn" data-id="${
                          task.id
                        }"><span class="material-icons text-sm">delete</span></button>
                    </div>
                </div>
                <div class="text-xs text-slate-600 mt-1">${
                  type.name || task.type
                } · ${source.name || task.source}</div>
            </div>
            <div class="p-4" style="background: ${bodyBg}">
                ${imgHtml}
                <div class="flex gap-2 text-xs mb-2">
                    <span class="bg-white/50 px-2 py-1 rounded">预计 ${
                      task.estimatedHours
                    }h</span>
                    ${
                      task.deadline
                        ? `<span class="bg-white/50 px-2 py-1 rounded">截止 ${formatDate(
                            new Date(task.deadline)
                          )}</span>`
                        : ""
                    }
                </div>
                <div class="space-y-1">
                    ${nodesHtml}
                </div>
                ${
                  task.completed
                    ? '<div class="mt-2 text-green-600 font-bold text-sm">已完成</div>'
                    : ""
                }
            </div>
        </div>
      `;
  };

  // ─── Timer state ─────────────────────────────────────────────
  let timerTaskId = null;
  let timerStartTime = null;
  let currentTimer = null;

  const isTimerRunning = (taskId) =>
    timerTaskId === taskId && currentTimer !== null;

  const getTimerIcon = (running) => (running ? "stop" : "timer");

  const getTimerLabel = (running, hasActualStart = false) => {
    if (running) return "结束画画计时";
    return hasActualStart ? "开始画画计时" : "开始首次画画计时";
  };

  const getTimerButton = (task) => {
    if (!task || task.completed) return "";
    const running = isTimerRunning(task.id);
    const notStarted = !running && !task.actualStartTime;
    const stateClass = running ? "running" : notStarted ? "not-started" : "";
    return `<div class="mt-3 flex justify-center"><button class="timer-btn ${stateClass} text-white rounded-full px-4 py-2 flex items-center justify-center transition-colors flex-shrink-0" data-task-id="${task.id}" data-testid="timer-btn-${task.id}"><span class="material-icons text-sm mr-2">${getTimerIcon(running)}</span><span class="text-sm font-medium">${getTimerLabel(running, !!task.actualStartTime)}</span></button></div>`;
  };

  const showTimerDurationDialog = (task, durationInHours, onClose) => {
    const hours = Math.floor(durationInHours);
    const minutes = Math.round((durationInHours - hours) * 60);
    const defaultVal = parseFloat((hours + minutes / 60).toFixed(2));
    const userInput = prompt(
      `任务「${task.name}」计时结束。\n本次时长: ${hours}小时${minutes}分钟 (${defaultVal}h)\n请确认或修改实际工时（小时）:`,
      String(defaultVal)
    );
    if (userInput === null) {
      if (onClose) onClose();
      return;
    }
    const parsed = parseFloat(userInput);
    if (!isNaN(parsed) && parsed >= 0) {
      task.actualHours = Math.round(((task.actualHours || 0) + parsed) * 100) / 100;
      if (task.completed) {
        task.completedHours = task.actualHours;
        recordCompletionStatistics(task);
      }
      saveData().then(() => {
        renderAll();
        // 重新打开预览以刷新界面
        if (state.taskPreviewId === task.id) {
          showTaskPreview(task.id);
        }
      });
    }
    if (onClose) onClose();
  };

  const startTimer = (taskId) => {
    if (currentTimer) {
      alert("已有任务正在计时，请先结束当前任务计时");
      return;
    }
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (!task.actualStartTime) {
      task.actualStartTime = new Date().toISOString();
      saveData();
      // 检查是否触发加急冲突
      if (!task.urgentA && task.dependencyType === 'line' && task.startTime &&
          new Date(task.actualStartTime) < new Date(task.startTime)) {
        handleAccelerateConflict(task);
      }
    }
    timerTaskId = taskId;
    timerStartTime = Date.now();
    currentTimer = setInterval(() => {}, 1000);
    // 刷新预览中的按钮
    if (state.taskPreviewId === taskId) {
      showTaskPreview(taskId);
    }
  };

  const stopTimer = (taskId) => {
    if (timerTaskId !== taskId || !currentTimer) return;
    const endTime = Date.now();
    const duration = Math.round((endTime - timerStartTime) / 1000);
    const durationInHours = duration / 3600;
    clearInterval(currentTimer);
    currentTimer = null;
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    showTimerDurationDialog(task, durationInHours, () => {
      timerTaskId = null;
      timerStartTime = null;
    });
  };

  const toggleTimer = (taskId) => {
    if (isTimerRunning(taskId)) {
      stopTimer(taskId);
    } else {
      startTimer(taskId);
    }
  };

  // ─── Preset node styles for Shadow DOM ──────────────────────
  const buildPresetNodeStylesCSS = () => {
    const presets = state.data?.presetNodes || [];
    if (!presets.length) return "";
    return presets
      .map((node) => {
        const name = (node.name || "").replace(/"/g, '\\"');
        const bg = node.background || "transparent";
        const tc = (node.text || "text-stone-700").replace(/^text-/, "");
        const color = `var(--color-${tc}, inherit)`;
        return `.preset-node-btn[data-node="${name}"], .node-item[data-node="${name}"]{background:${bg};color:${color}}`;
      })
      .join("\n");
  };

  const createTaskCard = (task) => {
    const shared = window.taskCardShared?.createTaskCardHtml;
    if (typeof shared === "function") {
      try {
        return shared(task, {
          taskTypes: state.data?.taskTypes || [],
          sourcePlatforms: state.data?.sourcePlatforms || [],
          presetNodes: state.data?.presetNodes || [],
          computeLightBgFromHex,
          blendWithWhite,
          cardBodyWhiteBlend: state.data?.cardBodyWhiteBlend,
          dateOnlyDeadlineMode: !!state.data?.dateOnlyDeadlineMode,
          showingRecycleBin: false,
          getTimerButton,
        });
      } catch (err) {
        console.warn("task-card-shared render failed", err);
      }
    }
    return createTaskCardFallback(task);
  };

  const showTaskPreview = (taskId) => {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    ensureTaskCardSharedLoaded(taskId);

    closeTaskPreview();

    const host = document.createElement("div");
    host.className = "task-preview-host";
    // Remove Shadow DOM to allow theme CSS variables to work properly
    const container = document.createElement("div");
    container.className = "task-preview-container";

    const baseLink = document.createElement("link");
    baseLink.rel = "stylesheet";
    baseLink.href = "../MainView/base-style.css";

    const themeLink = document.createElement("link");
    themeLink.rel = "stylesheet";
    themeLink.href = getTaskCardThemeHref(state.options.theme);
    themeLink.dataset.role = "task-card-theme";

    // Inject preset node styles into the container
    const presetStyle = document.createElement("style");
    presetStyle.textContent = buildPresetNodeStylesCSS();

    const utilityStyle = document.createElement("style");
    utilityStyle.textContent = buildShadowUtilityStyles();

    const overlay = document.createElement("div");
    overlay.id = "task-preview-overlay";
    overlay.className = "task-preview-overlay";

    const wrapper = document.createElement("div");
    wrapper.className = "task-preview-wrapper";
    wrapper.innerHTML = createTaskCard(task);

    // 如果是已完成任务，和主页面保持一致：强制在预览中显示（覆盖 .task-card.completed 的隐藏样式）
    const previewCard = wrapper.querySelector(".task-card");
    if (previewCard && previewCard.classList.contains("completed")) {
      previewCard.classList.add("preview-visible");
    }

    overlay.appendChild(wrapper);
    container.appendChild(baseLink);
    container.appendChild(themeLink);
    container.appendChild(presetStyle);
    container.appendChild(utilityStyle);
    container.appendChild(overlay);
    host.appendChild(container);

    document.body.appendChild(host);
    previewHost = host;
    state.taskPreviewId = taskId;

    wrapper.addEventListener("click", async (ev) => {
      const target = ev.target;

      // Edit button
      const editBtn = target.closest(".edit-btn");
      if (editBtn) {
        closeTaskPreview();
        showModal(taskId);
        return;
      }

      // Delete button
      const deleteBtn = target.closest(".delete-btn");
      if (deleteBtn) {
        if (confirm("确定删除任务?")) {
          const beforeSnapshot = captureCurrentSnapshot();
          const beforeRecycle = Array.isArray(state.data?.recycleBin)
            ? JSON.parse(JSON.stringify(state.data.recycleBin))
            : [];

          pushUndo();

          const removed = state.tasks.filter((t) => t.id === taskId);
          state.tasks = state.tasks.filter((t) => t.id !== taskId);

          state.data = state.data || {};
          state.data.recycleBin = Array.isArray(state.data.recycleBin)
            ? state.data.recycleBin
            : [];

          const moved = [];
          for (const t of removed) {
            const movedImage = await moveImageToRecycle(t.image);
            moved.push({
              ...sanitizeTaskForSnapshot(t),
              image: movedImage,
              deletedAt: new Date().toISOString(),
            });
          }
          state.data.recycleBin = state.data.recycleBin.concat(moved);

          try {
            await saveData();
            addSnapshot([String(taskId)]);
            renderAll();
            renderRecycleBinPanel();
            closeTaskPreview();
            modalController?.dataSource?.showMessage?.("任务已移动到回收站");
          } catch (e) {
            console.warn("delete task save failed", e);
            state.tasks = beforeSnapshot.map((t) => normalizeTask(t));
            state.data.recycleBin = beforeRecycle;
            renderAll();
            modalController?.dataSource?.showMessage?.("删除失败，未写入回收站");
          }
        }
        return;
      }

      // Timer button
      const timerBtn = target.closest(".timer-btn");
      if (timerBtn) {
        const tid = parseInt(timerBtn.dataset.taskId, 10);
        if (tid) toggleTimer(tid);
        return;
      }

      // Complete toggle
      const completeArea = target.closest(".task-complete-area");
      if (completeArea) {
        const tid = parseInt(completeArea.dataset.taskId, 10);
        const t = state.tasks.find((x) => x.id === tid);
        if (t) {
          pushUndo();
          const wasCompleted = !!t.completed;
          t.completed = !t.completed;
          if (t.completed) {
            t.completedAt = new Date().toISOString();
            t.completedHours = t.actualHours || t.completedHours || 0;
            // 标记所有节点为已完成
            if (t.nodes) t.nodes.forEach((n) => (n.completed = true));
            recordCompletionStatistics(t);
          } else {
            t.completedAt = null;
            removeStatisticsSample(t.type, t.id);
          }
          // 完成状态变化后重算链式后继 + 刷新同类型 autoCalcEnd 任务截止日期
          try { reflowChainFrom(t.id); } catch (e) { console.warn('reflowChainFrom after complete toggle failed', e); }
          try { refreshAutoCalcEndTasks(t.type); } catch (e) { console.warn('refreshAutoCalcEndTasks after complete toggle failed', e); }
          saveData().then(() => {
            addSnapshot([String(tid)]);
            renderAll();
            showTaskPreview(tid);
          });
        }
        return;
      }

      // Increment hours
      const incBtn = target.closest(".increment-hours-btn");
      if (incBtn) {
        const tid = parseInt(incBtn.dataset.taskId, 10);
        const t = state.tasks.find((x) => x.id === tid);
        if (t) {
          pushUndo();
          t.actualHours = Math.round(((t.actualHours || 0) + 1) * 100) / 100;
          if (t.completed) {
            t.completedHours = t.actualHours;
            recordCompletionStatistics(t);
          }
          saveData().then(() => {
            renderAll();
            showTaskPreview(tid);
          });
        }
        return;
      }

      // Decrement hours
      const decBtn = target.closest(".decrement-hours-btn");
      if (decBtn) {
        const tid = parseInt(decBtn.dataset.taskId, 10);
        const t = state.tasks.find((x) => x.id === tid);
        if (t) {
          pushUndo();
          t.actualHours = Math.max(0, Math.round(((t.actualHours || 0) - 1) * 100) / 100);
          if (t.completed) {
            t.completedHours = t.actualHours;
            recordCompletionStatistics(t);
          }
          saveData().then(() => {
            renderAll();
            showTaskPreview(tid);
          });
        }
        return;
      }

      // Image preview
      const img = target.closest(".task-image");
      if (img) {
        const src = img.dataset.imageSrc || img.src;
        if (src) window.open(src, "_blank");
        return;
      }
    });

    // Node checkbox change handler
    wrapper.addEventListener("change", (ev) => {
      const checkbox = ev.target;
      if (!checkbox.classList.contains("node-checkbox")) return;
      const tid = parseInt(checkbox.dataset.taskId, 10);
      const nid = checkbox.dataset.nodeId;
      const t = state.tasks.find((x) => x.id === tid);
      if (!t || !t.nodes) return;
      const node = t.nodes.find((n) => String(n.id) === String(nid));
      if (node) {
        pushUndo();
        node.completed = checkbox.checked;
        // 自动计算进度
        const total = t.nodes.length;
        const completedCount = t.nodes.filter((n) => n.completed).length;
        t.progress = total > 0 ? Math.round((completedCount / total) * 100) : 0;
        // 所有节点完成 → 自动标记任务完成并记录统计
        const wasCompleted = !!t.completed;
        t.completed = t.progress === 100;
        if (!wasCompleted && t.completed) {
          t.completedAt = new Date().toISOString();
          t.completedHours = t.actualHours || t.completedHours || 0;
          recordCompletionStatistics(t);
          try { reflowChainFrom(t.id); } catch (e) { console.warn('reflowChainFrom after node complete failed', e); }
          try { refreshAutoCalcEndTasks(t.type); } catch (e) { console.warn('refreshAutoCalcEndTasks after node complete failed', e); }
        } else if (wasCompleted && !t.completed) {
          t.completedAt = null;
          removeStatisticsSample(t.type, t.id);
          try { refreshAutoCalcEndTasks(t.type); } catch (e) { console.warn('refreshAutoCalcEndTasks after node uncomplete failed', e); }
        }
        saveData().then(() => {
          addSnapshot([String(tid)]);
          renderAll();
          showTaskPreview(tid);
        });
      }
    });

    // Hours input change handler
    wrapper.addEventListener("input", (ev) => {
      const input = ev.target;
      if (!input.classList.contains("used-hours-input")) return;
      const tid = parseInt(input.dataset.taskId, 10);
      const t = state.tasks.find((x) => x.id === tid);
      if (!t) return;
      const val = parseFloat(input.value);
      if (!isNaN(val) && val >= 0) {
        t.actualHours = Math.round(val * 100) / 100;
        if (t.completed) {
          t.completedHours = t.actualHours;
          recordCompletionStatistics(t);
        }
        // Debounce save
        clearTimeout(input._saveTimeout);
        input._saveTimeout = setTimeout(() => {
          saveData().then(() => {
            renderAll();
          });
        }, 500);
      }
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        closeTaskPreview();
      }
    });
  };

  // expose helper for rendering bars to call
  const onBarClick = (taskId) => {
      showTaskPreview(taskId);
  };
  
  // Inject global for click handlers from HTML bar onclick (if any)
  window.barViewShowPreview = onBarClick;
  
  // Also hook into renderBars to add click listeners properly instead of inline
  // (Assuming renderBars uses addEventListener if possible, OR we rely on bar.html structure)
  // Since bar.js controls render, let's find where bars are rendered and add the listener.
  // ...Wait, standard Gantt chart libraries or this custom implementation needs to know how to trigger preview.
  // I will check `renderBars` implementation.
  // But for now, let's define `state` interactions.

  const bindEvents = () => {
    if (els.btnEdit) {
      els.btnEdit.addEventListener("click", toggleEditMode);
    }
    if (els.btnSave) {
      els.btnSave.addEventListener("click", async () => {
        await commitEditsToIndex();
      });
    }
    if (els.btnUndo) {
      els.btnUndo.addEventListener("click", () => {
        const snapshot = state.undoStack.pop();
        if (!snapshot) return;
        state.redoStack.push(captureCurrentSnapshot());
        applySnapshot(snapshot);
        updateUndoRedoButtons();
      });
    }
    if (els.btnRedo) {
      els.btnRedo.addEventListener("click", () => {
        const snapshot = state.redoStack.pop();
        if (!snapshot) return;
        state.undoStack.push(captureCurrentSnapshot());
        applySnapshot(snapshot);
        updateUndoRedoButtons();
      });
    }

    if (els.btnHistory) {
      els.btnHistory.addEventListener("click", () => {
        closeRecyclePanel();
        const isOpen = els.historyPanel.classList.contains("open");
        if (isOpen) {
          // 已开启 → 走关闭逻辑（含自动保存）
          closeHistoryPanel();
        } else {
          // 即将打开 → 记录当前快照 ID
          state._historySnapshotOnOpen = state.preview.currentId;
          els.historyPanel.classList.add("open");
          els.historyPanel.setAttribute("aria-hidden", "false");
        }
      });
    }
    if (els.btnRecycle) {
      els.btnRecycle.addEventListener("click", () => {
        closeHistoryPanel();
        renderRecycleBinPanel();
        els.recyclePanel.classList.toggle("open");
        els.recyclePanel.setAttribute(
          "aria-hidden",
          !els.recyclePanel.classList.contains("open")
        );
      });
    }
    if (els.historyClose) {
      els.historyClose.addEventListener("click", () => {
        closeHistoryPanel();
      });
    }
    if (els.recycleClose) {
      els.recycleClose.addEventListener("click", () => {
        closeRecyclePanel();
      });
    }
    if (els.historyPanel) {
      let historyPressedOutside = false;
      document.addEventListener("pointerdown", (e) => {
        if (!isHistoryOpen()) return;
        const target = e.target;
        const isInsidePanel = els.historyPanel.contains(target);
        const isHistoryButton = els.btnHistory && els.btnHistory.contains(target);
        historyPressedOutside = !isInsidePanel && !isHistoryButton;
      });
      document.addEventListener("pointerup", (e) => {
        if (!isHistoryOpen()) {
          historyPressedOutside = false;
          return;
        }
        if (historyPressedOutside) {
          const target = e.target;
          const isInsidePanel = els.historyPanel.contains(target);
          const isHistoryButton = els.btnHistory && els.btnHistory.contains(target);
          if (!isInsidePanel && !isHistoryButton) {
            closeHistoryPanel();
          }
        }
        historyPressedOutside = false;
      });
      document.addEventListener("pointercancel", () => {
        historyPressedOutside = false;
      });
    }
    if (els.recyclePanel) {
      let recyclePressedOutside = false;
      document.addEventListener("pointerdown", (e) => {
        if (!isRecycleOpen()) return;
        const target = e.target;
        const isInsidePanel = els.recyclePanel.contains(target);
        const isRecycleButton = els.btnRecycle && els.btnRecycle.contains(target);
        recyclePressedOutside = !isInsidePanel && !isRecycleButton;
      });
      document.addEventListener("pointerup", (e) => {
        if (!isRecycleOpen()) {
          recyclePressedOutside = false;
          return;
        }
        if (recyclePressedOutside) {
          const target = e.target;
          const isInsidePanel = els.recyclePanel.contains(target);
          const isRecycleButton = els.btnRecycle && els.btnRecycle.contains(target);
          if (!isInsidePanel && !isRecycleButton) {
            closeRecyclePanel();
          }
        }
        recyclePressedOutside = false;
      });
      document.addEventListener("pointercancel", () => {
        recyclePressedOutside = false;
      });
    }

    if (els.recycleList) {
      els.recycleList.addEventListener("click", async (e) => {
        const restoreBtn = e.target.closest(".restore-btn");
        if (restoreBtn) {
          const tid = restoreBtn.dataset.taskId;
          if (tid) await restoreTaskFromRecycleBin(tid);
          return;
        }
        const deleteBtn = e.target.closest(".delete-btn");
        if (deleteBtn) {
          const tid = deleteBtn.dataset.taskId;
          if (!tid) return;
          if (confirm("确定从回收站彻底删除该任务吗？")) {
            await removeFromRecycleBinPermanently(tid);
          }
          return;
        }
      });
    }

    if (els.btnSettings) {
      els.btnSettings.addEventListener("click", () => {
        showSettingsModal();
      });
    }

    if (els.optWheel) {
      els.optWheel.addEventListener("change", (e) => {
        state.options.wheelScroll = e.target.checked;
        saveOptions();
      });
    }
    if (els.optOpenNewTab) {
      els.optOpenNewTab.addEventListener("change", (e) => {
        state.options.openNewTab = e.target.checked;
        saveOptions();
      });
    }
    if (els.optTheme) {
      els.optTheme.addEventListener("change", (e) => {
        state.options.theme = e.target.value;
        applyTheme(state.options.theme);
        saveOptions();
      });
    }

    // 设置弹窗相关监听器
    if (els.closeSettingsBtn) {
      els.closeSettingsBtn.addEventListener("click", hideSettingsModal);
    }

    if (els.saveSettingsBtn) {
      els.saveSettingsBtn.addEventListener("click", () => {
        // 保存设置
        const wheelScroll = document.getElementById("opt-wheel-scroll");
        const openNewTab = document.getElementById("opt-open-new-tab");
        const themeWarm = document.getElementById("theme-warm");

        if (wheelScroll) state.options.wheelScroll = wheelScroll.checked;
        if (openNewTab) state.options.openNewTab = openNewTab.checked;

        const themeLite = document.getElementById("theme-lite");
        if (themeWarm && themeWarm.checked) {
          state.options.theme = "warm";
        } else if (themeLite && themeLite.checked) {
          state.options.theme = "lite";
        } else {
          state.options.theme = "standard";
        }

        applyTheme(state.options.theme);
        saveOptions();
        hideSettingsModal();
      });
    }

    // 点击弹窗背景关闭 (使用 TaskModalController.bindOverlayClose 防止误触)
    if (els.settingsModal && typeof TaskModalController !== 'undefined') {
      TaskModalController.bindOverlayClose(els.settingsModal, hideSettingsModal);
    }

    if (els.btnGoCards) {
      els.btnGoCards.addEventListener("click", () => {
        const url = "../MainView/index.html";
        if (state.options.openNewTab) window.open(url, "_blank");
        else window.location.href = url;
      });
    }

    if (els.addTask) {
      els.addTask.addEventListener("click", () => {
        showModal(null);
      });
    }

    // Task modal events are managed by TaskModalController
    // Bind overlay close for image modal
    const imgModal = document.getElementById("image-modal");
    if (imgModal) {
         imgModal.addEventListener("click", (e) => {
            if (e.target === imgModal) {
                 imgModal.classList.add("hidden");
            }
         });
         const closeImg = document.getElementById("close-image-modal");
         if (closeImg) closeImg.addEventListener("click", () => imgModal.classList.add("hidden"));
    }
    
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
             const imgModal = document.getElementById("image-modal");
             if (imgModal && !imgModal.classList.contains("hidden")) {
                 imgModal.classList.add("hidden");
                 return;
             }
             const taskModal = document.getElementById("task-modal");
             if (taskModal && !taskModal.classList.contains("hidden")) {
           modalController?.hideModal?.();
                 return;
             }
             closeTaskPreview();
        }
    });


    els.ganttScroll.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          const nextIndex = clamp(
            state.zoomIndex + (e.deltaY > 0 ? 1 : -1),
            0,
            state.zoomSteps.length - 1
          );
          applyZoomAt(nextIndex, e.clientX);
          return;
        }
        if (!state.options.wheelScroll) return;
        if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
        e.preventDefault();
        els.ganttScroll.scrollLeft += e.deltaY * 1.2;
      },
      { passive: false }
    );

    let isPanning = false;
    let panStart = { x: 0, scrollLeft: 0 };
    els.ganttScroll.addEventListener("mousedown", (e) => {
      if (e.ctrlKey && state.editMode) {
        startSelectionBox(e);
        return;
      }
      if (e.target.closest(".gantt-bar")) return;
      isPanning = true;
      els.ganttScroll.classList.add("panning");
      panStart = { x: e.clientX, scrollLeft: els.ganttScroll.scrollLeft };
    });

    window.addEventListener("mousemove", (e) => {
      if (state.drag) handleDragMove(e);
      if (state.selectionBox) updateSelectionBox(e);
      if (!isPanning) return;
      const delta = e.clientX - panStart.x;
      els.ganttScroll.scrollLeft = panStart.scrollLeft - delta;
    });

    window.addEventListener("mouseup", (e) => {
      if (isPanning) {
        isPanning = false;
        els.ganttScroll.classList.remove("panning");
      }
      endSelectionBox();
      handleDragEnd(e);
    });

    els.ganttScroll.addEventListener("scroll", updateStickyLabels);

    els.bars.addEventListener("mousedown", (e) => {
      const bar = e.target.closest(".gantt-bar");
      if (!bar) return;
      const taskId = bar.dataset.id;
      handleBarClick(e, taskId);
      handleDragStart(e, taskId);
    });

    window.addEventListener("keydown", (e) => {
      const target = e.target;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          els.btnRedo?.click();
        } else {
          els.btnUndo?.click();
        }
      }
      if (e.ctrlKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        els.btnRedo?.click();
      }
      const step = 120;
      if (["a", "ArrowLeft"].includes(e.key)) {
        els.ganttScroll.scrollLeft -= step;
      }
      if (["d", "ArrowRight"].includes(e.key)) {
        els.ganttScroll.scrollLeft += step;
      }
      if (["w", "ArrowUp"].includes(e.key)) {
        els.ganttScroll.scrollTop -= step;
      }
      if (["s", "ArrowDown"].includes(e.key)) {
        els.ganttScroll.scrollTop += step;
      }
    });

    // 触控滑动与双指缩放
    let touchPan = null;
    let pinchDist = null;
    els.ganttScroll.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2) {
          // prevent browser pinch-zoom and delegate to our pinch handler
          e.preventDefault();
          pinchDist = getTouchDistance(e.touches);
          return;
        }
        if (e.target.closest(".gantt-bar")) return;
        const t = e.touches[0];
        touchPan = {
          x: t.clientX,
          y: t.clientY,
          scrollLeft: els.ganttScroll.scrollLeft,
          scrollTop: els.ganttScroll.scrollTop,
        };
      },
      { passive: false }
    );

    els.ganttScroll.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length === 2) {
          // prevent browser pinch zoom while handling our own pinch
          e.preventDefault();
          const dist = getTouchDistance(e.touches);
          if (pinchDist && Math.abs(dist - pinchDist) > 10) {
            const nextIndex = clamp(
              state.zoomIndex + (dist < pinchDist ? 1 : -1),
              0,
              state.zoomSteps.length - 1
            );
            const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            pinchDist = dist;
            applyZoomAt(nextIndex, centerX);
          }
          return;
        }
        if (!touchPan) return;
        const t = e.touches[0];
        const dx = t.clientX - touchPan.x;
        const dy = t.clientY - touchPan.y;
        els.ganttScroll.scrollLeft = touchPan.scrollLeft - dx;
        els.ganttScroll.scrollTop = touchPan.scrollTop - dy;
      },
      { passive: false }
    );

    els.ganttScroll.addEventListener("touchend", () => {
      touchPan = null;
      pinchDist = null;
    });

    // Safari/iOS: intercept gesture events to avoid native page zoom
    window.addEventListener(
      "gesturestart",
      (ev) => {
        try {
          ev.preventDefault();
        } catch (e) {
          // ignore
        }
      },
      { passive: false }
    );
    window.addEventListener(
      "gesturechange",
      (ev) => {
        try {
          ev.preventDefault();
        } catch (e) {
          // ignore
        }
      },
      { passive: false }
    );
    window.addEventListener(
      "gestureend",
      (ev) => {
        try {
          ev.preventDefault();
        } catch (e) {
          // ignore
        }
      },
      { passive: false }
    );

    els.bars.addEventListener("click", (e) => {
        const bar = e.target.closest(".gantt-bar");
        if (!bar) return;
        if (!state.editMode) {
             const taskId = Number(bar.dataset.id);
             if (taskId) showTaskPreview(taskId);
        }
    });
  };

  const getTouchDistance = (touches) => {
    const [a, b] = touches;
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const startSelectionBox = (e) => {
    if (!els.selectionRect) return;
    const rect = els.ganttScroll.getBoundingClientRect();
    state.selectionBox = {
      startX: e.clientX,
      startY: e.clientY,
      rect,
    };
    els.selectionRect.classList.add("visible");
  };

  const updateSelectionBox = (e) => {
    if (!state.selectionBox || !els.selectionRect) return;
    const { rect, startX, startY } = state.selectionBox;
    const x1 = startX - rect.left + els.ganttScroll.scrollLeft;
    const y1 = startY - rect.top + els.ganttScroll.scrollTop;
    const x2 = e.clientX - rect.left + els.ganttScroll.scrollLeft;
    const y2 = e.clientY - rect.top + els.ganttScroll.scrollTop;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    els.selectionRect.style.left = `${left}px`;
    els.selectionRect.style.top = `${top}px`;
    els.selectionRect.style.width = `${width}px`;
    els.selectionRect.style.height = `${height}px`;
  };

  const endSelectionBox = () => {
    if (!state.selectionBox || !els.selectionRect) return;
    const rect = els.selectionRect.getBoundingClientRect();
    const selected = new Set(state.selection);
    document.querySelectorAll(".gantt-bar").forEach((bar) => {
      const barRect = bar.getBoundingClientRect();
      const overlap =
        rect.left < barRect.right &&
        rect.right > barRect.left &&
        rect.top < barRect.bottom &&
        rect.bottom > barRect.top;
      if (overlap) selected.add(bar.dataset.id);
    });
    state.selection = selected;
    state.selectionBox = null;
    els.selectionRect.classList.remove("visible");
    renderAll();
  };

  // 页面加载后对所有链进行一次重算，修正因数据过期导致的日期偏差；有变更则自动保存
  /**
   * 根据统计数据刷新所有 autoCalcEnd 任务的截止日期。
   * @param {string|null} filterType - 仅刷新指定类型的任务，null 则刷新全部
   * @returns {boolean} 是否有任务截止日期发生变化
   */
  const refreshAutoCalcEndTasks = (filterType) => {
    if (!modalController) return false;
    const tasks = state.tasks || [];
    const candidates = tasks.filter(t =>
      t.autoCalcEnd && !t.completed && (filterType ? t.type === filterType : true)
    );
    let anyChanged = false;
    candidates.forEach(task => {
      try {
        // 从当前 state 重新拿对象（前面循环中 state.tasks 可能已被 map 替换）
        const cur = (state.tasks || []).find(t => String(t.id) === String(task.id));
        if (!cur || cur.completed) return;

        // urgentA 任务以 actualStartTime 为基准，其余以 startTime
        const isUrgentA = !!(cur.urgentA && cur.actualStartTime);
        const deadlineBase = isUrgentA ? cur.actualStartTime : (cur.startTime || cur.starttime);
        if (!deadlineBase) return;

        const autoEnd = modalController.computeAutoDeadline(deadlineBase, cur.estimatedHours, cur.type);
        let newDeadline;
        if (autoEnd) {
          newDeadline = autoEnd;
        } else if (Number.isFinite(cur.estimatedDay) && cur.estimatedDay >= 0) {
          newDeadline = formatDate(addDays(new Date(deadlineBase), cur.estimatedDay));
        } else {
          return;
        }

        if (newDeadline && newDeadline !== cur.deadline) {
          state.tasks = state.tasks.map(t =>
            String(t.id) === String(cur.id) ? normalizeTask({ ...t, deadline: newDeadline }) : t
          );
          anyChanged = true;
          // 截止日期变化了，若有链式后继则向下传播
          const hasSuccessors = (state.tasks || []).some(s => String(s.lineTaskId) === String(cur.id));
          if (hasSuccessors) {
            try { reflowChainFrom(String(cur.id)); } catch (e) { console.warn('refreshAutoCalcEnd reflowChainFrom failed', e); }
          }
        }
      } catch (e) { console.warn('refreshAutoCalcEndTasks failed', task.name, e); }
    });
    return anyChanged;
  };

  const scanAllChainsOnLoad = async () => {
    if (state._scanningChains) return;
    state._scanningChains = true;
    try {
      const tasks = state.tasks || [];
      const successorSet = new Set(tasks.map(t => t.lineTaskId).filter(Boolean).map(String));
      // 链根：自身有继任者但没有前序的任务
      const roots = tasks.filter(t => successorSet.has(String(t.id)) && !t.lineTaskId);

      // 记录重算前的日期快照，用于判断是否有变更
      const before = new Map(tasks.map(t => [String(t.id), t.startTime + '|' + t.deadline]));

      // 第 1 步：从每条链根向下传播（会处理链式子任务的 autoCalcEnd）
      roots.forEach(root => {
        try { reflowChainFrom(String(root.id)); } catch (e) { console.warn("scanAllChainsOnLoad reflowChainFrom failed", e); }
      });

      // 第 2 步：统计驱动——对所有未完成且 autoCalcEnd 的任务重算截止日期
      // 覆盖：链根自身、独立任务、urgentA 任务、以及 reflowChainFrom 可能遗漏的情况
      refreshAutoCalcEndTasks(null);

      // 比较重算后是否有任务日期发生了变化
      const changed = (state.tasks || []).some(t => {
        const key = String(t.id);
        return before.has(key) && before.get(key) !== t.startTime + '|' + t.deadline;
      });
      if (changed) {
        try { await saveData(); } catch (e) { console.warn("scanAllChainsOnLoad saveData failed", e); }
      }
    } finally {
      state._scanningChains = false;
    }
  };

  const init = async () => {
    loadOptions();
    await loadPreview();
    const res = await fetch("/load");
    const data = await res.json();
    state.data = data;
    state.data.recycleBin = Array.isArray(data.recycleBin) ? data.recycleBin : [];
    state.tasks = (data.tasks || []).map(normalizeTask);
    // 必须在 scanAllChainsOnLoad 之前初始化 modalController，否则 computeAutoDeadline 不可用
    // 导致回退路径使用 normalizeTask 膨胀后的 __endDate 产生错误的截止日期
    try { initModalController(); } catch (e) { console.warn("early initModalController failed", e); }
    try { await scanAllChainsOnLoad(); } catch (e) { console.warn("scanAllChainsOnLoad failed on init", e); }
    // 每次加载重置快照历史；base.tasks 仅存内存，preview.json 不产生双倍开销
    resetPreviewBaseFromIndex();
    renderAll();
    renderRecycleBinPanel();
    renderHistory();
    updateUndoRedoButtons();
    bindEvents();
  };

  init();
})();
