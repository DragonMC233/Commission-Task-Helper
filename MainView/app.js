//3.1.2
class TaskManager {
  // ✅ 初始化横竖屏检测//
  initOrientationDetection() {
    const container = document.getElementById("container");

    const checkOrientation = () => {
      const isLandscapeNow = window.innerWidth > window.innerHeight;

      if (this.isLandscape !== isLandscapeNow) {
        this.isLandscape = isLandscapeNow;

        // ✅ 在这里添加布局切换
        if (this.isLandscape) {
          container.classList.add("landscape-layout");
          container.classList.remove("portrait-layout");
        } else {
          container.classList.add("portrait-layout");
          container.classList.remove("landscape-layout");
        }

        // ✅ 重新渲染任务（让 Masonry 或竖屏布局生效）
        this.renderTasks();
      }
    };

    // ✅ 页面加载时立即执行一次
    checkOrientation();

    // ✅ 监听横竖屏变化
    window.addEventListener("resize", checkOrientation);
    window.addEventListener("orientationchange", checkOrientation);
  }

  // 显示任务预览卡片（centered overlay），保留卡片内的编辑功能
  showTaskPreview(taskId) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return;
    // 按需设置全局 opaxxx
    try {
      window.opaxxx = 1;
    } catch (e) {
      console.warn("设置 window.opaxxx 失败", e);
    }

    // 移除已有的覆盖层（若存在）
    const existing = document.getElementById("task-preview-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "task-preview-overlay";
    overlay.className = "task-preview-overlay";

    // 创建居中的卡片容器
    const wrapper = document.createElement("div");
    wrapper.className = "task-preview-wrapper";

    // 使用现有的 createTaskCard 生成的 HTML
    wrapper.innerHTML = this.createTaskCard(task);

    // 如果是已完成任务，在预览中强制显示（覆盖 .task-card.completed 的隐藏样式）
    try {
      const previewCard = wrapper.querySelector(".task-card");
      if (previewCard && previewCard.classList.contains("completed")) {
        previewCard.classList.add("preview-visible");
      }
    } catch (e) {
      /* ignore */
    }

    // 追加并显示
    overlay.appendChild(wrapper);
    document.body.appendChild(overlay);

    // 点击卡片外部关闭覆盖层（包括 wrapper 的内边距区域）
    overlay.addEventListener("click", (ev) => {
      const clickedCard = ev.target.closest && ev.target.closest(".task-card");
      if (!clickedCard) {
        overlay.remove();
      }
    });
    // 同样：如果用户点击 wrapper 区域（非卡片），也关闭
    wrapper.addEventListener("click", (ev) => {
      const clickedCard = ev.target.closest && ev.target.closest(".task-card");
      if (!clickedCard) {
        overlay.remove();
      }
    });

    // 代理预览内的点击以支持编辑/删除/切换等操作
    wrapper.addEventListener("click", (ev) => {
      const target = ev.target;
      const card = target.closest(".task-card");
      if (!card) return;
      const currentId =
        parseInt(card.dataset.taskId, 10) ||
        parseInt(target.dataset.taskId, 10) ||
        taskId;

      const editBtn = target.closest(".edit-btn");
      if (editBtn) {
        const id = parseInt(editBtn.dataset.taskId, 10) || currentId;
        this.showModal(id);
        return;
      }
      const restoreBtn = target.closest(".restore-btn");
      if (restoreBtn) {
        const id = parseInt(restoreBtn.dataset.taskId, 10) || currentId;
        this.restoreTask(id);
        overlay.remove();
        return;
      }
      const deleteBtn = target.closest(".delete-btn");
      if (deleteBtn) {
        const id = parseInt(deleteBtn.dataset.taskId, 10) || currentId;
        if (this.showingRecycleBin) {
          this.showConfirmDialog(
            "确定要永久删除该任务吗？此操作不可恢复。",
            () => {
              this.deleteTask(id);
              overlay.remove();
            }
          );
        } else {
          if (this.confirmDeleteOnRemove) {
            this.showConfirmDialog("确定要删除该任务并移动到回收站吗？", () => {
              this.deleteTask(id);
              overlay.remove();
            });
          } else {
            this.deleteTask(id);
            overlay.remove();
          }
        }
        return;
      }
      const completeArea = target.closest(".task-complete-area");
      if (completeArea) {
        const id = parseInt(completeArea.dataset.taskId, 10) || currentId;
        this.toggleComplete(id);
        return;
      }

      const incBtn = target.closest(".increment-hours-btn");
      if (incBtn) {
        const id = parseInt(incBtn.dataset.taskId, 10) || currentId;
        this.adjustHours(id, 1);
        return;
      }
      const decBtn = target.closest(".decrement-hours-btn");
      if (decBtn) {
        const id = parseInt(decBtn.dataset.taskId, 10) || currentId;
        this.adjustHours(id, -1);
        return;
      }
      const adjustBtn = target.closest("[data-adjust-hours]");
      if (adjustBtn) {
        const hoursChange = parseFloat(adjustBtn.dataset.adjustHours);
        this.adjustHours(currentId, hoursChange);
        return;
      }
      const timerBtn = target.closest(".timer-btn");
      if (timerBtn) {
        this.toggleTimer(currentId);
        return;
      }
      const pauseBtn = target.closest(".pause-btn");
      if (pauseBtn) {
        this.togglePause(currentId);
        return;
      }
    });

    // 确保预览中的输入变更（如耗时输入框）也会被处理
    wrapper.addEventListener("change", this._taskListChangeHandler);
  }

  refreshTaskPreviewIfOpen(taskId) {
    const overlay = document.getElementById("task-preview-overlay");
    if (!overlay) return;
    const wrapper = overlay.querySelector(".task-preview-wrapper");
    if (!wrapper) return;
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return;
    wrapper.innerHTML = this.createTaskCard(task);
    const previewCard = wrapper.querySelector(".task-card");
    if (previewCard && previewCard.classList.contains("completed")) {
      previewCard.classList.add("preview-visible");
    }
  }
  // 统一的 task list click 处理（事件委托）
  _onTaskListClick(e) {
    const target = e.target;

    // 获取任务卡片的 ID
    const taskCard = target.closest(".task-card");
    if (!taskCard) return;
    const taskId = parseInt(taskCard.dataset.taskId);

    // 编辑按钮
    if (target.closest(".edit-btn")) {
      this.showModal(taskId);
      return;
    }

    // 删除按钮
    if (target.closest(".delete-btn")) {
      // 在回收站视图中，删除为永久删除，需确认
      if (this.showingRecycleBin) {
        this.showConfirmDialog(
          "确定要永久删除该任务吗？此操作不可恢复。",
          () => {
            this.deleteTask(taskId);
          }
        );
      } else {
        // 正常视图：根据页面设置决定是否弹出确认
        if (this.confirmDeleteOnRemove) {
          this.showConfirmDialog("确定要删除该任务并移动到回收站吗？", () => {
            this.deleteTask(taskId);
          });
        } else {
          // 直接移动到回收站（不弹窗）
          this.deleteTask(taskId);
        }
      }
      return;
    }

    // 恢复按钮（仅在回收站视图显示）
    if (target.closest(".restore-btn")) {
      this.restoreTask(taskId);
      return;
    }

    // 完成按钮
    if (target.closest(".task-complete-area")) {
      this.toggleComplete(taskId);
      return;
    }

    // 计时按钮
    if (target.closest(".timer-btn")) {
      this.toggleTimer(taskId);
      return;
    }

    // 暂停/恢复委托按钮
    if (target.closest(".pause-btn")) {
      this.togglePause(taskId);
      return;
    }

    // 增减耗时按钮（外部箭头）
    const incBtn = target.closest(".increment-hours-btn");
    if (incBtn) {
      const id = parseInt(incBtn.dataset.taskId);
      this.adjustHours(id, 1);
      return;
    }
    const decBtn = target.closest(".decrement-hours-btn");
    if (decBtn) {
      const id = parseInt(decBtn.dataset.taskId);
      this.adjustHours(id, -1);
      return;
    }

    // 调整工时按钮
    const adjustBtn = target.closest("[data-adjust-hours]");
    if (adjustBtn) {
      const hoursChange = parseFloat(adjustBtn.dataset.adjustHours);
      this.adjustHours(taskId, hoursChange);
      return;
    }

    // 节点切换
    const nodeCheckbox = target.closest(".node-checkbox");
    if (nodeCheckbox) {
      const nodeId = parseInt(nodeCheckbox.dataset.nodeId);
      this.toggleNodeComplete(taskId, nodeId);
      return;
    }
  }
  _onTaskListChange(e) {
    const input = e.target;

    // 已用工时输入框
    if (input.classList && input.classList.contains("used-hours-input")) {
      const taskId = parseInt(input.dataset.taskId);
      const value = parseFloat(input.value) || 0;
      const task = this.tasks.find((t) => t.id === taskId);
      if (task) {
        task.actualHours = value;
        task.progress = task.estimatedHours
          ? Math.min(100, Math.round((value / task.estimatedHours) * 100))
          : 0;
        if (task.completed) {
          task.completedHours = task.actualHours;
          this.recordCompletionStatistics(task);
        }

        this.saveAllData();
        this.updateStats();
        this.updateSmartRecommendations();
        this.renderTasks(taskId);
        this.updateMonthlyStatsDisplay();
        this.refreshTaskPreviewIfOpen(taskId);
      }
    }
  }
  _onDocumentClick(e) {
    const target = e.target;

    // 若搜索面板打开且点击在其外部，则根据 pointerdown 标志决定是否关闭搜索面板
    if (this._searchOpen) {
      const wrap = document.querySelector(".types-search-wrap");
      if (wrap && !wrap.contains(target)) {
        // 如果按下（pointerdown）是从搜索面板内开始的（例如拖选文字），
        // 那么忽略这次外部点击以避免误关闭；否则正常关闭。
        if (this._searchPointerDownInside) {
          this._searchPointerDownInside = false;
        } else {
          try {
            this._closeSearch();
          } catch (err) {}
        }
      }
    }

    // 点击日程条弹出预览卡片（非编辑）
    const bar = target.closest && target.closest(".calendar-timeline-bar");
    if (bar) {
      const tid = bar.dataset.taskId || bar.getAttribute("data-task-id");
      const taskId = tid ? parseInt(tid, 10) : null;
      if (taskId) {
        e.preventDefault();
        try {
          this.showTaskPreview(taskId);
        } catch (err) {
          console.warn("showTaskPreview error", err);
        }
        return;
      }
    }
  }

  //Masonry layout函数
  // ✅ 修改：接收已计算好的 cardWidth，避免重复计算导致的浏览器差异

  calculateMasonryLayout(container, cards, gap, cardWidth) {
    const containerWidth = container.clientWidth;
    const columnCount = Math.max(
      1,
      Math.floor((containerWidth + gap) / (cardWidth + gap))
    );
    const columnHeights = Array(columnCount).fill(0);

    // 1. 先算出坐标数组
    const layoutArray = cards.map((card) => {
      const minHeightIndex = columnHeights.indexOf(Math.min(...columnHeights));
      const left = minHeightIndex * (cardWidth + gap);
      const top = columnHeights[minHeightIndex];
      const cardHeight = card.offsetHeight;
      columnHeights[minHeightIndex] += cardHeight + gap;

      return {
        left: left,
        top: top,
        width: cardWidth,
        height: cardHeight,
      };
    });

    // ✅ 返回坐标数组
    return {
      layout: layoutArray,
      cardWidth: cardWidth,
      columnCount: columnCount,
    };
  }
  // ✅ 瀑布流布局函数
  // ✅ 瀑布流布局函数 - 蜘蛛纸牌版
  // ✅ 瀑布流布局函数 - 终极修复版
  async applyMasonryLayout(isResize = false) {
    // 等一帧，确保浏览器完成样式计算与布局
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const container = document.getElementById("task-list");
    if (!container) return;

    // 保证定位上下文
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }

    const cards = Array.from(container.querySelectorAll(".task-card"));
    if (cards.length === 0) {
      container.style.height = "auto";
      return;
    }

    const gap = 20;
    // Safari 浏览器需要更小的最小卡片宽度以改善布局（用户代理检测）
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const minCard = isSafari ? 285 : 310;
    const maxCard = 435;

    // 测量可用宽度（使用 clientWidth 更稳定）
    const renderedWidth = Math.floor(
      container.clientWidth || container.getBoundingClientRect().width
    );
    const cs = getComputedStyle(container);
    const paddingLeft = Math.floor(parseFloat(cs.paddingLeft) || 0);
    const paddingRight = Math.floor(parseFloat(cs.paddingRight) || 0);
    const usableWidth = Math.max(0, renderedWidth - paddingLeft - paddingRight);

    // 计算列数与卡片宽度
    const columnCount = Math.max(
      1,
      Math.floor((usableWidth + gap) / (minCard + gap))
    );
    const cardWidth = Math.max(
      100,
      Math.min(
        maxCard,
        Math.floor((usableWidth - gap * (columnCount - 1)) / columnCount)
      )
    );

    // 先写入宽度与基础样式（立即生效，避免首次渲染堆叠）
    const shouldPlayIntro = !this._hasPerformedMasonryIntro && !isResize;
    cards.forEach((card) => {
      card.style.boxSizing = "border-box";
      card.style.width = `${cardWidth}px`;
      card.style.minWidth = `${cardWidth}px`;
      card.style.maxWidth = `${cardWidth}px`;
      card.style.position = "absolute";
      if (shouldPlayIntro) {
        card.classList.remove("is-laid-out");
        card.style.opacity = "";
        card.style.setProperty("--tx", "0px");
        card.style.setProperty("--ty", "0px");
        card.style.transitionDelay = "";
      }
    });

    // 计算布局坐标（使用现有的 calculateMasonryLayout）
    const result = this.calculateMasonryLayout(
      container,
      cards,
      gap,
      cardWidth
    );
    const layout = result && result.layout ? result.layout : null;
    if (!layout || layout.length !== cards.length) {
      this.scheduleMasonryLayout(100, isResize);
      return;
    }

    // 立即写入位置并用 transitionDelay 实现分发动画
    cards.forEach((card, index) => {
      const pos = layout[index];
      if (!pos) return;
      card.style.setProperty("--tx", `${pos.left}px`);
      card.style.setProperty("--ty", `${pos.top}px`);
      card.style.zIndex = String(Math.max(1, 21 - index));
      const delay = isResize || !shouldPlayIntro ? "0ms" : `${index * 60}ms`;
      card.style.transitionDelay = delay;
      card.classList.add("is-laid-out");
      card.style.opacity = "1";
    });

    // 更新容器高度
    const maxBottom = Math.max(...layout.map((p) => p.top + p.height));
    container.style.height = `${maxBottom + gap}px`;

    if (shouldPlayIntro) {
      this._hasPerformedMasonryIntro = true;
    }

    // 清理：resize 场景移除 transitionDelay
    if (isResize) {
      setTimeout(() => {
        cards.forEach((card) => {
          card.style.transitionDelay = "";
        });
      }, 300);
    }
  }

  // 去抖调度：在资源稳定后执行 masonry 布局
  scheduleMasonryLayout(delay = 50, isResize = true) {
    if (this._masonryLayoutTimer) clearTimeout(this._masonryLayoutTimer);
    this._masonryLayoutTimer = setTimeout(() => {
      this.applyMasonryLayout(isResize);
    }, delay);
  }
  // ✅ 检查服务器状态
  async checkServerOnline() {
    try {
      const res = await fetch("/load", {
        method: "GET",
        cache: "no-store",
      });
      this.serverOnline = res.ok;
    } catch (e) {
      this.serverOnline = false;
    }
    return this.serverOnline;
  }

  // ✅ 构造函数
  constructor() {
    this.tasks = [];
    this.hideCompleted = false;
    this.currentFilter = "all";
    this.tempNodes = [];
    this.tempPaymentRecords = [];
    this.presetNodes = [];
    this.taskTypes = [];
    this.sourcePlatforms = [];
    this._modalPresetNodes = null;
    this.recycleBin = [];
    this.showingRecycleBin = false; // 是否在管理界面查看回收站
    // 是否在主界面删除时弹出确认对话框（页面设置中可配置）
    this.confirmDeleteOnRemove = true;
    this.editingTaskId = null;
    this.currentDate = new Date();
    this.currentImageData = null;
    this.imageChanged = false;
    this.currentTimer = null;
    this.timerTaskId = null;
    this.timerStartTime = null;
    this.isLandscape = false;
    this.serverOnline = true;
    this._firstMasonryLayout = false; // ✅ 标志首次加载
    this._hasPerformedMasonryIntro = false;
    // 保存去抖与并发控制
    this._saveDebounceTimer = null;
    this._pendingSave = null; // 已调度保存的 Promise
    this._saveInProgress = null; // 正在进行保存的 Promise
    this.statistics = { version: 1, types: {} };
    this.statisticsMaxSamples = 10;
    // 统一的 task-list click handler（在 constructor 中绑定引用，init 时只注册一次）
    this._taskListClickHandler = this._onTaskListClick.bind(this);
    // 统一的 task list change handler（用于处理输入框 change 事件）
    this._taskListChangeHandler = this._onTaskListChange.bind(this);
    // document 级别的委托处理（用于类似 preset-node-btn 的按钮）
    this._documentClickHandler = this._onDocumentClick.bind(this);
    // 搜索状态与查询（默认清空）
    this.searchQuery = "";
    this._searchOpen = false;
    this._searchDebounce = null;
    // 是否在任务类型/来源区域显示快捷添加输入框
    this.showQuickAddInputs = true;
    // 是否允许重复节点（默认允许）
    this.allowDuplicateNodes = true;
    // 暂停实时预览：每次加载自动将活跃暂停应用为 deadline 延期
    this.livePreviewCurrentPause = false;
    // HSV 可调上限（用于调试，取值范围 0..1）。
    // 在页面控制台修改 `window._hsvDebug.maxS` / `window._hsvDebug.maxV` 即可实时调整。
    this.hsvMaxS = 1;
    this.hsvMaxV = 1;
    window._hsvDebug = window._hsvDebug || {};
    window._hsvDebug.maxS = this.hsvMaxS;
    window._hsvDebug.maxV = this.hsvMaxV;
    // 卡片下半区与白色混合系数（0..1），默认 0.7（70%）
    this.cardBodyWhiteBlend = 0.7;
    // 预置的 Material 图标清单（用于节点图标选择器）
    // 延迟加载：仅在 UI 需要时或需要回退时加载 basetype，而不是页面初始化就读取
    this.materialIconCatalog = null;
    // 本地图标/符号表（懒加载）
    this.fontIconsPalette = [
      "outlined",
      "regular",
      "round",
      "sharp",
      "twotone",
    ];
    this.fontSymbolsPalette = ["outlined", "rounded", "sharp"];
    this.fontIconsMap = null;
    this.fontSymbolsMap = null;
    this._fontIconPromise = null;
    // requestAnimationFrame id 用于节流卡片背景更新
    this._pendingCardBgRaf = null;
    const savedCalendarMode =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("calendar-mode")
        : null;
    this.calendarMode =
      savedCalendarMode === "timeline" ? "timeline" : "deadline";
  }

  getDefaultPresetNodes() {
    // 如果 basetype 文件已加载，优先返回其中的 presets；否则返回空数组，允许用户完全自定义
    if (this._baseTypes && Array.isArray(this._baseTypes.presetNodes)) {
      return this._baseTypes.presetNodes;
    }
    return [];
  }

  getMaterialIconCatalog() {
    // 如果 basetype 已加载且包含 materialIconCatalog，则优先使用外部定义，便于跨平台/定制化
    if (this._baseTypes) {
      if (Array.isArray(this._baseTypes.materialIconCatalog))
        return this._baseTypes.materialIconCatalog;
      if (Array.isArray(this._baseTypes.icons)) return this._baseTypes.icons;
      if (Array.isArray(this._baseTypes.materialIcons))
        return this._baseTypes.materialIcons;
    }
    // basetype 未提供图标列表或 basetype 未加载 -> 按用户要求返回空数组（不回退到内置列表）
    return [];
  }

  normalizeIconSelection(iconPayload) {
    if (iconPayload && typeof iconPayload === "object") {
      const name = iconPayload.name || iconPayload.icon || "label";
      const group = iconPayload.group === "symbols" ? "symbols" : "icons";
      const fallbackStyle = group === "symbols" ? "outlined" : "regular";
      const palette =
        group === "symbols" ? this.fontSymbolsPalette : this.fontIconsPalette;
      const styleRaw = iconPayload.style || fallbackStyle;
      const style =
        palette && palette.includes(styleRaw) ? styleRaw : fallbackStyle;
      return { name, group, style };
    }
    return { name: iconPayload || "label", group: "icons", style: "regular" };
  }

  getIconClassForSource(group, style) {
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
  }

  normalizeIconNameForSearch(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  }

  expandCompactIconData(raw, defaultPalette) {
    if (!raw) return {};
    // 紧凑格式检测：要求 `palette` 为数组且 `groups` 为对象
    if (
      Array.isArray(raw.palette) &&
      raw.palette.length &&
      raw.groups &&
      typeof raw.groups === "object" &&
      !Array.isArray(raw.groups)
    ) {
      const palette = raw.palette;
      const result = {};
      Object.entries(raw.groups).forEach(([key, names]) => {
        // `names` must be an array of icon names; otherwise skip this group entry
        if (!Array.isArray(names)) return;
        const styles = String(key)
          .split(",")
          .map((idx) => palette[parseInt(idx, 10)])
          .filter(Boolean);
        names.forEach((name) => {
          const arr = result[name] || [];
          styles.forEach((s) => {
            if (!arr.includes(s)) arr.push(s);
          });
          result[name] = arr;
        });
      });
      return result;
    }
    // 普通映射回退
    if (typeof raw === "object" && !Array.isArray(raw)) {
      const out = {};
      Object.entries(raw).forEach(([name, styles]) => {
        out[name] = Array.isArray(styles) ? styles : [];
      });
      return out;
    }
    return {};
  }

  buildFontSearchIndex() {
    const out = [];
    const pushMap = (map, group) => {
      Object.entries(map || {}).forEach(([name, styles]) => {
        const norm = this.normalizeIconNameForSearch(name);
        (styles || []).forEach((style) => {
          out.push({ norm, name, group, style });
        });
      });
    };
    pushMap(this.fontIconsMap, "icons");
    pushMap(this.fontSymbolsMap, "symbols");
    this.fontSearchIndex = out;
  }

  async ensureFontIconCatalogs() {
    if (this._fontIconPromise) return this._fontIconPromise;
    this._fontIconPromise = (async () => {
      const fetchJson = async (path) => {
        const res = await fetch(path, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load ${path}`);
        return res.json();
      };
      try {
        const [iconsData, symbolsData] = await Promise.all([
          fetchJson("/font/icons.json"),
          fetchJson("/font/symbols.json"),
        ]);
        this.fontIconsMap = this.expandCompactIconData(
          iconsData,
          this.fontIconsPalette
        );
        this.fontSymbolsMap = this.expandCompactIconData(
          symbolsData,
          this.fontSymbolsPalette
        );
        this.buildFontSearchIndex();
      } catch (e) {
        console.warn("加载字体图标清单失败", e);
        this.fontIconsMap = this.fontIconsMap || {};
        this.fontSymbolsMap = this.fontSymbolsMap || {};
        this._fontIconPromise = null;
        throw e;
      }
    })();
    return this._fontIconPromise;
  }

  buildFontSearchResults(keyword) {
    const norm = this.normalizeIconNameForSearch(keyword);
    if (!norm) return [];
    const idx = this.fontSearchIndex || [];
    const results = [];
    for (const item of idx) {
      if (!item.norm.includes(norm)) continue;
      results.push({ name: item.name, group: item.group, style: item.style });
      if (results.length >= 400) break; // 限制结果以保护 DOM 大小
    }
    // 排序：先 icons，再 symbols；各内按名称和样式排序
    return results.sort((a, b) => {
      if (a.group !== b.group) return a.group === "icons" ? -1 : 1;
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return String(a.style || "").localeCompare(String(b.style || ""));
    });
  }

  //16进制转hsl
  hexToHsl(hex) { return window.taskUtils.hexToHsl(hex); }
  //自动配置字体颜色（委托到 taskUtils 共享实现）
  getNearestTailwindTextClass(hexColor) { return window.taskUtils.getNearestTailwindTextClass(hexColor); }
  // 预设委托节点定义转译
  normalizePresetNode(node) {
    if (!node) return null;
    const background = node.background || "#e5e7eb";
    const text = node.text || this.getNearestTailwindTextClass(background);
    const iconSelection = this.normalizeIconSelection({
      name: node.icon || "label",
      group: node.iconGroup,
      style: node.iconStyle,
    });
    const icon = iconSelection.name;
    const id = node.id || `preset-${Date.now()}`;
    const name = node.name || "未命名节点";
    return {
      id,
      name,
      background,
      icon,
      text,
      iconGroup: iconSelection.group,
      iconStyle: iconSelection.style,
    };
  }

  // 统一解析节点css属性：优先使用 presetNodes 的定义，否则回退到节点自身字段或默认值
  getNodePresentation(node) {
    const name = node && node.name;
    const id = node && node.id;
    const presetMatch = (this.presetNodes || []).find(
      (p) => (name && p.name === name) || (id && String(p.id) === String(id))
    );
    const background =
      presetMatch?.background || (node && node.background) || "";
    const iconSelection = this.normalizeIconSelection({
      name: presetMatch?.icon || (node && node.icon) || "label",
      group: presetMatch?.iconGroup || node?.iconGroup,
      style: presetMatch?.iconStyle || node?.iconStyle,
    });
    const icon = iconSelection.name;
    const textClass =
      presetMatch?.text ||
      (node && node.text) ||
      (node && node.textClass) ||
      this.getNearestTailwindTextClass(background);
    const iconClass = this.getIconClassForSource(
      iconSelection.group,
      iconSelection.style
    );
    return {
      presetMatch,
      icon,
      background,
      textClass,
      iconGroup: iconSelection.group,
      iconStyle: iconSelection.style,
      iconClass,
    };
  }

  // 根据预设节点生成对应的 CSS 规则（使用 data-node 属性），统一控制背景与文字颜色
  applyPresetNodeStyles(presetList) {
    const list = (
      presetList && presetList.length
        ? presetList
        : this.getDefaultPresetNodes()
    ).map((n) => this.normalizePresetNode(n));
    const tag =
      document.getElementById("preset-node-styles") ||
      (function () {
        const s = document.createElement("style");
        s.id = "preset-node-styles";
        document.head.appendChild(s);
        return s;
      })();
    tag.textContent = list
      .map((node) => {
        const name =
          typeof CSS !== "undefined" && CSS.escape
            ? CSS.escape(node.name)
            : (node.name || "").replace(/"/g, '\\"');
        const bg = node.background || "transparent";
        const tc = (node.text || this.getNearestTailwindTextClass(bg)).replace(
          /^text-/,
          ""
        );
        const color = `var(--color-${tc}, inherit)`;
        return `.preset-node-btn[data-node="${name}"], .node-item[data-node="${name}"]{background:${bg};color:${color}}`;
      })
      .join("\n");
  }

  // 加载项目根目录下的 basetype 定义（在 loadAllData 早期调用），供无服务数据时使用
  async loadBaseTypes() {
    if (this._baseTypes) return; // 已加载
    try {
      const res = await fetch("/basetype.json", { cache: "no-store" });
      if (!res.ok) throw new Error("basetype not found");
      const data = await res.json();
      this._baseTypes = data || null;
      return this._baseTypes;
    } catch (e) {
      // 忽略加载错误，保持回退逻辑
      console.warn("加载 basetype.json 失败", e);
      this._baseTypes = null;
    }
  }
  getSchemaUtils() {
    return typeof TaskSchemaUtils !== "undefined" ? TaskSchemaUtils : null;
  }
  normalizeTaskRecord(task = {}) {
    const utils = this.getSchemaUtils();
    if (utils && typeof utils.normalizeTaskRecord === "function") {
      return utils.normalizeTaskRecord(task);
    }
    const clone = { ...task };
    const startTimeValue =
      clone.startTime || clone.starttime || clone.startDate || clone.deadline || "";
    const dependencyType =
      clone.dependencyType === "line" || clone.dependency_type === "line"
        ? "line"
        : "none";
    const isLine = dependencyType === "line";
    const autoSchedule =
      typeof clone.autoSchedule === "boolean"
        ? clone.autoSchedule
        : typeof clone.auto_schedule === "boolean"
        ? clone.auto_schedule
        : isLine;
    const autoCalcEnd =
      typeof clone.autoCalcEnd === "boolean"
        ? clone.autoCalcEnd
        : typeof clone.auto_calc_end === "boolean"
        ? clone.auto_calc_end
        : false;
    const bufferDaysRaw =
      clone.bufferDays ?? clone.buffer_days ?? clone.bufferdays ?? clone.buffer;
    const bufferDaysNum = Number(bufferDaysRaw);
    const bufferDays =
      Number.isFinite(bufferDaysNum) && bufferDaysNum >= -1
        ? Math.round(bufferDaysNum)
        : 1;
    const lineTaskIdRaw =
      clone.lineTaskId ?? clone.line_task_id ?? clone.line_taskid;
    const lineTaskId =
      lineTaskIdRaw === undefined || lineTaskIdRaw === null || lineTaskIdRaw === ""
        ? null
        : Number.isFinite(Number(lineTaskIdRaw))
        ? Number(lineTaskIdRaw)
        : null;
    const estimatedDayRaw =
      clone.estimatedDay ?? clone.estimated_day ?? clone.estimatedday ?? 0;
    const estimatedDayNum = parseInt(estimatedDayRaw, 10);
    const estimatedDay =
      Number.isFinite(estimatedDayNum) && estimatedDayNum >= 0
        ? estimatedDayNum
        : 0;
    const actualStartTime =
      clone.actualStartTime || clone.actual_start_time || clone.actualstarttime || null;
    const normalizedNodes = Array.isArray(clone.nodes)
      ? clone.nodes.map((n) => ({
          id: n.id,
          name: n.name,
          completed: !!n.completed,
        }))
      : [];
    return {
      ...clone,
      startTime: startTimeValue,
      starttime: startTimeValue,
      deadline: clone.deadline || "",
      actualStartTime: actualStartTime || null,
      dependencyType,
      lineTaskId,
      autoSchedule,
      autoCalcEnd,
      estimatedDay,
      bufferDays,
      nodes: normalizedNodes,
    };
  }
  prepareTaskForSave(task = {}) {
    const utils = this.getSchemaUtils();
    if (utils && typeof utils.prepareTaskForSave === "function") {
      return utils.prepareTaskForSave(task);
    }
    const normalized = this.normalizeTaskRecord(task);
    const cleanedNodes = normalized.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      completed: !!n.completed,
    }));
    const {
      id,
      name,
      type,
      source,
      progress,
      estimatedHours,
      estimatedDay,
      payment,
      actualHours,
      completedHours,
      image,
      completed,
      createdAt,
      completedAt,
      actualStartTime,
      dependencyType,
      lineTaskId,
      autoSchedule,
      autoCalcEnd,
      bufferDays,
      w,
      h,
      startDate,
      nodes,
      abandoned,
      abandonedAt,
      paymentMode,
      paymentRecords,
      urgentA,
      paused, pausedAt, totalPausedDays, pauseHistory,
      // eslint-disable-next-line no-unused-vars
      __duration: _dur, __endDate: _end, __startDate: _start,
      ...rest
    } = normalized;

    const result = {
      name,
      ...(createdAt !== undefined ? { createdAt } : {}),
      completed,
      startTime: normalized.startTime || "",
      starttime: normalized.startTime || "",
      actualStartTime,
      deadline: normalized.deadline || "",
      completedAt,
      estimatedHours,
      completedHours,
      actualHours,
      bufferDays,
      dependencyType,
      estimatedDay: estimatedDay || 0,
      autoCalcEnd,
      autoSchedule,
      id,
      lineTaskId,
      source,
      type,
      image,
      nodes: cleanedNodes,
      payment,
      progress,
      w,
      h,
      ...rest,
    };
    // 额外字段按固定顺序追加，确保与 BarView 保存结果一致
    if (abandoned !== undefined) result.abandoned = abandoned;
    if (abandonedAt !== undefined) result.abandonedAt = abandonedAt;
    if (paymentMode !== undefined) result.paymentMode = paymentMode;
    if (paymentRecords !== undefined) result.paymentRecords = paymentRecords;
    if (urgentA !== undefined) result.urgentA = urgentA;
    if (paused !== undefined) result.paused = paused;
    if (pausedAt !== undefined) result.pausedAt = pausedAt;
    if (totalPausedDays !== undefined) result.totalPausedDays = totalPausedDays;
    if (pauseHistory !== undefined) result.pauseHistory = pauseHistory;
    if (task.pausePreDeadline !== undefined) result.pausePreDeadline = task.pausePreDeadline;
    // __duration/__endDate/__startDate 由 BarView 运行时计算，不持久化
    return result;
  }
  applyCompletionToggle(task) {
    const utils = this.getSchemaUtils();
    if (utils && typeof utils.applyCompletionToggle === "function") {
      return utils.applyCompletionToggle(task);
    }
    if (!task) return task;
    const nextCompleted = !task.completed;
    task.completed = nextCompleted;
    task.completedAt = nextCompleted ? new Date().toISOString() : null;
    return task;
  }
  formatDateTimeLocal(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return "";
    const Y = dateObj.getFullYear();
    const M = String(dateObj.getMonth() + 1).padStart(2, "0");
    const D = String(dateObj.getDate()).padStart(2, "0");
    const h = String(dateObj.getHours()).padStart(2, "0");
    const m = String(dateObj.getMinutes()).padStart(2, "0");
    return `${Y}-${M}-${D}T${h}:${m}`;
  }
  computeAutoStartTime(predecessorId, bufferDays = 1) {
    const prev = (this.tasks || []).find((t) => t.id === predecessorId);
    if (!prev) return null;
    const endBase = prev.completedAt || prev.deadline;
    if (!endBase) return null;
    let base = new Date(endBase);
    if (Number.isNaN(base.getTime())) return null;

    // 若前序任务尚未完成且其 deadline 已过，则以“今日（仅日期）”为基准，以保证后继不会被安排在过去
    // 注意：仅在 prev.completedAt 不存在且 prev.deadline 可解析并早于今日（日期粒度）时生效
    const today = new Date();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (!prev.completedAt && prev.deadline) {
      const dl = new Date(prev.deadline);
      if (!Number.isNaN(dl.getTime()) && dl < todayDate) {
        // 使用今日的日期作为基准，但保留原始 deadline 的时分（例如 23:59），以与现有时间粒度保持一致
        const newBase = new Date(todayDate.getTime());
        newBase.setHours(dl.getHours(), dl.getMinutes(), dl.getSeconds() || 0, 0);
        base = newBase;
      }
    }

    // 语义：bufferDays 表示“间隔天数”的直观语义
    // - bufferDays === -1 => 下一项在同一天开始（无缝衔接）
    // - bufferDays === 0  => 下一项在次日开始
    // - bufferDays === 1  => 下一项在次次日开始，依此类推
    const rawProvided = Number.isFinite(Number(bufferDays)) ? Math.round(Number(bufferDays)) : null;
    const raw = rawProvided === null ? 1 : Math.max(rawProvided, -1);
    const addDays = raw + 1; // mapping: -1->0, 0->1, 1->2, ...
    base.setDate(base.getDate() + addDays);
    return this.formatDateTimeLocal(base);
  }
  // 统计数据处理
  createEmptyStatistics() {
    return { version: 1, types: {} };
  }
  // 标准化单个统计样本
  normalizeStatisticsSample(sample) {
    if (!sample || typeof sample !== "object") return null;
    const endRaw = sample.completedAt || sample.completed_at || sample.end;
    const end = endRaw ? new Date(endRaw) : null;
    if (!end || Number.isNaN(end.getTime())) return null;
    const hours = Number(sample.hours);
    const requireDaysRaw = Number(sample.requireDays);
    const dailyHoursRaw = Number(sample.dailyHours);
    const requireDays = Number.isFinite(requireDaysRaw)
      ? Math.max(1, Math.round(requireDaysRaw))
      : null;
    const hoursValid = Number.isFinite(hours) && hours > 0;
    const dailyHours = Number.isFinite(dailyHoursRaw)
      ? dailyHoursRaw
      : hoursValid && requireDays
      ? hours / requireDays
      : null;
    if (!hoursValid || !requireDays || !dailyHours) return null;
    const sourceTaskId =
      sample.sourceTaskId || sample.source_task_id || sample.sourceTask || null;
    return {
      hours,
      requireDays,
      dailyHours,
      completedAt: end.toISOString(),
      sourceTaskId: sourceTaskId === undefined ? null : sourceTaskId,
    };
  }
  // 计算统计样本的加权平均值
  computeStatisticsAggregates(samples) {
    if (!Array.isArray(samples) || samples.length === 0) {
      return {
        avgDailyHours: null,
        avgRequireDays: null,
        avgCompletedHours: null,
        sampleCount: 0,
      };
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
      return {
        avgDailyHours: null,
        avgRequireDays: null,
        avgCompletedHours: null,
        sampleCount: 0,
      };
    }
    return {
      avgDailyHours: sumDaily / weightSum,
      avgRequireDays: sumDays / weightSum,
      avgCompletedHours: sumHours / weightSum,
      sampleCount: samples.length,
    };
  }
  // 统计数据标准化
  normalizeStatistics(raw) {
    const stats = this.createEmptyStatistics();
    if (!raw || typeof raw !== "object") return stats;
    stats.version = Number.isFinite(raw.version) ? raw.version : 1;
    const types = raw.types && typeof raw.types === "object" ? raw.types : {};
    Object.entries(types).forEach(([typeId, entry]) => {
      const samplesRaw = Array.isArray(entry.samples) ? entry.samples : [];
      const normalizedSamples = samplesRaw
        .map((s) => this.normalizeStatisticsSample(s))
        .filter(Boolean)
        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
        .slice(0, this.statisticsMaxSamples);
      const agg = this.computeStatisticsAggregates(normalizedSamples);
      stats.types[typeId] = {
        samples: normalizedSamples,
        avgDailyHours: Number.isFinite(entry.avgDailyHours)
          ? entry.avgDailyHours
          : agg.avgDailyHours,
        avgRequireDays: Number.isFinite(entry.avgRequireDays)
          ? entry.avgRequireDays
          : agg.avgRequireDays,
        avgCompletedHours: Number.isFinite(entry.avgCompletedHours)
          ? entry.avgCompletedHours
          : agg.avgCompletedHours,
        sampleCount:
          entry.sampleCount || agg.sampleCount || normalizedSamples.length,
        updatedAt: entry.updatedAt || null,
      };
    });
    return stats;
  }
  isStatisticsEmpty(stats) {
    return !stats || !stats.types || Object.keys(stats.types).length === 0;
  }
  upsertStatisticsSample(taskType, sample) {
    if (!taskType || !sample) return null;
    if (!this.statistics || typeof this.statistics !== "object") {
      this.statistics = this.createEmptyStatistics();
    }
    const types = this.statistics.types || {};
    const existing = types[taskType] || { samples: [] };
    const samples = Array.isArray(existing.samples) ? [...existing.samples] : [];
    // 如果 sample 包含源任务 ID，则尝试替换已有同源样本以避免重复
    const srcId = sample && (sample.sourceTaskId || sample.source_task_id || sample.sourceTask);
    if (srcId !== null && srcId !== undefined) {
      const idx = samples.findIndex((s) => s && (s.sourceTaskId || s.source_task_id || s.sourceTask) == srcId);
      if (idx >= 0) {
        samples[idx] = sample;
      } else {
        samples.push(sample);
      }
    } else {
      // 否则直接追加（兼容旧样本）
      samples.push(sample);
    }
    samples.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    const trimmed = samples.slice(0, this.statisticsMaxSamples);
    const agg = this.computeStatisticsAggregates(trimmed);
    types[taskType] = {
      samples: trimmed,
      avgDailyHours: agg.avgDailyHours,
      avgRequireDays: agg.avgRequireDays,
      avgCompletedHours: agg.avgCompletedHours,
      sampleCount: agg.sampleCount,
      updatedAt: new Date().toISOString(),
    };
    this.statistics.version = this.statistics.version || 1;
    this.statistics.types = types;
    return types[taskType];
  }

  removeStatisticsSample(taskType, sourceTaskId) {
    if (!taskType || sourceTaskId === null || sourceTaskId === undefined)
      return null;
    if (!this.statistics || !this.statistics.types) return null;
    const entry = this.statistics.types[taskType];
    if (!entry || !Array.isArray(entry.samples)) return null;
    const filtered = entry.samples.filter(
      (s) => (s && (s.sourceTaskId || s.source_task_id || s.sourceTask)) != sourceTaskId
    );
    // 如果长度未变，则无删除
    if (filtered.length === entry.samples.length) return null;
    filtered.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    const trimmed = filtered.slice(0, this.statisticsMaxSamples);
    const agg = this.computeStatisticsAggregates(trimmed);
    this.statistics.types[taskType] = {
      samples: trimmed,
      avgDailyHours: agg.avgDailyHours,
      avgRequireDays: agg.avgRequireDays,
      avgCompletedHours: agg.avgCompletedHours,
      sampleCount: agg.sampleCount,
      updatedAt: new Date().toISOString(),
    };
    return this.statistics.types[taskType];
  }
  extractCompletionSample(task) {
    if (!task || !task.completed) return null;
    const endRaw = task.completedAt || task.completed_at;
    if (!endRaw) return null;
    const end = new Date(endRaw);
    if (Number.isNaN(end.getTime())) return null;
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
    const requireDays = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    );
    const dailyHours = hours / requireDays;
    return {
      hours,
      requireDays,
      dailyHours,
      completedAt: end.toISOString(),
      sourceTaskId: task.id,
    };
  }
  rebuildStatisticsFromTasks(tasks) {
    const stats = this.createEmptyStatistics();
    (tasks || []).forEach((task) => {
      if (!task || !task.type || !task.completed || !task.completedAt) return;
      const sample = this.extractCompletionSample(task);
      if (!sample) return;
      const entry = stats.types[task.type] || { samples: [] };
      entry.samples = Array.isArray(entry.samples) ? entry.samples : [];
      entry.samples.push(sample);
      stats.types[task.type] = entry;
    });
    Object.entries(stats.types).forEach(([typeId, entry]) => {
      entry.samples = (entry.samples || [])
        .filter(Boolean)
        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
        .slice(0, this.statisticsMaxSamples);
      const agg = this.computeStatisticsAggregates(entry.samples);
      stats.types[typeId] = {
        samples: entry.samples,
        avgDailyHours: agg.avgDailyHours,
        avgRequireDays: agg.avgRequireDays,
        avgCompletedHours: agg.avgCompletedHours,
        sampleCount: agg.sampleCount,
        updatedAt: new Date().toISOString(),
      };
    });
    return stats;
  }
  recordCompletionStatistics(task) {
    const sample = this.extractCompletionSample(task);
    if (!sample || !task || !task.type) return null;
    return this.upsertStatisticsSample(task.type, sample);
  }
  computeWeightedStatsFromTasks(taskType) {
    const completed = (this.tasks || [])
      .filter(
        (t) =>
          t &&
          t.completed &&
          t.completedAt &&
          t.type === taskType &&
          (t.startTime || t.starttime || t.startDate || t.actualStartTime)
      )
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .slice(0, 10);
    let sumDaily = 0;
    let sumDays = 0;
    let sumHours = 0;
    let weightSum = 0;
    completed.forEach((t, idx) => {
      const start =
        t.actualStartTime || t.startTime || t.starttime || t.startDate || t.deadline;
      const end = t.completedAt;
      const s = new Date(start);
      const e = new Date(end);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return;
      const days = Math.max(1, Math.ceil((e - s) / (1000 * 60 * 60 * 24)));
      const hours = Number.isFinite(Number(t.actualHours))
        ? Number(t.actualHours)
        : Number.isFinite(Number(t.estimatedHours))
        ? Number(t.estimatedHours)
        : 0;
      if (hours <= 0) return;
      const daily = hours / days;
      const weight = 1 / (idx + 1);
      sumDaily += daily * weight;
      sumDays += days * weight;
      sumHours += hours * weight;
      weightSum += weight;
    });
    if (weightSum === 0) {
      return {
        avgDailyHours: null,
        avgRequireDays: null,
        avgCompletedHours: null,
        sampleCount: 0,
      };
    }
    return {
      avgDailyHours: sumDaily / weightSum,
      avgRequireDays: sumDays / weightSum,
      avgCompletedHours: sumHours / weightSum,
      sampleCount: completed.length,
    };
  }
  // 根据任务类型获取加权统计数据，优先使用预计算数据，否则动态计算
  getTypeWeightedStats(taskType) {
    const stats = this.statistics || this.createEmptyStatistics();
    const entry = stats.types && stats.types[taskType];
    if (entry && Array.isArray(entry.samples) && entry.samples.length > 0) {
      const agg = this.computeStatisticsAggregates(entry.samples);
      return {
        avgDailyHours: Number.isFinite(entry.avgDailyHours)
          ? entry.avgDailyHours
          : agg.avgDailyHours,
        avgRequireDays: Number.isFinite(entry.avgRequireDays)
          ? entry.avgRequireDays
          : agg.avgRequireDays,
        avgCompletedHours: Number.isFinite(entry.avgCompletedHours)
          ? entry.avgCompletedHours
          : agg.avgCompletedHours,
        sampleCount:
          entry.sampleCount || agg.sampleCount || entry.samples.length || 0,
      };
    }
    return this.computeWeightedStatsFromTasks(taskType);
  }
  computeAutoDeadline(startTime, estimatedHours, taskType) {
    if (!startTime) return null;
    const start = new Date(startTime);
    if (Number.isNaN(start.getTime())) return null;
    const stats = this.getTypeWeightedStats(taskType);
    const MIN_SAMPLES_FOR_SUGGESTION = 3;
    const hasEnoughSamples = stats && Number.isFinite(stats.sampleCount) && stats.sampleCount >= MIN_SAMPLES_FOR_SUGGESTION;
    const avgDaily = hasEnoughSamples && Number.isFinite(stats.avgDailyHours) ? stats.avgDailyHours : null;
    const daysByHours = estimatedHours && avgDaily && avgDaily > 0
      ? Math.ceil(estimatedHours / avgDaily)
      : null;
    const daysByHistory = hasEnoughSamples && stats && Number.isFinite(stats.avgRequireDays)
      ? Math.ceil(stats.avgRequireDays)
      : null;
    // 如果无充足历史也无法由工时/日均推算，返回 null 表示不可自动计算
    if (daysByHours === null && daysByHistory === null) return null;
    const requireDays = Math.max(daysByHours || 0, daysByHistory || 0, 1);
    const end = new Date(start);
    end.setDate(end.getDate() + requireDays);
    end.setHours(23, 59, 0, 0);
    return this.formatDateTimeLocal(end);
  }
  getSuccessorTasks(taskId) {
    return (this.tasks || []).filter(
      (t) => t && t.dependencyType === "line" && t.lineTaskId === taskId
    );
  }
  getChainAncestors(task) {
    const list = [];
    const seen = new Set();
    let cur = task;
    while (cur && cur.lineTaskId && !seen.has(cur.lineTaskId)) {
      seen.add(cur.lineTaskId);
      const parent = (this.tasks || []).find((t) => t.id === cur.lineTaskId);
      if (!parent) break;
      list.push(parent);
      cur = parent;
    }
    return list;
  }
  // 检查绑定是否会形成环：若新前序在当前任务的后代链上，则判为循环
  wouldCreateCycle(taskId, newParentId) {
    if (!taskId || !newParentId) return false;
    if (taskId === newParentId) return true;
    const tasks = Array.isArray(this.tasks) ? this.tasks : [];
    const visited = new Set();
    let cursor = tasks.find((t) => t && t.id === newParentId);
    while (cursor) {
      if (cursor.id === taskId) return true;
      const pid = cursor.lineTaskId;
      if (!pid || visited.has(pid)) break;
      visited.add(pid);
      cursor = tasks.find((t) => t && t.id === pid);
    }
    return false;
  }
  // 将当前任务的所有后继重新绑定到指定的父节点（用于剪切当前任务时保留链路顺序）
  rebindSuccessorsTo(taskId, parentId) {
    const children = this.getSuccessorTasks(taskId) || [];
    children.forEach((child) => {
      child.lineTaskId = parentId;
    });
    return children;
  }
  handleAccelerateConflict(task) {
    // 构建有序前序链 [链头, ..., 紧前任务]（getChainAncestors 返回 [紧前,...,链头]，需 reverse）
    const orderedPreds = [...this.getChainAncestors(task)].reverse();

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

    const message =
      `任务"${task.name}"已实际开始，早于链式计算的开始时间。是否确认加急并调整链顺序？`;
    this.showConfirmDialog(message, () => {
      task.urgentA = true;  // 标记为「实际开始加急」，BarView 将以 actualStartTime 为 bar 起点
      task.lineTaskId = newLineTaskId;
      task.dependencyType = newLineTaskId ? "line" : "none";
      // 根据新的前序重新计算开始时间
      if (task.autoSchedule && task.lineTaskId) {
        const prev = (this.tasks || []).find((t) => t.id === task.lineTaskId);
        const buffer = Number.isFinite(Number(prev?.bufferDays))
          ? Math.max(-1, Math.round(Number(prev.bufferDays)))
          : (function () {
              const stats = prev ? this.getTypeWeightedStats(prev.type) : null;
              const statDays = stats && stats.avgRequireDays ? Math.round(stats.avgRequireDays) : 1;
              return Math.max(1, statDays);
            }).call(this);
        const nextStart = this.computeAutoStartTime(task.lineTaskId, buffer);
        if (nextStart) {
          task.startTime = nextStart;
          task.starttime = nextStart;
        }
      }
      if (task.autoCalcEnd) {
        // urgentA 任务截止日期基于实际开始时间计算
        const autoEnd = this.computeAutoDeadline(
          task.actualStartTime || task.startTime || task.starttime,
          task.estimatedHours,
          task.type
        );
        if (autoEnd) task.deadline = autoEnd;
      }
      this.saveAllData();
      this.renderTasks(task.id);
      this.renderCalendar();
    }, { confirmLabel: "确认", confirmClass: "btn-save" });
  }
  adjustChainFrom(task, visited = new Set(), changed = null) {
    if (!task || visited.has(task.id)) return;
    const topLevel = changed === null;
    if (topLevel) changed = new Set();
    visited.add(task.id);
    const successors = this.getSuccessorTasks(task.id);
    if (!successors.length) {
      if (topLevel) {
        // if no successors but changes exist, refresh calendar
        if (changed.size > 0) this.renderCalendar();
      }
      return;
    }
    const endBase = task.completedAt || task.deadline;
    const bufferDays = Number.isFinite(Number(task.bufferDays))
      ? Math.max(-1, Math.round(Number(task.bufferDays)))
      : (function () {
          const stats = this.getTypeWeightedStats(task.type);
          const statDays = stats && stats.avgRequireDays ? Math.round(stats.avgRequireDays) : 1;
          return Math.max(1, statDays);
        }).call(this);
    successors.forEach((child) => {
      let childChanged = false;
      if (child.autoSchedule) {
        const nextStart = endBase
          ? this.computeAutoStartTime(task.id, bufferDays)
          : child.startTime || child.starttime;
        if (nextStart) {
          if (child.startTime !== nextStart) {
            child.startTime = nextStart;
            child.starttime = nextStart;
            childChanged = true;
            changed.add(child.id);
            // update UI for this child
            try { this.renderTasks(child.id); } catch (e) { /* ignore */ }
          }
        }
        // 混合截止日期策略
        // urgentA 任务已提前实际开工，截止日基于 actualStartTime；其余任务基于计划 startTime
        const _dlBase = (child.urgentA && child.actualStartTime)
          ? child.actualStartTime
          : (child.startTime || child.starttime);
        if (child.autoCalcEnd) {
          // 使用统计数据计算截止日期
          const nextDeadline = this.computeAutoDeadline(
            _dlBase,
            child.estimatedHours,
            child.type
          );
          if (nextDeadline && child.deadline !== nextDeadline) {
            child.deadline = nextDeadline;
            childChanged = true;
            changed.add(child.id);
            try { this.renderTasks(child.id); } catch (e) { /* ignore */ }
          }
        } else if (Number.isFinite(child.estimatedDay) && child.estimatedDay >= 0) {
          // 使用手动工期向后传播截止日期（支持 0 = 当天完成），只修改日期部分并保留原有时分
          const baseStart = new Date(_dlBase);
          if (!isNaN(baseStart.getTime())) {
            const existingDl = child.deadline ? new Date(child.deadline) : null;
            const timeSource = existingDl && !isNaN(existingDl.getTime()) ? existingDl : baseStart;

            const newEnd = new Date(baseStart);
            newEnd.setDate(newEnd.getDate() + child.estimatedDay);
            newEnd.setHours(timeSource.getHours(), timeSource.getMinutes(), 0, 0);

            const nextDeadline = this.formatDateTimeLocal(newEnd);
            if (nextDeadline && child.deadline !== nextDeadline) {
              child.deadline = nextDeadline;
              childChanged = true;
              changed.add(child.id);
              try { this.renderTasks(child.id); } catch (e) { /* ignore */ }
            }
          }
        } else {
          // 边界情况：仅调整了开始时间，未调整截止日期
          // 如果新开始时间超过了现有截止日期，保持最小工期（避免截止 < 开始）
          if (childChanged && child.deadline && child.startTime) {
            const dlDate = new Date(child.deadline);
            const stDate = new Date(child.startTime);
            if (!isNaN(dlDate.getTime()) && !isNaN(stDate.getTime()) && dlDate < stDate) {
              const safeEnd = new Date(stDate);
              safeEnd.setDate(safeEnd.getDate() + 1);
              safeEnd.setHours(23, 59, 0, 0);
              child.deadline = this.formatDateTimeLocal(safeEnd);
              changed.add(child.id);
              try { this.renderTasks(child.id); } catch (e) { /* ignore */ }
            }
          }
        }
      }
      if (
        !child.urgentA &&  // 已标记加急的任务不重复触发
        child.actualStartTime &&
        child.startTime &&
        new Date(child.actualStartTime) < new Date(child.startTime)
      ) {
        this.handleAccelerateConflict(child);
      }
      // recurse
      this.adjustChainFrom(child, visited, changed);
    });
    if (topLevel) {
      if (changed.size > 0) {
        // one final calendar render to consolidate UI
        try { this.renderCalendar(); } catch (e) { /* ignore */ }
        // Persist chain changes asynchronously (debounced inside saveAllData)
        try { this.saveAllData(); } catch (e) { /* ignore */ }
      }
    }
  }

  // 扫描逾期但未完成的任务并触发链式调整（用于启动/保存后的补偿性调整）
  scanOverdueChains() {
    if (this._scanningOverdue) return;
    this._scanningOverdue = true;
    try {
      const today = new Date();
      const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const tasks = Array.isArray(this.tasks) ? this.tasks : [];
      const overdue = tasks.filter((t) => {
        if (!t || t.completed) return false;
        if (!t.deadline) return false;
        const dl = new Date(t.deadline);
        return !Number.isNaN(dl.getTime()) && dl < todayDate;
      });
      if (overdue.length === 0) return;
      // 对每个逾期任务触发从该任务开始的链式调整
      overdue.forEach((t) => {
        try {
          this.adjustChainFrom(t);
        } catch (e) {
          console.warn("scanOverdueChains adjustChainFrom failed", e);
        }
      });
    } finally {
      this._scanningOverdue = false;
    }
  }

  // 页面加载后对所有链进行一次全量重算，修正因数据过期导致的日期偏差
  scanAllChains() {
    if (this._scanningAllChains) return;
    this._scanningAllChains = true;
    try {
      const tasks = Array.isArray(this.tasks) ? this.tasks : [];
      const successorSet = new Set(
        tasks.map(t => t.lineTaskId).filter(Boolean).map(String)
      );
      // 链根：自身被其他任务作为前序，但自己没有前序
      const roots = tasks.filter(t => successorSet.has(String(t.id)) && !t.lineTaskId);
      roots.forEach((root) => {
        try { this.adjustChainFrom(root); } catch (e) {
          console.warn("scanAllChains adjustChainFrom failed", e);
        }
      });
      // 对 urgentA autoCalcEnd 任务直接用 actualStartTime 重算自身截止日（覆盖链外独立任务等盲区）
      const urgentAAutoCalc = tasks.filter(t => t.urgentA && t.actualStartTime && t.autoCalcEnd && !t.completed);
      const urgentAChanged = new Set();
      urgentAAutoCalc.forEach(task => {
        try {
          const _dlBase = task.actualStartTime;
          const autoEnd = this.computeAutoDeadline(_dlBase, task.estimatedHours, task.type);
          let newDeadline;
          if (autoEnd) {
            newDeadline = autoEnd;
          } else if (Number.isFinite(task.estimatedDay) && task.estimatedDay >= 0) {
            const d = new Date(_dlBase);
            d.setDate(d.getDate() + task.estimatedDay);
            d.setHours(23, 59, 0, 0);
            newDeadline = this.formatDateTimeLocal(d);
          } else {
            return;
          }
          if (newDeadline && newDeadline !== task.deadline) {
            task.deadline = newDeadline;
            urgentAChanged.add(task.id);
          }
        } catch (e) { console.warn("scanAllChains urgentA recalc failed", task.name, e); }
      });
      if (urgentAChanged.size > 0) {
        try { this.saveAllData(); } catch (e) { console.warn("scanAllChains urgentA saveAllData failed", e); }
      }
    } finally {
      this._scanningAllChains = false;
    }
  }

  async withAdjustOverlay(fn) {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-30";
    overlay.innerHTML = `<div class="bg-white rounded-xl px-4 py-3 shadow-lg text-sm text-stone-700">正在调整链式任务，请稍候…</div>`;
    document.body.appendChild(overlay);
    try {
      await fn();
    } finally {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
  }
  getLineTaskCandidates(excludeId = null) {
    const list = Array.isArray(this.tasks) ? [...this.tasks] : [];
    const filtered = list.filter((t) => t && t.id !== excludeId);
    filtered.sort((a, b) => {
      const dA = a.deadline ? new Date(a.deadline).getTime() : 0;
      const dB = b.deadline ? new Date(b.deadline).getTime() : 0;
      if (dA !== dB) return dB - dA; // 截止日期倒序
      const sA = a.startTime || a.starttime || a.startDate || "";
      const sB = b.startTime || b.starttime || b.startDate || "";
      return (new Date(sB).getTime() || 0) - (new Date(sA).getTime() || 0);
    });
    return filtered;
  }
  // ✅ 初始化函数
  async init() {
    await this.loadAllData();
    this.renderPresetNodeButtons();
    // 将已保存的已完成卡片透明度应用为 CSS 变量，确保页面初始渲染时生效
    try {
      document.documentElement.style.setProperty(
        "--completed-task-opacity",
        String(this.completedTaskOpacity ?? 0.8)
      );
    } catch (e) {
      console.warn("设置已完成卡片透明度 CSS 变量失败", e);
    }
    this.bindEvents();
    this._initModalController();
    this.updateStats();
    this.updateSmartRecommendations();
    this.renderTasks();
    try {
      const _taskList = document.getElementById("task-list");
      if (_taskList) {
        _taskList.addEventListener("click", this._taskListClickHandler);
      }
    } catch (e) {
      console.warn("bind task-list click failed", e);
    }
    try {
      const _taskList2 = document.getElementById("task-list");
      if (_taskList2) {
        _taskList2.addEventListener("change", this._taskListChangeHandler);
      }
    } catch (e) {
      console.warn("bind task-list change failed", e);
    }
    try {
      document.addEventListener("click", this._documentClickHandler);
    } catch (e) {
      console.warn("bind document click delegation failed", e);
    }
    this.renderTaskTypeOptions();
    this.renderSourceOptions();
    this.renderStatsCards();
    this.renderCalendar();
    this.updateCalendarModeToggleUI();
    this.resetTimerOnPageLoad();
    this.initOrientationDetection();
    // 确保颜色选择器小尺寸样式被注入
    try {
      this.ensureColorPickerStyle && this.ensureColorPickerStyle();
    } catch (e) {
      console.error("注入颜色选择器样式失败", e);
    }

    // 根据已保存的设置恢复隐藏已完成状态到 DOM 和按钮样式
    const taskList = document.getElementById("task-list");
    if (taskList) {
      if (this.hideCompleted) taskList.classList.add("hide-completed");
      else taskList.classList.remove("hide-completed");
    }
    const toggleBtns = document.querySelectorAll(
      '[data-testid="toggle-hide-completed-btn"]'
    );
    if (toggleBtns && toggleBtns.length > 0) {
      toggleBtns.forEach((b) => {
        if (this.hideCompleted) b.classList.add("opacity-80");
        else b.classList.remove("opacity-80");
      });
    }
    // 确保初始文本根据已保存设置显示正确文本/图标
    const initialBtns = document.querySelectorAll(
      '[data-testid="toggle-hide-completed-btn"]'
    );
    if (initialBtns && initialBtns.length > 0) {
      initialBtns.forEach((b) => {
        if (this.hideCompleted) {
          b.classList.add("opacity-80");
          b.innerHTML =
            '<span class="material-icons text-sm mr-1">visibility</span> 显示已完成委托';
        } else {
          b.classList.remove("opacity-80");
          b.innerHTML =
            '<span class="material-icons text-sm mr-1">visibility_off</span>折叠已完成委托';
        }
      });
    }

    let resizeTimeout;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (this.isLandscape) {
          this.scheduleMasonryLayout(15);
        }
      }, 15);
    });
    // ✅ 删除 window.load 事件中的重复布局调用
    // renderTasks() 已经会通过 scheduleMasonryLayout 触发蜘蛛纸牌
    // window.load 中再调用 isResize=true 会破坏动画效果
  }

  async loadAllData() {
    // 注意：不在页面初始化时强制加载 basetype，以减少不必要的网络请求。
    try {
      const res = await fetch("/load");
      const data = await res.json();

      // 回退逻辑：如果服务器返回的 data 为空对象或缺少关键字段，尝试从 basetype.json 加载回退值
      const looksEmpty =
        !data || (typeof data === "object" && Object.keys(data).length === 0);
      const missingKeys = !(
        Array.isArray(data.tasks) ||
        Array.isArray(data.presetNodes) ||
        Array.isArray(data.taskTypes) ||
        Array.isArray(data.sourcePlatforms)
      );
      if (looksEmpty || missingKeys) {
        try {
          await this.loadBaseTypes();
          if (this._baseTypes) {
            // 将 basetype 中的默认项合并到 data 中，前端后续逻辑会使用这些字段
            data.presetNodes =
              data.presetNodes || this._baseTypes.presetNodes || [];
            data.taskTypes = data.taskTypes || this._baseTypes.taskTypes || [];
            data.sourcePlatforms =
              data.sourcePlatforms || this._baseTypes.sourcePlatforms || [];
          }
        } catch (e) {
          // 忽略 basetype 加载错误，保留原始 data
        }
      }

      const normalize = (t) => this.normalizeTaskRecord(t);
      this.tasks = Array.isArray(data.tasks)
        ? data.tasks.map(normalize)
        : [];
      this.recycleBin = Array.isArray(data.recycleBin)
        ? data.recycleBin.map(normalize)
        : [];
      this.statistics = this.normalizeStatistics(data.statistics);
      if (
        this.isStatisticsEmpty(this.statistics) &&
        Array.isArray(this.tasks) &&
        this.tasks.length > 0
      ) {
        this.statistics = this.rebuildStatisticsFromTasks(this.tasks);
      }
      // 恢复隐藏已完成设置（本地化保存在 index.json）
      this.hideCompleted = data.hideCompleted || false;
      // 新增：恢复“默认隐藏上个月及之前已完成”设置
      this.hideCompletedBeforeLastMonth =
        data.hideCompletedBeforeLastMonth || false;
      // 恢复删除确认设置（若存在），默认 true
      this.confirmDeleteOnRemove =
        typeof data.confirmDeleteOnRemove === "boolean"
          ? data.confirmDeleteOnRemove
          : true;
      this.serverOnline = true; // ✅ 标记服务器在线
      // 任务类型与来源平台：优先使用服务器数据，其次使用 basetype 回退，否则留空，由 UI/用户自定义填充
      this.taskTypes =
        data.taskTypes || (this._baseTypes && this._baseTypes.taskTypes) || [];

      this.sourcePlatforms =
        data.sourcePlatforms ||
        (this._baseTypes && this._baseTypes.sourcePlatforms) ||
        [];
      // 快速节点（用于任务模态内的预设节点按钮）
      const hasPresetInData =
        Array.isArray(data.presetNodes) && data.presetNodes.length > 0;
      this.presetNodes = (
        hasPresetInData ? data.presetNodes : this.getDefaultPresetNodes()
      )
        .map((n) => this.normalizePresetNode(n))
        .filter(Boolean);

      // 升级逻辑：如果数据文件中没有 presetNodes，但 tasks 中存在节点，尝试从 basetype.json 恢复 presetNodes
      if (!hasPresetInData) {
        const tasksHaveNodes =
          Array.isArray(this.tasks) &&
          this.tasks.some((t) => Array.isArray(t.nodes) && t.nodes.length > 0);
        if (tasksHaveNodes) {
          try {
            await this.loadBaseTypes();
            if (
              this._baseTypes &&
              Array.isArray(this._baseTypes.presetNodes) &&
              this._baseTypes.presetNodes.length > 0
            ) {
              this.presetNodes = this._baseTypes.presetNodes
                .map((n) => this.normalizePresetNode(n))
                .filter(Boolean);
              // 尝试将恢复的 presetNodes 持久化回存储（若服务在线则保存）
              try {
                await this.saveAllData();
              } catch (saveErr) {
                // 忽略保存错误，保留内存中的恢复结果
                console.warn("保存恢复的 presetNodes 失败", saveErr);
              }
            }
          } catch (e) {
            // 忽略 basetype 加载或解析错误，保留已有回退逻辑
            console.warn("尝试从 basetype 恢复 presetNodes 失败", e);
          }
        }
      }
      // 恢复 HSV 可调上限（若存在于数据中），否则保留默认
      this.hsvMaxS =
        typeof data.hsvMaxS === "number" ? data.hsvMaxS : this.hsvMaxS || 1;
      this.hsvMaxV =
        typeof data.hsvMaxV === "number" ? data.hsvMaxV : this.hsvMaxV || 1;
      window._hsvDebug = window._hsvDebug || {};
      window._hsvDebug.maxS = this.hsvMaxS;
      window._hsvDebug.maxV = this.hsvMaxV;
      // 恢复已完成卡片透明度设置（0..1），若不存在则回退到 0.8
      this.completedTaskOpacity =
        typeof data.completedTaskOpacity === "number"
          ? data.completedTaskOpacity
          : this.completedTaskOpacity || 0.8;
      // 恢复卡片下半区与白色混合系数（0..1），若不存在则回退到默认
      this.cardBodyWhiteBlend =
        typeof data.cardBodyWhiteBlend === "number"
          ? data.cardBodyWhiteBlend
          : this.cardBodyWhiteBlend || 0.7;
      // 是否显示任务类型/来源快捷添加
      this.showQuickAddInputs =
        typeof data.showQuickAddInputs === "boolean"
          ? data.showQuickAddInputs
          : this.showQuickAddInputs;
      // 是否仅显示截止日期（无具体时间）
      this.dateOnlyDeadlineMode =
        typeof data.dateOnlyDeadlineMode === "boolean"
          ? data.dateOnlyDeadlineMode
          : this.dateOnlyDeadlineMode || false;
      // 是否允许重复节点（默认 false）
      this.allowDuplicateNodes =
        typeof data.allowDuplicateNodes === "boolean"
          ? data.allowDuplicateNodes
          : this.allowDuplicateNodes || false;
      // 暂停实时预览
      this.livePreviewCurrentPause =
        typeof data.livePreviewCurrentPause === "boolean"
          ? data.livePreviewCurrentPause
          : this.livePreviewCurrentPause || false;

      // 清理超过保留期的回收站任务（含删除日期标记）
      const purged = this.purgeExpiredRecycleTasks(30);
      if (purged) {
        try {
          await this.saveAllData();
        } catch (e) {
          console.warn("保存回收站清理结果失败", e);
        }
      }
    } catch (e) {
      console.error("加载失败", e);
      this.tasks = [];
      this.statistics = this.createEmptyStatistics();
      this.serverOnline = false; // ✅ 标志服务器离线
      // 仅在需要回退到 basetype 时再加载它（例如服务器离线并且需要默认预设）
      try {
        await this.loadBaseTypes();
      } catch (err) {
        // 忽略 basetype 加载错误
      }
      this.presetNodes = this.getDefaultPresetNodes()
        .map((n) => this.normalizePresetNode(n))
        .filter(Boolean);
    }
    // 确保 presetNodes 始终存在
    if (!this.presetNodes || this.presetNodes.length === 0) {
      this.presetNodes = this.getDefaultPresetNodes()
        .map((n) => this.normalizePresetNode(n))
        .filter(Boolean);
    }
    // 启动时补偿性扫描逾期链，保证在加载后链式任务得到及时调整
    try { this.scanOverdueChains(); } catch (e) { console.warn("scanOverdueChains failed on load", e); }
    // 全量链重算：修正因数据过期导致的所有链式任务日期偏差
    try { this.scanAllChains(); } catch (e) { console.warn("scanAllChains failed on load", e); }
    // 暂停实时预览：将活跃暂停自动应用为 deadline 延期
    try { this.applyCurrentPausePreview(); } catch (e) { console.warn("applyCurrentPausePreview failed", e); }
  }

  // 清理超过 retentionDays 的回收站任务；返回是否发生变更
  purgeExpiredRecycleTasks(retentionDays = 30) {
    const retentionMs = Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const bin = Array.isArray(this.recycleBin) ? this.recycleBin : [];
    const kept = [];
    let changed = false;
    for (const t of bin) {
      const ts = t && t.deletedAt ? Date.parse(t.deletedAt) : NaN;
      if (!Number.isNaN(ts) && now - ts > retentionMs) {
        changed = true;
        continue;
      }
      kept.push(t);
    }
    if (changed) this.recycleBin = kept;
    return changed;
  }
  // ── 暂停实时预览 ──
  // 将当前活跃的暂停（paused=true）视为已发生的延期，自动延长 deadline
  // 对所有暂停任务生效，幂等（使用 pausePreDeadline 作为基准）
  applyCurrentPausePreview() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tasks = Array.isArray(this.tasks) ? this.tasks : [];
    tasks.forEach(task => {
      if (!task || !task.paused || !task.pausedAt) return;
      const pausedAt = new Date(task.pausedAt);
      pausedAt.setHours(0, 0, 0, 0);
      const pausedDays = Math.floor((today - pausedAt) / 86400000);
      if (pausedDays < 1) return;
      // 首次：保存原始 deadline 作为不随预览变化的基准
      if (!task.pausePreDeadline && task.deadline) {
        task.pausePreDeadline = task.deadline;
      }
      if (task.pausePreDeadline) {
        const baseDeadline = new Date(task.pausePreDeadline);
        if (!isNaN(baseDeadline.getTime())) {
          const extendedDeadline = new Date(baseDeadline);
          extendedDeadline.setDate(extendedDeadline.getDate() + pausedDays);
          const formatted = this.formatDateTimeLocal(extendedDeadline);
          if (task.deadline !== formatted) {
            task.deadline = formatted;
            this.adjustChainFrom(task);
          }
        }
      }
    });
  }

  resetTimerOnPageLoad() {
    if (this.currentTimer) {
      clearInterval(this.currentTimer);
      this.currentTimer = null;
      this.timerTaskId = null;
      this.timerStartTime = null;
    }
  }
  formatHours(hours) {
    if (!hours || hours === 0) return "0小时";
    const wholeHours = Math.floor(hours);
    const minutes = Math.round((hours - wholeHours) * 60);
    if (wholeHours === 0) {
      return `${minutes}分钟`;
    } else if (minutes === 0) {
      return `${wholeHours}小时`;
    } else {
      return `${wholeHours}小时${minutes}分钟`;
    }
  }
  async loadTasks() {
    try {
      const res = await fetch("/load");
      const data = await res.json();
      return data.tasks || [];
    } catch (e) {
      console.error("加载失败，使用空数据", e);
      return [];
    }
  }
  loadTaskTypesFromServer(data) {
    // 从远程数据优先读取；若无则尝试从 basetype.json 回退；如都无则返回空数组（默认已移至 basetype.json）
    return (
      data.taskTypes || (this._baseTypes && this._baseTypes.taskTypes) || []
    );
  }
  prepareTasksForSave() {
    return (this.tasks || []).map((task) => this.prepareTaskForSave(task));
  }
  async saveAllData() {
    // 防抖 + 序列化保存，避免并发写入与竞态
    if (!this._pendingSave) {
      this._pendingSave = new Promise((resolve) => {
        clearTimeout(this._saveDebounceTimer);
        this._saveDebounceTimer = setTimeout(async () => {
          try {
            // 如果已有保存正在进行，等待其完成以串行化写入
            if (this._saveInProgress) {
              try {
                await this._saveInProgress;
              } catch (_) {
                // 忽略之前的失败，继续尝试新的保存
              }
            }

            // 发起新一次保存并记录为 in-progress
            this._saveInProgress = (async () => {
              try {
                await fetch("/save", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    tasks: this.prepareTasksForSave(),
                    taskTypes: this.taskTypes,
                    sourcePlatforms: this.sourcePlatforms,
                    presetNodes: this.presetNodes,
                    recycleBin: this.recycleBin || [],
                    hideCompleted: !!this.hideCompleted,
                    hideCompletedBeforeLastMonth:
                      !!this.hideCompletedBeforeLastMonth,
                    confirmDeleteOnRemove: !!this.confirmDeleteOnRemove,
                    hsvMaxS: this.hsvMaxS,
                    hsvMaxV: this.hsvMaxV,
                    completedTaskOpacity: this.completedTaskOpacity,
                    cardBodyWhiteBlend: this.cardBodyWhiteBlend,
                    showQuickAddInputs: this.showQuickAddInputs,
                    allowDuplicateNodes: !!this.allowDuplicateNodes,
                    dateOnlyDeadlineMode: !!this.dateOnlyDeadlineMode,
                    livePreviewCurrentPause: !!this.livePreviewCurrentPause,
                    statistics:
                      this.statistics || this.createEmptyStatistics(),
                  }),
                });
              } catch (e) {
                console.error("保存失败", e);
                this.serverOnline = false;
                throw e;
              }
            })();

            await this._saveInProgress;
          } finally {
            this._saveInProgress = null;
            resolve();
            this._pendingSave = null;
            // 保存后触发一次逾期扫描以保证链式任务得到及时调整（异步以避免阻塞保存流程）
            setTimeout(() => {
              try { this.scanOverdueChains(); } catch (e) { console.warn("scanOverdueChains failed after save", e); }
            }, 0);
          }
        }, 150);
      });
    }

    return this._pendingSave;
  }

  loadSourcePlatformsFromServer(data) {
    // 从远程数据优先读取；若无则尝试从 basetype.json 回退；如都无则返回空数组（默认已移至 basetype.json）
    return (
      data.sourcePlatforms ||
      (this._baseTypes && this._baseTypes.sourcePlatforms) ||
      []
    );
  }
  bindEvents() {
    document
      .getElementById("add-task-btn")
      .addEventListener("click", async () => {
        const online = await this.checkServerOnline();
        if (!online) {
          alert("服务端已关闭，无法添加新任务");
          return;
        }
        this.showModal(); // 正常打开新增任务弹窗
      });
    const manageBtn = document.getElementById("manage-types-btn");
    if (manageBtn) {
      manageBtn.addEventListener("click", () => {
        this.showTypeManagementModal();
      });
    }

    // 绑定主界面的回收站切换按钮
    const recycleMainBtn = document.getElementById("toggle-recycle-main-btn");
    if (recycleMainBtn) {
      this._toggleRecycleMainHandler = () => this.toggleRecycleView();
      recycleMainBtn.addEventListener("click", this._toggleRecycleMainHandler);
      // 初始化按钮显示（但不改变当前状态）
      // 使用 silent=true 避免初始化时显示消息
      this.toggleRecycleView(this.showingRecycleBin, true);
    }
    const pageSettingsBtn = document.getElementById("page-settings-btn");
    if (pageSettingsBtn) {
      this._pageSettingsHandler = () => this.showPageSettingsModal();
      pageSettingsBtn.addEventListener("click", this._pageSettingsHandler);
    }

    // 搜索面板绑定（types-actions 区域）
    const searchWrap = document.querySelector(".types-search-wrap");
    const searchBtn = document.getElementById("types-search-btn");
    const searchPanel = document.querySelector(".types-search-panel");
    const searchInput = document.getElementById("types-search-input");
    if (searchBtn && searchPanel && searchInput && searchWrap) {
      // 标志：指示 pointerdown 是否从搜索面板内开始（用于避免拖选时误关闭）
      this._searchPointerDownInside = false;

      // 当用户在搜索面板内按下（可能开始拖选）时记录标志
      searchPanel.addEventListener(
        "pointerdown",
        (ev) => {
          try {
            this._searchPointerDownInside = true;
          } catch (e) {
            this._searchPointerDownInside = false;
          }
        },
        { passive: true }
      );

      // pointercancel：重置标志
      searchPanel.addEventListener("pointercancel", () => {
        this._searchPointerDownInside = false;
      });

      // 在全局的 pointerup 中不立即关闭，但保留标志让 document click 处理时决定是否关闭
      document.addEventListener("pointerup", (ev) => {
        // 不在此处清除标志，让 _onDocumentClick 消费该标志以判断是否关闭。
      });

      this._openSearch = () => {
        if (this._searchOpen) return;
        this._searchOpen = true;
        searchWrap.classList.add("open");
        searchBtn.setAttribute("aria-expanded", "true");
        searchPanel.setAttribute("aria-hidden", "false");
        // focus 在面板即将完全展开后触发，使用 preventScroll 防止 Safari 自动滚动导致“抖动”
        setTimeout(() => {
          try {
            searchInput.focus({ preventScroll: true });
          } catch (e) {
            // 某些旧版浏览器不支持 preventScroll
            searchInput.focus();
          }
        }, 320);
      };
      this._closeSearch = () => {
        if (!this._searchOpen) return;
        this._searchOpen = false;
        searchWrap.classList.remove("open");
        searchBtn.setAttribute("aria-expanded", "false");
        searchPanel.setAttribute("aria-hidden", "true");
        // 默认关闭时清空搜索（如用户要求）
        this.searchQuery = "";
        searchInput.value = "";
        this.renderTasks();
      };

      searchBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this._searchOpen) this._closeSearch();
        else this._openSearch();
      });

      // 防抖输入
      searchInput.addEventListener("input", (e) => {
        const v = (e.target.value || "").trim();
        clearTimeout(this._searchDebounce);
        this._searchDebounce = setTimeout(() => {
          this.searchQuery = v;
          this.renderTasks();
        }, 200);
      });

      // ESC 关闭
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          this._closeSearch();
        }
      });
    }

    this.bindImageModalEvents();
    // 绑定全局 Esc 快捷键（按一次退出最上层弹窗；在输入框内按 Esc 也会触发，默认行为为取消并关闭最上层弹窗）
    this._globalEscHandler = (e) => this.handleGlobalEsc(e);
    window.addEventListener("keydown", this._globalEscHandler);

    document.getElementById("calendar-prev").addEventListener("click", () => {
      this.changeMonth(-1);
    });
    document.getElementById("calendar-next").addEventListener("click", () => {
      this.changeMonth(1);
    });
    const calendarModeToggle = document.getElementById("calendar-mode-toggle");
    if (calendarModeToggle) {
      calendarModeToggle.addEventListener("click", () => {
        this.toggleCalendarMode();
      });
    }
    document
      .getElementById("close-date-tasks")
      .addEventListener("click", () => {
        this.hideDateTasksModal();
      });
    this.bindOverlayClose(document.getElementById("date-tasks-modal"), () =>
      this.hideDateTasksModal()
    );
    this.bindCollapseEvents();
    // 绑定“隐藏已完成”切换（支持页面上可能有多个同样的按钮）
    const toggleBtns = document.querySelectorAll(
      '[data-testid="toggle-hide-completed-btn"]'
    );
    if (toggleBtns && toggleBtns.length > 0) {
      toggleBtns.forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();

          // 在回收站视图中，改为“一键清空回收站”的按钮行为
          if (this.showingRecycleBin) {
            const ok = confirm(
              "确认要永久清空回收站吗？此操作会删除回收站内的所有任务及其关联的图片，无法撤销。"
            );
            if (!ok) return;
            // 直接清空回收站并保存（后端 cleanup_unused_images 会移除回收站内未引用的图片）
            this.recycleBin = [];
            try {
              this.saveAllData();
            } catch (e) {
              console.warn("清空回收站时保存失败", e);
            }
            this.renderTasks();
            this.updateStats();
            this.showMessage("回收站已清空");
            return;
          }

          // 默认行为：切换隐藏/显示已完成委托
          this.hideCompleted = !this.hideCompleted;
          const taskList = document.getElementById("task-list");
          if (taskList) {
            if (this.hideCompleted) taskList.classList.add("hide-completed");
            else taskList.classList.remove("hide-completed");
          }
          // 更新按钮样式与文本（高亮/切换显示文字）
          toggleBtns.forEach((b) => {
            if (this.hideCompleted) {
              b.classList.add("opacity-80");
              b.innerHTML =
                '<span class="material-icons text-sm mr-1">visibility</span> 显示已完成委托';
            } else {
              b.classList.remove("opacity-80");
              b.innerHTML =
                '<span class="material-icons text-sm mr-1">visibility_off</span> 隐藏已完成委托';
            }
          });
          // 持久化设置到 index.json
          try {
            this.saveAllData();
          } catch (e) {
            console.warn("保存 hideCompleted 设置失败", e);
          }
          // 重新渲染任务，横竖屏会自动处理布局
          this.renderTasks();
        });
      });
    }
  }
  // ──────────────────────────────────────────────────────────────
  // _initModalController — 初始化 TaskModalController 实例
  // ──────────────────────────────────────────────────────────────
  _initModalController() {
    if (this.modalController) return; // 避免重复初始化
    if (typeof TaskModalController === 'undefined') {
      console.warn('TaskModalController not available — task-modal-shared.js may not be loaded');
      return;
    }
    const self = this;
    this.modalController = new TaskModalController({
      dataSource: {
        getTask(id) { return self.tasks.find(t => t.id === id); },
        getTasks() { return self.tasks; },
        get taskTypes() { return self.taskTypes; },
        get sourcePlatforms() { return self.sourcePlatforms; },
        get presetNodes() { return self.presetNodes; },
        get statistics() { return self.statistics; },
        get showQuickAddInputs() { return self.showQuickAddInputs; },
        showMessage(msg) { return self.showMessage(msg); },
      },
      onSave: async (formData, editingId) => {
        return await this._handleModalSave(formData, editingId);
      },
      onCancel: async () => {
        try {
          if (this.currentImageData && typeof fetch === 'function') {
            await fetch('/delete-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: this.currentImageData }),
            });
          }
        } catch (e) {
          console.error('取消时删除临时图片失败', e);
        }
        this.currentImageData = null;
      },
    });
    this.modalController.initEvents();
  }

  // ──────────────────────────────────────────────────────────────
  // _handleModalSave — TaskModalController.onSave 回调
  // formData 由 collectFormData() 提供，无需再次读取 DOM
  // 返回 false 表示操作取消（弹窗保持打开）
  // ──────────────────────────────────────────────────────────────
  async _handleModalSave(formData, editingId) {
    const online = await this.checkServerOnline();
    if (!online) {
      alert('服务端已关闭，无法保存任务');
      return false;
    }

    // ── Quick-add 类型创建 ──
    let type = formData.type;
    let source = formData.source;
    try {
      const quickTypeNameEl = document.getElementById('quick-add-type-name');
      const quickTypeColorEl = document.getElementById('quick-add-type-color');
      const qtName = quickTypeNameEl ? quickTypeNameEl.value.trim() : '';
      if (qtName) {
        const color = (quickTypeColorEl?.value || this.taskTypes[0]?.color || '#3b82f6').trim();
        const baseId = qtName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const existingIds = new Set(this.taskTypes.map(t => t.id));
        let idCandidate = baseId || `type-${Date.now()}`;
        let counter = 1;
        while (existingIds.has(idCandidate)) idCandidate = `${baseId || 'type'}-${counter++}`;
        this.taskTypes.push({ id: idCandidate, name: qtName, color });
        type = idCandidate;
        try { this.renderTaskTypeOptions(); this.renderPageSettingsSwatches(); } catch (e) {}
      }
    } catch (e) { console.error('创建快捷类型失败', e); }

    // ── Quick-add 来源创建 ──
    try {
      const quickSourceNameEl = document.getElementById('quick-add-source-name');
      const quickSourceColorEl = document.getElementById('quick-add-source-color');
      const qsName = quickSourceNameEl ? quickSourceNameEl.value.trim() : '';
      if (qsName) {
        const color = (quickSourceColorEl?.value || this.sourcePlatforms[0]?.color || '#3b82f6').trim();
        const baseId = qsName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const existingIds = new Set(this.sourcePlatforms.map(t => t.id));
        let idCandidate = baseId || `source-${Date.now()}`;
        let counter = 1;
        while (existingIds.has(idCandidate)) idCandidate = `${baseId || 'source'}-${counter++}`;
        this.sourcePlatforms.push({ id: idCandidate, name: qsName, color });
        source = idCandidate;
        try { this.renderSourceOptions(); } catch (e) {}
      }
    } catch (e) { console.error('创建快捷来源失败', e); }

    // 最终使用的 type/source（可能被 quick-add 覆盖）
    const fd = { ...formData, type, source };
    const {
      name, progress, startTime: starttime, deadline,
      completedAt: completedAtInput, estimatedHours, estimatedDay,
      payment, paymentMode, paymentRecords,
      abandoned: abandonedChecked, abandonedAt: formAbandonedAt,
      actualHours, nodes, image, dependencyType, lineTaskId: fdLineTaskId,
      autoSchedule, autoCalcEnd, bufferDays, actualStartTime,
    } = fd;

    let lineTaskId = fdLineTaskId;

    // ── 链式冲突对话 ──
    let linkMode = null;
    let conflictSiblings = [];
    if (dependencyType === 'line' && lineTaskId) {
      if (editingId && lineTaskId === editingId) {
        this.showMessage('不能将任务绑定为自己的前序');
        return false;
      }
      conflictSiblings = (this.tasks || []).filter(
        t => t && t.dependencyType === 'line' && t.lineTaskId === lineTaskId && t.id !== editingId
      );
      if (conflictSiblings.length > 0) {
        linkMode = await this.showLinkModeDialog();
        if (!linkMode) return false; // 用户取消保留弹窗
        if (linkMode === 'insert' && editingId) {
          const bad = conflictSiblings.find(s => this.wouldCreateCycle(s.id, editingId));
          if (bad) {
            this.showMessage('插入会形成循环，请选择并列或更换前序任务');
            return false;
          }
        }
      }
    }

    if (editingId) {
      // ════════════════════════════════
      // 情况 A：编辑已有任务
      // ════════════════════════════════
      const taskIndex = this.tasks.findIndex(t => t.id === editingId);
      if (taskIndex === -1) return false;
      const task = this.tasks[taskIndex];
      const oldParentId = task.lineTaskId ?? null;
      const newParentId = dependencyType === 'line' ? lineTaskId : null;
      const shouldRebindChildren = oldParentId !== newParentId;
      const oldCompleted = !!task.completed;
      const oldCompletedAt = task.completedAt || null;
      const oldCompletedHours = task.completedHours || null;
      const oldType = task.type;
      const oldActualStart = task.actualStartTime || null;
      const oldStartTimeVal = task.startTime || task.starttime || null;

      if (linkMode === 'insert') {
        const invalid = conflictSiblings.find(s => this.wouldCreateCycle(s.id, task.id));
        if (invalid) { this.showMessage('插入会形成循环，请选择并列或更换前序任务'); return false; }
      }
      if (shouldRebindChildren) this.rebindSuccessorsTo(task.id, oldParentId);

      task.name = name; task.type = type; task.source = source; task.progress = progress;
      task.startTime = starttime; task.starttime = starttime;
      task.dependencyType = dependencyType; task.lineTaskId = newParentId;
      task.autoSchedule = autoSchedule; task.autoCalcEnd = autoCalcEnd;
      task.bufferDays = bufferDays; task.actualStartTime = actualStartTime || null;
      task.deadline = deadline; task.completedAt = completedAtInput || null;
      task.estimatedHours = estimatedHours; task.estimatedDay = estimatedDay;
      task.payment = payment; task.paymentMode = paymentMode || null;
      task.paymentRecords = paymentRecords;
      task.abandoned = abandonedChecked;
      task.abandonedAt = abandonedChecked ? (formAbandonedAt || task.abandonedAt || new Date().toISOString()) : null;
      task.actualHours = actualHours; task.completedHours = actualHours;
      task.nodes = [...nodes];
      if (image !== undefined) {
        task.image = image;
        if (this.currentImageW && this.currentImageH) { task.w = this.currentImageW; task.h = this.currentImageH; }
      }
      task.completed = progress === 100 || !!completedAtInput;
      if (task.completed && task.nodes) task.nodes.forEach(n => (n.completed = true));
      if (linkMode === 'insert') conflictSiblings.forEach(s => { s.lineTaskId = task.id; });

      this.withAdjustOverlay(async () => {
        const oldParentTask = oldParentId ? (this.tasks || []).find(t => t.id === oldParentId) : null;
        if (shouldRebindChildren && oldParentTask && oldParentTask.id !== task.id) this.adjustChainFrom(oldParentTask);
        this.adjustChainFrom(task);
      });

      const newCompleted = !!task.completed;
      const newCompletedAt = task.completedAt || null;
      const newCompletedHours = task.completedHours || null;
      if (newCompleted && (!oldCompleted || newCompletedAt !== oldCompletedAt || newCompletedHours !== oldCompletedHours || task.type !== oldType)) {
        if (task.type !== oldType && oldCompleted) this.removeStatisticsSample(oldType, task.id);
        this.recordCompletionStatistics(task);
      } else if (!newCompleted && oldCompleted) {
        this.removeStatisticsSample(oldType, task.id);
      }
      if (task.completed) {
        const newActualStart = task.actualStartTime || null;
        const newStartTimeVal = task.startTime || task.starttime || null;
        if (oldActualStart !== newActualStart || oldStartTimeVal !== newStartTimeVal) this.recordCompletionStatistics(task);
      }

      this.showMessage('任务更新成功');
      this.renderTasks(task.id);
    } else {
      // ════════════════════════════════
      // 情况 B：新增任务
      // ════════════════════════════════
      const imgData = this.modalController?.currentImageData || image;
      const task = {
        id: Date.now(),
        name, type, source, progress,
        startTime: starttime, starttime,
        deadline, completedAt: completedAtInput || null,
        estimatedHours, estimatedDay,
        payment, paymentMode: paymentMode || null, paymentRecords,
        abandoned: abandonedChecked,
        abandonedAt: abandonedChecked ? (formAbandonedAt || new Date().toISOString()) : null,
        actualHours, completedHours: actualHours,
        nodes: [...nodes],
        image: imgData,
        completed: progress === 100 || !!completedAtInput,
        createdAt: new Date().toISOString(),
        actualStartTime: actualStartTime || null,
        dependencyType, lineTaskId, autoSchedule, autoCalcEnd, bufferDays,
      };
      if (this.currentImageW && this.currentImageH) { task.w = this.currentImageW; task.h = this.currentImageH; }
      if (linkMode === 'insert') conflictSiblings.forEach(s => { s.lineTaskId = task.id; });

      let insertIndex = this.tasks.findIndex(t => t.deadline && new Date(task.deadline) < new Date(t.deadline));
      if (insertIndex === -1) insertIndex = this.tasks.length;
      this.tasks.splice(insertIndex, 0, task);

      if (task.completed) {
        if (task.nodes) task.nodes.forEach(n => (n.completed = true));
        this.recordCompletionStatistics(task);
      }
      this.showMessage('任务添加成功');
      this.insertTaskCardLocally(task, insertIndex);
      this.withAdjustOverlay(async () => { this.adjustChainFrom(task); });
    }

    // ── 清理 quick-add 输入 ──
    try {
      const qtName = document.getElementById('quick-add-type-name');
      const qtColor = document.getElementById('quick-add-type-color');
      if (qtName) qtName.value = ''; if (qtColor) qtColor.value = '#3b82f6';
      const qsName = document.getElementById('quick-add-source-name');
      const qsColor = document.getElementById('quick-add-source-color');
      if (qsName) qsName.value = ''; if (qsColor) qsColor.value = '#3b82f6';
    } catch (e) {}

    this.saveAllData();
    this.updateStats();
    this.updateSmartRecommendations();
    this.renderCalendar();
    this.editingTaskId = null;
    this.imageChanged = false;
    this.updateMonthlyStatsDisplay();
    // 返回 undefined（不返回 false）表示保存成功，TaskModalController 随后关闭弹窗
  }

  showModal(taskId = null) {
    // 服务端关闭时禁止添加/编辑
    if (!this.serverOnline) {
      alert("服务端已关闭，无法添加或编辑任务");
      return;
    }
    this.editingTaskId = taskId; // 向后兼容 — onSave 中可直接使用 editingId 参数
    if (this.modalController) {
      this.modalController.showModal(taskId);
    }
  }
  // 渲染预设节点按钮
  renderPresetNodeButtons() {
    const list = (
      this.presetNodes && this.presetNodes.length > 0
        ? this.presetNodes
        : this.getDefaultPresetNodes()
    ).map((n) => this.normalizePresetNode(n));
    // 追加当前编辑态或已存在任务中的节点，使非预设节点也能获得样式
    // 但优先使用 presetNodes 的定义：如果名称已在 preset 中则跳过任务保存的颜色
    const presetNames = new Set(list.map((p) => p.name));
    const extraNodes = [];
    (this.tempNodes || []).forEach((n) => {
      if (!n || !n.name) return;
      if (presetNames.has(n.name)) return; // 已由 preset 控制
      extraNodes.push(
        this.normalizePresetNode({
          name: n.name,
          background: n.background,
          icon: n.icon,
        })
      );
    });
    // 也检查所有任务中的节点，确保样式完整
    (this.tasks || []).forEach((t) => {
      (t.nodes || []).forEach((n) => {
        if (!n || !n.name) return;
        if (presetNames.has(n.name)) return;
        extraNodes.push(
          this.normalizePresetNode({
            name: n.name,
            background: n.background,
            icon: n.icon,
          })
        );
      });
    });
    const styleNodes = [...extraNodes, ...list];

    const container = document.getElementById("preset-nodes"); // 预设节点按钮容器
    if (container) {
      container.innerHTML = list
        .map((node) => {
          const textClass =
            node.text || this.getNearestTailwindTextClass(node.background);
          const iconClass = this.getIconClassForSource(
            node.iconGroup,
            node.iconStyle
          );
          return `
            <button type="button"
              class="preset-node-btn px-3 py-1 rounded-full text-xs transition-colors"
              data-node-id="${node.id}"
              data-node-name="${node.name}"
              data-node="${node.name}"
              data-icon="${node.icon || "label"}"
              data-icon-group="${node.iconGroup || "icons"}"
              data-icon-style="${node.iconStyle || "regular"}"
              data-background="${node.background || ""}"
              data-text-class="${textClass}">
              <span class="${iconClass} text-xs mr-1">
                ${node.icon || "label"}
              </span>${node.name}
            </button>
          `;
        })
        .join("");
    }

    // 动态注入节点样式（背景与文字颜色）
    this.applyPresetNodeStyles(styleNodes);
  }

  hideModal() {
    if (this.modalController) {
      this.modalController.hideModal();
    } else {
      const m = document.getElementById("task-modal");
      if (m) m.classList.add("hidden");
    }
    this.editingTaskId = null;
    this.currentImageData = null;
  }

  // 编辑态：点击遮罩或按 Esc 时自动保存并退出；新增时仍直接关闭
  calculateIntelligentWorkload() {
    const incompleteTasks = this.tasks.filter(
      (task) => !task.completed && !task.abandoned && task.deadline
    );
    if (incompleteTasks.length === 0) {
      return {
        totalRemainingHours: 0,
        totalDaysRemaining: 0,
        dailyRecommendedHours: 0,
        urgentTasks: [],
        recommendations: [],
      };
    }
    const taskAnalysis = incompleteTasks.map((task) => {
      const remainingHours = Math.max(
        0,
        task.estimatedHours - (task.actualHours || 0)
      );
      const daysRemaining = this.getDaysRemaining(task.deadline);
      const priority = this.getTaskPriority(
        task,
        remainingHours,
        daysRemaining
      );
      return {
        ...task,
        remainingHours,
        daysRemaining,
        priority,
        urgencyScore: this.calculateUrgencyScore(daysRemaining, remainingHours),
      };
    });
    taskAnalysis.sort((a, b) => b.urgencyScore - a.urgencyScore);
    let totalDailyRecommendedHours = 0;
    taskAnalysis.forEach((task) => {
      if (task.daysRemaining <= 0) {
        // 修改：将逾期任务的剩余工时直接计入日均建议工时
        totalDailyRecommendedHours += task.remainingHours;
      } else if (task.daysRemaining > 0 && task.daysRemaining <= 30) {
        totalDailyRecommendedHours += task.remainingHours / task.daysRemaining;
      }
    });
    if (totalDailyRecommendedHours === 0 && taskAnalysis.length > 0) {
      const totalRemainingHours = taskAnalysis.reduce(
        (sum, task) => sum + task.remainingHours,
        0
      );
      const minDaysRemaining = Math.min(
        ...taskAnalysis.map((t) => Math.max(1, t.daysRemaining))
      );
      totalDailyRecommendedHours = totalRemainingHours / minDaysRemaining;
    }
    const totalRemainingHours = taskAnalysis.reduce(
      (sum, task) => sum + task.remainingHours,
      0
    );
    const minDaysRemaining = Math.min(
      ...taskAnalysis.map((t) => t.daysRemaining)
    );
    const urgentTasks = taskAnalysis.filter((task) => task.daysRemaining <= 3);
    const recommendations = this.getSmartRecommendations(
      taskAnalysis,
      totalDailyRecommendedHours
    );
    return {
      totalRemainingHours: Math.round(totalRemainingHours * 10) / 10,
      totalDaysRemaining: minDaysRemaining,
      dailyRecommendedHours: Math.round(totalDailyRecommendedHours * 10) / 10,
      urgentTasks,
      recommendations,
      taskBreakdown: taskAnalysis,
    };
  }
  getDaysRemaining(deadline) {
    if (!deadline) return Infinity;
    const now = new Date();
    const deadlineDate = new Date(deadline);
    const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const deadlineDateOnly = new Date(
      deadlineDate.getFullYear(),
      deadlineDate.getMonth(),
      deadlineDate.getDate()
    );
    const diffMs = deadlineDateOnly - nowDate;
    // 返回精确的天数差：0 表示今天，1 表示明天，负数表示已逾期
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return diffDays;
  }
  getTaskPriority(task, remainingHours, daysRemaining) {
    // 调整阈值以匹配新的 daysRemaining 语义（0=今天，负数=逾期）
    if (daysRemaining <= 0) return "critical";
    if (daysRemaining <= 2) return "high";
    if (daysRemaining <= 7) return "medium";
    return "low";
  }
  calculateUrgencyScore(daysRemaining, remainingHours) {
    // daysRemaining 允许为 0（今天）或负数（逾期）
    if (daysRemaining <= 0) return 1000;
    if (daysRemaining === 1) return 700 + remainingHours; // 明天
    if (daysRemaining <= 3) return 200 + remainingHours * 2;
    if (daysRemaining <= 7) return 100 + remainingHours;
    return (remainingHours / daysRemaining) * 10;
  }

  // ═══ 收款相关辅助方法 ═══

  // 统计用净收（到账-退款）；若无收款记录则向后兼容使用 task.payment
  getTaskNetIncomeForStats(task) {
    if (!task || task.abandoned) return 0;
    const records = task.paymentRecords;
    if (!Array.isArray(records) || records.length === 0) {
      return Number(task.payment) || 0;
    }
    return Math.max(0, records.reduce((sum, r) => {
      const amt = Number(r.amount) || 0;
      return r.type === "refund" ? sum - amt : sum + amt;
    }, 0));
  }

  // 获取任务收款状态信息（用于卡片徽章）
  getPaymentStatusInfo(task) {
    if (!task) return null;
    if (task.abandoned) return { label: "已废弃", variant: "abandoned" };
    const contracted = Number(task.payment) || 0;
    const records = Array.isArray(task.paymentRecords) ? task.paymentRecords : [];
    const mode = task.paymentMode || "";
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
      full_pre: "全款先付", full_post: "全款后付",
      deposit: "定金+尾款", milestone: "节点付款",
    };
    const modeLabel = modeLabels[mode] || "";
    if (records.length === 0) {
      return modeLabel ? { label: modeLabel + "·待收", variant: "pending" } : null;
    }
    if (received > 0 && net <= 0) return { label: "全额退款", variant: "refunded" };
    if (contracted > 0 && net >= contracted) {
      return { label: `¥${net.toFixed(0)} 已全收${hasRefund ? "(含退款)" : ""}`, variant: "paid-full" };
    }
    if (net > 0) {
      return {
        label: `¥${net.toFixed(0)}/${contracted > 0 ? "¥" + contracted.toFixed(0) : "?"}${hasRefund ? "(含退款)" : ""}`,
        variant: "paid-partial",
      };
    }
    return { label: "未收款", variant: "pending" };
  }

  // 渲染 modal 内的收款记录列表
  // 废弃/恢复任务（任务卡片上的快速操作）
  toggleAbandoned(taskId) {
    const task = (this.tasks || []).find((t) => t.id === taskId);
    if (!task) return;
    task.abandoned = !task.abandoned;
    task.abandonedAt = task.abandoned ? new Date().toISOString() : null;
    this.saveAllData();
    this.renderTasks(taskId);
    this.updateStats();
    this.renderCalendar();
  }

  getSmartRecommendations(taskAnalysis, dailyRecommendedHours) {
    const recommendations = [];
    // 把临界定义为今天或已逾期（daysRemaining <= 0）
    const criticalTasks = taskAnalysis.filter((t) => t.daysRemaining <= 0);
    if (criticalTasks.length > 0) {
      recommendations.push({
        type: "urgent",
        text: `有${criticalTasks.length}个任务今日或已逾期，建议优先完成`,
        priority: "critical",
      });
    }

    if (dailyRecommendedHours > 24) {
      recommendations.push({
        type: "fun",
        text: `一天画${dailyRecommendedHours.toFixed(1)}小时？洗洗睡吧`,
        priority: "critical",
      });
    } else if (dailyRecommendedHours > 17) {
      recommendations.push({
        type: "warning",
        text: `当前日均建议工时为(${dailyRecommendedHours.toFixed(
          1
        )}h)，已无法满足7小时睡眠`,
        priority: "high",
      });
    } else if (dailyRecommendedHours > 12) {
      recommendations.push({
        type: "warning",
        text: `当前日均建议工时过高(${dailyRecommendedHours.toFixed(
          1
        )}h)，建议调整任务优先级或延长截止时间`,
        priority: "high",
      });
    }

    // 大型任务判定：预估总工时超过 56 小时（即工期超过 7 个工作日，按 8h/天计算）
    const highWorkloadTasks = taskAnalysis.filter((t) => (t.estimatedHours || 0) > 56);
    if (highWorkloadTasks.length > 0) {
      recommendations.push({
        type: "info",
        text: `有${highWorkloadTasks.length}个大型任务(${highWorkloadTasks
          .map((t) => t.name)
          .join("、")})，工期超过7个工作日，注意休息和分配优先级`,
        priority: "medium",
      });
    }
    if (dailyRecommendedHours < 4 && taskAnalysis.length > 0) {
      recommendations.push({
        type: "success",
        text: `当前工作量适中，可以提前完成任务或增加新任务`,
        priority: "low",
      });
    }
    return recommendations;
  }
  calculateDailyTime(deadline, estimatedHours, currentProgress, actualHours) {
    if (!deadline) return null;
    const now = new Date();
    const deadlineDate = new Date(deadline);
    const daysRemaining = this.getDaysRemaining(deadline);
    const remainingHours = Math.max(0, estimatedHours - (actualHours || 0));

    // 修改逻辑：允许逾期任务的剩余工时参与计算
    const dailyTime =
      daysRemaining <= 0
        ? remainingHours // 如果逾期或今天到期，将所有剩余工时视为当天需要完成的工时
        : remainingHours / daysRemaining;

    const intelligentWorkload = this.calculateIntelligentWorkload();
    return {
      hours: Math.ceil(dailyTime * 10) / 10,
      daysRemaining,
      urgent: daysRemaining <= 3,
      isHigherThanAverage:
        dailyTime > intelligentWorkload.dailyRecommendedHours * 1.2,
      intelligentDailyRecommended: intelligentWorkload.dailyRecommendedHours,
    };
  }
  getDeadlineStatus(deadline) {
    if (!deadline) return null;
    const now = new Date();
    const deadlineDate = new Date(deadline);
    const diffMs = deadlineDate - now;
    const diffHours = diffMs / (1000 * 60 * 60);
    const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const deadlineDateOnly = new Date(
      deadlineDate.getFullYear(),
      deadlineDate.getMonth(),
      deadlineDate.getDate()
    );
    // 与 getDaysRemaining 保持一致：0 表示今天，1 表示明天，负数表示已逾期
    const daysRemaining = Math.ceil(
      (deadlineDateOnly - nowDate) / (1000 * 60 * 60 * 24)
    );
    if (diffMs < 0) {
      return {
        status: "overdue",
        text: "已逾期",
        urgent: true,
      };
    } else if (diffHours < 1) {
      const remainingMinutes = Math.floor(diffMs / (1000 * 60));
      return {
        status: "imminent",
        text: `${remainingMinutes}分钟后截止`,
        urgent: true,
      };
    } else if (daysRemaining === 0) {
      return {
        status: "today",
        text: "今天到期",
        urgent: true,
      };
    } else if (daysRemaining === 1) {
      return {
        status: "tomorrow",
        text: "明天到期",
        urgent: true,
      };
    } else if (daysRemaining <= 3) {
      return {
        status: "urgent",
        text: `${daysRemaining}天`,
        urgent: true,
      };
    } else {
      return {
        status: "normal",
        text: `${daysRemaining}天`,
        urgent: false,
      };
    }
  }
  async deleteTask(id) {
    if (this.showingRecycleBin) {
      // 在回收站视图中点击删除：从回收站中永久删除
      this.recycleBin = (this.recycleBin || []).filter(
        (task) => task.id !== id
      );
      try {
        await this.saveAllData();
      } catch (e) {
        console.warn("保存回收站删除结果失败", e);
      }
      this.renderTasks(id);
      this.showMessage("已从回收站永久删除");
      this.updateStats();
      this.updateSmartRecommendations();
      this.renderCalendar();
      this.updateMonthlyStatsDisplay();
      return;
    }

    // 正常视图：移动到回收站（不需要确认，这里由调用处决定是否提示）
    const removed = this.tasks.filter((task) => task.id === id);
    this.tasks = this.tasks.filter((task) => task.id !== id);

    // 链式：删除时将后继绑定到该任务的前序，并触发链式调整；同时移除统计样本
    const parentsToAdjust = new Set();
    for (const t of removed) {
      const parentId = t.lineTaskId ?? null;
      const successors = this.getSuccessorTasks(t.id) || [];
      successors.forEach((s) => {
        s.lineTaskId = parentId;
      });
      if (parentId) parentsToAdjust.add(parentId);
      // 移除统计样本（无论是否链式）
      if (t.type) this.removeStatisticsSample(t.type, t.id);
    }
    if (parentsToAdjust.size > 0) {
      try {
        await this.withAdjustOverlay(async () => {
          parentsToAdjust.forEach((pid) => {
            const p = (this.tasks || []).find((x) => x.id === pid);
            if (p) this.adjustChainFrom(p);
          });
        });
      } catch (e) {
        console.warn("删除后链式调整失败", e);
      }
    }

    if (removed && removed.length > 0) {
      this.recycleBin = this.recycleBin || [];
      const moved = [];
      for (const t of removed) {
        let newImage = t.image;
        if (
          newImage &&
          typeof newImage === "string" &&
          newImage.startsWith("pic/")
        ) {
          try {
            newImage = await this.moveImageToRecycle(newImage);
          } catch (e) {
            console.warn("移动图片到回收站失败", e);
          }
        }
        moved.push({
          ...t,
          image: newImage,
          deletedAt: new Date().toISOString(),
        });
      }
      this.recycleBin = this.recycleBin.concat(moved);
    }

    try {
      await this.saveAllData();
    } catch (e) {
      console.warn("保存移动到回收站的任务失败", e);
    }
    this.updateStats();
    this.updateSmartRecommendations();
    this.renderTasks(id);
    this.renderCalendar();
    this.showMessage("任务已移动到回收站");
    this.updateMonthlyStatsDisplay();
  }

  async moveImageToRecycle(imagePath) {
    if (!imagePath || typeof imagePath !== "string") return imagePath;
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
  }

  async restoreImageFromRecycle(imagePath) {
    if (!imagePath || typeof imagePath !== "string") return imagePath;
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
  }

  // 从回收站恢复任务
  async restoreTask(id) {
    const removed = (this.recycleBin || []).filter((task) => task.id === id);
    if (!removed || removed.length === 0) {
      this.showMessage("未找到要恢复的任务");
      return;
    }

    // 先在本地移除回收站条目（局部刷新：删除 recycle 视图中的卡片）
    this.recycleBin = (this.recycleBin || []).filter((task) => task.id !== id);
    // 在回收站视图中局部移除对应卡片
    this.renderTasks(id);

    // 恢复字段并加入主任务列表（放在末尾），但不触发全局刷新
    for (const t of removed) {
      const copy = Object.assign({}, t);
      delete copy.deletedAt;
      if (
        copy.image &&
        typeof copy.image === "string" &&
        copy.image.startsWith("recyclepic/")
      ) {
        try {
          copy.image = await this.restoreImageFromRecycle(copy.image);
        } catch (e) {
          console.warn("恢复图片到主目录失败", e);
        }
      }
      // 恢复为独立任务，清理链式绑定字段，避免直接回链
      copy.dependencyType = "none";
      copy.lineTaskId = null;
      copy.autoSchedule = false;

      // 将任务加入内存中的任务列表（用于持久化）
      this.tasks = this.tasks || [];
      const insertIndex = this.tasks.length;
      this.tasks.push(copy);

      // 如果当前不在回收站视图（即主界面可见），则局部插入卡片
      if (!this.showingRecycleBin) {
        this.insertTaskCardLocally(copy, insertIndex);
      }

      // 若任务本身已完成，恢复对应的统计样本
      if (copy.completed) {
        this.recordCompletionStatistics(copy);
      }
    }

    // 持久化变更（依然需要保存到服务器），但避免全局刷新
    try {
      await this.saveAllData();
    } catch (e) {
      console.warn("保存恢复任务失败", e);
    }

    // 仅更新统计、日历与推荐（局部更新）
    this.updateStats();
    this.updateSmartRecommendations();
    this.renderCalendar();
    this.showMessage("任务已恢复");
    this.updateMonthlyStatsDisplay();
  }
  async toggleComplete(id) {
    const task = this.tasks.find((t) => t.id === id);
    if (task) {
      const wasCompleted = !!task.completed;
      this.applyCompletionToggle(task);
      const nowCompleted = !!task.completed;
      if (!wasCompleted && nowCompleted) {
        this.recordCompletionStatistics(task);
      } else if (wasCompleted && !nowCompleted) {
        this.removeStatisticsSample(task.type, task.id);
      }

      // 先尝试保存更新到服务端，确保后端数据与前端同步
      try {
        await this.saveAllData();
      } catch (e) {
        console.warn("保存完成状态时出错", e);
      }

      // 完成状态改变后，重算链式后继
      this.withAdjustOverlay(async () => {
        this.adjustChainFrom(task);
      });

      this.updateStats();
      this.updateSmartRecommendations();

      if (this.hideCompleted && task.completed) {
        // 如果任务已完成且处于隐藏已完成状态，移除对应的卡片（仅影响 UI）
        const existingCard = document.querySelector(
          `.task-card[data-task-id="${id}"]`
        );
        if (existingCard) {
          existingCard.remove();
        }

        // 重新计算布局，确保其他卡片补位
        if (this.isLandscape) {
          this.scheduleMasonryLayout();
        }
      } else {
        // 否则整卡重渲染，避免遗漏局部状态
        this.renderTasks(task.id);
      }

      // 同步刷新日历/日程条，确保任务卡片变更同时反映到日程视图
      try {
        this.renderCalendar();
      } catch (e) {
        console.warn("刷新日历失败", e);
      }

      // 更新月度统计显示
      this.updateMonthlyStatsDisplay();
      this.refreshTaskPreviewIfOpen(id);
    }
  }

  // 切换子任务完成状态并自动更新进度与任务完成状态
  toggleNodeComplete(taskId, nodeId) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return;

    const node = task.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // ✅ 切换完成状态
    node.completed = !node.completed;

    // ✅ 自动计算进度
    const total = task.nodes.length;
    const completed = task.nodes.filter((n) => n.completed).length;
    task.progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    // ✅ 自动完成任务（附带 completedAt 与统计更新）
    const wasCompleted = !!task.completed;
    task.completed = task.progress === 100;
    if (!wasCompleted && task.completed) {
      task.completedAt = new Date().toISOString();
      this.recordCompletionStatistics(task);
    } else if (wasCompleted && !task.completed) {
      task.completedAt = null;
      this.removeStatisticsSample(task.type, task.id);
    }

    // ✅ 保存 + 刷新
    this.saveAllData();
    this.updateStats();
    this.updateSmartRecommendations();
    const existingCard = document.querySelector(
      `.task-card[data-task-id="${task.id}"]`
    );
    if (existingCard) {
      this.updateTaskCard(task);
    } else {
      this.renderTasks();
    }
    this.refreshTaskPreviewIfOpen(task.id);
  }

  // 统一更新任务进度的方法
  updateProgress(id, progress) {
    const task = this.tasks.find((t) => t.id === id);
    if (task) {
      const wasCompleted = !!task.completed;
      task.progress = progress;
      task.completed = progress === 100;
      task.actualHours = Math.round((task.estimatedHours * progress) / 100);
      if (task.progress === 100 && task.nodes) {
        task.nodes.forEach((node) => (node.completed = true));
      }
      if (!wasCompleted && task.completed) {
        task.completedAt = new Date().toISOString();
        this.recordCompletionStatistics(task);
      } else if (wasCompleted && !task.completed) {
        task.completedAt = null;
        this.removeStatisticsSample(task.type, task.id);
      }
      this.saveAllData();
      this.updateStats();
      this.updateSmartRecommendations();
      this.renderTasks(task.id);
      this.refreshTaskPreviewIfOpen(id);
    }
  }
  setFilter(filter, preserveFirstRow = false) {
    this.currentFilter = filter;
    this._preserveStatsFirstRowOrder = preserveFirstRow;
    // 选择一个类型后自动收起折叠列表，回到紧凑视图
    this._statsExpanded = false;
    this.renderStatsCards();
    this.updateStats();
    this.renderTasks();
    this.scheduleMasonryLayout(120, false);
    // 重置一次保留标志，避免影响后续操作
    this._preserveStatsFirstRowOrder = false;
  }

  // 统一回收站切换方法：可传入布尔强制设置状态（true=回收站，false=索引），也可不传进行切换
  toggleRecycleView(forceState, silent = false) {
    if (typeof forceState === "boolean") this.showingRecycleBin = !!forceState;
    else this.showingRecycleBin = !this.showingRecycleBin;

    // 更新主界面按钮显示
    const mainBtn = document.getElementById("toggle-recycle-main-btn");
    if (mainBtn) {
      mainBtn.innerHTML = `<span class=\"material-icons text-sm mr-1\">delete_outline</span> ${
        this.showingRecycleBin ? "显示主界面" : "显示回收站"
      }`;
      if (this.showingRecycleBin) {
        // 在回收站视图中使用 "recycle" data-state（颜色在 CSS 中已调整）
        mainBtn.setAttribute("data-state", "recycle");
      } else {
        mainBtn.removeAttribute("data-state");
      }
    }

    // 切换回收站时重置筛选并刷新任务列表
    this.currentFilter = "all";

    // 强制在回收站视图显示已完成委托，并在离开时恢复之前设置
    const taskList = document.getElementById("task-list");
    if (this.showingRecycleBin) {
      // 保存之前的 hideCompleted 状态以便恢复
      this._prevHideCompleted = this.hideCompleted;
      this.hideCompleted = false;
      if (taskList) taskList.classList.remove("hide-completed");
    } else {
      // 恢复之前的 hideCompleted
      this.hideCompleted = !!this._prevHideCompleted;
      if (taskList) {
        if (this.hideCompleted) taskList.classList.add("hide-completed");
        else taskList.classList.remove("hide-completed");
      }
    }

    this.renderTasks();
    this.updateStats();

    // 更新隐藏/清空回收站按钮在回收站界面的显示，并调整样式以复用回收站（红色）样式
    const toggleBtns = document.querySelectorAll(
      '[data-testid="toggle-hide-completed-btn"]'
    );
    if (toggleBtns && toggleBtns.length > 0) {
      toggleBtns.forEach((b) => {
        if (this.showingRecycleBin) {
          b.classList.remove("opacity-80");
          b.innerHTML =
            '<span class="material-icons text-sm mr-1">delete_forever</span> 一键清空回收站';
          // 复用回收站红色样式：把按钮的变体改为 toggle-recycle 并移除 data-state
          b.setAttribute("data-variant", "toggle-recycle");
          b.removeAttribute("data-state");
        } else {
          // 恢复为隐藏已完成按钮的变体与文本
          b.setAttribute("data-variant", "toggle-hide-completed");
          if (this.hideCompleted) {
            b.classList.add("opacity-80");
            b.innerHTML =
              '<span class="material-icons text-sm mr-1">visibility</span> 显示已完成委托';
          } else {
            b.classList.remove("opacity-80");
            b.innerHTML =
              '<span class="material-icons text-sm mr-1">visibility_off</span> 隐藏已完成委托';
          }
        }
      });
    }

    if (!silent)
      this.showMessage(
        this.showingRecycleBin ? "已切换到回收站" : "已切换到主界面"
      );
  }
  getFilteredTasks() {
    let baseList = this.showingRecycleBin
      ? this.recycleBin || []
      : this.tasks || [];
    let filteredTasks;

    // ✅ 类型过滤（横竖屏都适用）
    if (this.currentFilter === "all") {
      filteredTasks = baseList;
    } else {
      filteredTasks = baseList.filter(
        (task) => task.type === this.currentFilter
      );
    }

    // 如果用户在页面设置中启用了“默认隐藏上个月及之前的已完成委托”，
    // 在主界面（非回收站）过滤出那些已完成/已废弃且时间早于本月第一天的任务
    if (!this.showingRecycleBin && this.hideCompletedBeforeLastMonth) {
      try {
        const now = new Date();
        const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        filteredTasks = filteredTasks.filter((t) => {
          if (!t) return true;
          // 已完成：按 completedAt 判断
          if (t.completed) {
            const ca = t.completedAt || t.completed_at || null;
            if (!ca) return true; // 如果没有完成时间则保留（尽量不误删）
            const cdt = new Date(ca);
            if (isNaN(cdt.getTime())) return true;
            return cdt >= startOfThisMonth; // 仅保留本月及之后完成的任务
          }
          // 已废弃：按 abandonedAt 判断，逻辑与已完成一致
          if (t.abandoned) {
            const aa = t.abandonedAt || null;
            if (!aa) return true;
            const adt = new Date(aa);
            if (isNaN(adt.getTime())) return true;
            return adt >= startOfThisMonth;
          }
          return true;
        });
      } catch (e) {
        // 若解析失败，安全退回到不进行额外过滤
        console.warn("hideCompletedBeforeLastMonth filter failed", e);
      }
    }

    // 搜索过滤（标题/备注，模糊匹配）
    if (this.searchQuery && String(this.searchQuery).trim()) {
      const q = String(this.searchQuery).trim().toLowerCase();
      filteredTasks = filteredTasks.filter((t) => {
        const title = (t.name || "").toLowerCase();
        const note = (t.note || "").toLowerCase();
        return title.includes(q) || note.includes(q);
      });
    }

    // ✅ 排序逻辑（根据横竖屏切换）
    if (this.isLandscape) {
      return filteredTasks.sort((a, b) => {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline) - new Date(b.deadline);
      });
    }

    return filteredTasks.sort((a, b) => {
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }

      if (!a.completed && !b.completed) {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline) - new Date(b.deadline);
      }

      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  updateStats() {
    this.renderStatsCards();
  }
  updateSmartRecommendations() {
    const intelligentWorkload = this.calculateIntelligentWorkload();
    const recommendationsPanel = document.getElementById(
      "smart-recommendations"
    );
    const recommendationsList = document.getElementById("recommendations-list");
    if (intelligentWorkload.totalRemainingHours === 0) {
      recommendationsPanel.style.display = "none";
      return;
    }
    recommendationsPanel.style.display = "block";
    document.getElementById("total-remaining-hours").textContent =
      intelligentWorkload.totalRemainingHours + "h";
    document.getElementById("daily-recommended-hours").textContent =
      intelligentWorkload.dailyRecommendedHours + "h";
    document.getElementById("days-remaining").textContent =
      intelligentWorkload.totalDaysRemaining + "天";
    if (intelligentWorkload.recommendations.length === 0) {
      recommendationsList.innerHTML = `
                <div class="flex items-center p-2 rounded-lg" data-rec-type="success">
                    <span class="material-icons mr-1 text-sm">check_circle</span>
                    <span class="text-xs">工作量安排合理，继续保持！</span>
                </div>
            `;
    } else {
      recommendationsList.innerHTML = intelligentWorkload.recommendations
        .map((rec) => {
          let icon = rec.icon;
          if (!icon) {
            switch (rec.type) {
              case "fun":
                icon = "☝️🤓";
                break;
              case "urgent":
                icon = "warning";
                break;
              case "warning":
                icon = "priority_high";
                break;
              case "info":
                icon = "info";
                break;
              case "success":
                icon = "check_circle";
                break;
              default:
                icon = "lightbulb";
            }
          }
          const isEmoji = /[^\w-]/.test(icon);
          return `<div class="flex items-center gap-2 p-2 rounded" data-rec-type="${
            rec.type
          }"> ${
            isEmoji
              ? `<span style="font-size:16px; line-height:1; vertical-align:middle;">${icon}</span>`
              : `<span class="material-icons">${icon}</span>`
          } 
          <span class="text-sm">${rec.text}
          </span> 
          </div>`;
        })
        .join("");
    }
  }
  // ✅ 局部插入新卡片，不触发全局刷新
  insertTaskCardLocally(task, index) {
    const taskList = document.getElementById("task-list");
    const cardHTML = this.createTaskCard(task);

    // 创建一个临时的包裹元素
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = cardHTML;
    const newCardEl = tempDiv.firstElementChild;

    // 找到当前列表中对应位置的卡片
    const currentCards = taskList.querySelectorAll(".task-card");
    if (currentCards.length > 0 && index < currentCards.length) {
      // 在指定位置之前插入
      taskList.insertBefore(newCardEl, currentCards[index]);
    } else {
      // 如果是最后一位，直接添加
      taskList.appendChild(newCardEl);
    }

    // 重新绑定事件（如删除、编辑按钮）
    this.bindTaskEvents();

    // 如果是横屏（瀑布流模式），触发重新布局动画
    if (this.isLandscape) {
      this.applyMasonryLayout();
    } else {
      // 竖屏模式下，添加简单的淡入动画
      setTimeout(() => newCardEl.classList.add("is-laid-out"), 10);
    }
  }
  renderTasks(updateTaskId = null) {
    const taskList = document.getElementById("task-list");
    const emptyState = document.getElementById("empty-state");
    let filteredTasks = this.getFilteredTasks();

    // 1. 基础过滤逻辑
    if (this.hideCompleted) {
      filteredTasks = filteredTasks.filter((t) => !t.completed);
    }

    if (filteredTasks.length === 0) {
      taskList.innerHTML = "";
      emptyState.style.display = "block";
      return;
    }
    emptyState.style.display = "none";

    // --- 局部更新逻辑 (比如修改了某个任务) ---
    if (updateTaskId) {
      const task = filteredTasks.find((t) => t.id === updateTaskId);
      const existingCard = taskList.querySelector(
        `.task-card[data-task-id="${updateTaskId}"]`
      );

      if (!task) {
        if (existingCard) existingCard.remove();
        if (this.isLandscape) this.applyMasonryLayout(); // 局部变动也触发重新排版
        return;
      }

      if (existingCard) {
        const newCardHTML = this.createTaskCard(task);
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = newCardHTML;
        const newCardEl = tempDiv.firstElementChild;
        existingCard.className = newCardEl.className;
        existingCard.innerHTML = newCardEl.innerHTML;
        existingCard.dataset.type = newCardEl.dataset.type;
        existingCard.dataset.testid = newCardEl.dataset.testid;
        // 保持“就绪”状态
        existingCard.classList.add("is-laid-out");
      }

      this.bindTaskEvents();
      if (this.isLandscape) this.applyMasonryLayout();
      return;
    }

    // --- 全局刷新逻辑 (页面加载或切换视图时) ---

    // 1. 清空当前列表
    taskList.innerHTML = "";

    // 2. 批量添加卡片
    // 注意：因为 CSS 设了 top:0; left:0;，这些卡片一出来就会整齐叠在左上角
    filteredTasks.forEach((task) => {
      const cardHTML = this.createTaskCard(task);
      taskList.insertAdjacentHTML("beforeend", cardHTML);
    });

    this.bindTaskEvents();

    if (!this.isLandscape) {
      // 检测当前容器宽度是否能容纳多列瀑布流（在大平板竖屏上常见）
      const cs = getComputedStyle(taskList);
      const paddingLeft = Math.floor(parseFloat(cs.paddingLeft) || 0);
      const paddingRight = Math.floor(parseFloat(cs.paddingRight) || 0);
      const usableWidth = Math.max(
        0,
        taskList.clientWidth - paddingLeft - paddingRight
      );
      const gap = 20;
      const minCard = 310;
      const columnCountCandidate = Math.max(
        1,
        Math.floor((usableWidth + gap) / (minCard + gap))
      );

      if (columnCountCandidate > 1) {
        // 启用竖屏下的 Masonry 布局（多列平板场景）
        taskList.classList.add("task-list");
        taskList.classList.remove("space-y-4");
        const container = document.getElementById("container");
        if (container) container.classList.add("masonry-enabled");

        const cards = taskList.querySelectorAll(".task-card");
        // 设置每张卡片为绝对定位并准备宽度（与 applyMasonryLayout 保持一致）
        const maxCard = 435;
        const columnCount = columnCountCandidate;
        const cardWidth = Math.max(
          100,
          Math.min(
            maxCard,
            Math.floor((usableWidth - gap * (columnCount - 1)) / columnCount)
          )
        );

        cards.forEach((card) => {
          card.style.boxSizing = "border-box";
          card.style.width = `${cardWidth}px`;
          card.style.minWidth = `${cardWidth}px`;
          card.style.maxWidth = `${cardWidth}px`;
          card.style.position = "absolute";
          card.style.opacity = "";
          card.classList.remove("is-laid-out");
        });

        // 触发 masonry 布局
        this.scheduleMasonryLayout(60, false);
      } else {
        // 【竖屏模式】回归正常列表流
        if (document.getElementById("container"))
          document
            .getElementById("container")
            .classList.remove("masonry-enabled");
        taskList.style.height = "auto";
        taskList.classList.remove("task-list");
        taskList.classList.add("space-y-4");

        const cards = taskList.querySelectorAll(".task-card");
        cards.forEach((card, index) => {
          // 竖屏下不需要绝对定位
          card.style.position = "relative";
          card.style.top = "auto";
          card.style.left = "auto";
          card.style.width = "100%";
          // 依次淡入显示
          setTimeout(() => card.classList.add("is-laid-out"), index * 20);
        });
      }
    } else {
      // 【横屏模式】开启发牌式瀑布流
      // 使用已在函数开头声明的 taskList（不要再用 const 声明）
      taskList.classList.add("task-list");
      taskList.classList.remove("space-y-4");

      // ✅ 关键修复：延迟执行布局，确保 CSS 已加载且容器尺寸稳定
      // 首次加载时用较长延迟，后续操作用较短延迟
      // 原来可能是：
      // const delay = this._firstMasonryLayout ? 150 : 300;
      // this._firstMasonryLayout = true;
      // this.scheduleMasonryLayout(delay, false);

      // 替换为下面更稳妥的触发方式：
      const delay = this._firstMasonryLayout ? 150 : 300;
      this._firstMasonryLayout = true;

      // 1) 先清理可能残留的 inline 定位样式（避免旧样式影响下一次测量）
      if (taskList) {
        const existingCards = taskList.querySelectorAll(".task-card");
        existingCards.forEach((c) => {
          // 仅清理会影响测量/定位的内联样式
          c.style.left = "";
          c.style.top = "";
          c.style.width = "";
          c.style.opacity = "";
          c.style.transform = "";
          c.classList.remove("is-laid-out");
        });
      }

      // 2) 等待浏览器完成一次绘制帧，再短延迟触发 schedule（确保 CSS transition/DOM 更新稳定）
      requestAnimationFrame(() => {
        // 0ms 的 setTimeout 把任务推到下一个事件循环，配合 requestAnimationFrame 更稳妥
        setTimeout(() => {
          this.scheduleMasonryLayout(delay, false);
        }, 0);
      });
    }
  }

  getTimerButton(task) {
    if (!task || task.completed) return "";
    const running = this.isTimerRunning(task.id);
    const isPaused = !!task.paused;
    const type = this.taskTypes.find((t) => t.id === task.type);
    const typeColor = type ? type.color : "#95A5A6";
    const btnBg = this.computeButtonBgFromHex(typeColor);
    const timerBtn = `<button class="timer-btn text-white rounded-full px-4 py-2 flex items-center justify-center transition-colors flex-shrink-0" data-task-id="${task.id}" data-testid="timer-btn-${task.id}" style="background:${btnBg}"><span class="material-icons text-sm mr-2">${this.getTimerIcon(running)}</span><span class="text-sm font-medium">${this.getTimerLabel(running, !!task.actualStartTime, isPaused)}</span></button>`;
    // 暂停/恢复按钮（已完成和废弃不显示）
    if (task.abandoned) return `<div class="mt-3 flex justify-center items-center gap-2">${timerBtn}</div>`;
    const pauseIcon = isPaused ? "replay" : "play_disabled";
    const pauseClass = isPaused ? "pause-btn--paused" : "";
    const pauseBgStyle = isPaused ? "" : `background:${btnBg};`;
    const pauseBtn = `<button class="pause-btn ${pauseClass}" data-task-id="${task.id}" data-testid="pause-btn-${task.id}" style="${pauseBgStyle}"><span class="material-icons-round text-sm">${pauseIcon}</span></button>`;
    return `<div class="mt-3 flex justify-center items-center gap-2">${timerBtn}${pauseBtn}</div>`;
  }

  updateTimerButtonUI(task) {
    if (!task) return;
    const card = document.querySelector(
      `.task-card[data-task-id="${task.id}"]`
    );
    if (!card) return;
    const timerBtn =
      card.querySelector(`.timer-btn[data-task-id="${task.id}"]`) ||
      card.querySelector(".timer-btn");
    if (!timerBtn) return;
    const running = this.isTimerRunning(task.id);
    const isPaused = !!task.paused;
    const icon = timerBtn.querySelector(".material-icons");
    if (icon) icon.textContent = this.getTimerIcon(running);
    const textSpan =
      timerBtn.querySelector(".text-sm.font-medium") ||
      timerBtn.querySelector("span:last-child");
    if (textSpan) textSpan.textContent = this.getTimerLabel(running, !!task.actualStartTime, isPaused);
    // 更新暂停按钮状态
    const pauseBtn = card.querySelector(`.pause-btn[data-task-id="${task.id}"]`);
    const type = this.taskTypes.find((t) => t.id === task.type);
    const typeColor = type ? type.color : "#95A5A6";
    const btnBg = this.computeButtonBgFromHex(typeColor);
    // 计时按钮也用 oklch 颜色
    if (timerBtn) timerBtn.style.background = btnBg;
    if (pauseBtn) {
      pauseBtn.classList.toggle("pause-btn--paused", isPaused);
      const pauseIcon = pauseBtn.querySelector(".material-icons-round");
      if (pauseIcon) pauseIcon.textContent = isPaused ? "replay" : "play_disabled";
      pauseBtn.style.background = isPaused ? "" : btnBg;
    }
  }

  getTimerIcon(running) {
    return running ? "stop" : "timer";
  }

  // running: 是否正在计时；hasActualStart：是否已有实际开始时间；paused: 是否暂停中
  getTimerLabel(running, hasActualStart = false, paused = false) {
    if (running) return "结束画画计时";
    if (paused) return "继续委托并计时";
    return hasActualStart ? "开始画画计时" : "开始首次画画计时";
  }

  createTaskCard(task) {
    const type = this.taskTypes.find((t) => t.id === task.type);
    const typeColor = type ? type.color : "#95A5A6";
    //用户自定义颜色函数计算浅色背景
    const lightBg = this.computeLightBgFromHex(typeColor);
    const cardTextColor = "#1f2937";
    const typeName = type ? type.name : "未知类型";
    const source = this.sourcePlatforms.find((s) => s.id === task.source);
    const sourceColor = source ? source.color : "#95A5A6";
    const sourceName = source ? source.name : "未知平台";
    const deadlineStatus = this.getDeadlineStatus(task.deadline);
    // 使用语义化的截止状态用于数据驱动的样式（completed / overdue / imminent / today / tomorrow / urgent / normal）
    const deadlineStatusName = task.completed
      ? "completed"
      : deadlineStatus?.status || "normal";
    const dailyTime = this.calculateDailyTime(
      task.deadline,
      task.estimatedHours,
      task.progress,
      task.actualHours
    );
    const completedHours = task.actualHours || 0;
    const remainingHours = Math.max(0, task.estimatedHours - completedHours);
    const progressPercentage =
      task.estimatedHours > 0
        ? Math.round((completedHours / task.estimatedHours) * 100)
        : 0;
    let progressLevel;
    if (progressPercentage > 100) progressLevel = "over";
    else if (progressPercentage === 100) progressLevel = "complete";
    else if (progressPercentage >= 70) progressLevel = "high";
    else if (progressPercentage >= 40) progressLevel = "mid";
    else progressLevel = "low";

    const hasNodes = task.nodes && task.nodes.length > 0;
    const hasImage = task.image && task.image.trim() !== "";
    const hasPayment = task.payment && task.payment > 0;
    // 收款状态信息（新系统）
    const paymentInfo = this.getPaymentStatusInfo(task);
    const netIncome = this.getTaskNetIncomeForStats(task) || (task.payment || 0);
    const hourlyRate = netIncome > 0
      ? task.completed
        ? task.actualHours > 0
          ? (netIncome / task.actualHours).toFixed(2)
          : 0
        : task.estimatedHours > 0
        ? (netIncome / task.estimatedHours).toFixed(2)
        : 0
      : 0;

    // Header 使用现有计算的 lightBg；Body 在 Header 的基础上向白色混合 70% 以增强可读性
    const headerBg = lightBg;
    const bodyBg = this.blendWithWhite(headerBg, this.cardBodyWhiteBlend);

    return `
            <div class="task-card ${
              task.completed ? "completed" : ""
            } ${
              task.abandoned ? "abandoned" : ""
            } rounded-xl ${
      deadlineStatus?.urgent && !task.abandoned ? "deadline-warning" : ""
    }" data-task-id="${task.id}" data-type="${
      task.type
    }" data-testid="task-card-${
      task.id
    }" style="background: transparent; color: ${cardTextColor}; overflow: hidden;">
               <!-- 标题模块 -->
               <div class="task-card-header" style="background: ${headerBg}; padding: 1.5rem; padding-block-end: 0; border-top-left-radius: 1rem; border-top-right-radius: 1rem;">
                <div class="flex items-start justify-between" style="transform: translateY(-5px); margin-bottom: -5px; line-height:1.15;">
                    <div class="flex justify-between items-center flex-1" style="min-width:0;">
                        <div class="flex-1" style="min-width:0;">
                            <h3 class="font-bold text-xl ${
                              task.completed ? "line-through" : ""
                            }" style="color: inherit; margin:0; line-height:1.15; overflow-wrap:anywhere;">${
      task.name.replace(/_/g, '_<wbr>')
    }</h3>
                        </div>
                    </div>
                    <div class="flex flex-col items-start gap-1">
                        <div class="flex items-start gap-2" >
                            <!-- 编辑按钮 -->
                            <button class="flex items-center edit-btn" data-task-id="${
                              task.id
                            }" data-testid="edit-btn-${task.id}">
                                <span class="material-icons text-sm">edit</span>
                            </button> 
                            <!-- 专门的完成按钮点击区域 -->
                            <div class="task-complete-area flex items-center cursor-pointer rounded transition-colors scale-90" data-testid="complete-area-${
                              task.id
                            }">
                                ${
                                  task.completed
                                    ? '<span class="material-icons text-green-500">check_circle</span>'
                                    : '<span class="material-icons text-green-500">radio_button_unchecked</span>'
                                }
                            </div>
                            ${
                              this.showingRecycleBin
                                ? `<button class="flex items-center restore-btn" title="还原" aria-label="还原" data-task-id="${task.id}" data-testid="restore-btn-${task.id}"><span class="material-icons text-sm">restore</span></button>
                                 <button class="flex items-center delete-btn" title="彻底删除" aria-label="彻底删除" data-task-id="${task.id}" data-testid="delete-btn-${task.id}"><span class="material-icons text-sm scale-102">delete_forever</span></button>`
                                : `<button class="flex items-center delete-btn" data-task-id="${task.id}" data-testid="delete-btn-${task.id}"><span class="material-icons text-sm scale-102">delete</span></button>
                                 <button class="flex items-center" title="${task.abandoned ? '\u6062\u590d\u4efb\u52a1' : '\u5e9f\u5f03\u4efb\u52a1'}" onclick="taskManager.toggleAbandoned(${task.id})" data-testid="abandon-btn-${task.id}" style="opacity:${task.abandoned ? 1 : 0.45};">
                                   <span class="material-icons text-sm" style="color:${task.abandoned ? '#f97316' : 'currentColor'}">${task.abandoned ? 'undo' : 'block'}</span>
                                 </button>`
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
                              this.dateOnlyDeadlineMode
                                ? new Date(task.completedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit" })
                                : new Date(task.completedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                            }</div>`
                          : task.deadline
                          ? `<div data-deadline-status="${
                              (deadlineStatus && deadlineStatus.status) ||
                              "normal"
                            }" class="deadline-date">截止: ${
                              this.dateOnlyDeadlineMode
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
               <!-- 数值区 --> 
               <div class="task-card-body pt-0 overflow-hidden" style="background: ${bodyBg}; padding: 1.5rem; padding-top: 0; border-bottom-left-radius: 1rem; border-bottom-right-radius: 1rem;">
                <div class="flex items-center gap-1 mt-2 mb-2">
                <!-- 数值模块同一行显示 -->
                      ${
                        // 废弃任务优先显示废弃徽章
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
                      <!-- 链式 pill 已移除（BarView 中仍可见） -->
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
                    ? `<div class="mb-2 mt-0"><div class="relative inline-block"><img src="${
                        task.image
                      }" alt="${
                        task.name
                      }" class="w-full h-auto rounded-lg cursor-pointer hover:opacity-90 transition-opacity" style="${
                        task.w && task.h
                          ? `aspect-ratio: ${task.w} / ${task.h};`
                          : `min-height: 150px;`
                      } background-color: #f3f4f6;" onclick="taskManager.showImageModal('${
                        task.image
                      }', '${task.name}')"></div></div>`
                    : ""
                }

                <div class="mb-2">
                    <div class="flex justify-between items-center gap-2">
                        <span class="text-base text-stone-600 flex-shrink-0">耗时:</span>
                        <div class="used-hours-control flex items-center gap-2 flex-1 min-w-0">
                            <button type="button" class="decrement-hours-btn w-7 h-7 flex items-center justify-center rounded border hover:bg-stone-100" data-task-id="${
                              task.id
                            }" aria-label="减少1小时" style="border-color: ${headerBg};">
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
                            <button type="button" class="increment-hours-btn w-7 h-7 flex items-center justify-center rounded border hover:bg-stone-100" data-task-id="${
                              task.id
                            }" aria-label="增加1小时" style="border-color: ${headerBg};">
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
                          const pres = this.getNodePresentation(node);
                          const { icon, background, textClass, iconClass } =
                            pres;
                          return `<div class="node-item ${
                            node.completed ? "completed" : ""
                          } ${
                            !node.completed && !task.completed ? "active" : ""
                          } pl-3 py-1 rounded" data-node="${
                            node.name
                          }"><label class="flex items-center cursor-pointer gap-1" data-testid="node-${
                            task.id
                          }-${node.id}"><input type="checkbox" ${
                            node.completed ? "checked" : ""
                          } class="mr-2" data-task-id="${
                            task.id
                          }" data-node-id="${
                            node.id
                          }" onchange="taskManager.toggleNodeComplete(${
                            task.id
                          }, ${node.id})">${
                            icon
                              ? `<span class="${iconClass} text-sm">${icon}</span>`
                              : ""
                          }<span class="text-sm ${
                            node.completed ? "line-through" : ""
                          } node-name">${node.name}</span></label></div>`;
                        })
                        .join("")}</div></div>`
                    : ""
                }
                
                ${this.getTimerButton(task)}
            </div>
            </div>
        `;
  }
  // 局部更新单张卡片，不替换 DOM 节点，尽量避免触发 Masonry 重排
  updateTaskCard(task) {
    const card = document.querySelector(
      `.task-card[data-task-id="${task.id}"]`
    );
    if (!card) return;

    const prevHeight = card.offsetHeight;

    // 标题与完成样式
    const titleEl = card.querySelector("h3");
    if (titleEl) {
      titleEl.classList.toggle("line-through", !!task.completed);
      titleEl.textContent = task.name || "";
    }

    // type badge 颜色
    const type = this.taskTypes.find((t) => t.id === task.type);
    const badge = card.querySelector(".type-badge");
    if (badge && type) badge.style.backgroundColor = type.color;

    // 进度条与颜色
    const progressBar = card.querySelector(".progress-bar");
    const completedHours = task.actualHours || 0;
    const progressPercentage = task.estimatedHours
      ? Math.round((completedHours / task.estimatedHours) * 100)
      : 0;
    if (progressBar) {
      progressBar.style.width = progressPercentage + "%";
      progressBar.classList.remove(
        "bg-green-500",
        "bg-blue-500",
        "bg-yellow-500",
        "bg-red-500"
      );
      const colorClass =
        progressPercentage === 100
          ? "bg-green-500"
          : progressPercentage >= 70
          ? "bg-blue-500"
          : progressPercentage >= 40
          ? "bg-yellow-500"
          : "bg-red-500";
      progressBar.classList.add(colorClass);
    }

    // 已用工时输入框
    const usedInput = card.querySelector(".used-hours-input");
    if (usedInput) usedInput.value = task.actualHours || 0;

    // 更新开始时间与截止时间显示（若存在）
    const datesContainer = card.querySelector(".task-dates");
    if (datesContainer) {
      let deadlineHtml = "";
      if (task.completed && task.completedAt) {
        const d = new Date(task.completedAt);
        deadlineHtml = `<div class="deadline-date deadline-date--completed">已完成: ${this.dateOnlyDeadlineMode ? d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit" }) : d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>`;
      } else if (task.deadline) {
        deadlineHtml = `<div data-deadline-status="${
          (this.getDeadlineStatus(task.deadline) &&
            this.getDeadlineStatus(task.deadline).status) ||
          "normal"
        }" class="deadline-date">截止: ${
          this.dateOnlyDeadlineMode
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
        }</div>`;
      }
      datesContainer.innerHTML = deadlineHtml;
    }

    // 节点状态更新
    if (task.nodes && task.nodes.length > 0) {
      task.nodes.forEach((node) => {
        const pres = this.getNodePresentation(node);
        const { icon, background, textClass } = pres;

        const nodeSpan = card.querySelector(
          `[data-testid=\"node-${task.id}-${node.id}\"] .node-name`
        );
        if (nodeSpan) {
          nodeSpan.className = `text-sm ${textClass || ""} ${
            node.completed ? "line-through" : ""
          } node-name`;
          nodeSpan.textContent = node.name || "";
        }
        const iconSpan = card.querySelector(
          `[data-testid=\"node-${task.id}-${node.id}\"] .material-icons`
        );
        if (iconSpan) {
          iconSpan.textContent = icon || "label";
          iconSpan.className = `material-icons text-sm ${textClass || ""}`;
        }
        const checkbox = card.querySelector(
          `input[data-node-id="${node.id}"][data-task-id="${task.id}"]`
        );
        if (checkbox) checkbox.checked = !!node.completed;
        const nodeItem = card.querySelector(
          `[data-testid=\"node-${task.id}-${node.id}\"]`
        );
        if (nodeItem) {
          const container = nodeItem.closest(".node-item");
          if (container) {
            container.classList.toggle("completed", !!node.completed);
            container.classList.toggle(
              "active",
              !node.completed && !task.completed
            );
          }
        }
      });
    }

    // 完成图标与卡片状态
    const completeArea = card.querySelector(".task-complete-area");
    if (completeArea) {
      completeArea.innerHTML = task.completed
        ? '<span class="material-icons text-green-500">check_circle</span>'
        : '<span class="material-icons text-stone-400">radio_button_unchecked</span>';
    }
    card.classList.toggle("completed", !!task.completed);

    // 图片更新（如果存在）
    const img = card.querySelector("img");
    if (img && task.image) img.src = task.image;

    // 计时按钮状态与文本（合并插入/移除逻辑，确保父容器也被清理）
    const timerBtn = card.querySelector(".timer-btn");
    // 可能存在旧的父容器但按钮已被移除的情况，尝试找到容器
    const timerContainer =
      card.querySelector(".mt-3.flex.justify-center") ||
      (timerBtn && timerBtn.parentElement);
    if (task.completed) {
      // 完成：移除整个容器（如果存在）
      if (timerContainer) timerContainer.remove();
    } else {
      // 未完成：如果按钮存在，更新状态；否则（容器可能存在但无按钮或全无）插入新按钮
      if (timerBtn) {
        this.updateTimerButtonUI(task);
      } else {
        // 清理可能残留的空容器，避免重复插入导致高度累加
        if (timerContainer) timerContainer.remove();
        // 将计时按钮添加到卡片主体的最下方，确保它在任务节点之后
        card
          .querySelector(".task-card-body")
          .insertAdjacentHTML("beforeend", this.getTimerButton(task));
      }
    }

    // 如果高度发生显著变化，则触发局部 Masonry 重新计算
    const newHeight = card.offsetHeight;
    if (Math.abs(newHeight - prevHeight) > 2) {
      if (this.isLandscape) this.scheduleMasonryLayout();
    }
  }

  // 绑定任务卡片上的各种事件
  bindTaskEvents() {
    const taskList = document.getElementById("task-list");

    // 确保父容器存在
    if (!taskList) return;

    // click 事件的处理器由 constructor 创建引用，并在 init() 中只绑定一次，
    // 以避免重复绑定导致的多次触发。

    // 监听输入框的变化事件（用于调整已用工时）
    // change 处理器在 init() 中仅绑定一次：使用 `_onTaskListChange`
  }
  // 调整已用工时
  adjustHours(taskId, hoursChange) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const newActualHours = Math.max(0, (task.actualHours || 0) + hoursChange);
    task.actualHours = newActualHours;
    task.progress =
      task.estimatedHours > 0
        ? Math.min(
            100,
            Math.round((newActualHours / task.estimatedHours) * 100)
          )
        : 0;
    if (task.completed && task.nodes) {
      task.nodes.forEach((node) => (node.completed = true));
    }
    if (task.completed) {
      task.completedHours = task.actualHours;
      this.recordCompletionStatistics(task);
    }
    this.saveAllData();
    this.updateStats();
    this.updateSmartRecommendations();
    this.renderTasks(task.id);
    this.updateMonthlyStatsDisplay();
    this.refreshTaskPreviewIfOpen(taskId);
  }

  // 显示确认对话框（可自定义确认按钮文字和样式）
  showConfirmDialog(message, onConfirm, options = {}) {
    const confirmLabel = options.confirmLabel || "删除";
    const confirmClass = options.confirmClass || "bg-red-500 text-white hover:bg-red-600";
    const dialogEl = document.createElement("div");
    dialogEl.className =
      "fixed inset-0 z-50 flex items-center justify-center p-4";
    dialogEl.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
    dialogEl.innerHTML = `
            <div class="bg-white rounded-xl p-6 max-w-sm w-full">
                <div class="mb-4">
                    <p class="text-stone-800">${message}</p>
                </div>
                <div class="flex gap-3">
                    <button class="confirm-cancel flex-1 px-4 py-2 border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors">
                        取消
                    </button>
                    <button class="confirm-ok flex-1 px-4 py-2 rounded-lg transition-colors ${confirmClass}">
                        ${confirmLabel}
                    </button>
                </div>
            </div>
        `;
    document.body.appendChild(dialogEl);
    dialogEl.querySelector(".confirm-cancel").addEventListener("click", () => {
      document.body.removeChild(dialogEl);
    });
    dialogEl.querySelector(".confirm-ok").addEventListener("click", () => {
      try {
        onConfirm && onConfirm();
      } finally {
        if (dialogEl && dialogEl.parentNode)
          dialogEl.parentNode.removeChild(dialogEl);
      }
    });
    dialogEl.addEventListener("click", (e) => {
      if (e.target === dialogEl) {
        document.body.removeChild(dialogEl);
      }
    });
  }
  showMessage(message) {
    const messageEl = document.createElement("div");
    messageEl.className =
      "fixed top-4 left-1/2 transform -translate-x-1/2 bg-stone-800 text-white px-4 py-2 rounded-lg shadow-lg z-50 transition-opacity duration-300";
    messageEl.textContent = message;
    document.body.appendChild(messageEl);
    setTimeout(() => {
      messageEl.style.opacity = "0";
      setTimeout(() => {
        document.body.removeChild(messageEl);
      }, 300);
    }, 2000);
  }
  // 链路冲突选择对话框：并列 / 插入；点击遮罩取消
  showLinkModeDialog() {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4";
      overlay.style.backgroundColor = "rgba(0,0,0,0.45)";
      overlay.innerHTML = `
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 select-none link-mode-dialog">
          <div class="mb-4">
            <p class="text-base text-stone-800 font-medium">请选择当前任务的链接方式</p>
            <p class="text-sm text-stone-500 mt-1">并列：保持与其他后继并行；插入：将现有后继改为当前任务的后继</p>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <button type="button" data-mode="parallel" class="px-4 py-2 rounded-lg border border-stone-300 hover:bg-stone-50 text-stone-800">并列</button>
            <button type="button" data-mode="insert" class="px-4 py-2 rounded-lg border border-stone-300 hover:bg-stone-50 text-stone-800">插入</button>
          </div>
        </div>`;
      const cleanup = (result) => {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(result);
      };
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) cleanup(null); // 点击遮罩视为取消
      });
      const buttons = overlay.querySelectorAll("button[data-mode]");
      buttons.forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          cleanup(btn.getAttribute("data-mode"));
        });
      });
      document.body.appendChild(overlay);
    });
  }
  // 渲染任务类型和来源平台选项
  renderTaskTypeOptions() {
    const container = document.getElementById("task-type-options");
    if (!container) return;
    const typeOptionsHTML = this.taskTypes
      .map(
        (type) => `
            <label class="flex items-center p-3 border border-stone-300 rounded-lg cursor-pointer hover:bg-stone-50" data-testid="type-${
              type.id
            }">
                <input type="radio" name="task-type" value="${
                  type.id
                }" class="mr-3" ${type.id === "illustration" ? "checked" : ""}>
                <span class="type-badge mr-2" style="background-color: ${
                  type.color || this.stringToColor(type.id)
                }; width: 12px; height: 12px; border-radius: 50%; display: inline-block;"></span>
                <span>${type.name}</span>
            </label>
        `
      )
      .join("");

    const quickAddType = this.showQuickAddInputs
      ? `
      <label class="flex items-center p-3 border border-dashed border-stone-300 rounded-lg cursor-pointer">
        <input type="radio" name="task-type" value="__quick-add-type__" class="mr-1">
        <div class="flex items-center mr-1">
          <input id="quick-add-type-color" type="color" class="color-picker-sm w-8 h-8 rounded cursor-pointer border-0 p-0 outline-none" value="#3b82f6" title="选择类型颜色">
        </div>
        <input id="quick-add-type-name" type="text" class="w-full px-2 py-1 border border-stone-200 rounded-md focus:outline-none text-sm" placeholder="新增任务类型">
      </label>`
      : "";

    container.className = "grid grid-cols-2 gap-2";
    container.innerHTML = typeOptionsHTML + quickAddType;

    // 添加 quick-add 输入框的点击事件，使其自动选中对应的 radio
    if (this.showQuickAddInputs) {
      try {
        const quickTypeInput = document.getElementById("quick-add-type-name");
        const quickTypeRadio = document.querySelector(
          'input[name="task-type"][value="__quick-add-type__"]'
        );
        if (quickTypeInput && quickTypeRadio) {
          quickTypeInput.addEventListener("click", () => {
            quickTypeRadio.checked = true;
          });
        }
      } catch (e) {
        console.error("绑定快捷类型输入点击事件失败", e);
      }
    }

    // 快捷添加输入会在主任务保存时一并持久化
  }
  renderSourceOptions() {
    const container = document.getElementById("task-source-options");
    if (!container) return;
    const sourceOptionsHTML = this.sourcePlatforms
      .map(
        (platform) => `
            <label class="flex items-center p-3 border border-stone-300 rounded-lg cursor-pointer hover:bg-stone-50" data-testid="source-${
              platform.id
            }">
                <input type="radio" name="task-source" value="${
                  platform.id
                }" class="mr-3" ${platform.id === "weibo" ? "checked" : ""}>
                <span class="type-badge mr-2" style="background-color: ${
                  platform.color || this.stringToColor(platform.id)
                }; width: 12px; height: 12px; border-radius: 50%; display: inline-block;"></span>
                <span>${platform.name}</span>
            </label>
        `
      )
      .join("");

    const quickAddSource = this.showQuickAddInputs
      ? `
      <label class="flex items-center p-3 border border-dashed border-stone-300 rounded-lg cursor-pointer">
        <input type="radio" name="task-source" value="__quick-add-source__" class="mr-1">
        <div class="flex items-center mr-1">
          <input id="quick-add-source-color" type="color" class="color-picker-sm w-8 h-8 rounded cursor-pointer border-0 p-0 outline-none" value="#3b82f6" title="选择平台颜色">
        </div>
        <input id="quick-add-source-name" type="text" class="w-full px-2 py-1 border border-stone-200 rounded-md focus:outline-none text-sm" placeholder="新增来源平台">
      </label>`
      : "";

    container.className = "grid grid-cols-2 gap-2";
    container.innerHTML = sourceOptionsHTML + quickAddSource;

    // 添加 quick-add 输入框的点击事件，使其自动选中对应的 radio
    if (this.showQuickAddInputs) {
      try {
        const quickSourceInput = document.getElementById(
          "quick-add-source-name"
        );
        const quickSourceRadio = document.querySelector(
          'input[name="task-source"][value="__quick-add-source__"]'
        );
        if (quickSourceInput && quickSourceRadio) {
          quickSourceInput.addEventListener("click", () => {
            quickSourceRadio.checked = true;
          });
        }
      } catch (e) {
        console.error("绑定快捷来源输入点击事件失败", e);
      }
    }

    // 快捷添加输入会在主任务保存时一并持久化
  }
  //渲染统计卡片
  renderStatsCards() {
    const statsContainer = document.getElementById("stats-container");
    // 确保容器存在
    if (!statsContainer) return;
    const typeStats = {};
    this.taskTypes.forEach((type) => {
      const typeTasks = this.tasks.filter((task) => task.type === type.id);
      const incompleteTasks = typeTasks.filter((task) => !task.completed);
      const completedTasks = typeTasks.filter((task) => task.completed);
      typeStats[type.id] = {
        incomplete: incompleteTasks.length,
        completed: completedTasks.length,
      };
    });
    // 计算全部任务的完成与未完成数量
    const allIncomplete = this.tasks.filter((task) => !task.completed).length;
    const allCompleted = this.tasks.filter((task) => task.completed).length;

    // 组织显示顺序：默认把 "全部" 放在第一位，随后按任务类别原始顺序显示。
    // 如果选择了某个类型（非 'all'），则把该类型放到最前面，随后是 "全部"，再是剩余类型（保持原始顺序）。

    const originalOrder = [...this.taskTypes];
    const allItem = { id: "all", name: "全部" };
    let typesWithAll;
    // 如果开启了 preserveStatsFirstRowOrder，则始终保持原始顺序，仅把 "全部" 放在第一位。
    if (this._preserveStatsFirstRowOrder) {
      // 保持第一行原地不动：始终按原始顺序显示（且 '全部' 始终在第一位）
      typesWithAll = [allItem, ...originalOrder];
      // 不管 currentFilter 是什么，都不调整顺序
    } else if (this.currentFilter && this.currentFilter !== "all") {
      const selected = originalOrder.find((t) => t.id === this.currentFilter);
      const others = originalOrder.filter((t) => t.id !== this.currentFilter);
      typesWithAll = selected
        ? [selected, allItem, ...others]
        : [allItem, ...originalOrder];
    } else {
      typesWithAll = [allItem, ...originalOrder];
    }

    // 网格列数（与样式一致），第一行保留一个位置给展开按钮
    const gridCols = 5;
    const maxTypesInCollapsed = gridCols - 1; // 留一个位置给展开按钮
    const hasOverflow = typesWithAll.length > maxTypesInCollapsed;
    const showAll = !!this._statsExpanded;

    let statsHTML = "";

    // 渲染函数：渲染单个条目（支持 'all' 项）
    const renderItem = (type, index) => {
      const priorityClass =
        index % 3 === 0
          ? "priority-low"
          : index % 3 === 1
          ? "priority-medium"
          : "priority-high";
      const isActive = this.currentFilter === type.id;
      const activeClass = isActive ? "" : "hover:bg-stone-50";
      if (type.id === "all") {
        statsHTML += `
          <div class="stats-card rounded-lg p-2 text-center relative cursor-pointer transition-all ${activeClass}" 
               data-type-filter="all" data-testid="stats-card-all">
              <div class="text-lg font-bold text-stone-800">${allCompleted}/${
          allIncomplete + allCompleted
        }</div>
              <div class="text-xs" data-stat-label>全部</div>
          </div>
        `;
        return;
      }
      // 使用类型颜色（经过 HSV 软化）作为统计卡片的背景色，移除单独的优先级色点
      const stats = typeStats[type.id] || { incomplete: 0, completed: 0 };
      // 如果活跃，计算基于背景色 HSV 的 ring 色（V +50%）并应用为内联 box-shadow
      const bg = this.computeLightBgFromHex(type.color);
      // 计算对比安全的 ring 色
      let inlineStyle = `background:${bg};`;
      if (isActive) {
        try {
          // 使用 OKLCH 算法计算 ring 色（无回退，面向现代浏览器）
          const ok = this.computeOklchAdjustedRing(type.color);
          if (ok && ok.oklch) {
            inlineStyle += ` --tw-ring-color: ${ok.oklch}; box-shadow: 0 8px 15px rgba(0,0,0,0.1), inset 0 0 0 2px var(--tw-ring-color);`;
          }
        } catch (e) {
          /* ignore */
        }
      }
      statsHTML += `
        <div class="stats-card rounded-lg p-2 text-center relative cursor-pointer transition-all ${activeClass}" 
             data-type-filter="${type.id}" data-testid="stats-card-${
        type.id
      }" style="${inlineStyle}">
            <div class="text-lg font-bold text-stone-800">${stats.completed}/${
        stats.incomplete + stats.completed
      }</div>
            <div class="text-xs" data-stat-label>${type.name}</div>
        </div>
      `;
    };

    if (showAll) {
      // 展开状态：渲染全部项，但在到达第一行末尾的位置插入展开按钮（如果需要）
      typesWithAll.forEach((type, i) => {
        if (i === maxTypesInCollapsed && hasOverflow) {
          const iconName = showAll ? "expand_less" : "expand_more";
          statsHTML += `
            <div id="stats-expand-btn" class="stats-card rounded-lg px-2 py-1 text-center relative cursor-pointer transition-all hover:bg-stone-50" data-testid="stats-expand-btn" style="min-width:64px;">
              <div class="text-xl text-stone-800"><span class="material-icons">${iconName}</span></div>
              <div class="text-xs text-stone-600">${
                showAll ? "收起" : "展开"
              }</div>
            </div>
          `;
        }
        renderItem(type, i);
      });
    } else {
      // 折叠状态：只渲染前 N 项，然后在末尾放置展开按钮（如果溢出）
      const slice = typesWithAll.slice(0, maxTypesInCollapsed);
      slice.forEach((type, i) => renderItem(type, i));
      if (hasOverflow) {
        const iconName = showAll ? "expand_less" : "expand_more";
        statsHTML += `
          <div id="stats-expand-btn" class="stats-card rounded-lg px-2 py-1 text-center relative cursor-pointer transition-all hover:bg-stone-50" data-testid="stats-expand-btn" style="min-width:64px;">
            <div class="text-xl text-stone-800"><span class="material-icons">${iconName}</span></div>
            <div class="text-xs text-stone-600">${
              showAll ? "收起" : "展开"
            }</div>
          </div>
        `;
      }
    }
    // 更新容器内容
    statsContainer.innerHTML = statsHTML;
    // 绑定卡片点击事件
    this.bindStatsCardEvents();
    // 绑定展开/收起按钮
    const expandBtn = document.getElementById("stats-expand-btn");
    if (expandBtn) {
      this._statsExpandHandler = () => {
        this._statsExpanded = !this._statsExpanded;
        this.renderStatsCards();
      };
      expandBtn.addEventListener("click", this._statsExpandHandler);
    }
  }
  // 绑定统计卡片点击事件
  bindStatsCardEvents() {
    const statsContainer = document.getElementById("stats-container");
    if (!statsContainer) return;

    // 先移除旧的事件监听器（通过克隆并替换来清除）
    const newContainer = statsContainer.cloneNode(true);
    statsContainer.parentNode.replaceChild(newContainer, statsContainer);

    // 在新的容器实例上添加事件监听器
    const newStatsContainer = document.getElementById("stats-container");
    newStatsContainer.addEventListener("click", (e) => {
      const card = e.target.closest("[data-type-filter]");
      if (!card) return;

      const filterType = card.dataset.typeFilter;

      // 判断点击的卡片是否在第一行（基于当前 DOM 中的实际位置）
      let inFirstRow = false;
      try {
        const allTypeCards = Array.from(
          newStatsContainer.querySelectorAll("[data-type-filter]")
        );
        const cardIndex = allTypeCards.indexOf(card);
        // 第一行最多显示 4 个卡片（maxTypesInCollapsed = gridCols - 1 = 5 - 1 = 4）
        inFirstRow = cardIndex >= 0 && cardIndex < 4;
      } catch (err) {
        inFirstRow = false;
      }

      // 如果卡片在第一行，渲染时保留第一行顺序；否则允许重排并收起展开区域
      this._statsExpanded = false;
      this.setFilter(filterType, !!inFirstRow);
    });
    // 为每个卡片添加 hover 效果（动态计算基于卡片背景色的 ring 色）
    try {
      const cards = newStatsContainer.querySelectorAll(".stats-card");
      cards.forEach((card) => {
        const typeId = card.dataset.typeFilter;
        card.addEventListener("mouseenter", (ev) => {
          try {
            const bg = getComputedStyle(card).backgroundColor;
            // 对于 "全部" 卡片不强制 ring 色，直接返回
            if (!typeId || typeId === "all") return;
            const t = this.taskTypes.find((tt) => tt.id === typeId);
            if (!t) return;
            // 优先使用基于 OKLCH 的 ring 调整（若浏览器支持），否则回退到对比度安全的 RGB
            const ok = this.computeOklchAdjustedRing(t.color);
            // 如果当前卡片已被选中（有 inline box-shadow），不覆盖选中样式
            if (this.currentFilter === typeId) return;
            // 直接使用 OKLCH 字符串（项目面向新浏览器，无需回退）
            if (ok && ok.oklch) {
              card.style.setProperty("--tw-ring-color", ok.oklch);
              card.style.boxShadow = `0 8px 15px rgba(0,0,0,0.1), inset 0 0 0 2px var(--tw-ring-color)`;
            }
          } catch (e) {
            // 回退情形不做额外处理
          }
        });
        card.addEventListener("mouseleave", () => {
          // 离开时如果该卡片是当前选中项则保持其 boxShadow，否则清除（恢复到 CSS hover 的默认）
          if (this.currentFilter === typeId) return;
          card.style.boxShadow = "";
        });
      });
    } catch (e) {
      console.warn("bindStatsCardEvents hover bind error", e);
    }
  }
  //显示类别和来源平台管理设置弹窗
  showTypeManagementModal() {
    // 先移除可能已存在的同类或页面设置模态，避免同时展开多个模态导致交互冲突
    const prev = document.getElementById("type-management-modal");
    if (prev) prev.remove();
    const ps = document.getElementById("page-settings-modal");
    if (ps) ps.remove();

    // 临时缓冲：弹窗内的编辑只作用于这两个数组，点击保存时写回主数据
    this._modalTaskTypes =
      typeof structuredClone === "function"
        ? structuredClone(this.taskTypes || [])
        : JSON.parse(JSON.stringify(this.taskTypes || []));
    this._modalSourcePlatforms =
      typeof structuredClone === "function"
        ? structuredClone(this.sourcePlatforms || [])
        : JSON.parse(JSON.stringify(this.sourcePlatforms || []));
    this._modalPresetNodes =
      typeof structuredClone === "function"
        ? structuredClone(this.presetNodes || [])
        : JSON.parse(JSON.stringify(this.presetNodes || []));

    const modalHTML = `
            <div id="type-management-modal" class="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
                <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl modal-content">
                    <div class="modal-body flex-1 overflow-y-auto p-6">
                        <h2 class="text-xl font-bold text-stone-800 mb-4">管理类别、平台、常用节点</h2>
                        
                        <!-- 任务类型管理 -->
                        <div class="mb-6">
                            <h3 class="text-lg font-semibold text-stone-700 mb-3">任务类型</h3>
                            <div class="space-y-2 mb-4 borderrounded-lg" id="types-list">
                                ${this._modalTaskTypes
                                  .map((type) =>
                                    this.createTypeManagementItem(type)
                                  )
                                  .join("")}
                            </div>
                            
                            <div class="mb-4">
                                <div class="flex items-center gap-2 p-3 border border-stone-200 rounded-lg">
                                <div class="drag-handle flex items-center justify-center mr-0 cursor-not-allowed">
                                  <span class="material-icons text-stone-400">drag_indicator</span>
                                </div>
                                <input type="color" id="new-type-color" class="color-picker-sm w-8 h-8 border border-stone-300 rounded-lg cursor-pointer" value="#4ECDC4" data-testid="new-type-color">
                                <input type="text" id="new-type-name" class="type-name-input flex-1 min-w-0 px-2 py-1 border border-stone-300 rounded" placeholder="添加新类型" data-testid="new-type-name">
                                <button id="add-type-btn" class="bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center p-1 w-8 h-8" data-testid="add-type-btn">
                                  <span class="material-icons text-sm">add</span>
                                </button>
                              </div>
                            </div>
                        </div>

                        <!-- 来源平台管理 -->
                        <div class="mb-4">
                            <h3 class="text-lg font-semibold text-stone-700 mb-3">来源平台</h3>
                            <div class="space-y-2 mb-4 borderrounded-lg" id="sources-list">
                                ${this._modalSourcePlatforms
                                  .map((platform) =>
                                    this.createSourceManagementItem(platform)
                                  )
                                  .join("")}
                            </div>
                            
                            <div class="mb-4">
                                <div class="flex items-center gap-2 p-3 border border-stone-200 rounded-lg">
                                <div class="drag-handle flex items-center justify-center mr-0 cursor-not-allowed" title="添加（不可拖拽）">
                                  <span class="material-icons text-stone-400">drag_indicator</span>
                                </div>
                                <input type="color" id="new-source-color" class="color-picker-sm w-8 h-8 border border-stone-300 rounded-lg cursor-pointer" value="#FF6B6B" data-testid="new-source-color">
                                <input type="text" id="new-source-name" class="source-name-input flex-1 min-w-0 px-2 py-1 border border-stone-300 rounded" placeholder="添加新平台" data-testid="new-source-name">
                                <button id="add-source-btn" class="bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center p-1 w-8 h-8" data-testid="add-source-btn">
                                  <span class="material-icons text-sm">add</span>
                                </button>
                              </div>
                            </div>
                        </div>

                        <!-- 预设快速节点管理 -->
                        <div class="mb-4">
                            <h3 class="text-lg font-semibold text-stone-700 mb-1">快速节点</h3>
                            <div class="text-xs text-stone-500 mb-3">用于任务弹窗的常用节点按钮，支持编辑名称、颜色、图标并拖拽排序</div>
                            <div class="space-y-2 mb-4" id="preset-nodes-list">
                                ${this._modalPresetNodes
                                  .map((node) =>
                                    this.createPresetNodeManagementItem(node)
                                  )
                                  .join("")}
                            </div>
                            <div class="mb-4">
                                <div class="flex items-center gap-2 p-3 border border-stone-200 rounded-lg">
                                  <div class="drag-handle flex items-center justify-center mr-0 cursor-not-allowed" title="添加（不可拖拽）">
                                    <span class="material-icons text-stone-400">drag_indicator</span>
                                  </div>
                                  <input type="color" id="new-preset-node-bg" class="color-picker-sm w-8 h-8 border border-stone-300 rounded-lg cursor-pointer" value="#e5e7eb" data-testid="new-preset-node-bg">
                                  <button type="button" id="new-preset-node-icon" data-icon="label" class="preset-node-icon-btn w-9 h-9 flex items-center justify-center border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors" data-testid="new-preset-node-icon">
                                    <span class="material-icons text-base">label</span>
                                  </button>
                                  <input type="text" id="new-preset-node-name" class="preset-node-name-input flex-1 min-w-0 px-2 py-1 border border-stone-300 rounded" placeholder="添加快速节点" data-testid="new-preset-node-name">
                                  <button id="add-preset-node-btn" class="bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center p-1 w-8 h-8" data-testid="add-preset-node-btn">
                                    <span class="material-icons text-sm">add</span>
                                  </button>
                                </div>
                              </div>
                        </div>
                    </div>
                    
                    <div class="modal-footer !m-0 !p-6 pt-0">
                        <div class="flex gap-3">
                            <button id="cancel-type-management-btn" class="flex-1 px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 transition-colors" data-testid="cancel-type-management-btn">
                                取消
                            </button>
                            <button id="save-types-btn" class="flex-1 px-4 py-2 btn-save" data-testid="save-types-btn">
                              保存
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    document.body.insertAdjacentHTML("beforeend", modalHTML);
    this.bindTypeManagementEvents();
    this.scheduleMasonryLayout(120, false);
  }
  createTypeManagementItem(type) {
    const hasTasks = this.tasks.some((task) => task.type === type.id);
    return `
            <div class="flex items-center gap-2 p-3 border border-stone-200 rounded-lg type-item" data-type-id="${
              type.id
            }">
                <div class="drag-handle flex items-center justify-center mr-0" title="按住拖拽排序" draggable="true">
                  <span class="material-icons text-stone-400">drag_indicator</span>
                </div>
                <input type="color" class="type-color-input color-picker-sm w-8 h-8 border border-stone-300 rounded cursor-pointer" value="${
                  type.color
                }" data-type-id="${type.id}" data-testid="type-color-${
      type.id
    }">
                <input type="text" class="type-name-input flex-1 min-w-0 px-2 py-1 border border-stone-300 rounded" value="${
                  type.name
                }" data-type-id="${type.id}" data-testid="type-name-${type.id}">
                ${
                  hasTasks
                    ? `<span title="不可删除，有任务关联" class="inline-block"><button class="delete-type-btn flex items-center justify-center w-8 h-8 p-1 opacity-50 cursor-not-allowed" data-type-id="${type.id}" data-testid="delete-type-${type.id}" disabled><span class="material-icons text-sm">delete</span></button></span>`
                    : `<button class="delete-type-btn flex items-center justify-center w-8 h-8 p-1" data-type-id="${type.id}" data-testid="delete-type-${type.id}"><span class="material-icons text-sm">delete</span></button>`
                }
            </div>
        `;
  }
  createSourceManagementItem(platform) {
    const hasTasks = this.tasks.some((task) => task.source === platform.id);
    return `
            <div class="flex items-center gap-2 p-3 border border-stone-200 rounded-lg source-item" data-source-id="${
              platform.id
            }">
                <div class="drag-handle flex items-center justify-center mr-0" title="按住拖拽排序" draggable="true">
                  <span class="material-icons text-stone-400">drag_indicator</span>
                </div>
                <input type="color" class="source-color-input color-picker-sm w-8 h-8 border border-stone-300 rounded cursor-pointer" value="${
                  platform.color
                }" data-source-id="${platform.id}" data-testid="source-color-${
      platform.id
    }">
                <input type="text" class="source-name-input flex-1 min-w-0 px-2 py-1 border border-stone-300 rounded" value="${
                  platform.name
                }" data-source-id="${platform.id}" data-testid="source-name-${
      platform.id
    }">
                ${
                  hasTasks
                    ? `<span title="不可删除，有任务关联" class="inline-block"><button class="delete-source-btn flex items-center justify-center w-8 h-8 p-1 opacity-50 cursor-not-allowed" data-source-id="${platform.id}" data-testid="delete-source-${platform.id}" disabled><span class="material-icons text-sm">delete</span></button></span>`
                    : `<button class="delete-source-btn flex items-center justify-center w-8 h-8 p-1" data-source-id="${platform.id}" data-testid="delete-source-${platform.id}"><span class="material-icons text-sm">delete</span></button>`
                }
            </div>
        `;
  }
  createPresetNodeManagementItem(node) {
    const normalized = this.normalizePresetNode(node);
    const textClass =
      normalized.text ||
      this.getNearestTailwindTextClass(normalized.background);
    const style = normalized.background
      ? `background:${normalized.background};`
      : "";
    const hasTasks = (this.tasks || []).some((task) =>
      (task.nodes || []).some(
        (n) =>
          n &&
          (n.name === normalized.name || String(n.id) === String(normalized.id))
      )
    );
    const iconClass = this.getIconClassForSource(
      normalized.iconGroup,
      normalized.iconStyle
    );
    return `
            <div class="flex items-center gap-2 p-3 border border-stone-200 rounded-lg preset-node-row" data-node-id="${
              normalized.id
            }">
                <div class="drag-handle flex items-center justify-center mr-0" title="按住拖拽排序" draggable="true">
                  <span class="material-icons text-stone-400">drag_indicator</span>
                </div>
                <input type="color" class="preset-node-bg-input color-picker-sm w-8 h-8 border border-stone-300 rounded cursor-pointer" value="${
                  normalized.background
                }" data-node-id="${
      normalized.id
    }" data-testid="preset-node-bg-${normalized.id}">
                <button type="button" class="preset-node-icon-btn w-9 h-9 flex items-center justify-center border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors ${
                  textClass || ""
                }" data-node-id="${normalized.id}" data-icon="${
      normalized.icon
    }" data-icon-group="${normalized.iconGroup || "icons"}" data-icon-style="${
      normalized.iconStyle || "regular"
    }" data-text-class="${textClass}" data-testid="preset-node-icon-${
      normalized.id
    }" style="${style}">
                  <span class="${iconClass} text-base ${
      textClass || ""
    }" data-icon-group="${normalized.iconGroup || "icons"}" data-icon-style="${
      normalized.iconStyle || "regular"
    }">${normalized.icon}</span>
                </button>
                <input type="text" class="preset-node-name-input flex-1 min-w-0 px-2 py-1 border border-stone-300 rounded" value="${
                  normalized.name
                }" data-node-id="${
      normalized.id
    }" data-testid="preset-node-name-${normalized.id}">
                ${
                  hasTasks
                    ? `<span title="此预设节点正在被任务使用，无法删除" class="inline-block"><button class="delete-btn flex items-center justify-center w-8 h-8 p-1 opacity-50 cursor-not-allowed" data-node-id="${normalized.id}" data-testid="delete-preset-node-${normalized.id}" disabled><span class="material-icons text-sm">delete</span></button></span>`
                    : `<button class="delete-btn flex items-center justify-center w-8 h-8 p-1" data-node-id="${normalized.id}" data-testid="delete-preset-node-${normalized.id}"><span class="material-icons text-sm">delete</span></button>`
                }
            </div>
        `;
  }
  bindTypeManagementEvents() {
    const addBtn = document.getElementById("add-type-btn");
    if (addBtn) {
      addBtn.addEventListener("click", () => this.addNewTaskType());
    }
    const addSourceBtn = document.getElementById("add-source-btn");
    if (addSourceBtn) {
      addSourceBtn.addEventListener("click", () => this.addNewSourcePlatform());
    }

    // 支持按 Enter 提交：在输入框按回车即可触发添加（与按钮行为一致）
    const typeNameInput = document.getElementById("new-type-name");
    if (typeNameInput) {
      typeNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.addNewTaskType();
        }
      });
    }
    const sourceNameInput = document.getElementById("new-source-name");
    if (sourceNameInput) {
      sourceNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.addNewSourcePlatform();
        }
      });
    }

    document.querySelectorAll(".delete-type-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const button = e.currentTarget;
        const typeId = button.dataset.typeId;
        if (typeId) {
          this.deleteTaskType(typeId);
        }
      });
    });
    document.querySelectorAll(".delete-source-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const button = e.currentTarget;
        const sourceId = button.dataset.sourceId;
        if (sourceId) {
          this.deleteSourcePlatform(sourceId);
        }
      });
    });
    try {
      this.bindPresetNodeManagementEvents();
    } catch (e) {
      console.warn("bind preset node management events failed", e);
    }
    const cancelBtn = document.getElementById("cancel-type-management-btn");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => this.hideTypeManagementModal());
    }
    const saveBtn = document.getElementById("save-types-btn");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => this.saveTaskTypesChanges());
    }
    // 回收站切换按钮（位于模态头部，如果存在则绑定）

    const modal = document.getElementById("type-management-modal");
    if (modal) {
      this.bindOverlayClose(modal, () => this.hideTypeManagementModal());
    }
    // 初始化拖拽排序（类型 / 来源 / 预设节点）
    try {
      this.initTypeAndSourceDragSorting();
    } catch (e) {
      console.warn("initTypeAndSourceDragSorting error", e);
    }
  }
  // 绑定预设快速节点管理事件
  bindPresetNodeManagementEvents() {
    const addPresetBtn = document.getElementById("add-preset-node-btn");
    if (addPresetBtn) {
      addPresetBtn.addEventListener("click", () => this.addNewPresetNode());
    }
    const newBgInput = document.getElementById("new-preset-node-bg");
    if (newBgInput) {
      this.newPresetBgChangeHandler = (e) => {
        const color = e.target.value || "#e5e7eb";
        this.updatePresetNodePreview("new", color);
      };
      newBgInput.addEventListener("input", this.newPresetBgChangeHandler);
      this.updatePresetNodePreview("new", newBgInput.value || "#e5e7eb");
    }
    const newIconBtn = document.getElementById("new-preset-node-icon");
    if (newIconBtn) {
      this.newPresetIconHandler = () => {
        const current = this.normalizeIconSelection({
          name: newIconBtn.dataset.icon || "label",
          group: newIconBtn.dataset.iconGroup,
          style: newIconBtn.dataset.iconStyle,
        });
        this.openIconPicker((iconPayload) => {
          const sel = this.normalizeIconSelection(iconPayload);
          newIconBtn.dataset.icon = sel.name;
          newIconBtn.dataset.iconGroup = sel.group;
          newIconBtn.dataset.iconStyle = sel.style;
          const span = newIconBtn.querySelector("span");
          if (span) {
            span.className = `${this.getIconClassForSource(
              sel.group,
              sel.style
            )} text-base ${newIconBtn.dataset.textClass || ""}`;
            span.textContent = sel.name;
          }
        }, current);
      };
      newIconBtn.addEventListener("click", this.newPresetIconHandler);
    }

    // 支持按 Enter 提交快速节点（与添加按钮行为一致）
    const newPresetNameInput = document.getElementById("new-preset-node-name");
    if (newPresetNameInput) {
      newPresetNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.addNewPresetNode();
        }
      });
    }

    const list = document.getElementById("preset-nodes-list");
    if (list && !list.dataset.boundPreset) {
      list.dataset.boundPreset = "1";
      list.addEventListener("input", (e) => {
        const bgInput = e.target.closest(".preset-node-bg-input");
        if (!bgInput) return;
        const color = bgInput.value || "#e5e7eb";
        const nodeId = bgInput.dataset.nodeId;
        this.updatePresetNodePreview(nodeId, color);
      });
      list.addEventListener("click", (e) => {
        const iconBtn = e.target.closest(".preset-node-icon-btn");
        if (iconBtn) {
          const nodeId = iconBtn.dataset.nodeId;
          const current = this.normalizeIconSelection({
            name: iconBtn.dataset.icon || "label",
            group: iconBtn.dataset.iconGroup,
            style: iconBtn.dataset.iconStyle,
          });
          this.openIconPicker((iconPayload) => {
            const sel = this.normalizeIconSelection(iconPayload);
            iconBtn.dataset.icon = sel.name;
            iconBtn.dataset.iconGroup = sel.group;
            iconBtn.dataset.iconStyle = sel.style;
            const span = iconBtn.querySelector("span");
            if (span) {
              span.className = `${this.getIconClassForSource(
                sel.group,
                sel.style
              )} text-base ${iconBtn.dataset.textClass || ""}`;
              span.textContent = sel.name;
            }
          }, current);
          return;
        }
        const delBtn = e.target.closest("button.delete-btn[data-node-id]");
        if (delBtn) {
          e.preventDefault();
          e.stopPropagation();
          const nodeId = delBtn.dataset.nodeId;
          if (nodeId) this.deletePresetNode(nodeId);
        }
      });
    }
  }

  updatePresetNodePreview(nodeId, color) {
    const textClass = this.getNearestTailwindTextClass(color);
    if (nodeId === "new") {
      const iconBtn = document.getElementById("new-preset-node-icon");
      if (iconBtn) {
        iconBtn.dataset.textClass = textClass;
        iconBtn.style.background = color;
        const selection = this.normalizeIconSelection({
          name: iconBtn.dataset.icon,
          group: iconBtn.dataset.iconGroup,
          style: iconBtn.dataset.iconStyle,
        });
        const span = iconBtn.querySelector("span");
        if (span)
          span.className = `${this.getIconClassForSource(
            selection.group,
            selection.style
          )} text-base ${textClass}`;
      }
      return;
    }
    const iconBtn = document.querySelector(
      `.preset-node-icon-btn[data-node-id="${nodeId}"]`
    );
    if (iconBtn) {
      iconBtn.dataset.textClass = textClass;
      iconBtn.style.background = color;
      const selection = this.normalizeIconSelection({
        name: iconBtn.dataset.icon,
        group: iconBtn.dataset.iconGroup,
        style: iconBtn.dataset.iconStyle,
      });
      const span = iconBtn.querySelector("span");
      if (span)
        span.className = `${this.getIconClassForSource(
          selection.group,
          selection.style
        )} text-base ${textClass}`;
    }
  }

  addNewPresetNode() {
    const nameInput = document.getElementById("new-preset-node-name");
    const bgInput = document.getElementById("new-preset-node-bg");
    const iconBtn = document.getElementById("new-preset-node-icon");
    if (!nameInput || !bgInput || !iconBtn) {
      this.showMessage("无法找到输入控件，请重试");
      return;
    }
    const name = nameInput.value.trim();
    if (!name) {
      this.showMessage("请输入节点名称");
      return;
    }
    const background = bgInput.value || "#e5e7eb";
    const iconSel = this.normalizeIconSelection({
      name: iconBtn.dataset.icon || "label",
      group: iconBtn.dataset.iconGroup,
      style: iconBtn.dataset.iconStyle,
    });
    const text =
      iconBtn.dataset.textClass || this.getNearestTailwindTextClass(background);
    const newNode = this.normalizePresetNode({
      id: `preset_${Date.now()}`,
      name,
      background,
      icon: iconSel.name,
      iconGroup: iconSel.group,
      iconStyle: iconSel.style,
      text,
    });
    if (this._modalPresetNodes && Array.isArray(this._modalPresetNodes)) {
      this._modalPresetNodes.push(newNode);
    } else {
      this.presetNodes.push(newNode);
    }
    const list = document.getElementById("preset-nodes-list");
    if (list) {
      list.insertAdjacentHTML(
        "beforeend",
        this.createPresetNodeManagementItem(newNode)
      );
    }
    try {
      this.initTypeAndSourceDragSorting();
    } catch (e) {
      console.warn("re-init drag after add preset node", e);
    }
    nameInput.value = "";
    bgInput.value = background;
    // 更新新节点的图标预览（保持与选择一致）
    iconBtn.dataset.icon = newNode.icon;
    iconBtn.dataset.iconGroup = newNode.iconGroup || "icons";
    iconBtn.dataset.iconStyle = newNode.iconStyle || "regular";
    const span = iconBtn.querySelector("span");
    if (span) {
      span.className = `${this.getIconClassForSource(
        newNode.iconGroup || "icons",
        newNode.iconStyle || "regular"
      )} text-base ${text}`;
      span.textContent = newNode.icon;
    }
    try {
      this.initTypeAndSourceDragSorting();
    } catch (e) {
      console.warn("re-init drag after add preset node", e);
    }
    this.showMessage("节点已添加，请点击保存");
  }

  deletePresetNode(nodeId) {
    // 找到要删除的预设
    const allPresets =
      this._modalPresetNodes && Array.isArray(this._modalPresetNodes)
        ? this._modalPresetNodes
        : this.presetNodes || [];
    const preset = allPresets.find((n) => String(n.id) === String(nodeId));
    if (!preset) {
      this.showMessage("未找到此预设节点");
      return;
    }
    // 检查是否有任务使用该预设（按 name 或 id 匹配）
    const inUse = (this.tasks || []).some((task) =>
      (task.nodes || []).some(
        (n) =>
          n && (n.name === preset.name || String(n.id) === String(preset.id))
      )
    );
    if (inUse) {
      this.showMessage("此预设节点正在被任务使用，无法删除");
      return;
    }
    // 从模态缓冲或主数据中移除并删除 DOM 行
    const row = document.querySelector(
      `.preset-node-row[data-node-id="${nodeId}"]`
    );
    if (row) row.remove();
    if (this._modalPresetNodes && Array.isArray(this._modalPresetNodes)) {
      this._modalPresetNodes = this._modalPresetNodes.filter(
        (n) => String(n.id) !== String(nodeId)
      );
    } else {
      this.presetNodes = (this.presetNodes || []).filter(
        (n) => String(n.id) !== String(nodeId)
      );
    }
    this.showMessage("节点已删除，请点击保存");
  }

  // 公用：为模态/遮罩绑定“按下且抬起都在遮罩上”才触发的关闭逻辑，避免拖拽松手误触
  bindOverlayClose(overlayEl, onClose, matcher) {
    if (!overlayEl || typeof onClose !== "function") return;
    const isOnOverlay =
      typeof matcher === "function"
        ? (evt) => matcher(evt, overlayEl)
        : (evt) => evt.target === overlayEl;
    let pressed = false;
    overlayEl.addEventListener("pointerdown", (e) => {
      pressed = isOnOverlay(e);
    });
    overlayEl.addEventListener("pointerup", (e) => {
      if (pressed && isOnOverlay(e)) onClose(e);
      pressed = false;
    });
    overlayEl.addEventListener("pointercancel", () => {
      pressed = false;
    });
  }
  //选择图标的弹窗（按需加载 basetype）
  async openIconPicker(onSelect, currentIcon = "label") {
    // 只有在用户打开图标选择器时才加载 basetype
    try {
      await this.loadBaseTypes();
    } catch (e) {
      // 忽略加载失败，UI 将显示空列表
    }
    this.materialIconCatalog = this.getMaterialIconCatalog();
    const existing = document.getElementById("icon-picker-overlay");
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.id = "icon-picker-overlay";
    overlay.className =
      "modal-backdrop fixed inset-0 z-50 flex items-start  justify-center p-4 overflow-y-auto";
    const modal = document.createElement("div");
    modal.className =
      "bg-white rounded-2xl shadow-2xl w-full max-w-sm p-4 flex flex-col gap-3 my-6 overflow-visible";
    modal.innerHTML = `
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-stone-800">选择图标</h3>
          <button class="close-icon-picker text-stone-500 hover:text-stone-700">
            <span class="material-icons">close</span>
          </button>
        </div>
        <p class="text-xs text-stone-500 mt-[-6px]">仅显示部分图标，更多可在 <a href="https://fonts.google.com/icons" target="_blank" rel="noopener" class="text-blue-600 hover:underline" aria-label="在新窗口打开 Google Fonts 图标库">Google icons</a> 预览</p>
        <input type="text" class="icon-search px-3 py-2 border border-stone-300 rounded-lg w-full focus:outline-none focus:ring-0 focus:border-stone-300" placeholder="搜索图标名称，例如 Search Check 2">
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between text-xs text-stone-600 px-0.5">
              <span class="font-semibold text-stone-700">Icons</span>
              <span class="text-[11px]">默认 24px 样式</span>
            </div>
            <div class="icon-grid grid grid-cols-5 sm:grid-cols-6 gap-1 px-0.5" data-role="icon-grid-icons"></div>
          </div>
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between text-xs text-stone-600 px-0.5">
              <span class="font-semibold text-stone-700">Symbols</span>
              <span class="text-[11px]">可变轴 24px</span>
            </div>
            <div class="icon-grid grid grid-cols-5 sm:grid-cols-6 gap-1 px-0.5" data-role="icon-grid-symbols"></div>
          </div>
        </div>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const gridIcons = modal.querySelector('[data-role="icon-grid-icons"]');
    const gridSymbols = modal.querySelector('[data-role="icon-grid-symbols"]');
    const searchInput = modal.querySelector(".icon-search");

    const current = this.normalizeIconSelection(currentIcon);
    const defaultCatalog = this.materialIconCatalog || [];

    // 打开时聚焦搜索输入框
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
    const buildButton = (name, group, style, labelOverride) => {
      const cls = this.getIconClassForSource(group, style);
      const isCurrent =
        current.name === name &&
        current.group === group &&
        current.style === style;
      const label = labelOverride || name;
      return `
        <button class="icon-choice border rounded-md p-1.5 flex flex-col items-center justify-center gap-0.5 hover:bg-stone-50 transition-colors ${
          isCurrent ? "border-blue-500 bg-blue-50" : "border-stone-200"
        }" data-icon-choice="${name}" data-icon-group="${group}" data-icon-style="${style}">
          <span class="${cls} text-lg">${name}</span>
          <span class="text-[11px] leading-3 text-stone-700 truncate w-full text-center">${label}</span>
          <span class="text-[10px] leading-3 text-stone-500 truncate w-full text-center">${style}</span>
        </button>
      `;
    };

    const renderDefault = () => {
      const htmlIcons = defaultCatalog
        .map((name) => buildButton(name, "icons", "regular"))
        .join("");
      gridIcons.innerHTML = htmlIcons;
      gridSymbols.innerHTML = "";
    };

    let renderToken = 0;
    const renderSearch = async (keyword = "") => {
      const token = ++renderToken;
      const raw = (keyword || "").trim();
      if (!raw) {
        renderDefault();
        return;
      }
      try {
        await this.ensureFontIconCatalogs();
      } catch (e) {
        // 已记录日志，渲染空结果
      }
      if (token !== renderToken) return;
      const matches = this.buildFontSearchResults(raw);
      const seenIcons = new Set();
      const seenSymbols = new Set();
      let htmlIcons = "";
      let htmlSymbols = "";

      matches.forEach((m) => {
        const key = `${m.style}|${m.name}`;
        if (m.group === "icons") {
          if (seenIcons.has(key)) return;
          seenIcons.add(key);
          htmlIcons += buildButton(m.name, m.group, m.style);
        } else {
          if (seenSymbols.has(key)) return;
          seenSymbols.add(key);
          htmlSymbols += buildButton(m.name, m.group, m.style);
        }
      });

      gridIcons.innerHTML =
        htmlIcons ||
        '<div class="col-span-full text-center text-[11px] text-stone-400 py-2">无匹配</div>';
      gridSymbols.innerHTML =
        htmlSymbols ||
        '<div class="col-span-full text-center text-[11px] text-stone-400 py-2">无匹配</div>';
    };

    renderDefault();

    const attachClick = (gridEl) => {
      gridEl.addEventListener("click", (e) => {
        const btn = e.target.closest(".icon-choice");
        if (!btn) return;
        const name = btn.dataset.iconChoice;
        const group = btn.dataset.iconGroup || "icons";
        const style =
          btn.dataset.iconStyle ||
          (group === "symbols" ? "outlined" : "regular");
        if (name && typeof onSelect === "function")
          onSelect({ name, group, style });
        overlay.remove();
      });
    };
    attachClick(gridIcons);
    attachClick(gridSymbols);

    if (searchInput) {
      let searchDebounce = null;
      // 阻止回车键自动应用选中项
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          return;
        }
      });
      searchInput.addEventListener("input", (e) => {
        const val = e.target.value || "";
        if (searchDebounce) clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => renderSearch(val), 120);
      });
    }

    const close = () => overlay.remove();
    this.bindOverlayClose(overlay, close);
    const closeBtn = modal.querySelector(".close-icon-picker");
    if (closeBtn) closeBtn.addEventListener("click", close);
  }
  addNewTaskType() {
    const nameInput = document.getElementById("new-type-name");
    const colorInput = document.getElementById("new-type-color");
    if (!nameInput || !colorInput) {
      this.showMessage("无法找到输入框，请重试");
      return;
    }
    const name = nameInput.value.trim();
    const color = colorInput.value;
    if (!name) {
      this.showMessage("请输入类型名称");
      return;
    }
    const newType = { id: "type_" + Date.now(), name: name, color: color };
    // 写入弹窗临时缓冲，而不是直接修改主数据
    if (this._modalTaskTypes && Array.isArray(this._modalTaskTypes)) {
      this._modalTaskTypes.push(newType);
    } else {
      this.taskTypes.push(newType);
    }
    const typesList = document.getElementById("types-list");
    if (typesList) {
      typesList.insertAdjacentHTML(
        "beforeend",
        this.createTypeManagementItem(newType)
      );
      const newDeleteBtn = typesList.querySelector(
        `[data-type-id="${newType.id}"] .delete-type-btn`
      );
      if (newDeleteBtn) {
        newDeleteBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const button = e.currentTarget;
          const typeId = button.dataset.typeId;
          if (typeId) {
            this.deleteTaskType(typeId);
          }
        });
      }
    }
    nameInput.value = "";
    colorInput.value = "#4ECDC4";
    this.showMessage("类型已添加，请点击保存");
    try {
      this.initTypeAndSourceDragSorting();
    } catch (e) {
      console.warn("re-init drag after add type", e);
    }
  }
  deleteTaskType(typeId) {
    const hasTasks = this.tasks.some((task) => task.type === typeId);
    if (hasTasks) {
      this.showMessage("该类型下还有任务，无法删除");
      return;
    }
    const typeElement = document.querySelector(`div[data-type-id="${typeId}"]`);
    if (typeElement) {
      typeElement.remove();
    }
    // 如果弹窗有临时缓冲，同步移除缓冲里的项
    if (this._modalTaskTypes && Array.isArray(this._modalTaskTypes)) {
      this._modalTaskTypes = this._modalTaskTypes.filter(
        (t) => String(t.id) !== String(typeId)
      );
    }
    this.showMessage("类型已删除，请点击保存");
  }
  saveTaskTypesChanges() {
    // 1. 读取任务类型
    const newTaskTypes = [];
    document.querySelectorAll(".type-name-input").forEach((input) => {
      const typeId = input.dataset.typeId;
      const name = input.value.trim();
      if (name) {
        const colorInput = document.querySelector(
          `.type-color-input[data-type-id="${typeId}"]`
        );
        newTaskTypes.push({
          id: typeId,
          name: name,
          color: colorInput ? colorInput.value : "#4ECDC4",
        });
      }
    });
    this.taskTypes = newTaskTypes;

    // 2. 读取来源平台
    const newSourcePlatforms = [];
    document.querySelectorAll(".source-name-input").forEach((input) => {
      const sourceId = input.dataset.sourceId;
      const name = input.value.trim();
      if (name) {
        const colorInput = document.querySelector(
          `.source-color-input[data-source-id="${sourceId}"]`
        );
        newSourcePlatforms.push({
          id: sourceId,
          name: name,
          color: colorInput ? colorInput.value : "#FF6B6B",
        });
      }
    });
    this.sourcePlatforms = newSourcePlatforms;

    // 3. 读取预设节点
    const newPresetNodes = [];
    document.querySelectorAll(".preset-node-row").forEach((row, index) => {
      const nodeId = row.dataset.nodeId || `preset_${index}`;
      const nameInput = row.querySelector(".preset-node-name-input");
      const bgInput = row.querySelector(".preset-node-bg-input");
      const iconBtn = row.querySelector(".preset-node-icon-btn");
      const name = nameInput ? nameInput.value.trim() : "";
      if (!name) return;
      const background = bgInput ? bgInput.value || "#e5e7eb" : "#e5e7eb";
      const text =
        iconBtn?.dataset.textClass ||
        this.getNearestTailwindTextClass(background);
      const icon = iconBtn ? iconBtn.dataset.icon || "label" : "label";
      const iconGroup = iconBtn?.dataset.iconGroup;
      const iconStyle = iconBtn?.dataset.iconStyle;
      newPresetNodes.push(
        this.normalizePresetNode({
          id: nodeId,
          name,
          background,
          icon,
          text,
          iconGroup,
          iconStyle,
        })
      );
    });
    this.presetNodes = newPresetNodes;

    // ✅ 4. 最后统一保存一次
    this.saveAllData();

    // ✅ 5. 刷新界面
    this.renderTaskTypeOptions();
    this.renderSourceOptions();
    this.renderPresetNodeButtons();
    this.renderStatsCards();
    this.updateStats();
    this.updateSmartRecommendations();
    this.renderTasks();

    // 如果页面设置面板打开，刷新色块预览
    if (document.getElementById("page-settings-modal")) {
      try {
        this.renderPageSettingsSwatches();
      } catch (e) {
        console.warn("刷新页面设置色块失败", e);
      }
    }
    // ✅ 6. 关闭弹窗
    this.hideTypeManagementModal();
    this.showMessage("类别和来源平台已保存");
    this.scheduleMasonryLayout(120, false);
  }

  addNewSourcePlatform() {
    const nameInput = document.getElementById("new-source-name");
    const colorInput = document.getElementById("new-source-color");
    if (!nameInput || !colorInput) {
      this.showMessage("无法找到输入框，请重试");
      return;
    }
    const name = nameInput.value.trim();
    const color = colorInput.value;
    if (!name) {
      this.showMessage("请输入平台名称");
      return;
    }
    const newPlatform = {
      id: "source_" + Date.now(),
      name: name,
      color: color,
    };
    // 写入弹窗临时缓冲，而不是直接修改主数据
    if (
      this._modalSourcePlatforms &&
      Array.isArray(this._modalSourcePlatforms)
    ) {
      this._modalSourcePlatforms.push(newPlatform);
    } else {
      this.sourcePlatforms.push(newPlatform);
    }
    const sourcesList = document.getElementById("sources-list");
    if (sourcesList) {
      sourcesList.insertAdjacentHTML(
        "beforeend",
        this.createSourceManagementItem(newPlatform)
      );
      const newDeleteBtn = sourcesList.querySelector(
        `[data-source-id="${newPlatform.id}"] .delete-source-btn`
      );
      if (newDeleteBtn) {
        newDeleteBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const button = e.currentTarget;
          const sourceId = button.dataset.sourceId;
          if (sourceId) {
            this.deleteSourcePlatform(sourceId);
          }
        });
      }
    }
    nameInput.value = "";
    colorInput.value = "#FF6B6B";
    this.showMessage("平台已添加，请点击保存");
    try {
      this.initTypeAndSourceDragSorting();
    } catch (e) {
      console.warn("re-init drag after add source", e);
    }
  }
  deleteSourcePlatform(sourceId) {
    const hasTasks = this.tasks.some((task) => task.source === sourceId);
    if (hasTasks) {
      this.showMessage("该平台下还有任务，无法删除");
      return;
    }
    const sourceElement = document.querySelector(
      `div[data-source-id="${sourceId}"]`
    );
    if (sourceElement) {
      sourceElement.remove();
    }
    // 如果弹窗有临时缓冲，同步移除缓冲里的项
    if (
      this._modalSourcePlatforms &&
      Array.isArray(this._modalSourcePlatforms)
    ) {
      this._modalSourcePlatforms = this._modalSourcePlatforms.filter(
        (s) => String(s.id) !== String(sourceId)
      );
    }
    this.showMessage("平台已删除，请点击保存");
  }
  hideTypeManagementModal() {
    const modal = document.getElementById("type-management-modal");
    if (modal) {
      modal.remove();
    }
    // 关闭时清理弹窗临时缓冲（取消不写回主数据）
    this._modalTaskTypes = null;
    this._modalSourcePlatforms = null;
    this._modalPresetNodes = null;
    this.scheduleMasonryLayout(120, false);
  }

  // 初始化类型与来源列表的拖拽排序(gpt-5 codex max 重构)
  initTypeAndSourceDragSorting() {
    const app = this;
    const configs = [
      { id: "types-list", selector: "div[data-type-id]", dataKey: "taskTypes" },
      {
        id: "sources-list",
        selector: "div[data-source-id]",
        dataKey: "sourcePlatforms",
      },
      {
        id: "preset-nodes-list",
        selector: "div[data-node-id]",
        dataKey: "presetNodes",
      },
    ];
    // 指针事件选项（禁止 passive，以便 preventDefault 生效）
    const pointerOpts = { passive: false };
    // 根据配置返回用于识别元素的 data 属性名
    const attrFor = (cfg) => {
      if (cfg.dataKey === "taskTypes") return "data-type-id";
      if (cfg.dataKey === "sourcePlatforms") return "data-source-id";
      if (cfg.dataKey === "presetNodes") return "data-node-id";
      return "data-id";
    };
    // 测量 container 中每个项的顶部坐标，返回 Map<Element,top>
    const measureTops = (container, selector) => {
      const map = new Map();
      container.querySelectorAll(selector).forEach((el) => {
        if (el.classList.contains("drag-placeholder")) return;
        map.set(el, el.getBoundingClientRect().top);
      });
      return map;
    };
    // 执行 FLIP 动画：比较 beforeMap 与当前 top，应用临时 transform
    const animateFlip = (container, selector, beforeMap) => {
      const afterMap = new Map();
      const items = [...container.querySelectorAll(selector)].filter(
        (el) => !el.classList.contains("drag-placeholder")
      );
      items.forEach((el) => afterMap.set(el, el.getBoundingClientRect().top));
      items.forEach((el) => {
        const delta = (beforeMap.get(el) || 0) - (afterMap.get(el) || 0);
        if (!delta) return;
        // 先禁用过渡，设置初始偏移
        el.style.transition = "none";
        el.style.transform = `translateY(${delta}px)`;
        // 强制重排以应用 transform
        el.getBoundingClientRect();
        // 启用过渡并清空 transform，让元素平滑归位
        el.style.transition = "";
        el.style.transform = "";
      });
    };
    // 将 DOM 顺序映射回 app 模型并赋值（保持原始数据顺序）
    const applyOrderToModel = (container, cfg) => {
      // 当弹窗缓冲存在时，优先将排序结果应用到缓冲数组，避免直接修改主数据
      const attr = attrFor(cfg);
      const ids = Array.from(container.querySelectorAll(cfg.selector)).map(
        (el) => el.getAttribute(attr)
      );
      let list;
      let targetKey = cfg.dataKey;
      if (cfg.dataKey === "taskTypes" && app._modalTaskTypes) {
        list = app._modalTaskTypes;
        targetKey = "_modalTaskTypes";
      } else if (
        cfg.dataKey === "sourcePlatforms" &&
        app._modalSourcePlatforms
      ) {
        list = app._modalSourcePlatforms;
        targetKey = "_modalSourcePlatforms";
      } else if (cfg.dataKey === "presetNodes" && app._modalPresetNodes) {
        list = app._modalPresetNodes;
        targetKey = "_modalPresetNodes";
      } else {
        list = app[cfg.dataKey];
      }
      const sorted = ids
        .map((id) => list.find((x) => String(x.id) === String(id)))
        .filter(Boolean);
      app[targetKey] = sorted;
    };
    // 清除元素上的 transform/transition 样式
    const clearTransforms = (container, selector) =>
      container.querySelectorAll(selector).forEach((el) => {
        el.style.transition = "";
        el.style.transform = "";
      });
    // 创建占位符元素（高度保持布局）
    const createPlaceholder = (height) => {
      const ph = document.createElement("div");
      ph.className = "drag-placeholder";
      ph.style.height = `${height}px`;
      return ph;
    };
    // 开始拖拽：创建幽灵（fixed）、插入占位符、处理移动及结束恢复
    const startDrag = (container, item, cfg, startEvent) => {
      startEvent.preventDefault();
      const rect = item.getBoundingClientRect();
      const offsetX = startEvent.clientX - rect.left,
        offsetY = startEvent.clientY - rect.top;
      const placeholder = createPlaceholder(rect.height);
      container.insertBefore(placeholder, item);
      const orig = {
        position: item.style.position,
        left: item.style.left,
        top: item.style.top,
        width: item.style.width,
        height: item.style.height,
        zIndex: item.style.zIndex,
        margin: item.style.margin,
        pointerEvents: item.style.pointerEvents,
      };
      item.classList.add("dragging-fixed");
      Object.assign(item.style, {
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        zIndex: "9999",
        margin: "0",
        pointerEvents: "none",
      });
      document.body.appendChild(item);
      const move = (x, y) => {
        item.style.left = `${x - offsetX}px`;
        item.style.top = `${y - offsetY}px`;
        // 清除上一次 FLIP 帧的临时 transform，避免累计误差
        clearTransforms(container, cfg.selector);
        const before = measureTops(container, cfg.selector);
        const afterEl = app.getDragAfterElement(container, y, cfg.selector);
        if (!afterEl) container.appendChild(placeholder);
        else if (afterEl !== placeholder)
          container.insertBefore(placeholder, afterEl);
        animateFlip(container, cfg.selector, before);
      };
      const onMove = (event) => {
        event.preventDefault();
        move(event.clientX, event.clientY);
      };
      const onUp = (ev) => {
        document.removeEventListener("pointermove", onMove, pointerOpts);
        document.removeEventListener("pointerup", onUp, pointerOpts);
        document.removeEventListener("pointercancel", onUp, pointerOpts);
        ev.preventDefault();
        item.classList.remove("dragging-fixed");
        item.style.position = orig.position || "";
        item.style.left = orig.left || "";
        item.style.top = orig.top || "";
        item.style.width = orig.width || "";
        item.style.height = orig.height || "";
        item.style.zIndex = orig.zIndex || "";
        item.style.margin = orig.margin || "";
        item.style.pointerEvents = orig.pointerEvents || "";
        container.insertBefore(item, placeholder);
        placeholder.remove();
        clearTransforms(container, cfg.selector);
        applyOrderToModel(container, cfg);
        // 如果排序只是针对弹窗的临时缓冲，则不立即持久化，等待用户点击保存
        if (
          !(
            (cfg.dataKey === "taskTypes" && app._modalTaskTypes) ||
            (cfg.dataKey === "sourcePlatforms" && app._modalSourcePlatforms) ||
            (cfg.dataKey === "presetNodes" && app._modalPresetNodes)
          )
        ) {
          app.saveAllData();
        }
      };
      document.addEventListener("pointermove", onMove, pointerOpts);
      document.addEventListener("pointerup", onUp, pointerOpts);
      document.addEventListener("pointercancel", onUp, pointerOpts);
      item.setPointerCapture(startEvent.pointerId);
    };
    // 为单个项的拖拽手柄绑定 pointerdown 事件
    const bindItem = (container, item, cfg) => {
      const handle = item.querySelector(".drag-handle");
      const onPointerDown = (ev) => startDrag(container, item, cfg, ev);
      handle.addEventListener("pointerdown", onPointerDown, pointerOpts);
    };
    // 初始化：为每个配置的容器绑定现有项的拖拽手柄事件
    configs.forEach((cfg) => {
      const container = document.getElementById(cfg.id);
      if (!container) return;
      container
        .querySelectorAll(cfg.selector)
        .forEach((item) => bindItem(container, item, cfg));
    });
  }
  // 根据鼠标 Y 位置寻找要插入到之前的元素
  getDragAfterElement(container, y, itemSelector) {
    const draggableElements = [
      ...container.querySelectorAll(itemSelector),
    ].filter((el) => !el.classList.contains("dragging"));
    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
    for (const child of draggableElements) {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        closest = { offset, element: child };
      }
    }
    return closest.element;
  }

  // 页面设置弹窗：包含 S/V 滑块与任务类型色块预览
  showPageSettingsModal() {
    // 使用与类型管理相同的宽度约束（max-w-md）以保持一致
    const modalHTML = `
      <div id="page-settings-modal" class="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
          <div class="flex-1 overflow-y-auto p-6">
            <h2 class="text-xl font-bold text-stone-800 mb-4">页面设置</h2>

            <!-- 一级：任务卡片 -->
            <section class="mb-4">
              <h3 class="text-lg font-semibold text-stone-800 mb-3">任务卡片</h3>
              <div class="mb-4">
                <label class="block text-sm text-stone-600 mb-2">饱和度 S (最大值)</label>
                <div class="flex items-center gap-3">
                  <input id="hsv-s-slider" type="range" min="0" max="100" value="${Math.round(
                    (this.hsvMaxS || 1) * 100
                  )}" class="flex-1">
                  <span id="hsv-s-val" class="w-12 text-right text-sm text-stone-600">${Math.round(
                    (this.hsvMaxS || 1) * 100
                  )}%</span>
                </div>
              </div>

              <div class="mb-4">
                <label class="block text-sm text-stone-600 mb-2">明度 V (最大值)</label>
                <div class="flex items-center gap-3">
                  <input id="hsv-v-slider" type="range" min="0" max="100" value="${Math.round(
                    (this.hsvMaxV || 1) * 100
                  )}" class="flex-1">
                  <span id="hsv-v-val" class="w-12 text-right text-sm text-stone-600">${Math.round(
                    (this.hsvMaxV || 1) * 100
                  )}%</span>
                </div>
              </div>

              <div class="mb-2 text-sm text-stone-700">任务类型颜色预览</div>
              <div id="page-settings-swatches" class="mb-4"></div>

              <div class="mb-4">
                <label class="block text-sm text-stone-600 mb-2">卡片下半区白度（与白色混合）</label>
                <div class="flex items-center gap-3">
                  <input id="body-white-blend-slider" type="range" min="0" max="100" value="${Math.round(
                    (this.cardBodyWhiteBlend || 0.7) * 100
                  )}" class="flex-1">
                  <span id="body-white-blend-val" class="w-12 text-right text-sm text-stone-600">${Math.round(
                    (this.cardBodyWhiteBlend || 0.7) * 100
                  )}%</span>
                </div>
              </div>
              <!-- 页面样式切换 -->
              <div class="mb-4">
                <h3 class="text-sm font-medium text-stone-700 mb-2">页面样式</h3>
                <div class="flex items-center gap-4">
                  <label class="inline-flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="theme-select" id="theme-warm" value="warm" class="h-4 w-4">
                    <span class="text-sm text-stone-700">暖色</span>
                  </label>
                  <label class="inline-flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="theme-select" id="theme-standard" value="standard" class="h-4 w-4">
                    <span class="text-sm text-stone-700">标准</span>
                  </label>
                </div>
              </div>

              <div class="mb-4">
                <label class="block text-sm text-stone-600 mb-2">已完成卡片透明度</label>
                <div class="flex items-center gap-3">
                  <input id="completed-opacity-slider" type="range" min="0" max="100" value="${Math.round(
                    (this.completedTaskOpacity || 0.8) * 100
                  )}" class="flex-1">
                  <span id="completed-opacity-val" class="w-12 text-right text-sm text-stone-600">${Math.round(
                    (this.completedTaskOpacity || 0.8) * 100
                  )}%</span>
                </div>
              </div>
                            <div class="mb-2 flex items-start justify-between gap-3">
                <div>
                  <div class="text-sm text-stone-700">删除操作需要确认</div>
                  <div class="text-xs text-stone-500">在主界面删除任务时是否弹出确认对话框；取消则直接移动到回收站</div>
                </div>
                <label class="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input id="toggle-confirm-delete" type="checkbox" class="h-4 w-4" ${
                    this.confirmDeleteOnRemove === false ? "" : "checked"
                  }>
                </label>
              </div>

              <!-- 新增：隐藏上个月及之前的已完成委托 -->
              <div class="mb-2 flex items-start justify-between gap-3">
                <div>
                  <div class="text-sm text-stone-700">隐藏上个月及之前的 '已完成' 委托</div>
                  <div class="text-xs text-stone-500">开启后，主界面将默认隐藏上个月及之前完成的任务，可在日历查看之前完成的任务。</div>
                </div>
                <label class="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input id="toggle-hide-last-month" type="checkbox" class="h-4 w-4" ${
                    this.hideCompletedBeforeLastMonth ? "checked" : ""
                  }>
                </label>
              </div>

              <!-- 新增：仅截止日期模式 -->
              <div class="mb-2 flex items-start justify-between gap-3">
                <div>
                  <div class="text-sm text-stone-700">仅显示截止日期（无具体时间）</div>
                  <div class="text-xs text-stone-500">开启后任务卡片不显示具体截止时间，只显示月/日</div>
                </div>
                <label class="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input id="toggle-deadline-date-only" type="checkbox" class="h-4 w-4" ${
                    this.dateOnlyDeadlineMode ? "checked" : ""
                  }>
                </label>
              </div>
            </section>

            <!-- 一级：编辑 & 添加页面 -->
            <section class="mb-4">
              <h3 class="text-lg font-semibold text-stone-800 mb-3">编辑 & 添加页面</h3>
              <div class="mb-2 flex items-start justify-between gap-3">
                <div>
                  <div class="text-sm text-stone-700">显示快捷添加类型/来源输入框</div>
                  <div class="text-xs text-stone-500">在添加/编辑任务卡片页面中展示快捷输入框以新增任务类型或平台</div>
                </div>
                <label class="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input id="toggle-quick-add-inputs" type="checkbox" class="h-4 w-4" ${
                    this.showQuickAddInputs === false ? "" : "checked"
                  }>
                </label>
              </div>


            </section>
          </div>
          <div class="modal-footer !m-0 !p-6 pt-0">
            <div class="flex gap-3">
              <button id="close-page-settings-btn" class="flex-1 px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50">关闭</button>
              <button id="save-page-settings-btn" class="flex-1 px-4 py-2 btn-save">保存</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML("beforeend", modalHTML);

    const sSlider = document.getElementById("hsv-s-slider");
    const vSlider = document.getElementById("hsv-v-slider");
    const completedSlider = document.getElementById("completed-opacity-slider");
    const completedVal = document.getElementById("completed-opacity-val");
    const sVal = document.getElementById("hsv-s-val");
    const vVal = document.getElementById("hsv-v-val");
    const bodySlider = document.getElementById("body-white-blend-slider");
    const bodyVal = document.getElementById("body-white-blend-val");
    const quickAddToggle = document.getElementById("toggle-quick-add-inputs");
    const confirmDeleteToggle = document.getElementById(
      "toggle-confirm-delete"
    );
    const hideLastMonthToggle = document.getElementById(
      "toggle-hide-last-month"
    );

    const setSliderVars = () => {
      const sp = Math.round(Number(sSlider.value));
      const vp = Math.round(Number(vSlider.value));
      sSlider.style.setProperty("--val", sp + "%");
      vSlider.style.setProperty("--val", vp + "%");
      completedSlider.style.setProperty(
        "--val",
        Math.round(Number(completedSlider.value)) + "%"
      );
      if (bodySlider)
        bodySlider.style.setProperty(
          "--val",
          Math.round(Number(bodySlider.value)) + "%"
        );
    };

    // 更新页面上现有卡片的背景颜色（立即生效，不重绘整个列表）
    const updateCardBackgrounds = () => {
      try {
        const s = Number(sSlider.value) / 100;
        const v = Number(vSlider.value) / 100;
        const bodyBlend = bodySlider
          ? Number(bodySlider.value) / 100
          : this.cardBodyWhiteBlend;
        // 先按类型计算一次颜色，避免对每张卡重复计算
        const typeMap = new Map();
        this.taskTypes.forEach((t) => {
          const headerBg = this.computeLightBgFromHex(t.color, s, v);
          const bodyBg = this.blendWithWhite(headerBg, bodyBlend);
          typeMap.set(t.id, { headerBg, bodyBg });
        });

        const cards = document.querySelectorAll(".task-card");
        cards.forEach((card) => {
          const typeId =
            card.getAttribute("data-type") ||
            card.getAttribute("data-type") ||
            "";
          let info = typeMap.get(typeId);
          if (!info) {
            // 回退：若没有该类型（可能是未知），用默认颜色
            const t = this.taskTypes[0] || { color: "#95A5A6" };
            const headerBg = this.computeLightBgFromHex(t.color, s, v);
            info = {
              headerBg,
              bodyBg: this.blendWithWhite(headerBg, bodyBlend),
            };
          }
          // 设置内层 header/body 背景（尽量减少不必要的写入）
          const headerEl = card.querySelector(".task-card-header");
          const bodyEl = card.querySelector(".task-card-body");
          if (headerEl && headerEl.style.background !== info.headerBg)
            headerEl.style.background = info.headerBg;
          if (bodyEl && bodyEl.style.background !== info.bodyBg)
            bodyEl.style.background = info.bodyBg;
        });

        // 同步更新统计卡片背景（按类型）
        try {
          const stats = document.querySelectorAll(".stats-card");
          stats.forEach((sc) => {
            const tf = sc.getAttribute("data-type-filter");
            if (!tf || tf === "all") return;
            const t = this.taskTypes.find((tt) => tt.id === tf);
            const hex = t ? t.color : "#95A5A6";
            const sbg = this.computeLightBgFromHex(hex, s, v);
            if (sbg && sc.style.background !== sbg) sc.style.background = sbg;
          });
        } catch (e) {
          // 忽略单张卡片统计错误
        }
      } catch (e) {
        console.warn("updateCardBackgrounds error", e);
      }
    };

    const onInputChange = () => {
      const s = Number(sSlider.value) / 100;
      const v = Number(vSlider.value) / 100;
      sVal.textContent = `${Math.round(s * 100)}%`;
      vVal.textContent = `${Math.round(v * 100)}%`;
      const cp = Number(completedSlider.value) / 100;
      completedVal.textContent = `${Math.round(cp * 100)}%`;
      // body blend 值显示
      if (bodyVal)
        bodyVal.textContent = `${Math.round(
          (Number(bodySlider.value) / 100) * 100
        )}%`;
      // 实时设置 CSS 变量，影响 .task-card.is-laid-out.completed 的 opacity
      document.documentElement.style.setProperty(
        "--completed-task-opacity",
        String(cp)
      );
      // 更新滑块的 CSS 变量以修正轨道填充显示
      setSliderVars();
      // 同步更新页面上卡片的背景颜色（使用 rAF 节流）
      if (this._pendingCardBgRaf) cancelAnimationFrame(this._pendingCardBgRaf);
      this._pendingCardBgRaf = requestAnimationFrame(() => {
        try {
          updateCardBackgrounds();
        } finally {
          this._pendingCardBgRaf = null;
        }
      });
      // 实时预览
      try {
        this.renderPageSettingsSwatches();
      } catch (e) {
        console.warn(e);
      }
    };

    // 初始化并监听输入（触发一次同步渲染）
    setSliderVars();
    updateCardBackgrounds();
    // 初始化 body 值显示
    if (bodyVal)
      bodyVal.textContent = `${Math.round(
        bodySlider
          ? Number(bodySlider.value)
          : Math.round((this.cardBodyWhiteBlend || 0.7) * 100)
      )}%`;
    // 应用已保存的 completed opacity 到根变量，保证发牌前样式生效
    document.documentElement.style.setProperty(
      "--completed-task-opacity",
      String(this.completedTaskOpacity ?? 0.8)
    );
    sSlider.addEventListener("input", onInputChange);
    vSlider.addEventListener("input", onInputChange);
    completedSlider.addEventListener("input", onInputChange);
    if (bodySlider) bodySlider.addEventListener("input", onInputChange);

    if (quickAddToggle) {
      quickAddToggle.addEventListener("change", async () => {
        this.showQuickAddInputs = !!quickAddToggle.checked;
        this.renderTaskTypeOptions();
        this.renderSourceOptions();
        try {
          await this.saveAllData();
        } catch (e) {
          console.warn("保存快捷添加开关失败", e);
        }
      });
    }

    // 切换“默认隐藏上个月及之前的已完成委托”时，立即保存并触发全局刷新
    if (hideLastMonthToggle) {
      hideLastMonthToggle.addEventListener("change", async () => {
        this.hideCompletedBeforeLastMonth = !!hideLastMonthToggle.checked;
        try {
          await this.saveAllData();
        } catch (e) {
          console.warn("保存 hideCompletedBeforeLastMonth 失败", e);
        }
        // 立即刷新视图并更新统计
        try {
          this.renderTasks();
          this.updateStats();
        } catch (e) {
          console.warn("刷新视图失败", e);
        }
        this.showMessage(
          this.hideCompletedBeforeLastMonth
            ? "已启用：隐藏上个月及之前的已完成委托"
            : "已禁用：将显示上个月及之前的已完成委托"
        );
      });
    }

    const dateOnlyToggle = document.getElementById("toggle-deadline-date-only");
    if (dateOnlyToggle) {
      dateOnlyToggle.addEventListener("change", async () => {
        this.dateOnlyDeadlineMode = !!dateOnlyToggle.checked;
        try {
          await this.saveAllData();
        } catch (e) {
          console.warn("保存 dateOnlyDeadlineMode 失败", e);
        }
        try {
          this.renderTasks();
          this.updateStats();
        } catch (e) {
          console.warn("刷新视图失败", e);
        }
        this.showMessage(
          this.dateOnlyDeadlineMode
            ? "已启用：仅显示截止日期（无具体时间）"
            : "已禁用：显示截止时间"
        );
      });
    }

    const savePageSettingsAndExit = async () => {
      const s = Number(sSlider.value) / 100;
      const v = Number(vSlider.value) / 100;
      const cp = Number(completedSlider.value) / 100;
      const quickAddEnabled = quickAddToggle
        ? quickAddToggle.checked
        : this.showQuickAddInputs;
      const confirmDeleteEnabled = confirmDeleteToggle
        ? confirmDeleteToggle.checked
        : this.confirmDeleteOnRemove;
      const hideLastMonthEnabled = hideLastMonthToggle
        ? hideLastMonthToggle.checked
        : this.hideCompletedBeforeLastMonth;
      const dateOnlyEnabled = document.getElementById("toggle-deadline-date-only")
        ? document.getElementById("toggle-deadline-date-only").checked
        : this.dateOnlyDeadlineMode;
      this.hsvMaxS = s;
      this.hsvMaxV = v;
      this.completedTaskOpacity = cp;
      this.showQuickAddInputs = quickAddEnabled;
      this.confirmDeleteOnRemove = !!confirmDeleteEnabled;
      this.hideCompletedBeforeLastMonth = !!hideLastMonthEnabled;
      this.dateOnlyDeadlineMode = !!dateOnlyEnabled;
      // 保存体现在页面设置中的卡片下半区白度值
      const bb = bodySlider
        ? Number(bodySlider.value) / 100
        : this.cardBodyWhiteBlend;
      this.cardBodyWhiteBlend = bb;
      window._hsvDebug = window._hsvDebug || {};
      window._hsvDebug.maxS = s;
      window._hsvDebug.maxV = v;
      document.documentElement.style.setProperty(
        "--completed-task-opacity",
        String(this.completedTaskOpacity)
      );
      try {
        await this.saveAllData();
        this.showMessage("页面设置已保存");
        this.renderTaskTypeOptions();
        this.renderSourceOptions();
        // 立即应用最终的 card body blend 值
        try {
          updateCardBackgrounds();
        } catch (err2) {
          /* ignore */
        }
        // 如存在则应用已保存的主题选择
        try {
          const themeRadios = document.getElementsByName("theme-select");
          if (themeRadios && themeRadios.length) {
            let sel = null;
            for (const r of themeRadios) if (r.checked) sel = r.value;
            if (sel && window.applyTheme) window.applyTheme(sel);
          }
        } catch (e) {
          console.warn("apply theme failed", e);
        }
        // 重新渲染日历以使 timeline bar 的透明度与设置同步
        try {
          this.renderCalendar();
        } catch (e) {
          console.warn("刷新日历失败", e);
        }
      } catch (e) {
        console.error("保存页面设置失败", e);
        this.showMessage("页面设置保存失败");
      }
      const m = document.getElementById("page-settings-modal");
      if (m) m.remove();
    };

    document
      .getElementById("close-page-settings-btn")
      .addEventListener("click", () => {
        const m = document.getElementById("page-settings-modal");
        if (m) m.remove();
      });
    document
      .getElementById("save-page-settings-btn")
      .addEventListener("click", savePageSettingsAndExit);

    // 点击 backdrop（灰色区域）时也保存设置并关闭（与点击保存按钮等效）
    const modal = document.getElementById("page-settings-modal");
    if (modal) {
      this.bindOverlayClose(modal, savePageSettingsAndExit);
    }

    // 初次渲染色块
    this.renderPageSettingsSwatches();

    // 初始化主题选择控件的状态（基于已保存的 siteTheme 或当前 link）
    try {
      const saved = localStorage.getItem("siteTheme");
      const themeLink = document.getElementById("theme-stylesheet");
      const current =
        saved ||
        (themeLink &&
        (themeLink.getAttribute("href") || "").includes("暖色.css")
          ? "warm"
          : "standard");
      const warm = document.getElementById("theme-warm");
      const standard = document.getElementById("theme-standard");
      if (warm && standard) {
        if (current === "warm") warm.checked = true;
        else standard.checked = true;
      }
    } catch (e) {
      /* ignore */
    }
    try {
      const warm = document.getElementById("theme-warm");
      const standard = document.getElementById("theme-standard");
      if (warm)
        warm.addEventListener("change", () => {
          if (warm.checked && window.applyTheme) window.applyTheme("warm");
        });
      if (standard)
        standard.addEventListener("change", () => {
          if (standard.checked && window.applyTheme)
            window.applyTheme("standard");
        });
    } catch (e) {
      /* ignore */
    }
  }

  // 渲染设置面板中的色块预览，最多每行 6 个，动态跟随 this.taskTypes
  renderPageSettingsSwatches() {
    const container = document.getElementById("page-settings-swatches");
    if (!container) return;
    // 读取当前滑块值（优先使用 DOM，回退到实例值）
    const sSlider = document.getElementById("hsv-s-slider");
    const vSlider = document.getElementById("hsv-v-slider");
    const bodySlider = document.getElementById("body-white-blend-slider");
    const s = sSlider ? Number(sSlider.value) / 100 : this.hsvMaxS || 1;
    const v = vSlider ? Number(vSlider.value) / 100 : this.hsvMaxV || 1;
    const bodyPercent = bodySlider
      ? Number(bodySlider.value)
      : Math.round((this.cardBodyWhiteBlend || 0.7) * 100);

    // 使用 flex + space-between 布局，最多每行 10 个，超过 10 个时换行
    const types = this.taskTypes || [];
    const count = types.length || 0;
    const perRow = Math.min(10, Math.max(1, count));
    // 清理并设置容器样式
    container.innerHTML = "";
    container.style.display = "flex";
    container.style.flexWrap = "wrap";
    container.style.justifyContent = "space-between";
    container.style.alignItems = "flex-start";
    container.style.gap = "8px";

    const itemWidthPercent = 100 / perRow;

    container.append(
      ...types.map((t) => {
        const header = this.computeLightBgFromHex(t.color, s, v);
        const body = this.blendWithWhite(header, Number(bodyPercent) / 100);
        const gradient = `linear-gradient(to bottom, ${header} 0% 33%, ${body} 33% 100%)`; //色块预览上下分色比例
        //linear-gradient(to bottom, ${header} 0% 30%, ${body} 30% 100%);

        const wrap = document.createElement("div");
        wrap.className = "ps-swatch-item flex flex-col items-center text-sm";
        wrap.style.width = `calc(${itemWidthPercent}% - 8px)`; // 减去 gap 的近似值
        wrap.style.boxSizing = "border-box";
        wrap.style.gap = "6px";

        const sw = document.createElement("div");
        sw.className = "ps-swatch-box";
        sw.title = t.name;
        sw.style.width = "100%";
        sw.style.height = "60px"; //色块预览高度
        sw.style.borderRadius = "6px"; //圆角
        sw.style.background = gradient; //应用渐变背景

        const label = document.createElement("div");
        label.className = "truncate w-full text-center text-xs text-stone-600";
        label.textContent = t.name;

        wrap.appendChild(sw);
        wrap.appendChild(label);
        return wrap;
      })
    );
  }

  // 注入全局样式以强制颜色选择器为固定小尺寸圆角方形
  ensureColorPickerStyle() {
    if (typeof document === "undefined") return;
    if (document.getElementById("color-picker-sm-style")) return;
    const style = document.createElement("style");
    style.id = "color-picker-sm-style";
    style.textContent = `
      input[type="color"].color-picker-sm {
        width: 30px !important;
        height: 30px   !important;
        border-radius: 0.5rem !important;
        padding: 0 !important;
        border: 0 !important;
        appearance: none !important;
        -webkit-appearance: none !important;
        overflow: hidden !important;
      }
      input[type="color"].color-picker-sm::-webkit-color-swatch-wrapper { padding: 0 !important; }
      input[type="color"].color-picker-sm::-webkit-color-swatch { border: none !important; border-radius: 0.5rem !important; }
      `;
    document.head.appendChild(style);
  }

  // 复用 createTaskCard 中的简洁 hex->lightBg 逻辑，接受可选 s/v
  computeLightBgFromHex(hex, capS, capV) {
    // 使用通用转换：hex -> RGB -> HSV -> 可选 cap -> HSV -> RGB
    const rgb = this._hexToRgb(hex);
    const hsv = this._rgbToHsv(rgb.r, rgb.g, rgb.b);
    // capS 表示对原始 s 的上限
    const cappedS = Math.min(hsv.s, Math.max(0, capS ?? this.hsvMaxS ?? 1));
    const cappedV = Math.min(1, Math.max(0, capV ?? this.hsvMaxV ?? 1));
    const out = this._hsvToRgb(hsv.h, cappedS, cappedV);
    return `rgb(${out.r}, ${out.g}, ${out.b})`;
  }

  // 使用 OKLCH 计算按钮背景色（基于 header 同色），L 不超过 maxL，C 限制在合理范围
  computeButtonBgFromHex(hex, maxL = 0.9) {
    const headerRgb = this.computeLightBgFromHex(hex);
    return window.taskUtils.computeButtonOklch(headerRgb, { maxL }) || '#6B7280';
  }

  // 将输入颜色（hex 或 rgb(...)）与白色按百分比混合，percent 范围 0..1
  blendWithWhite(color, percent = 0.7) { return window.taskUtils.blendWithWhite(color, percent); }

  // ------- OKLCH 帮助函数 + 颜色辅助（全部委托到 taskUtils）-------
  supportsOKLCH() { return window.taskUtils.supportsOKLCH(); }
  _srgbToLinear(v) { return window.taskUtils.srgbToLinear(v); }
  _linearToSrgb(v) { return window.taskUtils.linearToSrgb(v); }
  _rgbToXyz(r, g, b) { return window.taskUtils.rgbToXyz(r, g, b); }
  _xyzToOklab(X, Y, Z) { return window.taskUtils.xyzToOklab(X, Y, Z); }
  _oklabToOklch(oklab) { return window.taskUtils.oklabToOklch(oklab); }
  _oklchToOklab(oklch) { return window.taskUtils.oklchToOklab(oklch); }
  _oklabToXyz(oklab) { return window.taskUtils.oklabToXyz(oklab); }
  _xyzToRgb(X, Y, Z) { return window.taskUtils.xyzToRgb(X, Y, Z); }
  _hexToOklch(hex) { return window.taskUtils.hexToOklch(hex); }
  _oklchToRgb(oklch) { return window.taskUtils.oklchToRgb(oklch); }
  computeOklchAdjustedRing(hex) { return window.taskUtils.computeOklchAdjustedRing(hex); }
  computeRingFromHex(hex, deltaS = 0.5, deltaV = 0) { return window.taskUtils.computeRingFromHex(hex, deltaS, deltaV); }
  luminanceFromRgb(rgb) { return window.taskUtils.luminanceFromRgb(rgb); }

  // --- 通用颜色辅助函数（委托到 taskUtils 共享实现）---
  _hexToRgb(hex) { return window.taskUtils.hexToRgb(hex); }
  _rgbToHsv(r255, g255, b255) { return window.taskUtils.rgbToHsv(r255, g255, b255); }
  _hsvToRgb(h, s, v) { return window.taskUtils.hsvToRgb(h, s, v); }
  parseRgbString(rgbStr) { return window.taskUtils.parseRgbString(rgbStr); }

  // 计算对比安全的 ring 色的函数
  // 先尝试 deltaV=+0.5，如果与背景亮度差异太小则尝试更暗的方案
  computeContrastSafeRing(hex, bgRgbString) {
    try {
      const ring1 = this.computeRingFromHex(hex, 0.5);
      const ringRgb = this.parseRgbString(ring1);
      const bgRgb =
        this.parseRgbString(bgRgbString) ||
        this.parseRgbString(this.computeLightBgFromHex(hex));
      if (!ringRgb || !bgRgb) return ring1;
      const lumRing = this.luminanceFromRgb(ringRgb);
      const lumBg = this.luminanceFromRgb(bgRgb);
      if (Math.abs(lumRing - lumBg) < 0.18) {
        // 如果 ring 本身是高饱和度且亮度适中的鲜艳颜色，对其做小幅调整（降亮度并微调色相），以保持鲜艳但不太刺眼
        try {
          const hsvRingTemp = this._rgbToHsv(ringRgb.r, ringRgb.g, ringRgb.b);
          if (hsvRingTemp.s >= 0.45 && hsvRingTemp.v >= 0.5) {
            // 减小亮度 0.05
            const newV = Math.max(0, hsvRingTemp.v - 0.05);
            let newH = hsvRingTemp.h;
            // 黄色区域 50-60 度：调低色相 10 度
            if (newH >= 50 && newH <= 60) newH = (newH - 10 + 360) % 360;
            // 黄绿色区域 61-70 度：提高色相 5 度
            else if (newH >= 61 && newH <= 70) newH = (newH + 5) % 360;
            const adj = this._hsvToRgb(newH, hsvRingTemp.s, newV);
            return `rgb(${adj.r}, ${adj.g}, ${adj.b})`;
          }
        } catch (e) {
          /* ignore */
        }
        // 尝试更暗的 ring
        const ring2 = this.computeRingFromHex(hex, -0.4);
        const ring2Rgb = this.parseRgbString(ring2);
        if (ring2Rgb) {
          const lum2 = this.luminanceFromRgb(ring2Rgb);
          if (Math.abs(lum2 - lumBg) >= 0.18) return ring2;
        }
        // 回退：使用半透明黑色作为较稳妥的边框
        return "rgba(0,0,0,0.18)";
      }
      return ring1;
    } catch (e) {
      return this.computeRingFromHex(hex, 0.5);
    }
  }
  normalizeToDayStart(date) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  }

  normalizeToDayEnd(date) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(23, 59, 59, 999);
    return d;
  }

  diffDaysInclusive(start, end) {
    return Math.max(1, Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1);
  }

  getTaskSpanForStats(task) {
    const todayEnd = this.normalizeToDayEnd(new Date());
    const startStr =
      task.startTime ||
      task.starttime ||
      task.actualStartTime ||
      task.createdAt ||
      task.deadline;
    const startDay = this.normalizeToDayStart(startStr);
    if (!startDay) return null;

    const deadlineEnd = task.deadline ? this.normalizeToDayEnd(task.deadline) : null;
    const completedEnd = task.completedAt
      ? this.normalizeToDayEnd(task.completedAt)
      : null;
    // 废弃任务以 abandonedAt 为终点
    const abandonedEnd = task.abandoned && task.abandonedAt
      ? this.normalizeToDayEnd(task.abandonedAt)
      : null;

    let endDay = abandonedEnd || completedEnd || deadlineEnd || todayEnd;
    if (!endDay) return null;
    // 仅对未完成且未废弃的任务延伸到今天
    if (!task.completed && !task.abandoned && endDay < todayEnd) endDay = todayEnd;
    if (endDay < startDay) endDay = this.normalizeToDayEnd(startDay);

    const anchorRaw = abandonedEnd || completedEnd || deadlineEnd || endDay;
    let anchorEnd = anchorRaw;
    if (!task.completed && !task.abandoned && anchorEnd && anchorEnd < todayEnd) anchorEnd = todayEnd;

    const totalDays = this.diffDaysInclusive(startDay, endDay);
    return { startDay, endDay, totalDays, anchorEnd };
  }

  computeMonthlyTaskProjections(year, month) {
    const monthStart = this.normalizeToDayStart(new Date(year, month, 1));
    const monthEnd = this.normalizeToDayEnd(new Date(year, month + 1, 0));
    const projections = [];

    (this.tasks || []).forEach((task) => {
      const span = this.getTaskSpanForStats(task);
      if (!span) return;

      const overlapStart = span.startDay > monthStart ? span.startDay : monthStart;
      const overlapEnd = span.endDay < monthEnd ? span.endDay : monthEnd;
      if (overlapEnd < overlapStart) return;

      const overlapDays = this.diffDaysInclusive(overlapStart, overlapEnd);
      const ratio = span.totalDays > 0 ? overlapDays / span.totalDays : 0;
      if (ratio <= 0) return;

      const anchorMatchesMonth =
        span.anchorEnd &&
        span.anchorEnd.getFullYear() === year &&
        span.anchorEnd.getMonth() === month;
      const isCrossMonth =
        span.startDay.getFullYear() !== span.endDay.getFullYear() ||
        span.startDay.getMonth() !== span.endDay.getMonth();

      projections.push({
        task,
        ratio,
        overlapDays,
        anchorMatchesMonth,
        isCrossMonth,
        span,
      });
    });

    return { monthStart, monthEnd, projections };
  }

  formatStatCount(value, fractionDigits = 2) {
    if (Number.isNaN(value)) return "0";
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(fractionDigits);
  }
  calculateMonthlyStats(year, month) {
    const { monthStart, monthEnd, projections } = this.computeMonthlyTaskProjections(
      year,
      month
    );
    let totalTasks = 0;
    let completedTasks = 0;
    let abandonedTasks = 0;
    let totalPayment = 0;
    let completedPayment = 0;
    let hourlyPayment = 0;
    let hourlyHours = 0;

    projections.forEach(({ task, ratio, span, anchorMatchesMonth }) => {
      const payment = this.getTaskNetIncomeForStats(task);
      if (task.abandoned) {
        abandonedTasks += ratio;
        return; // 废弃任务不计入totalTasks/completedTasks
      }
      totalTasks += ratio;

      const completedAtDate = task.completedAt
        ? this.normalizeToDayEnd(task.completedAt)
        : null;
      const completedInMonth =
        task.completed &&
        completedAtDate &&
        completedAtDate >= monthStart &&
        completedAtDate <= monthEnd;

      if (task.completed) {
        completedTasks += ratio;
      }
      if (completedInMonth) {
        completedPayment += payment;
      }

      // 仅在锚定月份计入稿酬（完成月优先，其次截止月，逾期未完成按今天）
      if (anchorMatchesMonth) {
        totalPayment += payment;
      }

      if (task.completed) {
        const hours = Number(task.actualHours) || Number(task.completedHours) || 0;
        if (hours > 0) {
          hourlyHours += hours * ratio;
          hourlyPayment += payment * ratio;
        }
      }
    });

    const hourlyRate = hourlyHours > 0 ? hourlyPayment / hourlyHours : 0;
    return {
      totalTasks,
      completedTasks,
      abandonedTasks,
      totalPayment,
      completedPayment,
      completedHours: hourlyHours,
      hourlyRate,
    };
  }

  calculateMonthlyPlatformStats(year, month) {
    const { projections } = this.computeMonthlyTaskProjections(year, month);
    const monthlyTasks = projections.filter(({ task, anchorMatchesMonth }) => {
      if (anchorMatchesMonth) return true;
      const completedAtDate = task.completedAt
        ? this.normalizeToDayEnd(task.completedAt)
        : null;
      return (
        task.completed &&
        completedAtDate &&
        completedAtDate.getFullYear() === year &&
        completedAtDate.getMonth() === month
      );
    });

    const platformMap = new Map();
    monthlyTasks.forEach(({ task, ratio }) => {
      const platformId = task.source || "other";
      const payment = this.getTaskNetIncomeForStats(task);
      const entry = platformMap.get(platformId) || {
        totalPayment: 0,
        completedPayment: 0,
        totalTasks: 0,
        completedTasks: 0,
        abandonedTasks: 0,
      };

      if (task.abandoned) {
        entry.abandonedTasks += ratio;
      } else {
        entry.totalPayment += payment;
        entry.totalTasks += ratio;
        if (task.completed) {
          entry.completedPayment += payment;
          entry.completedTasks += ratio;
        }
      }
      platformMap.set(platformId, entry);
    });

    return Array.from(platformMap.entries())
      .map(([platformId, entry]) => {
        // 首先查找用户配置的 sourcePlatforms（来自 index.json/server）
        const platform =
          this.sourcePlatforms.find(
            (p) => p.id === platformId || p.name === platformId
          ) || null;
        const name = (platform && platform.name) || platformId;
        // 如果没有用户配置的颜色，则基于 platformId 生成一个稳定的颜色（避免使用早前的默认硬编码颜色）
        const color =
          (platform && platform.color) || this.stringToColor(platformId);
        return {
          id: platformId,
          name,
          color,
          ...entry,
        };
      })
      .sort(
        (a, b) =>
          b.totalPayment - a.totalPayment ||
          b.completedPayment - a.completedPayment ||
          b.totalTasks - a.totalTasks
      );

  }

  calculateMonthlyCrossPlatformStats(year, month) {
    const { projections } = this.computeMonthlyTaskProjections(year, month);
    const crossTasks = projections.filter(({ isCrossMonth }) => isCrossMonth);
    const platformMap = new Map();

    crossTasks.forEach(({ task, ratio }) => {
      const platformId = task.source || "other";
      const payment = this.getTaskNetIncomeForStats(task);
      const entry = platformMap.get(platformId) || {
        totalPayment: 0,
        completedPayment: 0,
        totalTasks: 0,
        completedTasks: 0,
        abandonedTasks: 0,
      };
      if (task.abandoned) {
        entry.abandonedTasks += ratio;
      } else {
        entry.totalPayment += payment * ratio;
        entry.totalTasks += ratio;
        if (task.completed) {
          entry.completedPayment += payment * ratio;
          entry.completedTasks += ratio;
        }
      }
      platformMap.set(platformId, entry);
    });

    return Array.from(platformMap.entries())
      .map(([platformId, entry]) => {
        const platform =
          this.sourcePlatforms.find(
            (p) => p.id === platformId || p.name === platformId
          ) || null;
        const name = (platform && platform.name) || platformId;
        const color =
          (platform && platform.color) || this.stringToColor(platformId);
        return {
          id: platformId,
          name,
          color,
          ...entry,
        };
      })
      .sort(
        (a, b) =>
          b.totalPayment - a.totalPayment ||
          b.completedPayment - a.completedPayment ||
          b.totalTasks - a.totalTasks
      );
  }

  renderMonthlyPlatformStats(platformStats, options = {}) {
    const listEl = document.getElementById(
      options.listId || "monthly-platform-stats"
    );
    const emptyEl = document.getElementById(
      options.emptyId || "monthly-platform-empty"
    );
    const showPayment = options.showPayment !== false;
    const useCounts = options.useCounts || false;
    if (!listEl) return;

    listEl.innerHTML = "";
    const hasStats = Array.isArray(platformStats) && platformStats.length > 0;
    if (!hasStats) {
      // No stats, wrapper will be hidden
      return;
    }
    // Always hide empty message since wrapper controls visibility
    if (emptyEl) emptyEl.classList.add("hidden");

    platformStats.forEach((stat) => {
      const baseColor = stat.color || "#95A5A6"; // stat.color 来自 index.json 的 sourcePlatforms 优先使用
      const bg = baseColor
        ? this.computeLightBgFromHex(baseColor)
        : "transparent";
      const ok = baseColor ? this.computeOklchAdjustedRing(baseColor) : null;
      const ring = ok && ok.oklch ? ok.oklch : "rgba(0,0,0,0.08)";
      const ratioSource = useCounts
        ? {
            completed: stat.completedTasks || 0,
            total: stat.totalTasks || 0,
          }
        : {
            completed: stat.completedPayment || 0,
            total: stat.totalPayment || 0,
          };
      const ratioRaw =
        ratioSource.total > 0
          ? Math.round((ratioSource.completed / ratioSource.total) * 100)
          : 0;
      const ratio = Math.min(100, Math.max(0, ratioRaw));

      const card = document.createElement("div");
      card.className = "platform-stat-card";
      card.dataset.platformId = stat.id;
      card.style.background = bg;
      card.style.borderColor = ring;

      const dotStyle = `background:${baseColor};`;
      const progressStyle = `width:${ratio}%;background:${baseColor};`;

      const completedCount = stat.completedTasks || 0;
      const totalCount = stat.totalTasks || 0;
      const abandonedCount = stat.abandonedTasks || 0;
      const fractionStr = `${this.formatStatCount(completedCount)}/${this.formatStatCount(
        totalCount
      )}`;

      let paymentText = showPayment
        ? `¥${(stat.completedPayment || 0).toFixed(0)}/¥${(stat.totalPayment || 0).toFixed(0)}`
        : `${fractionStr}`;

      // compactCounts: cross-month mode - show check icon when fully completed, remove '单' suffix
      let subLeft = `完成 ${fractionStr} 单`;
      if (abandonedCount > 0 && !options.compactCounts) {
        subLeft += `<span class="platform-stat-abandoned">  已废弃${this.formatStatCount(abandonedCount)}单</span>`;
      }
      if (options.compactCounts) {
        const allCompleted = totalCount > 0 && Math.abs(completedCount - totalCount) < 1e-6;
        paymentText = allCompleted
          ? `<span class="material-icons-outlined text-base text-stone-700">check</span>`
          : fractionStr;
        subLeft = fractionStr;
        if (abandonedCount > 0) {
          subLeft += `<span class="platform-stat-abandoned"> +${this.formatStatCount(abandonedCount)}废</span>`;
        }
      }

      card.innerHTML = `
        <div class="platform-stat-row">
          <div class="platform-stat-name">
            <span class="platform-stat-dot" style="${dotStyle}"></span>
            <span>${stat.name}</span>
          </div>
          <div class="platform-stat-payment">${paymentText}</div>
        </div>
        <div class="platform-stat-sub">
          <span>${subLeft}</span>
          <span class="platform-stat-percent">${ratio}%</span>
        </div>
        <div class="platform-stat-progress">
          <span style="${progressStyle}"></span>
        </div>
      `;

      listEl.appendChild(card);
    });
  }

  //更新月度统计显示
  updateMonthlyStatsDisplay() {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const stats = this.calculateMonthlyStats(year, month);
    const platformStats = this.calculateMonthlyPlatformStats(year, month);
    const crossPlatformStats = this.calculateMonthlyCrossPlatformStats(
      year,
      month
    );
    this.renderMonthlyPlatformStats(platformStats);
    this.renderMonthlyPlatformStats(crossPlatformStats, {
      listId: "cross-month-platform-stats",
      emptyId: "cross-month-platform-empty",
      showPayment: false,
      useCounts: true,
      compactCounts: true,
    });
    const platformHeader = document.getElementById("platform-header");
    if (platformHeader) {
      platformHeader.style.display = (!platformStats || platformStats.length === 0) ? 'none' : '';
    }
    const crossWrapper = document.getElementById("cross-platform-wrapper");
    if (crossWrapper) {
      crossWrapper.style.display = (!crossPlatformStats || crossPlatformStats.length === 0) ? 'none' : '';
    }

    const formatCount = (value) => this.formatStatCount(value);
    const taskCountEl = document.getElementById("monthly-task-count");
    const paymentCountEl = document.getElementById("monthly-payment-count");
    const hourlyRateEl = document.getElementById("monthly-hourly-rate");
    if (taskCountEl) {
      taskCountEl.textContent = `${formatCount(stats.completedTasks)}/${formatCount(stats.totalTasks)}`;
      taskCountEl.title = "本月涉及的委托稿件数量（跨月按天数分摊，不含废弃任务）";
    }

    if (paymentCountEl) {
      const completedPaymentText = `¥${stats.completedPayment.toFixed(0)}`;
      const totalPaymentText = `¥${stats.totalPayment.toFixed(0)}`;
      const fullText = `${completedPaymentText}/${totalPaymentText}`;
      // 始终使用单行显示（移除超长换行逻辑）
      paymentCountEl.textContent = fullText;
      paymentCountEl.title = "本月截止/完成的任务的稿酬";
    }
    if (hourlyRateEl) {
      hourlyRateEl.textContent = `¥${stats.hourlyRate.toFixed(0)}/h`;
      hourlyRateEl.title = "本月涉及的委托的时薪（跨月分摊已完成任务）";
    }
  }
  renderCalendar() {
    const mode = this.calendarMode || "deadline";
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const monthNames = [
      "一月",
      "二月",
      "三月",
      "四月",
      "五月",
      "六月",
      "七月",
      "八月",
      "九月",
      "十月",
      "十一月",
      "十二月",
    ];
    document.getElementById(
      "calendar-title"
    ).textContent = `${year}年 ${monthNames[month]}`;
    this.updateMonthlyStatsDisplay();
    this.updateCalendarModeToggleUI();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const prevLastDay = new Date(year, month, 0);
    const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7; // 调整为周一开始
    const lastDayDate = lastDay.getDate();
    const prevLastDayDate = prevLastDay.getDate();
    const calendarGrid = document.getElementById("calendar-grid");
    let html = "";
    // 按周分组：每 7 个单元格一个周容器
    const cells = [];
    // 添加空白占位符（填充到第一天之前）
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const date = prevLastDayDate - i;
      cells.push(`<div class="calendar-placeholder">${date}</div>`);
    }
    const today = new Date();
    for (let date = 1; date <= lastDayDate; date++) {
      const currentDate = new Date(year, month, date);
      const dateStr = this.formatDate(currentDate);
      const tasks = this.getCalendarTasksForDate(dateStr);
      const isToday = currentDate.toDateString() === today.toDateString();
      const hasTask = tasks.length > 0;
      let classes = "calendar-cell ";
      if (isToday) {
        classes += "today ";
      } else if (hasTask) {
        classes += "has-task ";
      }
      let cellInner = `<div class="calendar-date-label">${date}</div>`;
      if (mode !== "timeline" && hasTask) {
        cellInner += `<div class="task-indicator"></div>`;
      }
      cells.push(`
                <div class="${classes}" data-date="${dateStr}" onclick="taskManager.showDateTasks('${dateStr}')">
                    ${cellInner}
                </div>
            `);
    }
    const remainingCells = 42 - (firstDayOfWeek + lastDayDate);
    for (let date = 1; date <= remainingCells; date++) {
      cells.push(`<div class="calendar-placeholder">${date}</div>`);
    }
    // 按周分组生成 HTML
    for (let week = 0; week < 6; week++) {
      const weekCells = cells.slice(week * 7, (week + 1) * 7);
      html += `
        <div class="calendar-week">
          <div class="week-dates">
            ${weekCells.join("")}
          </div>
          <div class="week-timeline" id="week-timeline-${week}"></div>
        </div>
      `;
    }
    calendarGrid.innerHTML = html;
    this.renderTimelineOverlay({
      year,
      month,
      firstDayOfWeek,
      lastDayDate,
    });
  }
  renderCalendarBarSegment({ task, startCol, endCol, row, ring, blendedBg }) {
    const name = task.name || "未命名任务";
    const isAbandoned = !!task.abandoned;
    const opacity = isAbandoned ? 0.45 : task.completed ? this.completedTaskOpacity ?? 0.8 : 1;
    const effectiveBarBg = isAbandoned ? "#e5e7eb" : blendedBg;
    const effectiveRing = isAbandoned ? "#94a3b8" : ring;
    const completedClass = task.completed ? " completed" : (isAbandoned ? " abandoned" : "");
    return `
      <div class="calendar-timeline-bar${completedClass}" data-task-id="${task.id}" style="grid-column:${startCol} / ${endCol}; background:${effectiveBarBg}; border-color:${effectiveRing}; opacity: ${opacity};">
        <span class="calendar-timeline-bar__dot" style="background:${effectiveRing};"></span>
        <span class="calendar-task-bar__name">${name}</span>
      </div>
    `;
  }
  changeMonth(direction) {
    this.currentDate.setMonth(this.currentDate.getMonth() + direction, 1);
    this.renderCalendar();
  }
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  // 格式化为更可读的中文日期：2026年1月17日
  formatDatePretty(date) {
    if (!date) return "";
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }
  getTaskStartDateString(task) {
    if (!task) return "";
    const start =
      (task.urgentA && task.actualStartTime)
        ? task.actualStartTime
        : (task.startTime || task.starttime || task.startDate || task.pausePreDeadline || task.deadline || task.createdAt);
    if (!start) return "";
    return this.formatDate(new Date(start));
  }
  getTasksByDate(dateStr) {
    return this.tasks.filter((task) => {
      if (!task.deadline) return false;
      const taskDate = new Date(task.deadline);
      const taskDateStr = this.formatDate(taskDate);
      return taskDateStr === dateStr;
    });
  }
  getTasksByDateRange(dateStr) {
    return this.tasks.filter((task) => {
      if (!task.deadline) return false;
      const end = this.formatDate(new Date(task.deadline));
      const start = this.getTaskStartDateString(task) || end;
      return start <= dateStr && dateStr <= end;
    });
  }
  getCalendarTasksForDate(dateStr) {
    return this.calendarMode === "timeline"
      ? this.getTasksByDateRange(dateStr)
      : this.getTasksByDate(dateStr);
  }
  renderTimelineOverlay({ year, month, firstDayOfWeek, lastDayDate }) {
    const layer = document.getElementById("calendar-timeline-layer");
    if (!layer) return;
    if (this.calendarMode !== "timeline") {
      layer.classList.add("hidden");
      layer.innerHTML = "";
      return;
    }
    layer.classList.remove("hidden");
    layer.innerHTML = "";

    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    const today = new Date();
    const todayDate = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const parseYMD = (val) => {
      if (!val) return null;
      if (val instanceof Date)
        return new Date(val.getFullYear(), val.getMonth(), val.getDate());
      if (typeof val === "string") {
        const m = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m)
          return new Date(
            parseInt(m[1], 10),
            parseInt(m[2], 10) - 1,
            parseInt(m[3], 10)
          );
        const n = Date.parse(val);
        return isNaN(n) ? null : new Date(n);
      }
      const n = Date.parse(val);
      return isNaN(n) ? null : new Date(n);
    };
    const tasks = this.tasks || [];
    const segMaxRowMap = new Map();

    // 找出与当月有交集的任务
    const overlaps = tasks.filter((task) => {
      const endRaw =
        task.abandoned && task.abandonedAt ? task.abandonedAt
        : task.completed && task.completedAt ? task.completedAt
        : task.deadline;
      const end = endRaw ? parseYMD(endRaw) : null;
      const startRaw =
        this.getTaskStartDateString(task) || (end ? this.formatDate(end) : "");
      if (!end && !startRaw) return false;
      const start = startRaw ? parseYMD(startRaw) : null;
      const startDate = start || end || todayDate;
      let realEnd = end || startDate;
      // 若未完成且非废弃且截止早于今天，则将可视结束延伸到今天用于判断重叠
      if (!task.completed && !task.abandoned && realEnd < todayDate) {
        realEnd = todayDate;
      }
      return startDate <= monthEnd && realEnd >= monthStart;
    });

    if (overlaps.length === 0) {
      layer.innerHTML = "";
      layer.classList.add("hidden");
      return;
    }

    const firstDayIndex = firstDayOfWeek; // 0-based offset for day 1 cell index
    const maxCells = 42; // 6 weeks
    const weekSegments = Array.from({ length: 6 }, () => []);

    const clampDate = (d) => {
      if (d < monthStart) return new Date(monthStart);
      if (d > monthEnd) return new Date(monthEnd);
      return d;
    };

    overlaps.forEach((task) => {
      const type = this.taskTypes.find((t) => t.id === task.type);
      const baseColor = type ? type.color : "#6B7280";
      const barBg = this.computeLightBgFromHex(baseColor);
      const blendedBg = this.blendWithWhite(barBg, 0.25);
      const ok = this.computeOklchAdjustedRing(baseColor);
      const ring = ok && ok.oklch ? ok.oklch : null;

      // 如果任务已废弃且有abandonedAt，则以abandonedAt为段结束；如果已完成且有完成时间，则以完成时间为结束；否则以 deadline 为结束
      const endDate =
        task.abandoned && task.abandonedAt
          ? parseYMD(task.abandonedAt)
          : task.completed && task.completedAt
          ? parseYMD(task.completedAt)
          : task.deadline
          ? parseYMD(task.deadline)
          : null;
      const startRaw =
        this.getTaskStartDateString(task) ||
        (endDate ? this.formatDate(endDate) : "");
      if (!startRaw && !endDate) return;
      const startDateParsed =
        parseYMD(startRaw) ||
        (endDate
          ? new Date(
              endDate.getFullYear(),
              endDate.getMonth(),
              endDate.getDate()
            )
          : null);
      if (!startDateParsed) return;
      const startDate = clampDate(startDateParsed);

      // 如果任务未完成、未废弃且截止日期早于今天，则在视图上将结束日期扩展到今天（不修改任务本身的 deadline）
      const today = new Date();
      const todayDate = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      );
      let visualEnd = endDate || startDate;
      if (!task.completed && !task.abandoned && endDate && endDate < todayDate) {
        visualEnd = todayDate;
      }
      const lastDate = clampDate(visualEnd);

      // 记录原始截止时间戳（排序用，不随分段变化）
      const originalEndTs = endDate
        ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime()
        : new Date(startDateParsed.getFullYear(), startDateParsed.getMonth(), startDateParsed.getDate()).getTime();

      // 计算暂停感知的日期区间（跨天暂停 > 1 天时拆分，中间间隔不渲染）
      const calPauseRanges = (() => {
        let crossDayPauses = (task.pauseHistory || []).filter(entry => {
          if (!entry.pausedAt || !entry.resumedAt) return false;
          const pD = new Date(entry.pausedAt); pD.setHours(0, 0, 0, 0);
          const rD = new Date(entry.resumedAt); rD.setHours(0, 0, 0, 0);
          return (rD - pD) / 86400000 > 1;
        });
        // 暂停实时预览：将当前活跃暂停加入虚拟已完成条目
        if (task.paused && task.pausedAt) {
          const today4 = new Date(); today4.setHours(0, 0, 0, 0);
          const pD4    = new Date(task.pausedAt); pD4.setHours(0, 0, 0, 0);
          if ((today4 - pD4) / 86400000 > 1) {
            crossDayPauses = [...crossDayPauses,
              { pausedAt: task.pausedAt, resumedAt: today4.toISOString() }];
          }
        }
        if (crossDayPauses.length === 0) return [{ start: startDateParsed, end: visualEnd }];
        const sorted = [...crossDayPauses].sort((a, b) => new Date(a.pausedAt) - new Date(b.pausedAt));
        const ranges = [];
        let cur = new Date(startDateParsed);
        for (const entry of sorted) {
          const pD = new Date(entry.pausedAt); pD.setHours(0, 0, 0, 0);
          const rD = new Date(entry.resumedAt); rD.setHours(0, 0, 0, 0);
          if (rD <= cur) continue;
          if (pD > cur) ranges.push({ start: new Date(cur), end: new Date(pD) });
          cur = new Date(rD);
        }
        if (cur <= visualEnd) ranges.push({ start: cur, end: new Date(visualEnd) });
        return ranges.length > 0 ? ranges : [{ start: startDateParsed, end: visualEnd }];
      })();

      // 对每个日期区间做周分割并推入 weekSegments
      calPauseRanges.forEach(range => {
        // 跳过完全在本月范围之外的区间
        if (range.end < monthStart || range.start > monthEnd) return;
        const rStartClamped = clampDate(range.start);
        const rEndClamped   = clampDate(range.end);
        const rStartDayIdx  = Math.max(0, rStartClamped.getDate() - 1);
        const rEndDayIdx    = Math.max(0, rEndClamped.getDate() - 1);

        let cursor = firstDayIndex + rStartDayIdx;
        const endIndex = Math.min(firstDayIndex + rEndDayIdx, maxCells - 1);

        while (cursor <= endIndex) {
          const week     = Math.floor(cursor / 7);
          const weekEnd  = week * 7 + 6;
          const segStart = cursor;
          const segEnd   = Math.min(endIndex, weekEnd);
          const startCol = (segStart % 7) + 1;
          const endCol   = (segEnd % 7) + 2;
          weekSegments[week].push({ task, startCol, endCol, ring, blendedBg, endDateValue: originalEndTs });
          cursor = segEnd + 1;
        }
      });
    });

    // 为每个周的 timeline 容器渲染任务条
    weekSegments.forEach((segments, week) => {
      if (!segments || segments.length === 0) return;
      const sorted = segments.sort((a, b) => {
        if (a.startCol !== b.startCol) return a.startCol - b.startCol;
        // 相同 startCol 时：先按较早的截止时间（endDateValue）排序
        return (a.endDateValue || 0) - (b.endDateValue || 0);
      });
      const lanes = []; // 每条 lane 保存最后的 endCol
      sorted.forEach((seg) => {
        let laneIndex = lanes.findIndex((endCol) => endCol <= seg.startCol);
        if (laneIndex === -1) {
          laneIndex = lanes.length;
          lanes.push(seg.endCol);
        } else {
          lanes[laneIndex] = seg.endCol;
        }
        const weekLayer = document.getElementById(`week-timeline-${week}`);
        if (weekLayer) {
          const type = this.taskTypes.find((t) => t.id === seg.task.type);
          const baseColor = type ? type.color : "#6B7280";
          const barBg = this.computeLightBgFromHex(baseColor);
          const blendedBg = this.blendWithWhite(barBg, 0.25);
          const okBar = this.computeOklchAdjustedRing(baseColor);
          const ring = okBar && okBar.oklch ? okBar.oklch : null;
          const html = this.renderCalendarBarSegment({
            task: seg.task,
            startCol: seg.startCol,
            endCol: seg.endCol,
            row: laneIndex + 1, // lane 从 1 开始
            ring,
            blendedBg,
          });
          weekLayer.insertAdjacentHTML("beforeend", html);
        }
      });
    });

    // 保持旧的 overlay 隐藏（我们现在在周容器内渲染）
    layer.classList.add("hidden");
    layer.innerHTML = "";
  }
  sortTasksByStart(a, b) {
    const aStart = this.getTaskStartDateString(a);
    const bStart = this.getTaskStartDateString(b);
    if (aStart && bStart && aStart !== bStart) {
      return aStart < bStart ? -1 : 1;
    }
    const aEnd = a.deadline ? this.formatDate(new Date(a.deadline)) : "";
    const bEnd = b.deadline ? this.formatDate(new Date(b.deadline)) : "";
    if (aEnd && bEnd && aEnd !== bEnd) {
      return aEnd < bEnd ? -1 : 1;
    }
    return (a.name || "").localeCompare(b.name || "");
  }
  showDateTasks(dateStr) {
    const tasks = this.getCalendarTasksForDate(dateStr);
    const sortedTasks =
      this.calendarMode === "timeline"
        ? [...tasks].sort((a, b) => this.sortTasksByStart(a, b))
        : tasks;
    const modal = document.getElementById("date-tasks-modal");
    const title = document.getElementById("date-tasks-title");
    const list = document.getElementById("date-tasks-list");
    const empty = document.getElementById("date-tasks-empty");
    const date = new Date(dateStr);
    title.textContent = `${date.getFullYear()}年 ${
      date.getMonth() + 1
    }月 ${date.getDate()}日 ${
      this.calendarMode === "timeline" ? "相关任务" : "截止的任务"
    }`;
    if (sortedTasks.length === 0) {
      list.innerHTML = "";
      empty.classList.remove("hidden");
    } else {
      empty.classList.add("hidden");
      list.innerHTML = sortedTasks
        .map((task) => {
          const type = this.taskTypes.find((t) => t.id === task.type);
          const typeColor = type ? type.color : "#95A5A6";
          const typeName = type ? type.name : "未知类型";
          const progressPercentage =
            task.estimatedHours > 0
              ? Math.min(
                  Math.round((task.actualHours / task.estimatedHours) * 100),
                  100
                )
              : 0;

          const hasImage = task.image && task.image.trim() !== "";
          const hasPayment = task.payment && task.payment > 0;
          const hourlyRate = hasPayment
            ? task.completed
              ? task.actualHours > 0
                ? (task.payment / task.actualHours).toFixed(2)
                : 0
              : task.estimatedHours > 0
              ? (task.payment / task.estimatedHours).toFixed(2)
              : 0
            : 0;
          return `
                    <div class="bg-stone-50 rounded-lg p-3 border border-stone-200">
                        <div class="flex items-start justify-between mb-2">
                            <div class="flex items-center flex-1">
                                <span class="type-badge mr-2" style="background-color: ${typeColor}; width: 8px; height: 8px; border-radius: 50%; display: inline-block;"></span>
                                <div class="flex-1">
                                    <h4 class="font-medium text-stone-800 text-sm ${
                                      task.completed ? "line-through" : ""
                                    }" style="overflow-wrap:anywhere;">${task.name.replace(/_/g, '_<wbr>')}</h4>
                                    <p class="text-xs text-stone-500">${typeName}</p>
                                </div>
                            </div>
                            <div class="text-xs text-stone-400">
                                ${
                                  task.completed
                                    ? "已完成"
                                    : `${progressPercentage}%`
                                }
                            </div>
                        </div>
                        
                        ${
                          hasImage
                            ? `<div class="mb-2"><img src="${task.image}"alt="${task.name}"class="max-w-full h-20 object-cover rounded cursor-pointer hover:opacity-90 transition-opacity"onclick="taskManager.showImageModal('${task.image}', '${task.name}')"style="max-width: 150px;"></div>`
                            : ""
                        }
                        
                        ${
                          task.deadline
                            ? `<div class="flex items-center text-xs text-stone-500 mb-2"><span class="material-icons text-xs mr-1">schedule</span>${new Date(
                                task.deadline
                              ).toLocaleString("zh-CN", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}</div>`
                            : ""
                        }
                        
                        <div class="mt-2">
                            <div class="flex justify-between items-center mb-1">
                                <span class="text-xs text-stone-600">进度</span>
                                <span class="text-xs font-medium text-stone-700">${
                                  task.actualHours || 0
                                }h / ${task.estimatedHours || 0}h</span>
                            </div>
                            <div class="w-full bg-stone-200 rounded-full h-1">
                                <div class="bg-blue-500 h-full rounded-full transition-all duration-300" style="width: ${progressPercentage}%"></div>
                            </div>
                        </div>
                        
                        ${
                          hasPayment
                            ? `<div class="mt-2 flex justify-between items-center"><span class="text-xs text-stone-600">稿酬</span><div class="text-right"><div class="text-xs font-medium text-green-600">¥${task.payment}</div><div class="text-xs text-stone-400">时薪:¥${hourlyRate}/h</div></div></div>`
                            : ""
                        }
                    </div>
                `;
        })
        .join("");
    }
    modal.classList.remove("hidden");
  }
  toggleCalendarMode() {
    this.calendarMode =
      this.calendarMode === "timeline" ? "deadline" : "timeline";
    try {
      localStorage.setItem("calendar-mode", this.calendarMode);
    } catch (e) {
      /* ignore */
    }
    this.updateCalendarModeToggleUI();
    this.renderCalendar();
  }
  updateCalendarModeToggleUI() {
    const btn = document.getElementById("calendar-mode-toggle");
    if (!btn) return;
    const isTimeline = this.calendarMode === "timeline";
    btn.textContent = isTimeline ? "日程条" : "截止日期";
    btn.setAttribute("data-mode", this.calendarMode);
    // 颜色样式由 CSS 的日历模块通过 data-mode 控制，避免在 JS 中注入实用类
    const gridWrapper = document.getElementById("calendar-grid-wrapper");
    if (gridWrapper) gridWrapper.classList.toggle("timeline-mode", isTimeline);
  }
  hideDateTasksModal() {
    document.getElementById("date-tasks-modal").classList.add("hidden");
  }

  // 全局 Esc 处理：按一次关闭最上层弹窗（在输入/编辑状态时不触发）
  handleGlobalEsc(e) {
    if (!e || e.key !== "Escape") return;
    try {
      // 直接关闭最上层弹窗（包括输入框中按 Esc）
      this.closeTopmostDialog();
    } catch (err) {
      console.warn("handleGlobalEsc error", err);
    }
  }

  // 公用：查找并关闭最上层可见弹窗（尽量通用，减少以后需要改动的地方）
  closeTopmostDialog() {
    try {
      const selector =
        '.modal-backdrop, [id$="-overlay"], [id$="-modal"], .task-preview-overlay';
      const candidates = Array.from(document.querySelectorAll(selector)).filter(
        (el) => {
          if (!el) return false;
          if (el.classList && el.classList.contains("hidden")) return false;
          const rects = el.getClientRects();
          if (!rects || rects.length === 0) return false;
          const cs = window.getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") return false;
          return true;
        }
      );
      if (!candidates.length) return false;
      // 按 z-index 排序，取最高的元素作为最上层
      candidates.sort(
        (a, b) =>
          (Number(window.getComputedStyle(a).zIndex) || 0) -
          (Number(window.getComputedStyle(b).zIndex) || 0)
      );
      const top = candidates[candidates.length - 1];

      // 尝试通过通用关闭按钮关闭（优先）
      const closeBtn = top.querySelector(
        '[data-variant="cancel"], button[id^="close-"], button.close, .close-icon-picker'
      );
      if (closeBtn) {
        closeBtn.click();
        return true;
      }

      // 如果是以 -modal 结尾的容器，优先隐藏而不是移除
      if (top.id && top.id.endsWith("-modal")) {
        top.classList.add("hidden");
        return true;
      }

      // 若是 overlay/overlay-like，直接移除
      top.remove();
      return true;
    } catch (err) {
      console.warn("closeTopmostDialog error", err);
      return false;
    }
  }
  bindImageModalEvents() {
    const closeBtn = document.getElementById("close-image-modal");
    const modal = document.getElementById("image-modal");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        this.hideImageModal();
      });
    }
    if (modal) {
      this.bindOverlayClose(modal, () => this.hideImageModal());
    }
  }
  showImageModal(imageSrc, taskName) {
    const modal = document.getElementById("image-modal");
    const title = document.getElementById("image-modal-title");
    const img = document.getElementById("modal-image");
    if (modal && title && img) {
      title.textContent = `${taskName} - 图片预览`;
      img.src = imageSrc;
      modal.classList.remove("hidden");
      document.body.classList.add("modal-open");
    }
  }
  hideImageModal() {
    const modal = document.getElementById("image-modal");
    const img = document.getElementById("modal-image");
    if (modal) {
      modal.classList.add("hidden");
      document.body.classList.remove("modal-open");
      if (img) img.src = "";
    }
  }
  bindCollapseEvents() {
    const calendarToggle = document.getElementById("calendar-toggle");
    if (calendarToggle) {
      calendarToggle.addEventListener("click", () => {
        this.toggleCollapse("calendar");
      });
    }
    const recommendationsToggle = document.getElementById(
      "recommendations-toggle"
    );
    if (recommendationsToggle) {
      recommendationsToggle.addEventListener("click", () => {
        this.toggleCollapse("recommendations");
      });
    }
    const monthlyStatsToggle = document.getElementById("monthly-stats-toggle");
    if (monthlyStatsToggle) {
      monthlyStatsToggle.addEventListener("click", () => {
        this.toggleCollapse("monthly-stats");
      });
    }
    this.initCollapseStates();
  }
  toggleCollapse(section) {
    const content = document.getElementById(`${section}-content`);
    const chevron = document.getElementById(`${section}-chevron`);
    if (!content || !chevron) return;
    const isCollapsed = content.classList.contains("collapsed");
    if (isCollapsed) {
      content.classList.remove("collapsed");
      content.style.maxHeight = content.scrollHeight + "px";
      chevron.textContent = "expand_less";
      chevron.classList.remove("rotated");
      localStorage.setItem(`${section}-collapsed`, "false");

      // 修复：确保 transitionend 后清除内联样式
      const onExpandEnd = (e) => {
        if (e.propertyName === "max-height") {
          content.style.maxHeight = ""; // 清除内联样式
          content.removeEventListener("transitionend", onExpandEnd);
        }
      };
      content.addEventListener("transitionend", onExpandEnd);
    } else {
      content.style.maxHeight = content.scrollHeight + "px"; // 修复：确保起始高度正确
      content.offsetHeight; // 强制回流
      requestAnimationFrame(() => {
        content.style.maxHeight = "0px";
      });
      chevron.textContent = "expand_more";
      chevron.classList.add("rotated");
      localStorage.setItem(`${section}-collapsed`, "true");
      const onCollapseEnd = (e) => {
        if (e.propertyName === "max-height") {
          content.classList.add("collapsed");
          content.removeEventListener("transitionend", onCollapseEnd);
        }
      };
      content.addEventListener("transitionend", onCollapseEnd);
    }
  }
  initCollapseStates() {
    const savedCalendar = localStorage.getItem("calendar-collapsed");
    // 横屏始终展开（覆盖 localStorage 视觉状态）；竖屏则以用户偏好为准，
    // 若无偏好则默认收起
    let calendarCollapsed;
    if (this.isLandscape) {
      calendarCollapsed = false; // 强制展开
    } else {
      calendarCollapsed =
        savedCalendar === null ? true : savedCalendar === "true";
    }
    const recommendationsCollapsed =
      localStorage.getItem("recommendations-collapsed") === "true";
    const monthlyStatsCollapsed =
      localStorage.getItem("monthly-stats-collapsed") === "true";
    const calendarContent = document.getElementById("calendar-content");
    const calendarChevron = document.getElementById("calendar-chevron");
    if (calendarContent && calendarChevron) {
      if (calendarCollapsed) {
        calendarContent.classList.add("collapsed");
        calendarContent.style.maxHeight = "0";
        calendarChevron.textContent = "expand_more";
        calendarChevron.classList.add("rotated");
      } else {
        // 如果不是折叠状态，确保视觉上展开并清理可能的内联样式
        calendarContent.classList.remove("collapsed");
        // 触发一次展开过渡（从 0 -> scrollHeight）以保持一致的动画体验
        calendarContent.style.maxHeight = "0px";
        // 强制回流
        // eslint-disable-next-line no-unused-expressions
        calendarContent.offsetHeight;
        requestAnimationFrame(() => {
          calendarContent.style.maxHeight = calendarContent.scrollHeight + "px";
        });
        calendarChevron.textContent = "expand_less";
        calendarChevron.classList.remove("rotated");
        // 清理内联样式在 transitionend
        const _onEndInit = (e) => {
          if (e.propertyName === "max-height") {
            calendarContent.style.maxHeight = "";
            calendarContent.removeEventListener("transitionend", _onEndInit);
          }
        };
        calendarContent.addEventListener("transitionend", _onEndInit);
      }
    }
    const recommendationsContent = document.getElementById(
      "recommendations-content"
    );
    const recommendationsChevron = document.getElementById(
      "recommendations-chevron"
    );
    if (recommendationsContent && recommendationsChevron) {
      if (recommendationsCollapsed) {
        recommendationsContent.classList.add("collapsed");
        recommendationsContent.style.maxHeight = "0";
        recommendationsChevron.textContent = "expand_more";
        recommendationsChevron.classList.add("rotated");
      } else {
        recommendationsContent.classList.remove("collapsed");
        recommendationsChevron.textContent = "expand_less";
        recommendationsChevron.classList.remove("rotated");
      }
    }
    const monthlyStatsContent = document.getElementById(
      "monthly-stats-content"
    );
    const monthlyStatsChevron = document.getElementById(
      "monthly-stats-chevron"
    );
    if (monthlyStatsContent && monthlyStatsChevron) {
      if (monthlyStatsCollapsed) {
        monthlyStatsContent.classList.add("collapsed");
        monthlyStatsContent.style.maxHeight = "0";
        monthlyStatsChevron.textContent = "expand_more";
        monthlyStatsChevron.classList.add("rotated");
      } else {
        monthlyStatsContent.classList.remove("collapsed");
        monthlyStatsChevron.textContent = "expand_less";
        monthlyStatsChevron.classList.remove("rotated");
      }
    }
  }
  isTimerRunning(taskId) {
    return this.timerTaskId === taskId && this.currentTimer !== null;
  }
  startTimer(taskId) {
    if (this.currentTimer) {
      this.showMessage("已有任务正在计时，请先结束当前任务计时");
      return;
    }
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return;
    // 记录实际开始时间（若尚未记录）
    if (!task.actualStartTime) {
      try {
        task.actualStartTime = new Date().toISOString();
      } catch (e) {
        task.actualStartTime = new Date(Date.now()).toISOString();
      }
      // 立即持久化并更新相关展示
      try {
        this.saveAllData();
      } catch (e) {
        console.warn("保存 actualStartTime 失败", e);
      }
      // 与预览/卡片同步
      this.refreshTaskPreviewIfOpen(taskId);
      // 检查是否触发加急冲突
      if (!task.urgentA && task.dependencyType === 'line' && task.startTime &&
          new Date(task.actualStartTime) < new Date(task.startTime)) {
        this.handleAccelerateConflict(task);
      }
    }

    this.timerTaskId = taskId;
    this.timerStartTime = Date.now();
    this.currentTimer = setInterval(() => {
      this.updateTimerDisplay();
    }, 1000);
    this.showMessage(`开始为任务"${task.name}"计时`);
    this.renderTasks(taskId);
  }
  stopTimer(taskId) {
    if (this.timerTaskId !== taskId || !this.currentTimer) {
      return;
    }
    const endTime = Date.now();
    const duration = Math.round((endTime - this.timerStartTime) / 1000);
    const durationInHours = duration / 3600;
    clearInterval(this.currentTimer);
    this.currentTimer = null;
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return;
    this.showTimerDurationDialog(task, durationInHours, () => {
      this.timerTaskId = null;
      this.timerStartTime = null;
      this.renderTasks(task.id);
    });
  }
  updateTimerDisplay() {
    if (!this.currentTimer || !this.timerTaskId) return;
    const elapsed = Math.round((Date.now() - this.timerStartTime) / 1000);
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = elapsed % 60;
  }
  // 显示计时结束对话框，允许用户调整时长并保存
  showTimerDurationDialog(task, durationInHours, onClose) {
    const dialogEl = document.createElement("div");
    dialogEl.className =
      "fixed inset-0 z-50 flex items-center justify-center p-4";
    dialogEl.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
    const hours = Math.floor(durationInHours);
    const minutes = Math.round((durationInHours - hours) * 60);
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
    document.body.appendChild(dialogEl);
    dialogEl.querySelector(".timer-cancel").addEventListener("click", () => {
      document.body.removeChild(dialogEl);
      onClose();
    });
    dialogEl
      .querySelector(".timer-save")
      .addEventListener("click", async () => {
        try {
          const hoursInput = dialogEl.querySelector("#timer-hours");
          const minutesInput = dialogEl.querySelector("#timer-minutes");
          const totalHours =
            parseFloat(hoursInput.value) + parseFloat(minutesInput.value) / 60;
          if (totalHours > 0) {
            // 若尚未记录 actualStartTime，则在计时保存时记一次（防止用户忘记手动填写）
            if (!task.actualStartTime) {
              try {
                task.actualStartTime = new Date().toISOString();
              } catch (e) {
                task.actualStartTime = new Date(Date.now()).toISOString();
              }
            }
            task.actualHours = (task.actualHours || 0) + totalHours;
            if (task.completed) {
              task.completedHours = task.actualHours;
              this.recordCompletionStatistics(task);
            }
            // 如果 saveAllData 返回 Promise，等待其完成；否则也不会有问题
            try {
              await this.saveAllData();
            } catch (err) {
              console.error("saveAllData error:", err);
            }
            this.updateStats();
            this.updateSmartRecommendations();
            this.renderTasks(task.id);
            this.updateMonthlyStatsDisplay();
            this.refreshTaskPreviewIfOpen(task.id);
            this.showMessage(
              `已为任务"${task.name}"添加 ${totalHours.toFixed(2)} 小时工时`
            );
          }
        } catch (err) {
          console.error("timer-save handler error:", err);
          this.showMessage("保存计时信息时发生错误");
        } finally {
          if (document.body.contains(dialogEl)) {
            document.body.removeChild(dialogEl);
          }
          try {
            onClose();
          } catch (err) {
            console.error("onClose callback error:", err);
          }
        }
      });
    dialogEl.addEventListener("click", (e) => {
      if (e.target === dialogEl) {
        document.body.removeChild(dialogEl);
        onClose();
      }
    });
  }
  toggleTimer(taskId) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (this.isTimerRunning(taskId)) {
      this.stopTimer(taskId);
    } else {
      // 如果任务处于暂停状态，点击计时按钮时同时恢复委托
      if (task && task.paused) {
        this.resumeTask(taskId);
      }
      this.startTimer(taskId);
    }
  }

  // ─── 暂停/恢复委托 ─────────────────────────────────────────
  pauseTask(taskId) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task || task.completed || task.abandoned || task.paused) return;
    // 如果正在计时，先自动停止并保存工时
    if (this.isTimerRunning(taskId)) {
      this.stopTimer(taskId);
    }
    // 暂停实时预览：首次暂停时保存原始 deadline
    if (task.deadline && !task.pausePreDeadline) {
      task.pausePreDeadline = task.deadline;
    }
    task.paused = true;
    task.pausedAt = new Date().toISOString();
    if (!Array.isArray(task.pauseHistory)) task.pauseHistory = [];
    task.pauseHistory.push({ pausedAt: task.pausedAt });
    this.saveAllData();
    this.renderTasks(taskId);
    this.refreshTaskPreviewIfOpen(taskId);
    this.showMessage(`委托"${task.name}"已暂停`);
  }

  resumeTask(taskId) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task || !task.paused) return;
    const now = new Date();
    const pausedAt = new Date(task.pausedAt);
    const pausedMs = now.getTime() - pausedAt.getTime();
    const pausedDays = pausedMs / (24 * 60 * 60 * 1000);
    task.totalPausedDays = (task.totalPausedDays || 0) + pausedDays;
    // 自动顺延 deadline（使用 pausePreDeadline 作为基准，避免与 livePreviewCurrentPause 双计）
    const baseDeadline4Resume = task.pausePreDeadline
      ? new Date(task.pausePreDeadline)
      : (task.deadline ? new Date(task.deadline) : null);
    if (baseDeadline4Resume && !isNaN(baseDeadline4Resume.getTime())) {
      baseDeadline4Resume.setTime(baseDeadline4Resume.getTime() + pausedMs);
      task.deadline = this.formatDateTimeLocal(baseDeadline4Resume);
    }
    task.pausePreDeadline = undefined;
    // 填充 pauseHistory 的 resumedAt
    if (Array.isArray(task.pauseHistory) && task.pauseHistory.length > 0) {
      const last = task.pauseHistory[task.pauseHistory.length - 1];
      if (!last.resumedAt) last.resumedAt = now.toISOString();
    }
    task.paused = false;
    task.pausedAt = null;
    // 递归顺延后续链式任务
    this.adjustChainFrom(task);
    this.saveAllData();
    this.renderTasks(taskId);
    this.refreshTaskPreviewIfOpen(taskId);
    this.showMessage(`委托"${task.name}"已恢复`);
  }

  togglePause(taskId) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (task.paused) {
      this.resumeTask(taskId);
    } else {
      this.pauseTask(taskId);
    }
  }

  initOrientationDetection() {
    this.checkOrientation();
    window.addEventListener("resize", () => {
      this.checkOrientation();
    });
    if (window.screen && window.screen.orientation) {
      window.screen.orientation.addEventListener("change", () => {
        this.checkOrientation();
      });
    }
  }
  checkOrientation() {
    const wasLandscape = this.isLandscape;
    this.isLandscape = window.innerWidth > window.innerHeight;
    if (wasLandscape !== this.isLandscape) {
      this.updateLayoutForOrientation();
    }
  }
  updateLayoutForOrientation() {
    const container = document.getElementById("container");
    if (this.isLandscape) {
      container.classList.add("landscape-layout");
      container.classList.remove("portrait-layout");
    } else {
      container.classList.add("portrait-layout");
      container.classList.remove("landscape-layout");
    }
    this.renderTasks();
    // 横屏强制视觉展开（不修改 localStorage），竖屏遵循用户偏好（无偏好时收起）
    try {
      const savedCalendar = localStorage.getItem("calendar-collapsed");
      const calendarContent = document.getElementById("calendar-content");
      const calendarChevron = document.getElementById("calendar-chevron");
      if (calendarContent && calendarChevron) {
        if (this.isLandscape) {
          // 强制展开（不修改 localStorage）
          // 若当前为折叠状态，确保从 0px -> scrollHeight 触发过渡
          if (calendarContent.classList.contains("collapsed")) {
            // 保证起始 inline maxHeight 为 0
            calendarContent.style.maxHeight = "0px";
            // 先移除 collapsed 以允许 opacity 过渡
            calendarContent.classList.remove("collapsed");
            calendarChevron.textContent = "expand_less";
            calendarChevron.classList.remove("rotated");
            // 强制回流然后在下一帧设置目标高度以触发过渡
            // eslint-disable-next-line no-unused-expressions
            calendarContent.offsetHeight;
            requestAnimationFrame(() => {
              calendarContent.style.maxHeight =
                calendarContent.scrollHeight + "px";
            });
          } else {
            // 非折叠状态直接设置并清理
            calendarContent.style.maxHeight =
              calendarContent.scrollHeight + "px";
            calendarChevron.textContent = "expand_less";
            calendarChevron.classList.remove("rotated");
          }
          const onEnd = (e) => {
            if (e.propertyName === "max-height") {
              calendarContent.style.maxHeight = "";
              calendarContent.removeEventListener("transitionend", onEnd);
            }
          };
          calendarContent.addEventListener("transitionend", onEnd);
        } else {
          // 竖屏：如果用户有保存偏好则以偏好为准，否则默认收起
          if (savedCalendar === null || savedCalendar === "true") {
            calendarContent.classList.add("collapsed");
            calendarContent.style.maxHeight = "0";
            calendarChevron.textContent = "expand_more";
            calendarChevron.classList.add("rotated");
          } else {
            calendarContent.classList.remove("collapsed");
            calendarContent.style.maxHeight = "";
            calendarChevron.textContent = "expand_less";
            calendarChevron.classList.remove("rotated");
          }
        }
      }
    } catch (e) {
      console.warn("orientation collapse default handling error:", e);
    }
  }
  // 动态生成日历
  generateCalendar(month, year) {
    this.currentDate = new Date(year, month, 1);
    this.renderCalendar();
  }

  // 初始化当前月份的日历
  initCalendar() {
    const today = new Date();
    this.generateCalendar(today.getMonth(), today.getFullYear());
  }

  waitForImagesAndLayout() {
    const container = document.getElementById("task-list");
    if (!container) return;
    const imgs = Array.from(container.querySelectorAll("img"));
    if (imgs.length === 0) {
      requestAnimationFrame(() => this.applyMasonryLayout(false));
      return;
    }
    let remaining = imgs.length;
    const done = () => {
      remaining -= 1;
      if (remaining <= 0) {
        // 短暂延迟以等待浏览器稳定
        setTimeout(() => this.applyMasonryLayout(false), 60);
      }
    };
    imgs.forEach((img) => {
      if (img.complete) done();
      else {
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      }
    });
    // 回退：10 秒后强制触发布局（防止图片长时间未触发 load 导致的布局卡死）
    setTimeout(() => {
      if (remaining > 0) this.applyMasonryLayout(false);
    }, 10000);
  }
}
// -----------------------------
// TaskManager 的最小稳健启动代码
// 将此段粘贴到 app.js 末尾（替换任何已存在的 DOMContentLoaded 初始化）
// -----------------------------
// 单一、稳健的 DOMContentLoaded 初始化器
document.addEventListener("DOMContentLoaded", () => {
  // 切换主题样式表并持久化选择的辅助函数
  window.applyTheme = function (theme) {
    try {
      const link = document.getElementById("theme-stylesheet");
      if (!link) return;
      if (theme === "warm") link.setAttribute("href", "暖色.css");
      else link.setAttribute("href", "标准.css");
      try {
        localStorage.setItem("siteTheme", theme);
      } catch (e) {}
    } catch (e) {
      console.warn("applyTheme error", e);
    }
  };

  // 尽早应用先前保存的主题设置
  try {
    const saved = localStorage.getItem("siteTheme");
    if (saved && typeof window.applyTheme === "function")
      window.applyTheme(saved);
  } catch (e) {}
  // 创建全局实例以便顶层辅助函数可以调用
  if (!window.taskManager) {
    window.taskManager = new TaskManager();
  }

  // 如果 TaskManager 提供 init/initCalendar，则尝试调用（含安全保护）
  if (typeof window.taskManager.init === "function") {
    try {
      window.taskManager.init();
    } catch (e) {
      console.warn("taskManager.init error:", e);
    }
  } else if (typeof window.taskManager.initCalendar === "function") {
    try {
      window.taskManager.initCalendar();
    } catch (e) {
      console.warn("taskManager.initCalendar error:", e);
    }
  }

  // 确保在实例存在后再运行图片等待与观察逻辑
  try {
    window.taskManager.waitForImagesAndLayout();
  } catch (e) {
    console.warn("waitForImagesAndLayout error:", e);
  }
  //不知道有什么用而且会报错，删了可能会有bug
  //try { enableResizeDrivenLayout(); } catch (e) { console.warn("enableResizeDrivenLayout error:", e); }
});
