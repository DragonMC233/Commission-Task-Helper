// 任务编辑模态框逻辑模块 (Shared between main app and BarView)
// 负责处理新增/编辑任务的弹窗交互、数据收集与验证
// 1:1 对标 app.js TaskManager 中的模态框逻辑

class TaskModalController {
    constructor(options) {
        // options: {
        //   dataSource: {
        //      getTask(id), getTasks(),
        //      taskTypes (getter), sourcePlatforms (getter), presetNodes (getter),
        //      statistics (getter, optional — 若无则从 tasks 动态计算),
        //      allowDuplicateNodes (optional, default false),
        //      showMessage (optional fn),
        //   },
        //   onSave: async (taskData, editingId) => {},
        //   onCancel: () => {},
        //   helpers: { formatDate, ... }
        // }
        this.dataSource = options.dataSource;
        this.onSave = options.onSave;
        this.onCancel = options.onCancel;
        this.helpers = options.helpers || {};

        // 绑定上下文
        this.save = this.save.bind(this);
        this.addNode = this.addNode.bind(this);
        this.addPresetNode = this.addPresetNode.bind(this);
        this.removeNode = this.removeNode.bind(this);

        // 临时状态
        this.editingTaskId = null;
        this.tempNodes = [];
        this.tempPaymentRecords = [];
        this.currentImageData = null;
        this.imageChanged = false;

        // 图标资源调色板
        this.fontIconsPalette = ["outlined", "regular", "round", "sharp", "twotone"];
        this.fontSymbolsPalette = ["outlined", "rounded", "sharp"];
    }

    // ═══════════════════════════════════════
    // initEvents — 初始化 DOM 事件绑定 (只执行一次)
    // 对标 app.js bindEvents() 中与模态框相关的全部事件
    // ═══════════════════════════════════════
    initEvents() {
        // 确保 color-picker-sm 样式已注入（BarView 等没有 app.js 的环境也能生效）
        if (typeof document !== 'undefined' && !document.getElementById('color-picker-sm-style')) {
            const style = document.createElement('style');
            style.id = 'color-picker-sm-style';
            style.textContent = `
      input[type="color"].color-picker-sm {
        width: 30px !important; height: 30px !important;
        border-radius: 0.5rem !important; padding: 0 !important;
        border: 0 !important; appearance: none !important;
        -webkit-appearance: none !important; overflow: hidden !important;
      }
      input[type="color"].color-picker-sm::-webkit-color-swatch-wrapper { padding: 0 !important; }
      input[type="color"].color-picker-sm::-webkit-color-swatch { border: none !important; border-radius: 0.5rem !important; }
            `;
            document.head.appendChild(style);
        }

        const modal = document.getElementById("task-modal");
        if (!modal) return;

        // --- 保存/取消 ---
        const saveBtn = document.getElementById("save-task-btn");
        if (saveBtn) saveBtn.addEventListener("click", () => this.save());

        const cancelBtn = document.getElementById("cancel-btn");
        if (cancelBtn) cancelBtn.addEventListener("click", async () => {
            this.resetImageUpload();
            if (this.onCancel) {
                try { await this.onCancel(); } catch (e) {}
            }
            this.hideModal();
        });


        // 遮罩点击关闭 (编辑态自动保存，新增态直接关闭) -- 使用 bindOverlayClose 防止误触
        this.bindOverlayClose(modal, () => {
            if (this.editingTaskId) {
                this.save();
            } else {
                this.hideModal();
            }
        });

        // --- 链式/独立任务相关事件 ---
        const depRadios = document.querySelectorAll('input[name="task-dependency"]');
        const lineSelect = document.getElementById("task-line-task");
        const autoScheduleEl = document.getElementById("task-auto-schedule");
        const bufferEl = document.getElementById("task-buffer-days");
        const autoCalcEndEl = document.getElementById("task-auto-calc-end");
        const actualStartEl = document.getElementById("task-actual-starttime");

        const handleDepChange = () => {
            const checked = document.querySelector('input[name="task-dependency"]:checked');
            const type = checked ? checked.value : "none";
            this.updateDependencyUI(type);
        };

        depRadios.forEach((r) => r.addEventListener("change", handleDepChange));

        // 允许点击左右按钮时切换 (按钮内部隐藏了 radio)
        const depButtons = document.querySelectorAll('[data-testid="dep-none"], [data-testid="dep-line"]');
        depButtons.forEach((btn) => {
            btn.addEventListener("click", () => {
                const input = btn.querySelector('input[name="task-dependency"]');
                if (input) {
                    input.checked = true;
                    input.dispatchEvent(new Event("change", { bubbles: true }));
                }
            });
        });

        if (lineSelect) {
            lineSelect.addEventListener("change", handleDepChange);
        }
        if (autoScheduleEl) {
            autoScheduleEl.addEventListener("change", handleDepChange);
            // 点击左侧标题也能切换勾选
            const scheduleLabel = document.getElementById("task-auto-schedule-label");
            if (scheduleLabel) {
                scheduleLabel.addEventListener("click", () => {
                    autoScheduleEl.checked = !autoScheduleEl.checked;
                    autoScheduleEl.dispatchEvent(new Event("change", { bubbles: true }));
                });
            }
        }
        if (bufferEl) {
            bufferEl.addEventListener("input", handleDepChange);
        }
        if (autoCalcEndEl) {
            autoCalcEndEl.addEventListener("change", () => {
                this.updateDeadlineSuggestion();
            });
            const calcLabel = document.getElementById("task-auto-calc-end-label");
            if (calcLabel) {
                calcLabel.addEventListener("click", () => {
                    autoCalcEndEl.checked = !autoCalcEndEl.checked;
                    autoCalcEndEl.dispatchEvent(new Event("change", { bubbles: true }));
                });
            }
        }
        if (actualStartEl) {
            actualStartEl.addEventListener("change", () => {
                // 值会在保存时写入，无需额外处理
            });
        }

        // --- 实时刷新建议：开始时间、预计工时、工期、截止日期或任务类型变化时 ---
        const startInput = document.getElementById("task-starttime");
        const hoursInput = document.getElementById("task-hours");
        const deadlineInput = document.getElementById("task-deadline");
        const typeOptions = document.getElementById("task-type-options");
        const estimatedDaysInput = document.getElementById("task-estimated-days");

        if (startInput) startInput.addEventListener("change", () => {
            this.syncEstimatedDaysToDeadline();
            this.updateDeadlineSuggestion();
        });
        if (hoursInput) hoursInput.addEventListener("input", () => this.updateDeadlineSuggestion());
        if (deadlineInput) deadlineInput.addEventListener("change", () => {
            this.syncDeadlineToEstimatedDays();
            this.syncDeadlineGuards();
        });
        if (estimatedDaysInput) estimatedDaysInput.addEventListener("input", () => this.syncEstimatedDaysToDeadline());
        if (typeOptions) typeOptions.addEventListener("change", () => this.updateDeadlineSuggestion());

        // 类型 radios 单独监听 (某些浏览器 change 不冒泡)
        const typeRadios = document.querySelectorAll('input[name="task-type"]');
        if (typeRadios && typeRadios.length) {
            typeRadios.forEach((r) => r.addEventListener("change", () => this.updateDeadlineSuggestion()));
        }

        // --- 进度滑块 ---
        const progressSlider = document.getElementById("task-progress");
        const progressValue = document.getElementById("progress-value");
        if (progressSlider && progressValue) {
            progressSlider.addEventListener("input", (e) => {
                progressValue.textContent = e.target.value + "%";
            });
        }

        // --- 节点操作 ---
        const addNodeBtn = document.getElementById("add-node-btn");
        if (addNodeBtn) addNodeBtn.addEventListener("click", () => this.addNode());
        // 收款/退款记录按钮
        const addPaymentBtn = document.getElementById("add-payment-btn");
        if (addPaymentBtn) addPaymentBtn.addEventListener("click", () => this.addPaymentRecord("payment"));
        const addRefundBtn = document.getElementById("add-refund-btn");
        if (addRefundBtn) addRefundBtn.addEventListener("click", () => this.addPaymentRecord("refund"));
        // 废弃复选框 → 显示/隐藏废弃时间输入
        const abandonedCheckbox = document.getElementById("task-abandoned");
        const abandonedAtRow = document.getElementById("abandoned-at-row");
        if (abandonedCheckbox && abandonedAtRow) {
            abandonedCheckbox.addEventListener("change", () => {
                abandonedAtRow.classList.toggle("hidden", !abandonedCheckbox.checked);
            });
        }

        document.querySelector(".node-input")?.addEventListener("keypress", (e) => {
            if (e.key === "Enter") this.addNode();
        });

        // --- 图片上传 ---
        this.bindImageUploadEvents();
    }

    // ═══════════════════════════════════════
    // showModal — 打开模态框
    // 对标 app.js showModal()
    // ═══════════════════════════════════════
    showModal(taskId = null) {
        const modal = document.getElementById("task-modal");
        const modalTitle = document.getElementById("modal-title");
        const saveBtn = document.getElementById("save-task-btn");
        if (!modal) return;

        this.editingTaskId = taskId;

        // 渲染动态内容
        this.renderPresetNodeButtons();
        this.renderTaskTypeOptions();
        this.renderSourceOptions();

        const depRadios = document.querySelectorAll('input[name="task-dependency"]');
        const selectLine = document.getElementById("task-line-task");
        const autoScheduleEl = document.getElementById("task-auto-schedule");
        const autoCalcEndEl = document.getElementById("task-auto-calc-end");
        const bufferEl = document.getElementById("task-buffer-days");
        const actualStartEl = document.getElementById("task-actual-starttime");

        const setDepRadio = (val) => {
            depRadios.forEach((r) => { r.checked = r.value === val; });
        };
        const toLocal = (v) => {
            if (!v) return "";
            const dt = new Date(v);
            return Number.isNaN(dt.getTime()) ? "" : this.formatDateTimeLocal(dt);
        };

        if (taskId) {
            // ═══ 编辑任务 ═══
            const task = this.dataSource.getTask(taskId);
            if (!task) return;

            modalTitle.textContent = "编辑任务";
            saveBtn.textContent = "更新";

            document.getElementById("task-name").value = task.name;
            document.getElementById("task-starttime").value = toLocal(
                task.startTime || task.starttime || task.startDate || task.deadline || ""
            );
            document.getElementById("task-deadline").value = toLocal(task.deadline || "");
            document.getElementById("task-completed-at").value = task.completedAt
                ? this.formatDateTimeLocal(task.completedAt)
                : "";
            document.getElementById("task-hours").value = task.estimatedHours || 8;
            const estDaysEl = document.getElementById("task-estimated-days");
            if (estDaysEl) {
                if (Number.isFinite(task.estimatedDay) && task.estimatedDay >= 0) {
                    estDaysEl.value = task.estimatedDay;
                } else {
                    // 从 startTime 和 deadline 推算（使用按日期差口径，允许 0）
                    const s = new Date(task.startTime || task.starttime || task.startDate);
                    const e = new Date(task.deadline);
                    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
                        const sUtc = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
                        const eUtc = Date.UTC(e.getFullYear(), e.getMonth(), e.getDate());
                        estDaysEl.value = Math.max(0, Math.round((eUtc - sUtc) / 86400000));
                    } else {
                        estDaysEl.value = "";
                    }
                }
            }
            document.getElementById("task-actual-hours").value = task.actualHours || 0;
            document.getElementById("task-payment").value = task.payment || "";
            // 收款方式
            const paymentModeEl = document.getElementById("task-payment-mode");
            if (paymentModeEl) paymentModeEl.value = task.paymentMode || "";
            // 收款记录
            this.tempPaymentRecords = Array.isArray(task.paymentRecords)
              ? JSON.parse(JSON.stringify(task.paymentRecords)) : [];
            this.renderPaymentRecords();
            // 废弃状态
            const abandonedEl = document.getElementById("task-abandoned");
            if (abandonedEl) abandonedEl.checked = !!task.abandoned;
            const abandonedAtRowEl = document.getElementById("abandoned-at-row");
            const abandonedAtInput = document.getElementById("task-abandoned-at");
            if (abandonedAtRowEl) abandonedAtRowEl.classList.toggle("hidden", !task.abandoned);
            if (abandonedAtInput) abandonedAtInput.value = task.abandonedAt ? this.formatDateTimeLocal(task.abandonedAt) : "";
            document.getElementById("task-progress").value = task.progress || 0;
            document.getElementById("progress-value").textContent = (task.progress || 0) + "%";

            const typeRadio = document.querySelector(
                `input[name="task-type"][value="${task.type}"]`
            );
            if (typeRadio) typeRadio.checked = true;

            const sourceRadio = document.querySelector(
                `input[name="task-source"][value="${task.source || "weibo"}"]`
            );
            if (sourceRadio) sourceRadio.checked = true;

            const depType = task.dependencyType || "none";
            setDepRadio(depType);
            this.renderLineTaskOptions(task.lineTaskId, task.id);
            if (selectLine) selectLine.value = task.lineTaskId ?? "";
            if (autoScheduleEl)
                autoScheduleEl.checked =
                    typeof task.autoSchedule === "boolean" ? task.autoSchedule : false;
            if (autoCalcEndEl)
                autoCalcEndEl.checked =
                    typeof task.autoCalcEnd === "boolean" ? task.autoCalcEnd : false;
            if (bufferEl) bufferEl.value = task.bufferDays ?? 1;
            if (actualStartEl) actualStartEl.value = toLocal(task.actualStartTime);
            this.updateDependencyUI(depType);

            // 更新建议 (包含建议工期和可能的自动截止填充)
            try { this.updateDeadlineSuggestion(); } catch (e) { /* ignore */ }
            this.syncDeadlineGuards();

            // 节点
            this.tempNodes = task.nodes ? [...task.nodes] : [];
            this.renderNodes();

            // 图片 — 不把旧路径写入 currentImageData
            this.currentImageData = null;
            this.imageChanged = false;
            if (task.image) {
                this.showImagePreview(task.image);
            } else {
                this.resetImageUpload();
            }
        } else {
            // ═══ 添加新任务 ═══
            modalTitle.textContent = "添加新任务";
            saveBtn.textContent = "保存";

            document.getElementById("task-name").value = "";
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, "0");
            const day = String(now.getDate()).padStart(2, "0");
            const defaultStartTime = `${year}-${month}-${day}T09:00`;
            const defaultDateTime = `${year}-${month}-${day}T23:59`;

            document.getElementById("task-starttime").value = defaultStartTime;
            document.getElementById("task-deadline").value = defaultDateTime;
            document.getElementById("task-completed-at").value = "";
            document.getElementById("task-hours").value = "8";
            const estDaysElNew = document.getElementById("task-estimated-days");
            if (estDaysElNew) estDaysElNew.value = "";
            document.getElementById("task-actual-hours").value = "0";
            document.getElementById("task-payment").value = "";
            // 收款方式、收款记录、废弃状态重置
            const paymentModeElNew = document.getElementById("task-payment-mode");
            if (paymentModeElNew) paymentModeElNew.value = "";
            this.tempPaymentRecords = [];
            this.renderPaymentRecords();
            const abandonedElNew = document.getElementById("task-abandoned");
            if (abandonedElNew) abandonedElNew.checked = false;
            const abandonedAtRowNew = document.getElementById("abandoned-at-row");
            const abandonedAtInputNew = document.getElementById("task-abandoned-at");
            if (abandonedAtRowNew) abandonedAtRowNew.classList.add("hidden");
            if (abandonedAtInputNew) abandonedAtInputNew.value = "";
            document.getElementById("task-progress").value = 0;
            document.getElementById("progress-value").textContent = "0%";

            // 初始化时计算并显示建议
            try { this.updateDeadlineSuggestion(); } catch (e) { /* ignore */ }
            this.syncDeadlineGuards();

            const typeRadio = document.querySelector(
                'input[name="task-type"][value="illustration"]'
            );
            if (typeRadio) typeRadio.checked = true;

            const sourceRadio = document.querySelector(
                'input[name="task-source"][value="weibo"]'
            );
            if (sourceRadio) sourceRadio.checked = true;

            setDepRadio("none");
            this.renderLineTaskOptions(null, null);
            if (selectLine) selectLine.value = "";
            if (autoScheduleEl) autoScheduleEl.checked = false;
            if (autoCalcEndEl) autoCalcEndEl.checked = false;
            if (bufferEl) bufferEl.value = 1;
            if (actualStartEl) actualStartEl.value = "";
            this.updateDependencyUI("none");

            this.tempNodes = [];
            this.renderNodes();
            this.resetImageUpload();
        }

        // 预设节点按钮通过 clone 清除旧 inline 状态，再绑定事件
        document.querySelectorAll(".preset-node-btn").forEach((btn) => {
            btn.replaceWith(btn.cloneNode(true));
        });
        this.bindPresetNodeEvents();

        modal.classList.remove("hidden");
    }

    // ═══════════════════════════════════════
    // hideModal
    // ═══════════════════════════════════════
    hideModal() {
        const modal = document.getElementById("task-modal");
        if (modal) modal.classList.add("hidden");
        this.editingTaskId = null;
        this.currentImageData = null;
    }

    // ═══════════════════════════════════════
    // save — 收集表单数据并调用 onSave 回调
    // 对标 app.js addTask() 中的表单采集部分
    // 注: 链式调整/统计记录/quick-add 等由 onSave 回调负责
    // ═══════════════════════════════════════
    async save() {
        try {
            const formData = this.collectFormData();
            if (!formData) return; // 校验失败

            let shouldClose = true;
            if (this.onSave) {
                const result = await this.onSave(formData, this.editingTaskId);
                if (result === false) shouldClose = false;
            }
            if (shouldClose) {
                this.hideModal();
                this.imageChanged = false;
            }
        } catch (e) {
            console.error("保存失败", e);
            this.showMessage("保存失败: " + e.message);
        }
    }

    // ═══════════════════════════════════════
    // collectFormData — 从表单收集任务数据
    // 对标 app.js addTask() 中的字段读取逻辑
    // ═══════════════════════════════════════
    collectFormData() {
        const getVal = (id) => (document.getElementById(id)?.value ?? "").trim();
        const getNumVal = (id) => Number(document.getElementById(id)?.value) || 0;
        const getChecked = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
        const getBool = (id) => !!document.getElementById(id)?.checked;

        const name = getVal("task-name");
        if (!name) {
            this.showMessage("请输入任务名称");
            return null;
        }

        // 读取类型/来源 (优先使用 radio 选中值)
        let type = getChecked("task-type");
        if (!type) {
            const types = this.dataSource.taskTypes || [];
            type = types.length > 0 ? types[0].id : null;
        }
        let source = getChecked("task-source");
        if (!source) {
            const sources = this.dataSource.sourcePlatforms || [];
            source = sources.length > 0 ? sources[0].id : null;
        }

        const progress = parseInt(document.getElementById("task-progress")?.value) || 0;
        let starttime = getVal("task-starttime");
        const dependencyType = getChecked("task-dependency") || "none";
        const lineTaskIdRaw = document.getElementById("task-line-task")?.value;
        let lineTaskId = lineTaskIdRaw ? Number(lineTaskIdRaw) : null;
        if (dependencyType !== "line") lineTaskId = null;

        const autoSchedule = getBool("task-auto-schedule");
        const autoCalcEnd = getBool("task-auto-calc-end");
        const bufferDaysInput = document.getElementById("task-buffer-days")?.value;
        const bufferDays = Number.isFinite(Number(bufferDaysInput))
            ? Math.max(-1, Math.round(Number(bufferDaysInput)))
            : 1;
        const actualStartTime = getVal("task-actual-starttime") || null;
        const estimatedHours = parseInt(document.getElementById("task-hours")?.value) || 8;
        const estimatedDayRaw = parseInt(document.getElementById("task-estimated-days")?.value, 10);
        const estimatedDay = Number.isFinite(estimatedDayRaw) && estimatedDayRaw >= 0 ? estimatedDayRaw : 0;

        // 自动计算开始时间 (链式 + 自动调度)
        if (dependencyType === "line" && autoSchedule && lineTaskId) {
            const prev = (this.dataSource.getTasks ? this.dataSource.getTasks() : []).find(t => t.id === lineTaskId);
            let bufferToUse = 1;
            if (prev) {
                if (Number.isFinite(Number(prev.bufferDays))) {
                    bufferToUse = Math.max(-1, Math.round(Number(prev.bufferDays)));
                } else {
                    const stats = this.getTypeWeightedStats(prev.type);
                    const statDays = stats && stats.avgRequireDays ? Math.round(stats.avgRequireDays) : 1;
                    bufferToUse = Math.max(1, statDays);
                }
            }
            const autoStart = this.computeAutoStartTime(lineTaskId, bufferToUse);
            if (autoStart) starttime = autoStart;
        }

        let deadline = getVal("task-deadline");
        if (autoCalcEnd) {
            // urgentA 任务：截止日期基于实际开始时间；普通任务：基于计划开始时间
            const editingTask = this.editingTaskId ? this.dataSource.getTask(this.editingTaskId) : null;
            const calcBase = (editingTask && editingTask.urgentA && actualStartTime) ? actualStartTime : starttime;
            const autoEnd = this.computeAutoDeadline(calcBase, estimatedHours, type);
            if (autoEnd) deadline = autoEnd;
        }

        // 截止日期验证
        this.syncDeadlineGuards();
        if (this.isDeadlineBeforeStart(starttime, deadline)) {
            this.setDeadlineValidationState(true);
            this.showMessage("截止日期早于开始日期，请修改后尝试保存");
            return null;
        } else {
            this.setDeadlineValidationState(false);
        }

        const completedAtInput = getVal("task-completed-at");
        const actualHours = getNumVal("task-actual-hours");
        const paymentInput = getVal("task-payment");
        const payment = paymentInput ? parseFloat(paymentInput) : 0;
        const paymentMode = getVal("task-payment-mode") || null;
        const paymentRecords = [...(this.tempPaymentRecords || [])];
        const abandoned = getBool("task-abandoned");
        const existingTask = this.editingTaskId ? this.dataSource.getTask(this.editingTaskId) : null;
        const abandonedAtInputVal = document.getElementById("task-abandoned-at")?.value;
        const abandonedAt = abandoned
          ? (abandonedAtInputVal ? new Date(abandonedAtInputVal).toISOString() : (existingTask?.abandonedAt || new Date().toISOString()))
          : null;

        // 图片处理
        let image = null;
        const uploadArea = document.getElementById("image-upload-area");
        if (uploadArea && uploadArea.dataset.cleared === "true") {
            image = null;
        } else if (this.imageChanged && this.currentImageData) {
            image = this.currentImageData;
        } else if (this.editingTaskId) {
            // 保留原图
            const orig = this.dataSource.getTask(this.editingTaskId);
            image = orig ? orig.image : null;
        }

        const task = {
            id: this.editingTaskId || Date.now(),
            name,
            type,
            source,
            progress,
            startTime: starttime,
            starttime: starttime,
            deadline,
            completedAt: completedAtInput || null,
            estimatedHours,
            payment,
            paymentMode: paymentMode || null,
            paymentRecords,
            abandoned,
            abandonedAt,
            actualHours,
            completedHours: actualHours,
            nodes: [...this.tempNodes],
            image,
            completed: progress === 100 || !!completedAtInput,
            dependencyType,
            lineTaskId,
            autoSchedule,
            autoCalcEnd,
            bufferDays,
            actualStartTime: actualStartTime || null,
            estimatedDay,
        };

        // 若任务已完成，则将所有节点标记为已完成
        if (task.completed && task.nodes) {
            task.nodes.forEach((n) => (n.completed = true));
        }

        return task;
    }

    // ═══════════════════════════════════════
    // 节点操作
    // 对标 app.js addNode / addPresetNode / removeNode / renderNodes
    // ═══════════════════════════════════════
    addNode() {
        const nodeInput = document.querySelector(".node-input");
        const nodeName = nodeInput ? nodeInput.value.trim() : "";
        if (!nodeName) return;

        const defaultBg = "#e5e7eb";
        this.tempNodes.push({
            id: Date.now(),
            name: nodeName,
            completed: false,
            icon: "label",
            iconGroup: "icons",
            iconStyle: "regular",
            background: defaultBg,
            textClass: this.getNearestTailwindTextClass(defaultBg),
        });
        nodeInput.value = "";
        this.renderNodes();
    }

    addPresetNode(nodeInfo) {
        const matchById =
            typeof nodeInfo === "object"
                ? nodeInfo
                : (this.dataSource.presetNodes || []).find(
                    (n) => String(n.id) === String(nodeInfo)
                );
        const matchByName =
            matchById || (this.dataSource.presetNodes || []).find((n) => n.name === nodeInfo);
        const preset = this.normalizePresetNode(
            matchById ||
            matchByName ||
            (typeof nodeInfo === "object" ? nodeInfo : { name: nodeInfo })
        );
        if (!preset || !preset.name) return;

        const textClass =
            preset.text || this.getNearestTailwindTextClass(preset.background);
        const newNode = {
            id: Date.now(),
            name: preset.name,
            completed: false,
            icon: preset.icon || "label",
            iconGroup: preset.iconGroup || "icons",
            iconStyle: preset.iconStyle || "regular",
            background: preset.background || "",
            textClass,
        };

        // 重复检测
        const allowDup = this.dataSource.allowDuplicateNodes || false;
        if (!allowDup && this.tempNodes.some((n) => n.name === newNode.name)) {
            this.showMessage("已存在同名节点");
            return;
        }

        this.tempNodes.push(newNode);
        this.renderNodes();
        this.showMessage(`已添加节点：${newNode.name}`);
    }

    removeNode(nodeId) {
        this.tempNodes = this.tempNodes.filter((node) => node.id !== nodeId);
        this.renderNodes();
    }

    renderNodes() {
        const nodesList = document.getElementById("nodes-list");
        if (!nodesList) return;

        if (this.tempNodes.length === 0) {
            nodesList.innerHTML =
                '<div class="text-center text-stone-400 text-xs py-2">暂无节点，点击上方按钮快速添加</div>';
            return;
        }

        // 缓存 this 引用以便在 onclick handler 中使用
        const self = this;

        nodesList.innerHTML = this.tempNodes
            .map((node, index) => {
                const pres = this.getNodePresentation(node);
                const { icon, background, textClass, iconClass } = pres;
                return `
                <div class="node-item flex items-center justify-between p-2 rounded-lg transition-all hover:shadow-md group" data-node="${node.name}">
                    <div class="flex items-center gap-2">
                        <span class="${iconClass} text-sm">${icon}</span>
                        <span class="text-sm font-medium">${node.name}</span>
                        <span class="text-xs opacity-60">#${index + 1}</span>
                    </div>
                    <button type="button" class="opacity-0 group-hover:opacity-100 delete-btn transition-all"
                        data-remove-node="${node.id}"
                        data-testid="remove-node-${node.id}">
                        <span class="material-icons text-sm">close</span>
                    </button>
                </div>
                `;
            })
            .join("");

        // 绑定删除事件
        nodesList.querySelectorAll("[data-remove-node]").forEach((btn) => {
            btn.addEventListener("click", () => self.removeNode(Number(btn.dataset.removeNode)));
        });
    }

    // ═══════════════════════════════════════
    // 预设节点按钮
    // 对标 app.js renderPresetNodeButtons / bindPresetNodeEvents
    // ═══════════════════════════════════════
    renderPresetNodeButtons() {
        const list = (
            this.dataSource.presetNodes && this.dataSource.presetNodes.length > 0
                ? this.dataSource.presetNodes
                : []
        ).map((n) => this.normalizePresetNode(n));

        // 追加当前编辑态或已存在任务中的节点，使非预设节点也能获得样式
        const presetNames = new Set(list.map((p) => p.name));
        const extraNodes = [];

        (this.tempNodes || []).forEach((n) => {
            if (!n || !n.name) return;
            if (presetNames.has(n.name)) return;
            extraNodes.push(
                this.normalizePresetNode({
                    name: n.name, background: n.background, icon: n.icon,
                })
            );
        });

        // 全局任务中的节点
        if (this.dataSource.getTasks) {
            (this.dataSource.getTasks() || []).forEach((t) => {
                (t.nodes || []).forEach((n) => {
                    if (!n || !n.name) return;
                    if (presetNames.has(n.name)) return;
                    extraNodes.push(
                        this.normalizePresetNode({
                            name: n.name, background: n.background, icon: n.icon,
                        })
                    );
                });
            });
        }

        const styleNodes = [...extraNodes, ...list];
        const container = document.getElementById("preset-nodes");

        if (container) {
            container.innerHTML = list
                .map((node) => {
                    const textClass =
                        node.text || this.getNearestTailwindTextClass(node.background);
                    const iconClass = window.taskUtils.getIconClassForSource(
                        node.iconGroup, node.iconStyle
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

        // 动态注入节点样式 (背景与文字颜色)
        this.applyPresetNodeStyles(styleNodes);
    }

    bindPresetNodeEvents() {
        const self = this;
        document.querySelectorAll(".preset-node-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const nodeData = {
                    id: btn.dataset.nodeId,
                    name: btn.dataset.nodeName || btn.dataset.node,
                    icon: btn.dataset.icon,
                    iconGroup: btn.dataset.iconGroup,
                    iconStyle: btn.dataset.iconStyle,
                    background: btn.dataset.background,
                    text: btn.dataset.textClass,
                };
                self.addPresetNode(nodeData);
            });
        });
    }

    // ═══════════════════════════════════════
    // 任务类型 / 来源平台选项渲染
    // 对标 app.js renderTaskTypeOptions / renderSourceOptions
    // ═══════════════════════════════════════
    renderTaskTypeOptions() {
        const container = document.getElementById("task-type-options");
        if (!container) return;

        const types = this.dataSource.taskTypes || [];
        const showQuickAdd = !!(this.dataSource.showQuickAddInputs);

        const typeOptionsHTML = types.map((type) => `
            <label class="flex items-center p-3 border border-stone-300 rounded-lg cursor-pointer hover:bg-stone-50" data-testid="type-${type.id}">
                <input type="radio" name="task-type" value="${type.id}" class="mr-3">
                <span class="type-badge mr-2" style="background-color: ${type.color || this.stringToColor(type.id)}; width: 12px; height: 12px; border-radius: 50%; display: inline-block;"></span>
                <span>${type.name}</span>
            </label>
        `).join("");

        const quickAddType = showQuickAdd ? `
      <label class="flex items-center p-3 border border-dashed border-stone-300 rounded-lg cursor-pointer">
        <input type="radio" name="task-type" value="__quick-add-type__" class="mr-1">
        <div class="flex items-center mr-1">
          <input id="quick-add-type-color" type="color" class="color-picker-sm w-8 h-8 rounded cursor-pointer border-0 p-0 outline-none" value="#3b82f6" title="选择类型颜色">
        </div>
        <input id="quick-add-type-name" type="text" class="w-full px-2 py-1 border border-stone-200 rounded-md focus:outline-none text-sm" placeholder="新增任务类型">
      </label>` : "";

        container.className = "grid grid-cols-2 gap-2";
        container.innerHTML = typeOptionsHTML + quickAddType;

        // 重新绑定类型 radios 的 change → suggestion 更新
        container.querySelectorAll('input[name="task-type"]').forEach((r) => {
            r.addEventListener("change", () => this.updateDeadlineSuggestion());
        });

        // 点击输入框时自动选中对应 radio
        if (showQuickAdd) {
            try {
                const quickTypeInput = document.getElementById("quick-add-type-name");
                const quickTypeRadio = document.querySelector('input[name="task-type"][value="__quick-add-type__"]');
                if (quickTypeInput && quickTypeRadio) {
                    quickTypeInput.addEventListener("click", () => { quickTypeRadio.checked = true; });
                }
            } catch (e) { console.error("绑定快捷类型输入点击事件失败", e); }
        }
    }

    renderSourceOptions() {
        const container = document.getElementById("task-source-options");
        if (!container) return;

        const sources = this.dataSource.sourcePlatforms || [];
        const showQuickAdd = !!(this.dataSource.showQuickAddInputs);

        const sourceOptionsHTML = sources.map((platform) => `
            <label class="flex items-center p-3 border border-stone-300 rounded-lg cursor-pointer hover:bg-stone-50" data-testid="source-${platform.id}">
                <input type="radio" name="task-source" value="${platform.id}" class="mr-3">
                <span class="type-badge mr-2" style="background-color: ${platform.color || this.stringToColor(platform.id)}; width: 12px; height: 12px; border-radius: 50%; display: inline-block;"></span>
                <span>${platform.name}</span>
            </label>
        `).join("");

        const quickAddSource = showQuickAdd ? `
      <label class="flex items-center p-3 border border-dashed border-stone-300 rounded-lg cursor-pointer">
        <input type="radio" name="task-source" value="__quick-add-source__" class="mr-1">
        <div class="flex items-center mr-1">
          <input id="quick-add-source-color" type="color" class="color-picker-sm w-8 h-8 rounded cursor-pointer border-0 p-0 outline-none" value="#3b82f6" title="选择平台颜色">
        </div>
        <input id="quick-add-source-name" type="text" class="w-full px-2 py-1 border border-stone-200 rounded-md focus:outline-none text-sm" placeholder="新增来源平台">
      </label>` : "";

        container.className = "grid grid-cols-2 gap-2";
        container.innerHTML = sourceOptionsHTML + quickAddSource;

        // 点击输入框时自动选中对应 radio
        if (showQuickAdd) {
            try {
                const quickSourceInput = document.getElementById("quick-add-source-name");
                const quickSourceRadio = document.querySelector('input[name="task-source"][value="__quick-add-source__"]');
                if (quickSourceInput && quickSourceRadio) {
                    quickSourceInput.addEventListener("click", () => { quickSourceRadio.checked = true; });
                }
            } catch (e) { console.error("绑定快捷来源输入点击事件失败", e); }
        }
    }

    // ═══════════════════════════════════════
    // 前序任务下拉选项
    // 对标 app.js getLineTaskCandidates / renderLineTaskOptions
    // ═══════════════════════════════════════
    getLineTaskCandidates(excludeId = null) {
        const tasks = this.dataSource.getTasks ? this.dataSource.getTasks() : [];
        const list = Array.isArray(tasks) ? [...tasks] : [];
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

    renderLineTaskOptions(selectedId = null, excludeId = null) {
        const select = document.getElementById("task-line-task");
        if (!select) return;
        const options = [
            '<option value="">不绑定</option>',
            ...this.getLineTaskCandidates(excludeId).map((t) => {
                const prefix = t.dependencyType === "line" ? "[链式]" : "[独立]";
                const dl = t.deadline ? `（截止：${(t.deadline || "").slice(0, 10)}）` : "";
                return `<option value="${t.id}" ${String(t.id) === String(selectedId) ? "selected" : ""}>${prefix} ${t.name}${dl}</option>`;
            }),
        ];
        select.innerHTML = options.join("");
    }

    // ═══════════════════════════════════════
    // 依赖模式 UI 更新
    // 对标 app.js updateDependencyUI — 包含自动计算开始时间与 readOnly 逻辑
    // ═══════════════════════════════════════
    updateDependencyUI(dependencyType) {
        const lineGroup = document.getElementById("line-task-group");
        const startInput = document.getElementById("task-starttime");
        const autoScheduleEl = document.getElementById("task-auto-schedule");
        const autoScheduleWrap = document.getElementById("task-auto-schedule-wrap");
        const bufferEl = document.getElementById("task-buffer-days");
        const bufferGroup = document.getElementById("buffer-group");
        const select = document.getElementById("task-line-task");
        const isLine = dependencyType === "line";

        if (lineGroup) {
            if (isLine) lineGroup.classList.remove("hidden");
            else lineGroup.classList.add("hidden");
        }
        if (bufferGroup) {
            if (isLine) bufferGroup.classList.remove("hidden");
            else bufferGroup.classList.add("hidden");
        }
        if (autoScheduleWrap) {
            if (isLine) autoScheduleWrap.classList.remove("hidden");
            else autoScheduleWrap.classList.add("hidden");
        }

        if (!startInput) return;

        // 自动计算开始时间逻辑
        const applyAuto = () => {
            if (!isLine || !autoScheduleEl || !select) {
                startInput.readOnly = false;
                startInput.classList.remove("bg-stone-50");
                return;
            }
            const auto = autoScheduleEl.checked;
            if (auto) {
                const pid = Number(select.value) || null;
                // 缓冲应来源于前序任务
                let bufferToUse = 1;
                if (pid) {
                    const tasks = this.dataSource.getTasks ? this.dataSource.getTasks() : [];
                    const prev = tasks.find((t) => t.id === pid);
                    if (prev) {
                        if (Number.isFinite(Number(prev.bufferDays))) {
                            bufferToUse = Math.max(-1, Math.round(Number(prev.bufferDays)));
                        } else {
                            const stats = this.getTypeWeightedStats(prev.type);
                            const statDays = stats && stats.avgRequireDays ? Math.round(stats.avgRequireDays) : 1;
                            bufferToUse = Math.max(1, statDays);
                        }
                    }
                }
                const computed = pid ? this.computeAutoStartTime(pid, bufferToUse) : null;
                if (computed) startInput.value = computed;
                const lock = !!pid; // 无前序时允许手动编辑
                startInput.readOnly = lock;
                startInput.classList.toggle("bg-stone-50", lock);
                // 更新建议截止与建议工期提示
                try { this.updateDeadlineSuggestion(); } catch (e) { /* ignore */ }
                this.syncDeadlineGuards();
            } else {
                startInput.readOnly = false;
                startInput.classList.remove("bg-stone-50");
                this.syncDeadlineGuards();
            }
        };
        applyAuto();

        // 更新选择按钮的视觉高亮 (使用 dep-selected CSS 类)
        try {
            const elNone = document.querySelector('[data-testid="dep-none"]');
            const elLine = document.querySelector('[data-testid="dep-line"]');
            const selClass = "dep-selected";
            if (elNone) elNone.classList.remove(selClass);
            if (elLine) elLine.classList.remove(selClass);
            if (isLine) {
                if (elLine) elLine.classList.add(selClass);
            } else {
                if (elNone) elNone.classList.add(selClass);
            }
        } catch (e) { /* ignore */ }
    }

    // ═══════════════════════════════════════
    // 自动计算开始时间
    // 对标 app.js computeAutoStartTime
    // ═══════════════════════════════════════
    computeAutoStartTime(predecessorId, bufferDays = 1) {
        const tasks = this.dataSource.getTasks ? this.dataSource.getTasks() : [];
        const prev = tasks.find((t) => t.id === predecessorId);
        if (!prev) return null;
        const endBase = prev.completedAt || prev.deadline;
        if (!endBase) return null;
        let base = new Date(endBase);
        if (Number.isNaN(base.getTime())) return null;

        // 若前序任务尚未完成且其 deadline 已过，则以"今日"为基准
        const today = new Date();
        const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        if (!prev.completedAt && prev.deadline) {
            const dl = new Date(prev.deadline);
            if (!Number.isNaN(dl.getTime()) && dl < todayDate) {
                const newBase = new Date(todayDate.getTime());
                newBase.setHours(dl.getHours(), dl.getMinutes(), dl.getSeconds() || 0, 0);
                base = newBase;
            }
        }

        // bufferDays 语义: -1 => 当天, 0 => 次日, 1 => 后二日
        const rawProvided = Number.isFinite(Number(bufferDays)) ? Math.round(Number(bufferDays)) : null;
        const raw = rawProvided === null ? 1 : Math.max(rawProvided, -1);
        const addDays = raw + 1;
        base.setDate(base.getDate() + addDays);
        return this.formatDateTimeLocal(base);
    }

    // ═══════════════════════════════════════
    // 工期 ↔ 截止日期 双向联动
    // ═══════════════════════════════════════

    /** 工期输入 → 自动计算截止日期 */
    syncEstimatedDaysToDeadline() {
        const startInput = document.getElementById("task-starttime");
        const daysInput = document.getElementById("task-estimated-days");
        const deadlineInput = document.getElementById("task-deadline");
        const autoCalcEndEl = document.getElementById("task-auto-calc-end");
        if (!startInput || !daysInput || !deadlineInput) return;
        if (autoCalcEndEl && autoCalcEndEl.checked) return; // 统计数据计算优先

        const days = parseInt(daysInput.value);
        const startVal = startInput.value;
        if (!Number.isFinite(days) || days < 0 || !startVal) return;

        const start = new Date(startVal);
        if (isNaN(start.getTime())) return;

        const existingDeadline = deadlineInput.value ? new Date(deadlineInput.value) : null;
        const timeSource =
            existingDeadline && !isNaN(existingDeadline.getTime()) ? existingDeadline : start;

        const end = new Date(start);
        end.setDate(end.getDate() + days);
        end.setHours(timeSource.getHours(), timeSource.getMinutes(), 0, 0);
        deadlineInput.value = this.formatDateTimeLocal(end);
        this.syncDeadlineGuards();
    }

    /** 截止日期变更 → 自动反算工期 */
    syncDeadlineToEstimatedDays() {
        const startInput = document.getElementById("task-starttime");
        const daysInput = document.getElementById("task-estimated-days");
        const deadlineInput = document.getElementById("task-deadline");
        if (!startInput || !daysInput || !deadlineInput) return;

        const startVal = startInput.value;
        const deadlineVal = deadlineInput.value;
        if (!startVal || !deadlineVal) return;

        const start = new Date(startVal);
        const end = new Date(deadlineVal);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

        const startDateOnlyUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
        const endDateOnlyUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
        const days = Math.max(0, Math.round((endDateOnlyUtc - startDateOnlyUtc) / 86400000));
        daysInput.value = days;
    }

    // ═══════════════════════════════════════
    // 截止日期验证
    // 对标 app.js syncDeadlineGuards / isDeadlineBeforeStart / setDeadlineValidationState
    // ═══════════════════════════════════════
    isDeadlineBeforeStart(startVal, deadlineVal) {
        const start = startVal ? new Date(startVal) : null;
        const end = deadlineVal ? new Date(deadlineVal) : null;
        if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return false;
        }
        return end.getTime() < start.getTime();
    }

    setDeadlineValidationState(invalid) {
        const deadlineEl = document.getElementById("task-deadline");
        const errEl = document.getElementById("deadline-order-error");
        if (deadlineEl) {
            if (invalid) deadlineEl.classList.add("input-ring-error");
            else deadlineEl.classList.remove("input-ring-error");
        }
        if (errEl) {
            if (invalid) {
                errEl.textContent = "截止日期早于开始日期，请修改后尝试保存";
                errEl.classList.remove("hidden");
            } else {
                errEl.textContent = "";
                errEl.classList.add("hidden");
            }
        }
    }

    syncDeadlineGuards() {
        const startInput = document.getElementById("task-starttime");
        const actualStartInput = document.getElementById("task-actual-starttime");
        const deadlineInput = document.getElementById("task-deadline");
        if (!deadlineInput) return;

        // urgentA 任务以实际开始时间作为截止日期的下限基准
        const editingTask = this.editingTaskId ? this.dataSource.getTask(this.editingTaskId) : null;
        const isUrgentA = !!(editingTask && editingTask.urgentA);
        const compareStart = (isUrgentA && actualStartInput?.value)
            ? actualStartInput.value
            : (startInput?.value || null);

        if (compareStart) deadlineInput.min = compareStart;
        else deadlineInput.removeAttribute("min");

        const invalid = this.isDeadlineBeforeStart(compareStart, deadlineInput.value || null);
        this.setDeadlineValidationState(invalid);
    }

    // ═══════════════════════════════════════
    // 建议截止/工期 更新
    // 对标 app.js updateDeadlineSuggestionInModal
    // ═══════════════════════════════════════
    updateDeadlineSuggestion() {
        const startInput = document.getElementById("task-starttime");
        const hoursInput = document.getElementById("task-hours");
        const typeSel = document.querySelector('input[name="task-type"]:checked');
        const autoCalcEndEl = document.getElementById("task-auto-calc-end");
        const deadlineEl = document.getElementById("task-deadline");
        const suggEl = document.getElementById("task-deadline-suggestion");

        if (!startInput || !hoursInput || !suggEl) return;

        const startVal = startInput.value || null;
        const actualStartVal = document.getElementById("task-actual-starttime")?.value || null;
        const preferredStart = actualStartVal || startVal;
        const hours = parseInt(hoursInput.value) || 8;
        const type = typeSel ? typeSel.value : null;
        const MIN_SAMPLES_FOR_SUGGESTION = 3;

        // 计算并显示预计工期 (优先使用实际开始时间)
        const days = this.computeSuggestedRequireDays(preferredStart, hours, type);
        const autoEndRaw = preferredStart ? this.computeAutoDeadline(preferredStart, hours, type) : null;

        // 格式化建议截止日期
        let autoEndPretty = null;
        if (autoEndRaw) {
            const dt = new Date(autoEndRaw);
            if (!Number.isNaN(dt.getTime())) {
                autoEndPretty = `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`;
            }
        }

        // days 展示
        let daysText = "";
        if (days === 'x') daysText = `预计工期 x 天`;
        else if (Number.isFinite(days)) daysText = `预计工期 ${days} 天`;

        // 建议截止展示
        let deadlineText = "";
        if (startVal) {
            if (autoEndPretty) deadlineText = `理论完成时间：${autoEndPretty}`;
            else deadlineText = `理论完成时间：x`;
        }

        // 合并显示
        const parts = [];
        if (daysText) parts.push(daysText);
        if (deadlineText) parts.push(deadlineText);
        suggEl.textContent = parts.join('；');

        // 计算并显示历史平均工时
        const hoursSuggEl = document.getElementById("task-hours-suggestion");
        if (hoursSuggEl) {
            const stats = this.getTypeWeightedStats(type);
            const hasEnough = stats && Number.isFinite(stats.sampleCount) && stats.sampleCount >= MIN_SAMPLES_FOR_SUGGESTION;
            const avgHours = hasEnough && Number.isFinite(stats.avgCompletedHours) ? stats.avgCompletedHours : null;
            if (avgHours === null) {
                hoursSuggEl.textContent = `历史平均工时 x h`;
            } else {
                const rounded = Math.round(avgHours * 10) / 10;
                hoursSuggEl.textContent = `历史平均工时 ${rounded} h`;
            }
        }

        // 计算并显示历史平均缓冲天数
        const bufSuggEl = document.getElementById("task-buffer-suggestion");
        if (bufSuggEl) {
            const bufStats = this.computeTypeAvgBufferDays(type);
            if (bufStats && Number.isFinite(bufStats.avgBufferDays) && bufStats.sampleCount >= MIN_SAMPLES_FOR_SUGGESTION) {
                bufSuggEl.textContent = `历史平均休息 ${Math.max(0, Math.round(bufStats.avgBufferDays))} 天`;
            } else {
                bufSuggEl.textContent = `历史平均休息 x 天`;
            }
        }

        // 如果启用了统计数据计算截止且建议可用，则填回截止输入框并同步工期
        // urgentA 任务：截止日期基于实际开始时间计算；普通任务：基于计划开始时间
        const editingTask = this.editingTaskId ? this.dataSource.getTask(this.editingTaskId) : null;
        const isUrgentA = !!(editingTask && editingTask.urgentA && actualStartVal);
        const fillBase = isUrgentA ? actualStartVal : startVal;
        const autoEndForFill = fillBase ? this.computeAutoDeadline(fillBase, hours, type) : null;
        if (autoCalcEndEl && autoCalcEndEl.checked && fillBase && autoEndForFill) {
            if (deadlineEl) deadlineEl.value = autoEndForFill;
            this.syncDeadlineToEstimatedDays();
        }

        // 同步最小可选日期与是否倒挂的标记
        this.syncDeadlineGuards();
    }

    // ═══════════════════════════════════════
    // 统计计算辅助方法
    // 对标 app.js getTypeWeightedStats / computeTypeAvgBufferDays / computeSuggestedRequireDays / computeAutoDeadline
    // ═══════════════════════════════════════

    /**
     * 获取指定类型的加权统计。
     * 优先使用 dataSource.statistics (预计算数据)，否则从已完成任务动态计算。
     */
    getTypeWeightedStats(taskType) {
        // 若数据源提供了预计算统计，则优先使用
        const stats = this.dataSource.statistics;
        if (stats && stats.types && stats.types[taskType]) {
            const entry = stats.types[taskType];
            if (Array.isArray(entry.samples) && entry.samples.length > 0) {
                const agg = this._computeAggregatesFromSamples(entry.samples);
                return {
                    avgDailyHours: Number.isFinite(entry.avgDailyHours) ? entry.avgDailyHours : agg.avgDailyHours,
                    avgRequireDays: Number.isFinite(entry.avgRequireDays) ? entry.avgRequireDays : agg.avgRequireDays,
                    avgCompletedHours: Number.isFinite(entry.avgCompletedHours) ? entry.avgCompletedHours : agg.avgCompletedHours,
                    sampleCount: entry.sampleCount || agg.sampleCount || entry.samples.length || 0,
                };
            }
        }

        // 回退: 从已完成任务动态计算
        return this._computeWeightedStatsFromTasks(taskType);
    }

    /** 从预计算样本数组计算加权聚合 */
    _computeAggregatesFromSamples(samples) {
        if (!Array.isArray(samples) || samples.length === 0) {
            return { avgDailyHours: null, avgRequireDays: null, avgCompletedHours: null, sampleCount: 0 };
        }
        let sumDaily = 0, sumDays = 0, sumHours = 0, weightSum = 0;
        samples.forEach((s, idx) => {
            const hours = Number(s.hours);
            const days = Number(s.requireDays);
            const daily = Number(s.dailyHours);
            if (!Number.isFinite(hours) || !Number.isFinite(days) || !Number.isFinite(daily)) return;
            if (hours <= 0 || days <= 0) return;
            const weight = 1 / (idx + 1);
            sumDaily += daily * weight;
            sumDays += days * weight;
            sumHours += hours * weight;
            weightSum += weight;
        });
        if (weightSum === 0) return { avgDailyHours: null, avgRequireDays: null, avgCompletedHours: null, sampleCount: 0 };
        return {
            avgDailyHours: sumDaily / weightSum,
            avgRequireDays: sumDays / weightSum,
            avgCompletedHours: sumHours / weightSum,
            sampleCount: samples.length,
        };
    }

    /** 从已完成任务动态计算加权统计 */
    _computeWeightedStatsFromTasks(taskType) {
        if (!this.dataSource.getTasks) return { sampleCount: 0 };
        const tasks = this.dataSource.getTasks();

        const completed = tasks.filter((t) =>
            t && t.completed && t.completedAt && t.type === taskType
        ).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
            .slice(0, 10);

        let sumDaily = 0, sumDays = 0, sumHours = 0, weightSum = 0;

        completed.forEach((t, idx) => {
            const start = t.actualStartTime || t.startTime || t.starttime || t.startDate || t.deadline;
            const end = t.completedAt;
            if (!start || !end) return;

            const s = new Date(start);
            const e = new Date(end);
            if (isNaN(s.getTime()) || isNaN(e.getTime())) return;

            const days = Math.max(1, Math.ceil((e - s) / (1000 * 60 * 60 * 24)));
            const hours = Number(t.actualHours) || Number(t.estimatedHours) || 0;
            if (hours <= 0) return;

            const daily = hours / days;
            const weight = 1 / (idx + 1);

            sumDaily += daily * weight;
            sumDays += days * weight;
            sumHours += hours * weight;
            weightSum += weight;
        });

        if (weightSum === 0) return { sampleCount: 0 };
        return {
            avgDailyHours: sumDaily / weightSum,
            avgRequireDays: sumDays / weightSum,
            avgCompletedHours: sumHours / weightSum,
            sampleCount: completed.length,
        };
    }

    computeTypeAvgBufferDays(taskType) {
        if (!this.dataSource.getTasks) return { avgBufferDays: null, sampleCount: 0 };
        const tasks = this.dataSource.getTasks();

        const completed = tasks
            .filter((t) => t && t.completed && t.completedAt && t.type === taskType)
            .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
            .slice(0, 10);

        let sum = 0, weightSum = 0, count = 0;

        completed.forEach((t, idx) => {
            const successors = tasks.filter(
                (s) => s && s.dependencyType === "line" && s.lineTaskId === t.id &&
                    (s.actualStartTime || s.startTime || s.starttime || s.startDate)
            );
            if (!successors || successors.length === 0) return;

            // 取最早开始的后继
            successors.sort((a, b) => {
                const aStart = new Date(a.actualStartTime || a.startTime || a.starttime || a.startDate).getTime() || 0;
                const bStart = new Date(b.actualStartTime || b.startTime || b.starttime || b.startDate).getTime() || 0;
                return aStart - bStart;
            });
            const succ = successors[0];
            const sTimeRaw = succ.actualStartTime || succ.startTime || succ.starttime || succ.startDate;
            const endRaw = t.completedAt;
            if (!sTimeRaw || !endRaw) return;

            const sTime = new Date(sTimeRaw);
            const end = new Date(endRaw);
            if (Number.isNaN(sTime.getTime()) || Number.isNaN(end.getTime())) return;

            const days = Math.max(0, Math.ceil((sTime - end) / (1000 * 60 * 60 * 24)));
            const weight = 1 / (idx + 1);
            sum += days * weight;
            weightSum += weight;
            count += 1;
        });

        if (weightSum === 0) return { avgBufferDays: null, sampleCount: 0 };
        return { avgBufferDays: sum / weightSum, sampleCount: count };
    }

    computeSuggestedRequireDays(startTime, estimatedHours, taskType) {
        if (!startTime) return null;
        const start = new Date(startTime);
        if (Number.isNaN(start.getTime())) return null;

        const stats = this.getTypeWeightedStats(taskType);
        const MIN_SAMPLES = 3;
        const hasEnough = stats && Number.isFinite(stats.sampleCount) && stats.sampleCount >= MIN_SAMPLES;
        const avgDaily = hasEnough && Number.isFinite(stats.avgDailyHours) ? stats.avgDailyHours : null;

        const daysByHours = (estimatedHours && avgDaily && avgDaily > 0)
            ? Math.ceil(estimatedHours / avgDaily)
            : null;
        const daysByHistory = (hasEnough && stats && Number.isFinite(stats.avgRequireDays))
            ? Math.ceil(stats.avgRequireDays)
            : null;

        if (daysByHours === null && daysByHistory === null) return 'x';
        return Math.max(daysByHours || 0, daysByHistory || 0, 1);
    }

    computeAutoDeadline(startTime, estimatedHours, taskType) {
        if (!startTime) return null;
        const start = new Date(startTime);
        if (Number.isNaN(start.getTime())) return null;

        const stats = this.getTypeWeightedStats(taskType);
        const MIN_SAMPLES = 3;
        const hasEnough = stats && Number.isFinite(stats.sampleCount) && stats.sampleCount >= MIN_SAMPLES;
        const avgDaily = hasEnough && Number.isFinite(stats.avgDailyHours) ? stats.avgDailyHours : null;

        const daysByHours = (estimatedHours && avgDaily && avgDaily > 0)
            ? Math.ceil(estimatedHours / avgDaily)
            : null;
        const daysByHistory = (hasEnough && stats && Number.isFinite(stats.avgRequireDays))
            ? Math.ceil(stats.avgRequireDays)
            : null;

        if (daysByHours === null && daysByHistory === null) return null;
        const requireDays = Math.max(daysByHours || 0, daysByHistory || 0, 1);

        const end = new Date(start);
        end.setDate(end.getDate() + requireDays);
        end.setHours(23, 59, 0, 0);
        return this.formatDateTimeLocal(end);
    }

    // ═══════════════════════════════════════
    // 收款记录管理 (paymentRecords)
    // ═══════════════════════════════════════
    renderPaymentRecords() {
        const list = document.getElementById("payment-records-list");
        const empty = document.getElementById("payment-records-empty");
        if (!list) return;
        const records = this.tempPaymentRecords || [];
        if (records.length === 0) {
            list.innerHTML = "";
            if (empty) empty.style.display = "";
            return;
        }
        if (empty) empty.style.display = "none";
        list.innerHTML = records.map((r) => {
            const isRefund = r.type === "refund";
            const sign = isRefund ? "-" : "+";
            const colorClass = isRefund ? "border-red-100 bg-red-50" : "border-green-100 bg-green-50";
            const txtClass = isRefund ? "text-red-600" : "text-green-600";
            return `<div class="flex items-center justify-between px-2 py-1 rounded border ${colorClass} text-xs gap-2">
              <span class="${txtClass} font-medium whitespace-nowrap">${sign}¥${Number(r.amount).toFixed(0)}</span>
              <span class="text-stone-500 flex-1 truncate">${r.date || ""}${r.note ? " · " + r.note : ""}</span>
              <button type="button" data-remove-payment-id="${r.id}" class="text-stone-400 hover:text-red-500 shrink-0">
                <span class="material-icons" style="font-size:14px;vertical-align:-3px;">close</span>
              </button>
            </div>`;
        }).join("");
        list.querySelectorAll("[data-remove-payment-id]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const rid = Number(btn.dataset.removePaymentId);
                this.tempPaymentRecords = (this.tempPaymentRecords || []).filter((r) => r.id !== rid);
                this.renderPaymentRecords();
            });
        });
    }

    addPaymentRecord(type) {
        const label = type === "refund" ? "退款" : "收款";
        const modal = document.getElementById("payment-record-modal");
        if (!modal) return;
        const titleEl = document.getElementById("pr-modal-title");
        const amountEl = document.getElementById("pr-amount");
        const datetimeEl = document.getElementById("pr-datetime");
        const noteEl = document.getElementById("pr-note");
        const errorEl = document.getElementById("pr-error");
        if (titleEl) titleEl.textContent = `添加${label}记录`;
        if (amountEl) amountEl.value = "";
        if (noteEl) noteEl.value = "";
        if (errorEl) errorEl.classList.add("hidden");
        if (datetimeEl) {
            const now = new Date();
            const pad = (n) => String(n).padStart(2, "0");
            datetimeEl.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
        }
        modal.classList.remove("hidden");
        const confirmBtn = document.getElementById("pr-confirm-btn");
        const cancelBtn = document.getElementById("pr-cancel-btn");
        const cleanup = () => {
            modal.classList.add("hidden");
            if (confirmBtn) confirmBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
        };
        if (cancelBtn) cancelBtn.onclick = cleanup;
        if (confirmBtn) confirmBtn.onclick = () => {
            const amount = parseFloat(amountEl?.value);
            if (!amount || isNaN(amount) || amount <= 0) {
                if (errorEl) errorEl.classList.remove("hidden");
                if (amountEl) amountEl.focus();
                return;
            }
            const datetimeVal = datetimeEl?.value;
            const date = datetimeVal ? datetimeVal.slice(0, 10) : new Date().toISOString().slice(0, 10);
            const note = noteEl?.value.trim() || "";
            if (!this.tempPaymentRecords) this.tempPaymentRecords = [];
            this.tempPaymentRecords.push({ id: Date.now(), type, amount, date, note });
            this.renderPaymentRecords();
            cleanup();
        };
    }

    // ═══════════════════════════════════════
    // 图片上传
    // 对标 app.js bindImageUploadEvents
    // ═══════════════════════════════════════
    bindImageUploadEvents() {
        const input = document.getElementById("task-image");
        if (!input) return;

        input.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                this.currentImageData = ev.target.result;
                this.imageChanged = true;
                const uploadArea = document.getElementById("image-upload-area");
                if (uploadArea) uploadArea.dataset.cleared = "false";
                this.showImagePreview(this.currentImageData);
            };
            reader.readAsDataURL(file);
        });

        document.getElementById("upload-placeholder")?.addEventListener("click", () => input.click());
        document.getElementById("remove-image")?.addEventListener("click", () => this.resetImageUpload());
    }

    showImagePreview(src) {
        const container = document.getElementById("image-preview-container");
        const preview = document.getElementById("image-preview");
        const placeholder = document.getElementById("upload-placeholder");

        if (container && preview && placeholder) {
            preview.src = src;
            container.classList.remove("hidden");
            placeholder.classList.add("hidden");
        }
    }

    resetImageUpload() {
        const input = document.getElementById("task-image");
        if (input) input.value = "";

        this.currentImageData = null;
        this.imageChanged = false;

        const uploadArea = document.getElementById("image-upload-area");
        if (uploadArea) uploadArea.dataset.cleared = "true";

        const container = document.getElementById("image-preview-container");
        const placeholder = document.getElementById("upload-placeholder");
        if (container && placeholder) {
            container.classList.add("hidden");
            placeholder.classList.remove("hidden");
        }
    }

    // ═══════════════════════════════════════
    // 通用辅助方法 (from app.js)
    // ═══════════════════════════════════════

    showMessage(msg) {
        if (this.dataSource.showMessage) {
            this.dataSource.showMessage(msg);
        } else {
            console.log("[TaskModal]", msg);
        }
    }

    stringToColor(str) {
        if (!str) return "#ccc";
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const c = (hash & 0x00ffffff).toString(16).toUpperCase();
        return "#" + "00000".substring(0, 6 - c.length) + c;
    }

    hexToHsl(hex) {
        let c = (hex || "").replace("#", "").trim();
        if (c.length === 3) c = c.split("").map((ch) => ch + ch).join("");
        if (c.length !== 6) return { h: 0, s: 0, l: 0.5 };
        const r = parseInt(c.slice(0, 2), 16) / 255;
        const g = parseInt(c.slice(2, 4), 16) / 255;
        const b = parseInt(c.slice(4, 6), 16) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
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
    }

    getNearestTailwindTextClass(hexColor) {
        const palette = [
            { name: "red", hex: "#ef4444" },
            { name: "orange", hex: "#f97316" },
            { name: "amber", hex: "#f59e0b" },
            { name: "yellow", hex: "#eab308" },
            { name: "lime", hex: "#84cc16" },
            { name: "green", hex: "#22c55e" },
            { name: "emerald", hex: "#10b981" },
            { name: "teal", hex: "#14b8a6" },
            { name: "cyan", hex: "#06b6d4" },
            { name: "sky", hex: "#0ea5e9" },
            { name: "blue", hex: "#3b82f6" },
            { name: "indigo", hex: "#6366f1" },
            { name: "violet", hex: "#8b5cf6" },
            { name: "purple", hex: "#a855f7" },
            { name: "fuchsia", hex: "#d946ef" },
            { name: "pink", hex: "#ec4899" },
            { name: "rose", hex: "#f43f5e" },
            { name: "slate", hex: "#475569" },
        ];
        const { h, s, l } = this.hexToHsl(hexColor || "#e5e7eb");
        if (
            (l === 1.0 && s < 0.03) ||
            (l < 1.0 && l > 0.94 && !(s >= 0.94)) ||
            (l < 0.9 && s < 0.15) ||
            (l >= 0.9 && l <= 0.95 && s < 0.15) ||
            l < 0.15
        ) {
            return "text-stone-700";
        }
        let best = "gray";
        let bestDelta = Number.POSITIVE_INFINITY;
        palette.forEach((c) => {
            const { h: ph } = this.hexToHsl(c.hex);
            const delta = Math.min(Math.abs(ph - h), 360 - Math.abs(ph - h));
            if (delta < bestDelta) {
                bestDelta = delta;
                best = c.name;
            }
        });
        return `text-${best}-700`;
    }

    normalizeIconSelection(iconPayload) {
        const palette = (group) => group === 'symbols' ? this.fontSymbolsPalette : this.fontIconsPalette;
        if (iconPayload && typeof iconPayload === "object") {
            const name = iconPayload.name || iconPayload.icon || "label";
            const group = iconPayload.group === "symbols" ? "symbols" : "icons";
            const fallbackStyle = group === "symbols" ? "outlined" : "regular";
            const pal = palette(group);
            const styleRaw = iconPayload.style || fallbackStyle;
            const style = pal && pal.includes(styleRaw) ? styleRaw : fallbackStyle;
            return { name, group, style };
        }
        return { name: iconPayload || "label", group: "icons", style: "regular" };
    }

    // getIconClassForSource 已提取至 task-utils.js → window.taskUtils.getIconClassForSource

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
            id, name, background, icon, text,
            iconGroup: iconSelection.group,
            iconStyle: iconSelection.style,
        };
    }

    getNodePresentation(node) {
        const name = node && node.name;
        const id = node && node.id;
        const presetMatch = (this.dataSource.presetNodes || []).find(
            (p) => (name && p.name === name) || (id && String(p.id) === String(id))
        );
        const background = presetMatch?.background || (node && node.background) || "";
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
        const iconClass = window.taskUtils.getIconClassForSource(
            iconSelection.group,
            iconSelection.style
        );
        return {
            presetMatch, icon, background, textClass,
            iconGroup: iconSelection.group,
            iconStyle: iconSelection.style,
            iconClass,
        };
    }

    applyPresetNodeStyles(presetList) {
        const list = (presetList || []).map((n) => this.normalizePresetNode(n));
        const tag = document.getElementById("preset-node-styles") || (function () {
            const s = document.createElement("style");
            s.id = "preset-node-styles";
            document.head.appendChild(s);
            return s;
        })();

        tag.textContent = list.map((node) => {
            const name = typeof CSS !== "undefined" && CSS.escape
                ? CSS.escape(node.name)
                : (node.name || "").replace(/"/g, '\\"');
            const bg = node.background || "transparent";
            const tc = (node.text || this.getNearestTailwindTextClass(bg)).replace(/^text-/, "");
            const color = `var(--color-${tc}, inherit)`;
            return `.preset-node-btn[data-node="${name}"], .node-item[data-node="${name}"]{background:${bg};color:${color}}`;
        }).join("\n");
    }

    // 静态工具方法，允许外部直接调用
    static bindOverlayClose(overlayEl, onClose, matcher) {
        if (!overlayEl || typeof onClose !== "function") return;
        const isOnOverlay = typeof matcher === "function"
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

    // 实例方法代理 (兼容旧调用)
    bindOverlayClose(overlayEl, onClose, matcher) {
        TaskModalController.bindOverlayClose(overlayEl, onClose, matcher);
    }

    formatDateTimeLocal(dateStr) {
        if (!dateStr) return "";
        const dt = typeof dateStr === "object" ? dateStr : new Date(dateStr);
        if (isNaN(dt.getTime())) return "";
        const Y = dt.getFullYear();
        const M = String(dt.getMonth() + 1).padStart(2, "0");
        const D = String(dt.getDate()).padStart(2, "0");
        const h = String(dt.getHours()).padStart(2, "0");
        const m = String(dt.getMinutes()).padStart(2, "0");
        return `${Y}-${M}-${D}T${h}:${m}`;
    }

    // ═══════════════════════════════════════
    // static injectHTML — 向 body 注入模态框 HTML（两个页面共用）
    // 调用方应在 DOMContentLoaded 之前或之后均可，但须在 initEvents() 之前调用
    // ═══════════════════════════════════════
    static injectHTML() {
        if (document.getElementById('task-modal')) return; // 已注入，跳过

        // ── #task-modal ──
        const taskModalHtml = `
<div id="task-modal" class="modal-backdrop fixed inset-0 z-50 hidden flex items-center justify-center p-4">
  <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl modal-content">
    <div class="modal-body flex-1 overflow-y-auto p-6">
      <h2 id="modal-title" class="text-xl font-bold text-stone-800 mb-4">添加新任务</h2>

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-2">任务名称</label>
        <input type="text" id="task-name"
          class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
          placeholder="输入任务名称" data-testid="task-name-input" data-scrapbook-input-value="">
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-2">任务类型</label>
        <div class="space-y-2" id="task-type-options"><!-- populated dynamically --></div>
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-2">来源平台</label>
        <div class="space-y-2" id="task-source-options"><!-- populated dynamically --></div>
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-2">排单模式</label>
        <div id="task-dependency-options" class="grid grid-cols-2 gap-2">
          <label class="flex items-center p-2 border border-stone-300 rounded-lg cursor-pointer hover:bg-stone-50 justify-center" data-testid="dep-none">
            <input type="radio" name="task-dependency" value="none" class="mr-2 hidden">
            <span class="text-sm">独立任务（并行）</span>
          </label>
          <label class="flex items-center p-2 border border-stone-300 rounded-lg cursor-pointer hover:bg-stone-50 justify-center" data-testid="dep-line">
            <input type="radio" name="task-dependency" value="line" class="mr-2 hidden">
            <span class="text-sm">链式任务（线性）</span>
          </label>
        </div>
      </div>

      <div class="mb-4 hidden" id="line-task-group">
        <label class="block text-sm font-medium text-stone-700 mb-2">绑定前序任务</label>
        <select id="task-line-task" class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"></select>
        <p class="text-xs text-stone-400 mt-1">按截止日期倒序排列，可选择未开始的任务。</p>
      </div>

      <div class="mb-4">
        <label class="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
          <span>开始时间</span>
          <div id="task-auto-schedule-wrap" class="inline-flex items-center gap-2 hidden">
            <div id="task-auto-schedule-label" class="text-sm text-stone-700">自动计算开始时间</div>
            <label class="inline-flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" id="task-auto-schedule" class="h-4 w-4">
            </label>
          </div>
        </label>
        <input type="datetime-local" id="task-starttime"
          class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
          data-testid="task-starttime-input" data-scrapbook-input-value="">
      </div>

      <div class="mb-4">
        <div class="flex gap-3">
          <div class="flex-1">
            <label class="block text-sm font-medium text-stone-700 mb-2">预计工期（天）</label>
            <input type="number" id="task-estimated-days"
              class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
              placeholder="工期" min="0" value="" data-testid="task-estimated-days-input">
          </div>
          <div class="flex-1">
            <label class="block text-sm font-medium text-stone-700 mb-2">预计工时（小时）</label>
            <input type="number" id="task-hours"
              class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
              placeholder="工时" min="1" value="8" data-testid="task-hours-input">
          </div>
        </div>
        <p id="task-hours-suggestion" class="text-xs text-stone-400 mt-1"></p>
      </div>

      <div class="mb-4">
        <label class="flex items-center justify-between text-sm font-medium text-stone-700 mb-2">
          <span>截止日期</span>
          <div id="task-auto-calc-end-wrap" class="inline-flex items-center gap-2">
            <div id="task-auto-calc-end-label" class="text-sm text-stone-700">使用统计数据计算截止日期</div>
            <label class="inline-flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" id="task-auto-calc-end" class="h-4 w-4">
            </label>
          </div>
        </label>
        <input type="datetime-local" id="task-deadline"
          class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
          data-testid="task-deadline-input" data-scrapbook-input-value="">
        <p id="task-deadline-suggestion" class="text-xs text-stone-400 mt-1"></p>
        <p id="deadline-order-error" class="text-xs text-red-500 hidden mt-1"></p>
      </div>

      <div class="mb-2">
        <label class="block text-sm font-medium text-stone-700 mb-2">实际开始时间（可选）</label>
        <input type="datetime-local" id="task-actual-starttime"
          class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring">
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-2">完成时间（可选）</label>
        <input type="datetime-local" id="task-completed-at"
          class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
          data-testid="task-completed-at-input" placeholder="留空表示未完成">
        <p class="text-xs text-stone-400 mt-1">填写则标记为已完成，保存后会显示为完成时间。</p>
      </div>

      <div id="buffer-group" class="mb-2 hidden">
        <label class="block text-sm font-medium text-stone-700 mb-2">缓冲休息（天）</label>
        <input type="number" id="task-buffer-days" min="-1"
          class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring">
        <p class="text-xs text-stone-400 mt-1">说明：输入 -1 表示当天开始，0 表示次日开始，1 表示后二日开始</p>
        <p id="task-buffer-suggestion" class="text-xs text-stone-400 mt-1"></p>
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-2">稿酬与收款</label>
        <div class="flex gap-2 mb-2">
          <div class="flex-1">
            <input type="number" id="task-payment"
              class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
              placeholder="约定稿酬（可选）" min="0" step="0.01" value="" data-testid="task-payment-input">
          </div>
          <div class="flex-1">
            <select id="task-payment-mode"
              class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
              data-testid="task-payment-mode-select">
              <option value="">收款方式</option>
              <option value="full_pre">全款先付</option>
              <option value="full_post">全款后付</option>
              <option value="deposit">定金+尾款</option>
              <option value="milestone">节点付款</option>
              <option value="free">免费/无偿</option>
            </select>
          </div>
        </div>
        <p class="text-xs text-stone-400 mb-2">不输入约定金额则不显示稿酬信息</p>
        <div id="payment-records-section">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs text-stone-500 font-medium">收款记录</span>
            <div class="flex gap-1">
              <button type="button" id="add-payment-btn"
                class="text-xs px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                data-testid="add-payment-btn">
                <span class="material-icons" style="font-size:12px;vertical-align:-2px;">add</span> 收款
              </button>
              <button type="button" id="add-refund-btn"
                class="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                data-testid="add-refund-btn">
                <span class="material-icons" style="font-size:12px;vertical-align:-2px;">remove</span> 退款
              </button>
            </div>
          </div>
          <div id="payment-records-list" class="space-y-1 max-h-36 overflow-y-auto"></div>
          <div id="payment-records-empty" class="text-xs text-stone-400 text-center py-2">暂无收款记录</div>
        </div>
        <div class="flex items-center gap-2 mt-3 pt-2 border-t border-stone-100">
          <input type="checkbox" id="task-abandoned" class="h-4 w-4 shrink-0" data-testid="task-abandoned-checkbox">
          <label for="task-abandoned" class="text-xs text-stone-500 cursor-pointer">
            标记为废弃（保留记录，从工作量计算中排除）
          </label>
        </div>
        <div id="abandoned-at-row" class="hidden mt-2">
          <label class="block text-xs font-medium text-stone-500 mb-1">废弃时间</label>
          <input type="datetime-local" id="task-abandoned-at"
            class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring text-sm"
            data-testid="task-abandoned-at-input">
          <p class="text-xs text-stone-400 mt-1">记录该任务被废弃的时间，留空则使用当前时间。</p>
        </div>
      </div>

      <div class="mb-4 hidden">
        <label class="block text-sm font-medium text-stone-700 mb-2">实际工时（小时）</label>
        <input type="number" id="task-actual-hours"
          class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
          placeholder="输入实际工时" min="0" value="0" data-testid="task-actual-hours-input">
        <p class="text-xs text-stone-400 mt-1">实际花费的工时，可以超过预计工时</p>
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-2">任务图片（可选）</label>
        <div class="space-y-3">
          <div class="border-2 border-dashed border-stone-300 rounded-lg p-4 text-center hover:border-blue-400 transition-colors"
            id="image-upload-area">
            <input type="file" id="task-image" accept="image/*" class="hidden" data-testid="task-image-input">
            <div id="upload-placeholder">
              <span class="material-icons text-4xl text-stone-400 mb-2">image</span>
              <p class="text-sm text-stone-600">点击或拖拽上传图片</p>
              <p class="text-xs text-stone-400 mt-1">支持 JPG、PNG、GIF 格式</p>
            </div>
            <div id="image-preview-container" class="hidden">
              <div class="relative inline-block">
                <img id="image-preview" class="max-w-full h-32 object-cover rounded-lg" alt="任务图片预览">
                <button type="button" id="remove-image"
                  class="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 transition-colors">
                  <span class="material-icons text-sm">close</span>
                </button>
              </div>
              <p class="text-xs text-stone-500 mt-2">点击重新选择图片</p>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-6 hidden">
        <label class="block text-sm font-medium text-stone-700 mb-2">
          初始进度: <span id="progress-value" class="text-blue-600 font-bold">0%</span>
        </label>
        <input type="range" id="task-progress" min="0" max="100" value="0" class="w-full"
          data-testid="progress-slider">
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-2">任务节点（可选）</label>
        <div class="mb-3">
          <div class="text-xs text-stone-500 mb-2">添加常用节点：</div>
          <div class="flex flex-wrap gap-2" id="preset-nodes"><!-- populated dynamically --></div>
        </div>
        <div id="nodes-container" class="space-y-2">
          <div class="flex gap-2">
            <input type="text"
              class="node-input flex-1 px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
              placeholder="节点名称" data-testid="node-input" data-scrapbook-input-value="">
            <button type="button" id="add-node-btn" data-variant="add-node"
              class="px-3 py-2 rounded-lg transition-colors" data-testid="add-node-btn">
              <span class="material-icons text-sm">add</span>
            </button>
          </div>
          <div id="nodes-list" class="nodes-list-scrollable space-y-1"></div>
        </div>
      </div>
    </div>

    <div class="modal-footer !m-0 !p-6 pt-0">
      <div class="flex gap-3">
        <button id="cancel-btn"
          class="flex-1 px-4 py-2 border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
          data-variant="cancel" data-testid="cancel-btn">
          取消
        </button>
        <button id="save-task-btn" data-variant="save" class="flex-1 px-4 py-2 rounded-lg transition-colors"
          data-testid="save-task-btn">
          保存
        </button>
      </div>
    </div>
  </div>
</div>`;

        // ── #payment-record-modal ──
        const prModalHtml = `
<div id="payment-record-modal" class="fixed inset-0 z-[70] hidden flex items-center justify-center p-4" style="background:rgba(0,0,0,0.4);">
  <div class="bg-white rounded-2xl w-full max-w-xs shadow-2xl">
    <div class="p-5">
      <h3 id="pr-modal-title" class="text-base font-bold text-stone-800 mb-4">添加收款记录</h3>
      <div class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-stone-700 mb-1">金额（元）</label>
          <input type="number" id="pr-amount" min="0" step="0.01"
            class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring text-sm"
            placeholder="0.00">
        </div>
        <div>
          <label class="block text-sm font-medium text-stone-700 mb-1">收款时间</label>
          <input type="datetime-local" id="pr-datetime"
            class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring text-sm">
        </div>
        <div>
          <label class="block text-sm font-medium text-stone-700 mb-1">备注（可选）</label>
          <input type="text" id="pr-note"
            class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring text-sm"
            placeholder="留空可跳过">
        </div>
        <p id="pr-error" class="text-xs text-red-500 hidden">请输入有效金额</p>
      </div>
    </div>
    <div class="px-5 pb-5 flex gap-3">
      <button id="pr-cancel-btn" class="flex-1 px-4 py-2 border border-stone-300 rounded-lg bg-white hover:bg-stone-50 text-sm font-medium">取消</button>
      <button id="pr-confirm-btn" class="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium shadow-sm">确认</button>
    </div>
  </div>
</div>`;

        const wrap1 = document.createElement('div');
        wrap1.innerHTML = taskModalHtml;
        document.body.appendChild(wrap1.firstElementChild);

        const wrap2 = document.createElement('div');
        wrap2.innerHTML = prModalHtml;
        document.body.appendChild(wrap2.firstElementChild);
    }
}

// 暴露给全局
window.TaskModalController = TaskModalController;
