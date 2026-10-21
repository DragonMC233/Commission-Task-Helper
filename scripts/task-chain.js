/**
 * 链式调度共享实现（MainView / BarView 共用）
 *
 * 只负责「数据层」：给定父任务和后继，算出后继应有的 startTime / deadline。
 * UI 刷新、递归外壳、落盘由各视图自己处理，避免把 DOM 依赖拖进来。
 *
 * 语义口径（两处历史分叉已在此收敛，来源见各函数注释）：
 *   - 后继判定必须 dependencyType === "line"（BarView 旧实现漏了，会把残留 lineTaskId 的独立任务当后继）
 *   - 已完成的任务完全不动（app.js 旧实现会移动已完成任务的 startTime，导致甘特图上的历史 bar 漂移）
 *   - 截止日期三级回退：统计推算 → 手动工期 estimatedDay → 沿用原工期平移
 *   - 加急分支锚点用 7 天 gap 规则；确认加急时把后继回接到原前序，保证主链不断裂
 */
(() => {
  // 时间处理统一走 task-time.js
  // 注意：链式排期产出的字符串要写回 index.json，必须用 formatForStorage（ISO UTC）；
  // 界面展示用的是 formatDateTime（本地时区），别混用。
  const time = window.taskTime;
  // 链式排期产出的字符串会写回 index.json，必须用 UTC
  const toStorageStr = time.formatForStorage;
  const formatDate = time.formatDate;
  const parseLocalDate = time.parse;
  const toDateOnly = time.toDateOnly;
  const addDays = time.addDays;
  const daysBetween = time.daysBetween;
  const hasExplicitTime = time.hasExplicitTime;

  // ---- 排序相关 ----

  /** 直接后继：必须显式声明 line 依赖 */
  const getSuccessorTasks = (tasks, taskId) =>
    (tasks || []).filter(
      (t) => t && t.dependencyType === "line" && String(t.lineTaskId) === String(taskId)
    );

  /** 祖先链，返回 [紧前, 再前, ..., 链头] */
  const getChainAncestors = (tasks, task) => {
    const list = [];
    const seen = new Set();
    let cur = task;
    while (cur && cur.lineTaskId && !seen.has(String(cur.lineTaskId))) {
      seen.add(String(cur.lineTaskId));
      const parent = (tasks || []).find((t) => String(t.id) === String(cur.lineTaskId));
      if (!parent) break;
      list.push(parent);
      cur = parent;
    }
    return list;
  };

  /** 把 taskId 的所有后继改挂到 newParentId 下 */
  const rebindSuccessorsTo = (tasks, taskId, newParentId) => {
    const children = getSuccessorTasks(tasks, taskId);
    children.forEach((child) => {
      child.lineTaskId = newParentId;
    });
    return children;
  };

  // ---- 加急判定 ----

  /** 判定签名：实际开始 / 计划开始 / 前序，任一变化才需要重新询问 */
  const accelerateSignature = (task) => {
    if (!task) return "";
    const start = task.startTime || task.starttime || "";
    return `${task.actualStartTime || ""}|${start}|${task.lineTaskId ?? ""}`;
  };

  /** 已确认加急(urgentA)或已对当前这组值点过取消，就不再打断 */
  const needsAcceleratePrompt = (task) => {
    if (!task || task.urgentA) return false;
    const plannedStart = task.startTime || task.starttime;
    if (!task.actualStartTime || !plannedStart) return false;
    if (!(parseLocalDate(task.actualStartTime) < parseLocalDate(plannedStart))) return false;
    return task.accelerateDismissedFor !== accelerateSignature(task);
  };

  /** 加急后新前序与链根之间的最大允许间隔（天） */
  const BRANCH_GAP_DAYS = 7;

  /**
   * 根据 actualStartTime 定位加急任务应该挂到哪个前序下。
   *
   * 找 Q = 最后一个 startTime <= actualStart 的前序：
   *   无 Q                → 独立任务（lineTaskId = null）
   *   gap <= 7 天（含重叠）→ 分支自 Q（同档并行/紧随）
   *   gap > 7 天          → 往前一级，避免分支悬空过长
   */
  const resolveAccelerateAnchor = (tasks, task) => {
    const orderedPreds = [...getChainAncestors(tasks, task)].reverse();
    if (!task.actualStartTime) return { newLineTaskId: null, orderedPreds };
    const actualStart = parseLocalDate(task.actualStartTime).getTime();
    let qIdx = -1;
    for (let i = orderedPreds.length - 1; i >= 0; i--) {
      const predStart = orderedPreds[i].startTime || orderedPreds[i].starttime;
      if (parseLocalDate(predStart).getTime() <= actualStart) {
        qIdx = i;
        break;
      }
    }
    if (qIdx === -1) return { newLineTaskId: null, orderedPreds };
    const Q = orderedPreds[qIdx];
    // 前序没有截止日期时视为间隔无限，按 gap 超限处理，避免读 null 崩溃
    const qDeadline = parseLocalDate(Q.deadline);
    const gapDays = qDeadline ? (actualStart - qDeadline.getTime()) / 86400000 : Infinity;
    if (gapDays <= BRANCH_GAP_DAYS) return { newLineTaskId: Q.id, orderedPreds };
    return { newLineTaskId: qIdx > 0 ? orderedPreds[qIdx - 1].id : null, orderedPreds };
  };

  // ---- 排期计算 ----

  /**
   * 后继的自动开始时间。
   *
   * bufferDays 语义：-1 = 同天无缝衔接，0 = 次日，1 = 次次日，依此类推。
   * 日期从「前序的结束基准 + N 天」推出，**时分不动**：
   * 子任务已有自己写的时刻就保留（刷新/重排只挪日期），
   * 子任务没有时刻时退回前序基准的时分，基准本身只有日期才输出纯日期。
   * 换言之，链式重排不负责决定「几点开始」。
   */
  const computeAutoStartFromPredecessor = (prevTask, bufferDays, childTask) => {
    if (!prevTask) return null;
    const baseRaw = prevTask.completedAt || prevTask.deadline;
    if (!baseRaw) return null;
    let base = parseLocalDate(baseRaw);
    if (!base || Number.isNaN(base.getTime())) return null;

    const todayDate = time.today();
    if (!prevTask.completedAt && prevTask.deadline) {
      const dl = parseLocalDate(prevTask.deadline);
      if (dl && !Number.isNaN(dl.getTime()) && dl < todayDate) {
        // 前序逾期未完成时以「今日」为基准，但保留 deadline 的时分（例如 23:59）
        const dp = time.parts(dl);
        const tp = time.parts(todayDate);
        base = time.make(tp.year, tp.month, tp.day, dp.hour, dp.minute, dp.second);
      }
    }

    const rawProvided = Number.isFinite(Number(bufferDays)) ? Math.round(Number(bufferDays)) : 1;
    const raw = Math.max(rawProvided, -1);
    const nextStart = addDays(base, raw + 1);

    // 链式重排只决定「从哪一天开始」，不重新决定「几点开始」。
    // 时分优先级：子任务自己已有的 → 前序基准的 → 纯日期（不凭空造时刻）
    const childRaw = childTask ? childTask.startTime || childTask.starttime : "";
    let tod = null;
    if (hasExplicitTime(childRaw)) tod = time.parts(childRaw);
    else if (hasExplicitTime(baseRaw)) tod = time.parts(base);

    const np = time.parts(nextStart);
    if (!tod) return formatDate(nextStart);
    return time.formatForStorage(
      time.make(np.year, np.month, np.day, tod.hour, tod.minute, tod.second)
    );
  };

  /** 前序任务的间隔天数，缺省时按类型统计的日均工期估算 */
  const resolveBufferDays = (prevTask, getTypeWeightedStats) => {
    if (Number.isFinite(Number(prevTask?.bufferDays))) {
      return Math.max(-1, Math.round(Number(prevTask.bufferDays)));
    }
    const stats = getTypeWeightedStats ? getTypeWeightedStats(prevTask?.type) : null;
    const statDays = stats && stats.avgRequireDays ? Math.round(stats.avgRequireDays) : 1;
    return Math.max(1, statDays);
  };

  /**
   * 把新算出来的截止日期，按原字段的形态组装回去。
   *
   * - 原先写了具体时刻（如米画师这类按小时交付的平台，用户手填 20:00）→ 换日期、留时刻
   * - 原来只有日期 → 仍输出纯日期，不凭空造一个时刻
   * - 原先就是 23:59 → 保持 23:59（默认「当天结束」）
   *
   * 换言之：链式重排只负责「哪一天截止」，不重新决定「几点截止」。
   * 时分取自原值在**本地时区**的字段，再落到新日期的本地日历上，最后转成 UTC 存储。
   */
  const keepTimeOfDay = (newStr, originalStr) => {
    if (!newStr) return "";
    const newDate = time.parse(newStr);
    if (!newDate) return "";
    if (!hasExplicitTime(originalStr)) return time.formatDate(newDate);
    const op = time.parts(originalStr);
    const np = time.parts(newDate);
    if (!op || !np) return time.formatForStorage(newDate);
    return time.formatForStorage(
      time.make(np.year, np.month, np.day, op.hour, op.minute, op.second)
    );
  };

  /** 按原工期平移截止日期（最后一级回退） */
  const shiftDeadlineByOriginalDuration = (prevStart, prevDeadline, baseDate) => {
    const rawStart = toDateOnly(prevStart) || toDateOnly(baseDate);
    const rawEnd = toDateOnly(prevDeadline);
    const oldDuration = rawStart && rawEnd ? Math.max(1, daysBetween(rawStart, rawEnd) + 1) : 1;
    return toStorageStr(addDays(baseDate, oldDuration - 1));
  };

  /**
   * 把父任务的最新日期传播到单个后继上（就地修改 child）。
   *
   * 所有计算都基于调用前的 prevStart / prevDeadline，最后统一赋值，
   * 避免「先改 startTime 再用改后的值算原工期」导致工期恒为 1。
   *
   * @param {object} parent 前序任务
   * @param {object} child  后继任务
   * @param {object} ctx
   *   ctx.getTypeWeightedStats(type)                → 统计聚合
   *   ctx.computeAutoDeadline(start, hours, type)   → 按统计算截止日期
   *   ctx.afterChange(child, field)                 → 字段变化后的回调（UI 刷新）
   * @param {number} [bufferDays] 父任务的间隔天数；同类后继共用，避免重复查统计
   * @returns {{ startChanged: boolean, deadlineChanged: boolean }}
   */
  const applyChainToSuccessor = (parent, child, ctx = {}, bufferDays) => {
    const result = { startChanged: false, deadlineChanged: false };
    // 暂停中的任务由暂停延期接管截止日，若仍按前序重排会把手改的日期覆盖回去，
    // 恢复后自然重新参与链式排期。
    if (!child || child.completed || child.paused) return result;

    const prevStart = child.startTime || child.starttime || "";
    const prevDeadline = child.deadline || "";

    const newStartStr = computeAutoStartFromPredecessor(
      parent,
      bufferDays === undefined ? resolveBufferDays(parent, ctx.getTypeWeightedStats) : bufferDays,
      child
    );
    if (!newStartStr) return result;

    // 手动排期（autoSchedule=false）：只守下界。前序延后到它开始之后才整体后推，
    // 前序正常或提前时不前移，免得把用户手拖过的计划改掉。
    if (!child.autoSchedule) {
      const curStart = parseLocalDate(prevStart);
      const needStart = parseLocalDate(newStartStr);
      if (
        !curStart || Number.isNaN(curStart.getTime()) ||
        !needStart || Number.isNaN(needStart.getTime())
      ) return result;
      const pushDays = daysBetween(curStart, needStart);
      if (!pushDays || pushDays <= 0) return result;
      child.startTime = newStartStr;
      result.startChanged = true;
      if (ctx.afterChange) ctx.afterChange(child, "startTime");
      // 截止日跟着平移，保持原有工期
      const curDeadline = prevDeadline ? parseLocalDate(prevDeadline) : null;
      if (curDeadline && !Number.isNaN(curDeadline.getTime())) {
        const shifted = addDays(curDeadline, pushDays);
        child.deadline = hasExplicitTime(prevDeadline)
          ? toStorageStr(shifted)
          : formatDate(shifted);
        result.deadlineChanged = true;
        if (ctx.afterChange) ctx.afterChange(child, "deadline");
      }
      return result;
    }

    // 加急任务已提前实际开工，截止日基于 actualStartTime；其余基于计划 startTime
    const deadlineBase =
      child.urgentA && child.actualStartTime ? child.actualStartTime : newStartStr;
    const baseDate = parseLocalDate(deadlineBase);
    if (!baseDate || Number.isNaN(baseDate.getTime())) return result;

    // 三级回退：统计推算 → 手动工期 estimatedDay → 沿用原工期平移
    // autoCalcEnd=true 表示「截止日期由系统算」，时刻就用默认的 23:59；
    // 只在手动工期 / 原工期平移这两档里，才沿用用户原来的时分。
    let newDeadline = "";
    let keepUserTime = false;
    if (child.autoCalcEnd && ctx.computeAutoDeadline) {
      newDeadline = ctx.computeAutoDeadline(deadlineBase, child.estimatedHours, child.type) || "";
    }
    if (!newDeadline && Number.isFinite(child.estimatedDay) && child.estimatedDay >= 0) {
      // 手动工期：只改日期部分，保留用户原来的时分
      const end = addDays(baseDate, child.estimatedDay);
      const existingDl = parseLocalDate(prevDeadline);
      const timeSource =
        hasExplicitTime(prevDeadline) && existingDl && !Number.isNaN(existingDl.getTime())
          ? existingDl
          : baseDate;
      const ep = time.parts(end);
      const tp = time.parts(timeSource);
      newDeadline = toStorageStr(time.make(ep.year, ep.month, ep.day, tp.hour, tp.minute, 0));
      keepUserTime = true;
    }
    if (!newDeadline) {
      newDeadline = shiftDeadlineByOriginalDuration(prevStart, prevDeadline, baseDate);
      keepUserTime = true;
    }
    if (keepUserTime) {
      newDeadline = keepTimeOfDay(newDeadline, prevDeadline);
    } else if (!hasExplicitTime(prevDeadline)) {
      // 原来是纯日期：仍输出纯日期，不凭空造一个时刻
      newDeadline = time.formatDate(newDeadline);
    }

    // 兜底：开始时间被推到截止日期之后时给最小一天工期，避免截止早于开始
    const startDate = parseLocalDate(newStartStr);
    const deadlineDate = newDeadline ? parseLocalDate(newDeadline) : null;
    if (
      deadlineDate &&
      !Number.isNaN(deadlineDate.getTime()) &&
      !Number.isNaN(startDate.getTime()) &&
      deadlineDate < startDate
    ) {
      const sp = time.parts(startDate);
      const safeEnd = time.make(sp.year, sp.month, sp.day + 1, 23, 59, 0);
      newDeadline = keepTimeOfDay(toStorageStr(safeEnd), prevDeadline);
    }

    if (prevStart !== newStartStr) {
      child.startTime = newStartStr;
      result.startChanged = true;
      if (ctx.afterChange) ctx.afterChange(child, "startTime");
    }
    if (newDeadline && prevDeadline !== newDeadline) {
      child.deadline = newDeadline;
      result.deadlineChanged = true;
      if (ctx.afterChange) ctx.afterChange(child, "deadline");
    }
    return result;
  };

  /**
   * 递归重排 taskId 之后的所有后继（就地修改 tasks）。
   *
   * @param {Array}  tasks
   * @param {string} taskId
   * @param {object} ctx 透传给 applyChainToSuccessor
   * @returns {Set<string>} 发生过变化的任务 id
   */
  const reflowChainFrom = (tasks, taskId, ctx = {}) => {
    const changed = new Set();
    const visited = new Set();
    const walk = (id) => {
      const key = String(id);
      if (visited.has(key)) return;
      visited.add(key);
      const parent = (tasks || []).find((t) => String(t.id) === key);
      if (!parent) return;
      // 同一个父任务的间隔天数只算一次，所有后继共用
      const bufferDays = resolveBufferDays(parent, ctx.getTypeWeightedStats);
      getSuccessorTasks(tasks, key).forEach((child) => {
        const r = applyChainToSuccessor(parent, child, ctx, bufferDays);
        if (r.startChanged || r.deadlineChanged) changed.add(String(child.id));
        walk(child.id);
      });
    };
    walk(taskId);
    return changed;
  };

  window.taskChain = {
    // 日期工具
    formatDate,
    parseLocalDate,
    toDateOnly,
    addDays,
    daysBetween,
    // 链结构
    getSuccessorTasks,
    getChainAncestors,
    rebindSuccessorsTo,
    // 加急
    accelerateSignature,
    needsAcceleratePrompt,
    resolveAccelerateAnchor,
    // 排期
    hasExplicitTime,
    keepTimeOfDay,
    computeAutoStartFromPredecessor,
    resolveBufferDays,
    shiftDeadlineByOriginalDuration,
    applyChainToSuccessor,
    reflowChainFrom,
  };
})();
