(() => {
  // 时间处理统一走 task-time.js（按访问者设备本地时区显示）
  const time = window.taskTime;

  const getDaysRemaining = (deadline) => {
    if (!deadline) return null;
    const diff = time.daysBetween(time.today(), time.toDateOnly(deadline));
    if (diff === null) return null;
    // daysBetween 是「截止日 - 今天」的整天差，向上取整保持原有语义
    return Math.ceil(diff);
  };

  const defaultCalculateDailyTime = (
    deadline,
    estimatedHours,
    _currentProgress,
    actualHours
  ) => {
    if (!deadline) return null;
    const daysRemaining = getDaysRemaining(deadline);
    if (daysRemaining === null) return null;
    const remainingHours = Math.max(0, (estimatedHours || 0) - (actualHours || 0));
    const dailyTime = daysRemaining <= 0 ? remainingHours : remainingHours / daysRemaining;
    return {
      hours: Math.ceil(dailyTime * 10) / 10,
      daysRemaining,
      urgent: daysRemaining <= 3,
    };
  };

  const defaultGetDeadlineStatus = (deadline) => {
    if (!deadline) return null;
    const now = new Date();
    const deadlineDate = time.parse(deadline);
    if (!deadlineDate) return null;
    const diffMs = deadlineDate - now;
    const diffHours = diffMs / (1000 * 60 * 60);
    const daysRemaining = getDaysRemaining(deadline);
    if (diffMs < 0) {
      return { status: "overdue", text: "已逾期", urgent: true };
    }
    if (diffHours < 1) {
      const remainingMinutes = Math.floor(diffMs / (1000 * 60));
      return {
        status: "imminent",
        text: `${remainingMinutes}分钟后截止`,
        urgent: true,
      };
    }
    if (daysRemaining === 0) {
      return { status: "today", text: "今天到期", urgent: true };
    }
    if (daysRemaining === 1) {
      return { status: "tomorrow", text: "明天到期", urgent: true };
    }
    if (daysRemaining !== null && daysRemaining <= 3) {
      return { status: "urgent", text: `${daysRemaining}天`, urgent: true };
    }
    return { status: "normal", text: `${daysRemaining ?? ""}天`, urgent: false };
  };

  // getIconClassForSource 和 defaultGetNodePresentation 已提取至 task-utils.js

  /**
   * 收款状态徽章信息（卡片用）
   */
  const getPaymentStatusInfo = (t) => {
    if (!t) return null;
    if (t.abandoned) return { label: "已废弃", variant: "abandoned" };
    const contracted = Number(t.payment) || 0;
    const records = Array.isArray(t.paymentRecords) ? t.paymentRecords : [];
    const mode = t.paymentMode || "";
    if (mode === "free") return { label: "免费", variant: "free" };
    if (!contracted && records.length === 0 && !mode) return null;
    const received = records
      .filter((r) => r.type !== "refund")
      .reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const refunded = records
      .filter((r) => r.type === "refund")
      .reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const net = received - refunded;
    const hasRefund = refunded > 0;
    const modeLabels = {
      full_pre: "全款先付",
      full_post: "全款后付",
      deposit: "定金+尾款",
      milestone: "节点付款",
    };
    const modeLabel = modeLabels[mode] || "";
    if (records.length === 0) {
      return modeLabel ? { label: modeLabel + "·待收", variant: "pending" } : null;
    }
    if (received > 0 && net <= 0) return { label: "全额退款", variant: "refunded" };
    if (contracted > 0 && net >= contracted) {
      return {
        label: `¥${net.toFixed(0)} 已全收${hasRefund ? "(含退款)" : ""}`,
        variant: "paid-full",
      };
    }
    if (net > 0) {
      return {
        label: `¥${net.toFixed(0)}/${
          contracted > 0 ? "¥" + contracted.toFixed(0) : "?"
        }${hasRefund ? "(含退款)" : ""}`,
        variant: "paid-partial",
      };
    }
    return { label: "未收款", variant: "pending" };
  };

  /**
   * 任务净收入（扣除退款；已废弃任务不计入）
   */
  const getTaskNetIncomeForStats = (task) => {
    if (!task || task.abandoned) return 0;
    const records = task.paymentRecords;
    if (!Array.isArray(records) || records.length === 0) {
      return Number(task.payment) || 0;
    }
    return Math.max(
      0,
      records.reduce((sum, r) => {
        const amt = Number(r.amount) || 0;
        return r.type === "refund" ? sum - amt : sum + amt;
      }, 0)
    );
  };

  /**
   * 计时 / 暂停按钮（卡片底部）
   *
   * options: {
   *   isRunning: 该任务是否正在计时
   *   taskTypes: 用于取类型颜色
   *   getButtonBg: (typeColor) => css 颜色，两个视图的取色算法不同，由调用方注入
   * }
   */
  const getTimerButtonHtml = (task, options = {}) => {
    if (!task || task.completed) return "";
    const isRunning = !!options.isRunning;
    const taskTypes = options.taskTypes || [];
    const getButtonBg =
      typeof options.getButtonBg === "function"
        ? options.getButtonBg
        : (hex) =>
            window.taskUtils.computeButtonOklch(hex, { maxL: 0.9 }) || "#6B7280";
    const type = taskTypes.find((t) => t.id === task.type) || {};
    const typeColor = type.color || "#95A5A6";
    const btnBg = getButtonBg(typeColor);
    const isPaused = !!task.paused;
    const timerBtn = `<button class="timer-btn text-white rounded-full px-4 py-2 flex items-center justify-center transition-colors flex-shrink-0" data-task-id="${task.id}" data-testid="timer-btn-${task.id}" style="background:${btnBg}"><span class="material-icons text-sm mr-2">${getTimerIcon(isRunning)}</span><span class="text-sm font-medium">${getTimerLabel(isRunning, !!task.actualStartTime, isPaused)}</span></button>`;
    // 暂停/恢复按钮（已完成和废弃不显示）
    if (task.abandoned) {
      return `<div class="mt-3 flex justify-center items-center gap-2">${timerBtn}</div>`;
    }
    const pauseIcon = isPaused ? "replay" : "play_disabled";
    const pauseClass = isPaused ? "pause-btn--paused" : "";
    const pauseBgStyle = isPaused ? "" : `background:${btnBg};`;
    const pauseBtn = `<button class="pause-btn ${pauseClass}" data-task-id="${task.id}" data-testid="pause-btn-${task.id}" style="${pauseBgStyle}"><span class="material-icons-round text-sm">${pauseIcon}</span></button>`;
    return `<div class="mt-3 flex justify-center items-center gap-2">${timerBtn}${pauseBtn}</div>`;
  };

  const createTaskCardHtml = (task, ctx = {}) => {
    if (!task) return "";
    const taskTypes = ctx.taskTypes || [];
    const sourcePlatforms = ctx.sourcePlatforms || [];
    const type = taskTypes.find((t) => t.id === task.type) || {};
    const source = sourcePlatforms.find((s) => s.id === task.source) || {};
    const typeColor = type.color || "#95A5A6";
    const typeName = type.name || task.type || "未知类型";
    const sourceName = source.name || task.source || "未知平台";

    const computeLightBgFromHex =
      typeof ctx.computeLightBgFromHex === "function"
        ? ctx.computeLightBgFromHex
        : (hex) => hex;
    const blendWithWhite =
      typeof ctx.blendWithWhite === "function"
        ? ctx.blendWithWhite
        : (color) => color;
    const getDeadlineStatus =
      typeof ctx.getDeadlineStatus === "function"
        ? ctx.getDeadlineStatus
        : defaultGetDeadlineStatus;
    const calculateDailyTime =
      typeof ctx.calculateDailyTime === "function"
        ? ctx.calculateDailyTime
        : defaultCalculateDailyTime;
    const presetNodes = ctx.presetNodes || [];
    const getNodePresentation =
      typeof ctx.getNodePresentation === "function"
        ? ctx.getNodePresentation
        : (node) => window.taskUtils.defaultGetNodePresentation(node, presetNodes);
    const getTimerButton =
      typeof ctx.getTimerButton === "function" ? ctx.getTimerButton : () => "";

    const cardBodyWhiteBlend =
      typeof ctx.cardBodyWhiteBlend === "number" ? ctx.cardBodyWhiteBlend : 0.7;
    const dateOnlyDeadlineMode = !!ctx.dateOnlyDeadlineMode;
    const showingRecycleBin = !!ctx.showingRecycleBin;

    const deadlineStatus = getDeadlineStatus(task.deadline);
    const dailyTime = calculateDailyTime(
      task.deadline,
      task.estimatedHours,
      task.progress,
      task.actualHours
    );

    const completedHours = task.actualHours || 0;
    const remainingHours = Math.max(0, (task.estimatedHours || 0) - completedHours);
    const progressPercentage =
      task.estimatedHours && task.estimatedHours > 0
        ? Math.round((completedHours / task.estimatedHours) * 100)
        : 0;
    let progressLevel;
    if (progressPercentage > 100) progressLevel = "over";
    else if (progressPercentage === 100) progressLevel = "complete";
    else if (progressPercentage >= 70) progressLevel = "high";
    else if (progressPercentage >= 40) progressLevel = "mid";
    else progressLevel = "low";

    const hasNodes = task.nodes && task.nodes.length > 0;
    const hasImage = task.image && String(task.image).trim() !== "";
    const hasPayment = task.payment && task.payment > 0;
    const paymentInfo = getPaymentStatusInfo(task);
    const netIncome = getTaskNetIncomeForStats(task);
    const hourlyRate = netIncome > 0
      ? task.completed
        ? task.actualHours > 0
          ? (netIncome / task.actualHours).toFixed(2)
          : 0
        : task.estimatedHours > 0
        ? (netIncome / task.estimatedHours).toFixed(2)
        : 0
      : 0;

    const headerBg = computeLightBgFromHex(typeColor);
    const bodyBg = blendWithWhite(headerBg, cardBodyWhiteBlend);

    const completedClass = task.completed && !showingRecycleBin ? "completed" : "";
    const abandonedClass = task.abandoned ? "abandoned" : "";

    // presentation tweaks for embedded contexts (e.g. BarView recycle panel)
    const outerInlineStyle = `background: transparent; color: #1f2937;${showingRecycleBin ? '' : ' overflow: hidden;'}`;
    const bodyOverflowClass = showingRecycleBin ? '' : 'overflow-hidden';

    // 图片路径归一化：数据存相对路径（pic/x.png），页面有 base href 时必须转根绝对路径
    const imgSrc = window.taskUtils
      ? window.taskUtils.resolveImageSrc(task.image)
      : task.image;

    return `
            <div class="task-card ${
              completedClass
            } ${
              abandonedClass
            } rounded-xl ${
      deadlineStatus?.urgent && !task.abandoned ? "deadline-warning" : ""
    }" data-task-id="${task.id}" data-type="${
      task.type
    }" data-testid="task-card-${
      task.id
    }" style="${outerInlineStyle}">
               <div class="task-card-header" style="background: ${headerBg}; padding: 1.5rem; padding-block-end: 0; border-top-left-radius: 1rem; border-top-right-radius: 1rem;">
                <div class="flex items-start justify-between" style="transform: translateY(-5px); margin-bottom: -5px; line-height:1.15;">
                    <div class="flex justify-between items-center flex-1" style="min-width:0;">
                        <div class="flex-1" style="min-width:0;">
                            <h3 class="font-bold text-xl ${
                              task.completed ? "line-through" : ""
                            }" style="color: inherit; margin:0; line-height:1.15; overflow-wrap:anywhere;">${task.name.replace(/_/g, '_<wbr>')}</h3>
                        </div>
                    </div>
                    <div class="flex flex-col items-start gap-1">
                        <div class="flex items-start gap-2" >
                            <button class="flex items-center edit-btn" data-task-id="${task.id}" data-testid="edit-btn-${task.id}">
                                <span class="material-icons text-sm">edit</span>
                            </button> 
                            <div class="task-complete-area flex items-center cursor-pointer rounded transition-colors scale-90" data-testid="complete-area-${task.id}" data-task-id="${task.id}">
                                ${
                                  task.completed
                                    ? '<span class="material-icons text-green-500">check_circle</span>'
                                    : '<span class="material-icons text-green-500">radio_button_unchecked</span>'
                                }
                            </div>
                            ${
                              showingRecycleBin
                                ? `<button class="flex items-center restore-btn" title="还原" aria-label="还原" data-task-id="${task.id}" data-testid="restore-btn-${task.id}"><span class="material-icons text-sm">restore</span></button>
                                 <button class="flex items-center delete-btn" title="彻底删除" aria-label="彻底删除" data-task-id="${task.id}" data-testid="delete-btn-${task.id}"><span class="material-icons text-sm scale-102">delete_forever</span></button>`
                                : `<button class="flex items-center delete-btn" data-task-id="${task.id}" data-testid="delete-btn-${task.id}"><span class="material-icons text-sm scale-102">delete</span></button>
                                 <button class="flex items-center abandon-btn" title="${task.abandoned ? '恢复任务' : '废弃任务'}" data-task-id="${task.id}" data-testid="abandon-btn-${task.id}" style="opacity:${task.abandoned ? 1 : 0.45};"><span class="material-icons text-sm" style="color:${task.abandoned ? '#f97316' : 'currentColor'}">${task.abandoned ? 'undo' : 'block'}</span></button>`
                            }
                        </div>
                    </div>
                </div>
                <div class="flex items-center justify-between gap-1" style="transform:translateY(-5px);">
                    <p class="text-sm" style="color: inherit; opacity: 0.9; margin:4px 0 8px;">${typeName} · ${sourceName}</p>
                    <div class="task-dates" style="margin:4px 4px 8px; text-align:right;">
                      ${
                        task.completedAt
                          ? `<div class="deadline-date deadline-date--completed">已完成: ${
                              dateOnlyDeadlineMode
                                ? new Date(task.completedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit" })
                                : new Date(task.completedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                            }</div>`
                          : task.deadline
                          ? `<div data-deadline-status="${
                              (deadlineStatus && deadlineStatus.status) ||
                              "normal"
                            }" class="deadline-date">截止: ${
                              dateOnlyDeadlineMode
                                ? new Date(task.deadline).toLocaleString("zh-CN", {
                                    month: "2-digit",
                                    day: "2-digit",
                                  })
                                : new Date(task.deadline).toLocaleString("zh-CN", {
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                            }</div>`
                          : ""
                      }
                    </div>
                </div>
              </div>
               <div class="task-card-body pt-0 ${bodyOverflowClass}" style="background: ${bodyBg}; padding: 1.5rem; padding-top: 0; border-bottom-left-radius: 1rem; border-bottom-right-radius: 1rem;">
                <div class="flex items-center gap-1 mt-2 mb-2">
                      ${
                        task.abandoned
                          ? `<div class="flex items-center"><div class="deadline-badge" data-status="abandoned">已废弃</div></div>`
                          : task.completed
                          ? `<div class="flex items-center"><div class="deadline-badge" data-status="completed">已完成</div></div>`
                          : task.deadline
                          ? `<div class="flex items-center"><div class="deadline-badge" data-status="${
                              deadlineStatus?.status || "normal"
                            }">${deadlineStatus?.text || ""}</div></div>`
                          : ""
                      }
                      ${
                        (typeof document !== 'undefined' && document.body && document.body.classList.contains('barview-body') && task.dependencyType === "line")
                          ? `<div class="daily-time-badge">链式</div>`
                          : ""
                      }
                    ${
                      dailyTime && !task.completed && !task.abandoned
                        ? `<div class="daily-time-badge" data-variant="daily-time">${
                            dailyTime.hours || "?"
                          }h/天</div>`
                        : ""
                    }
                    ${
                      paymentInfo && !task.abandoned
                        ? `<div class="daily-time-badge" data-variant="payment-status" data-payment-variant="${paymentInfo.variant}">${paymentInfo.label}</div>`
                        : !task.abandoned && hasPayment
                        ? `<div class="daily-time-badge" data-variant="daily-time">¥${task.payment || "?"}</div>`
                        : ""
                    }
                    ${
                      (hasPayment || netIncome > 0) && !task.abandoned
                        ? `<div class="daily-time-badge" data-variant="daily-time">¥${hourlyRate || "?"}/h</div>`
                        : ""
                    }
                    ${
                      task.paused
                        ? `<div class="daily-time-badge" data-variant="paused">暂停中</div>`
                        : ""
                    }
                </div>

                ${
                  hasImage
                    ? `<div class="mb-2 mt-0"><div class="relative inline-block"><img src="${imgSrc}" alt="${task.name}" class="task-image w-full h-auto rounded-lg cursor-pointer hover:opacity-90 transition-opacity" data-image-src="${imgSrc}" data-image-name="${task.name}" style="${task.w && task.h ? `aspect-ratio: ${task.w} / ${task.h};` : `min-height: 150px;`} background-color: #f3f4f6;"></div></div>`
                    : ""
                }

                <div class="mb-2">
                    <div class="flex justify-between items-center gap-2">
                        <span class="text-base text-stone-600 flex-shrink-0">耗时:</span>
                        <div class="used-hours-control flex items-center gap-2 flex-1 min-w-0">
                            <button type="button" class="decrement-hours-btn w-7 h-7 flex items-center justify-center rounded border hover:bg-stone-100" data-task-id="${task.id}" aria-label="减少1小时" style="border-color: ${headerBg};">
                                <span class="material-icons text-sm">remove</span>
                            </button>
                            <input 
                                type="number" 
                                class="used-hours-input flex-1 w-full min-w-0 p-1 border rounded text-sm text-stone-800 text-center"
                                data-task-id="${task.id}"
                                value="${task.actualHours || 0}"
                                min="0"
                                style="border-color: ${headerBg};"
                            >
                            <button type="button" class="increment-hours-btn w-7 h-7 flex items-center justify-center rounded border hover:bg-stone-100" data-task-id="${task.id}" aria-label="增加1小时" style="border-color: ${headerBg};">
                                <span class="material-icons text-sm">add</span>
                            </button>
                        </div>
                        <span class="text-base text-stone-600 flex-shrink-0">小时</span>
                    </div>

                    <div class="flex-1 bg-stone-200 rounded-full h-3 overflow-hidden mt-2">
                        <div 
                            class="progress-bar h-full rounded-full transition-all duration-300" data-level="${progressLevel}" 
                            style="width: ${progressPercentage}%"
                        ></div>
                    </div>
                </div>

                ${
                  hasNodes
                    ? `<div class="mt-3 mb-3"><div class="text-sm text-stone-600 mb-2">任务节点</div><div class="space-y-1">${task.nodes
                        .map((node) => {
                          const pres = getNodePresentation(node);
                          const { icon, textClass, iconClass, background } = pres;
                          const bgStyle = background ? `background:${background};` : "";
                          const colorVar = textClass ? `color:var(--color-${textClass.replace(/^text-/,"")}, inherit);` : "";
                          return `<div class="node-item ${
                            node.completed ? "completed" : ""
                          } ${
                            !node.completed && !task.completed ? "active" : ""
                          } pl-3 py-1 rounded" data-node="${
                            node.name
                          }" style="${bgStyle}${colorVar}"><label class="flex items-center cursor-pointer gap-1" data-testid="node-${
                            task.id
                          }-${node.id}"><input type="checkbox" class="node-checkbox mr-2" ${
                            node.completed ? "checked" : ""
                          } data-task-id="${
                            task.id
                          }" data-node-id="${
                            node.id
                          }">${
                            icon
                              ? `<span class="${iconClass} text-sm ${textClass}">${icon}</span>`
                              : ""
                          }<span class="text-sm ${
                            node.completed ? "line-through" : ""
                          } node-name">${node.name}</span></label></div>`;
                        })
                        .join("")}</div></div>`
                    : ""
                }

                ${getTimerButton(task)}
            </div>
            </div>
        `;
  };

  // ═══════════════════════════════════════
  // 计时器（任务卡片上的秒表按钮）
  // 状态机与暂停/恢复的数据变更放在这里，MainView 与 BarView 共用，
  // 两个视图只负责各自的按钮 HTML、结束计时对话框与刷新回调。
  // ═══════════════════════════════════════

  const getTimerIcon = (running) => (running ? "stop" : "timer");

  const getTimerLabel = (running, hasActualStart = false, paused = false) => {
    if (running) return "结束画画计时";
    if (paused) return "继续委托并计时";
    return hasActualStart ? "开始画画计时" : "开始首次画画计时";
  };

  /** 计时状态机：同一时刻只允许一个任务在计时 */
  class TaskTimer {
    constructor(options = {}) {
      this.now = options.now || (() => Date.now());
      this.taskId = null;
      this.startTime = null;
      this.interval = null;
    }

    /** 当前正在计时的任务 id，没有则为 null */
    get runningTaskId() {
      return this.interval !== null ? this.taskId : null;
    }

    isRunning(taskId) {
      return this.taskId === taskId && this.interval !== null;
    }

    /** 开始计时；已有计时在进行时返回 false */
    start(taskId) {
      if (this.interval !== null) return false;
      this.taskId = taskId;
      this.startTime = this.now();
      this.interval = setInterval(() => {}, 1000);
      return true;
    }

    /** 结束计时，返回本次小时数；不在计时则返回 null */
    stop(taskId) {
      if (this.taskId !== taskId || this.interval === null) return null;
      const elapsedMs = this.now() - this.startTime;
      clearInterval(this.interval);
      this.interval = null;
      this.taskId = null;
      this.startTime = null;
      return Math.round(elapsedMs / 1000) / 3600;
    }

    /** 丢弃当前计时（不结算工时），用于页面重新加载 */
    reset() {
      if (this.interval !== null) clearInterval(this.interval);
      this.interval = null;
      this.taskId = null;
      this.startTime = null;
    }
  }

  /** 按原值形态写回：带时刻写 ISO UTC，纯日期保持纯日期 */
  const writeDatePreservingForm = (dateObj, original) =>
    time.hasExplicitTime(original)
      ? time.formatForStorage(dateObj)
      : time.formatDate(dateObj);

  /** 把日期挪到 target 那天，时分秒沿用原值 */
  const moveToDay = (value, target) => {
    const p = time.parts(value);
    const t = time.parts(target);
    if (!p || !t) return value;
    return writeDatePreservingForm(
      time.make(t.year, t.month, t.day, p.hour, p.minute, p.second),
      value
    );
  };

  /**
   * 暂停延期（锚点模型）
   *
   * `pauseLastExtendDate` 记录「本次暂停已经延到哪一天」。每次只把
   * 「今天 − 锚点」的差额追加到当前 deadline，再推进锚点：
   *   - 同一天反复调用：差额为 0，无副作用
   *   - 用户手改 deadline：新值即新起点，不会被基准覆盖
   *   - 多日未打开：一次补齐全部差额
   *
   * 返回是否发生改动（调用方据此决定是否落盘）
   */
  const applyPauseExtension = (task, now = new Date()) => {
    if (!task || !task.paused || task.completed || task.abandoned) return false;
    const today = time.toDateOnly(now);
    if (!today) return false;
    let changed = false;
    // 老数据没有锚点：以今天为起点，不补历史
    if (!task.pauseLastExtendDate) {
      task.pauseLastExtendDate = time.formatDate(today);
      changed = true;
    } else {
      // 按「今天 − 锚点」的差额追加，然后推进锚点
      const diff = time.daysBetween(task.pauseLastExtendDate, today);
      if (diff > 0) {
        const base = time.parse(task.deadline);
        if (base) {
          task.deadline = writeDatePreservingForm(time.addDays(base, diff), task.deadline);
        }
        task.pauseLastExtendDate = time.formatDate(today);
        changed = true;
      }
    }
    // 不变式：暂停期间不算逾期，截止日不得早于今天
    const current = time.parse(task.deadline);
    if (current && time.daysBetween(current, today) > 0) {
      task.deadline = moveToDay(task.deadline, today);
      changed = true;
    }
    return changed;
  };

  /**
   * 暂停委托（只改任务数据，不碰 UI）
   *
   * 锚点从这里开始计：暂停当天不延，第二天起每天 +1。
   */
  const pauseTaskData = (task, now = new Date()) => {
    if (!task) return false;
    task.paused = true;
    task.pausedAt = now.toISOString();
    const today = time.toDateOnly(now);
    task.pauseLastExtendDate = today
      ? time.formatDate(today)
      : time.formatDate(now);
    if (!Array.isArray(task.pauseHistory)) task.pauseHistory = [];
    task.pauseHistory.push({ pausedAt: task.pausedAt });
    return true;
  };

  /**
   * 恢复委托（只改任务数据，不碰 UI），返回本次暂停的毫秒数
   */
  const resumeTaskData = (task, now = new Date()) => {
    if (!task || !task.paused) return null;
    // 先把当天该延的天数补齐，再结算，保证暂停期间的每一天都被计入
    applyPauseExtension(task, now);
    const pausedAt = time.parse(task.pausedAt);
    if (!pausedAt) return null;
    const pausedMs = now.getTime() - pausedAt.getTime();
    task.totalPausedDays = (task.totalPausedDays || 0) + pausedMs / 86400000;
    task.pauseLastExtendDate = undefined;
    task.pausePreDeadline = undefined;
    // 回填本次暂停的恢复时间
    if (Array.isArray(task.pauseHistory) && task.pauseHistory.length > 0) {
      const last = task.pauseHistory[task.pauseHistory.length - 1];
      if (!last.resumedAt) last.resumedAt = now.toISOString();
    }
    task.paused = false;
    task.pausedAt = null;
    return pausedMs;
  };

  /**
   * 计时结束对话框：让用户确认或修改本次工时。
   *
   * 只负责 UI，持久化交给调用方在 onConfirm 里做——两个视图保存流程不同，
   * 但「长什么样、怎么校验输入」必须一致。
   *
   * @param {{name: string}} task
   * @param {number} durationInHours
   * @param {{onConfirm?: (hours: number) => void|Promise<void>, onCancel?: () => void}} handlers
   */
  const showTimerDurationDialog = (task, durationInHours, handlers = {}) => {
    const onConfirm = handlers.onConfirm;
    const onCancel = handlers.onCancel || (() => {});
    const hours = Math.floor(durationInHours);
    const minutes = Math.round((durationInHours - hours) * 60);

    const dialogEl = document.createElement("div");
    dialogEl.className = "fixed inset-0 z-50 flex items-center justify-center p-4";
    dialogEl.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
    dialogEl.innerHTML = `
            <div class="bg-white rounded-xl p-6 max-w-sm w-full">
                <div class="mb-4">
                    <h3 class="text-lg font-semibold text-stone-800 mb-2">计时结束</h3>
                    <p class="text-stone-600 mb-3">任务"${task.name}"的计时时长</p>
                    <div class="flex items-center gap-2">
                           <input type="number" id="timer-hours" class="w-20 px-3 py-2 border border-stone-300 rounded-lg focus:outline-none" 
                               value="${hours}" min="0" max="999" data-testid="timer-hours-input">
                        <span class="text-stone-600">小时</span>
                           <input type="number" id="timer-minutes" class="w-20 px-3 py-2 border border-stone-300 rounded-lg focus:outline-none" 
                               value="${minutes}" min="0" max="59" data-testid="timer-minutes-input">
                        <span class="text-stone-600">分钟</span>
                    </div>
                </div>
                <div class="flex gap-3">
                    <button class="timer-cancel flex-1 px-4 py-2 border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors" data-testid="timer-cancel-btn">
                        取消
                    </button>
                    <button class="timer-save flex-1 px-4 py-2 btn-save" data-testid="timer-save-btn">
                      保存
                    </button>
                </div>
            </div>
        `;

    const close = () => {
      if (document.body.contains(dialogEl)) document.body.removeChild(dialogEl);
    };

    document.body.appendChild(dialogEl);

    dialogEl.querySelector(".timer-cancel").addEventListener("click", () => {
      close();
      onCancel();
    });

    dialogEl.querySelector(".timer-save").addEventListener("click", async () => {
      try {
        const h = parseFloat(dialogEl.querySelector("#timer-hours").value) || 0;
        const m = parseFloat(dialogEl.querySelector("#timer-minutes").value) || 0;
        const totalHours = h + m / 60;
        if (totalHours > 0 && onConfirm) await onConfirm(totalHours);
      } catch (err) {
        console.error("timer dialog confirm error:", err);
      } finally {
        close();
      }
    });

    dialogEl.addEventListener("click", (e) => {
      if (e.target === dialogEl) {
        close();
        onCancel();
      }
    });
  };

  window.taskCardShared = {
    createTaskCardHtml,
    // 卡片数据辅助
    getPaymentStatusInfo,
    getTaskNetIncomeForStats,
    getTimerButtonHtml,
    // 计时器
    TaskTimer,
    getTimerIcon,
    getTimerLabel,
    applyPauseExtension,
    pauseTaskData,
    resumeTaskData,
    // 计时结束对话框（两个视图共用）
    showTimerDurationDialog,
  };
})();
