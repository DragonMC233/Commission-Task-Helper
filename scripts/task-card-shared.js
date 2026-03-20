(() => {
  const getDaysRemaining = (deadline) => {
    if (!deadline) return null;
    const now = new Date();
    const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const deadlineDate = new Date(deadline);
    const deadlineDateOnly = new Date(
      deadlineDate.getFullYear(),
      deadlineDate.getMonth(),
      deadlineDate.getDate()
    );
    return Math.ceil((deadlineDateOnly - nowDate) / (1000 * 60 * 60 * 24));
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
    const deadlineDate = new Date(deadline);
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
    // 收款状态计算（内联辅助函数）
    const _getPaymentInfo = (t) => {
      if (!t) return null;
      if (t.abandoned) return { label: '已废弃', variant: 'abandoned' };
      const contracted = Number(t.payment) || 0;
      const records = Array.isArray(t.paymentRecords) ? t.paymentRecords : [];
      const mode = t.paymentMode || '';
      if (mode === 'free') return { label: '免费', variant: 'free' };
      if (!contracted && records.length === 0 && !mode) return null;
      const received = records.filter(r => r.type !== 'refund').reduce((s, r) => s + (Number(r.amount)||0), 0);
      const refunded = records.filter(r => r.type === 'refund').reduce((s, r) => s + (Number(r.amount)||0), 0);
      const net = received - refunded;
      const hasRefund = refunded > 0;
      const modeLabels = { full_pre: '全款先付', full_post: '全款后付', deposit: '定金+尾款', milestone: '节点付款' };
      const modeLabel = modeLabels[mode] || '';
      if (records.length === 0) return modeLabel ? { label: modeLabel + '·待收', variant: 'pending' } : null;
      if (received > 0 && net <= 0) return { label: '全额退款', variant: 'refunded' };
      if (contracted > 0 && net >= contracted) return { label: `¥${net.toFixed(0)} 已全收${hasRefund ? '(含退款)' : ''}`, variant: 'paid-full' };
      if (net > 0) return { label: `¥${net.toFixed(0)}/${contracted > 0 ? '¥'+contracted.toFixed(0) : '?'}${hasRefund ? '(含退款)' : ''}`, variant: 'paid-partial' };
      return { label: '未收款', variant: 'pending' };
    };
    const paymentInfo = _getPaymentInfo(task);
    const netIncome = (() => {
      const records = task.paymentRecords;
      if (!Array.isArray(records) || records.length === 0) return Number(task.payment) || 0;
      return Math.max(0, records.reduce((sum, r) => r.type === 'refund' ? sum - (Number(r.amount)||0) : sum + (Number(r.amount)||0), 0));
    })();
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

    // normalize image src for pages served under subpaths (BarView)
    let imgSrc = task.image;
    if (typeof imgSrc === 'string') {
      // convert './recyclepic/..' or 'recyclepic/..' -> '/recyclepic/...', keep absolute or http(s) as-is
      if (/^\.?\/?(pic|recyclepic)\//.test(imgSrc) && !imgSrc.startsWith('/') && !/^https?:\/\//.test(imgSrc)) {
        imgSrc = '/' + imgSrc.replace(/^\.?\/*/, '');
      }
    }

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
                                : `<button class="flex items-center delete-btn" data-task-id="${task.id}" data-testid="delete-btn-${task.id}"><span class="material-icons text-sm scale-102">delete</span></button>`
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

  window.taskCardShared = { createTaskCardHtml };
})();
