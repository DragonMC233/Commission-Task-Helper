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
        this.tempPauseHistory = [];
        this.editingPauseId = null; // 非 null 表示正在编辑某条暂停记录
        // ── 图片 ──
        // currentImagePath：本次弹窗里新上传、待绑定到任务的图片路径（pic/xxx.png）
        // imageSize：/upload-image 返回的 {w, h}
        // _pendingUploadPath：已上传但任务还没保存的文件，取消编辑时删除
        this.currentImagePath = null;
        this.imageSize = null;
        this.imageChanged = false;
        this._pendingUploadPath = null;
        this._previewObjectUrl = null;
        this._uploading = false; // 图片上传进行中（此时保存会漏掉图片）
        this.pendingTaskId = null; // 新增任务时预生成的 id，供图片文件名使用
        this.deadlineManualOverride = false; // 用户手工修改了工期/截止日期，则优先保留手工值
        // 统计时间衰减半衰期（天）：与 app.js / bar.js 保持一致
        // 注意：分位数是「取某个具体样本值」的跳跃式统计，权重只能微调排列位置，
        // 样本量 < 15 时调整本参数几乎不会改变结果 —— 别指望靠它解决「旧数据过时」
        this.statisticsHalfLifeDays = 365;

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
                await this.onCancel();
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
            this.deadlineManualOverride = true;
            this.syncDeadlineToEstimatedDays();
            this.syncDeadlineGuards();
        });
        if (estimatedDaysInput) estimatedDaysInput.addEventListener("input", () => {
            this.deadlineManualOverride = true;
            this.syncEstimatedDaysToDeadline();
        });
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
        // 暂停记录按钮
        const addPauseBtn = document.getElementById("add-pause-record-btn");
        if (addPauseBtn) addPauseBtn.addEventListener("click", () => this.savePauseRecord());
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
        this.deadlineManualOverride = false;

        // 渲染动态内容
        this.renderPresetNodeButtons();
        this.renderTaskTypeOptions();
        this.renderSourceOptions();

        const depRadios = document.querySelectorAll('input[name="task-dependency"]');
        const selectLine = document.getElementById("task-line-task");
        const autoScheduleEl = document.getElementById("task-auto-schedule");
        const urgentEl = document.getElementById("task-urgent");
        const autoCalcEndEl = document.getElementById("task-auto-calc-end");
        const bufferEl = document.getElementById("task-buffer-days");
        const actualStartEl = document.getElementById("task-actual-starttime");

        const setDepRadio = (val) => {
            depRadios.forEach((r) => { r.checked = r.value === val; });
        };
        // 文件里存的是 ISO UTC，输入框里显示访问者本地时区的时间。
        // datetime-local 不接受纯日期，纯日期任务回填时补 00:00，否则输入框会被清空
        const toLocal = (v) => (v ? this.formatDateTimeLocal(v) : "");

        if (taskId) {
            // ═══ 编辑任务 ═══
            const task = this.dataSource.getTask(taskId);
            if (!task) return;

            modalTitle.textContent = "编辑任务";
            saveBtn.textContent = "更新";

            document.getElementById("task-name").value = task.name;
            if (urgentEl) urgentEl.checked = !!task.urgentA;
            document.getElementById("task-starttime").value = toLocal(
                task.startTime || task.starttime || task.startDate || task.deadline || ""
            );
            document.getElementById("task-deadline").value = toLocal(task.deadline || "");
            document.getElementById("task-completed-at").value = toLocal(task.completedAt || "");
            document.getElementById("task-hours").value = task.estimatedHours || 8;
            const estDaysEl = document.getElementById("task-estimated-days");
            if (estDaysEl) {
                if (Number.isFinite(task.estimatedDay) && task.estimatedDay >= 0) {
                    estDaysEl.value = task.estimatedDay;
                } else {
                    // 从 startTime 和 deadline 推算（使用按日期差口径，允许 0）
                    const s = window.taskTime.parseOrInvalid(task.startTime || task.starttime || task.startDate);
                    const e = window.taskTime.parseOrInvalid(task.deadline);
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
            // 收支记录
            this.tempPaymentRecords = Array.isArray(task.paymentRecords)
              ? JSON.parse(JSON.stringify(task.paymentRecords)) : [];
            this.renderPaymentRecords();
            // 暂停历史
            this.tempPauseHistory = Array.isArray(task.pauseHistory)
              ? JSON.parse(JSON.stringify(task.pauseHistory)) : [];
            this.editingPauseId = null;
            this.renderPauseHistory();
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
            this.updateDeadlineSuggestion();
            this.syncDeadlineGuards();

            // 节点
            this.tempNodes = task.nodes ? [...task.nodes] : [];
            this.renderNodes();

            // 图片 — 旧图只用于预览，不写入 currentImagePath
            this.currentImagePath = null;
            this.imageSize = null;
            this.imageChanged = false;
            this._pendingUploadPath = null;
            if (task.image) {
                // 明确标记「未被移除」，否则上一个任务的 cleared 状态会串过来
                const uploadAreaEl = document.getElementById("image-upload-area");
                if (uploadAreaEl) uploadAreaEl.dataset.cleared = "false";
                this.showImagePreview(task.image);
            } else {
                this.resetImageUpload();
            }
        } else {
            // ═══ 添加新任务 ═══
            modalTitle.textContent = "添加新任务";
            saveBtn.textContent = "保存";

            document.getElementById("task-name").value = "";
            if (urgentEl) urgentEl.checked = false;
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
            // 收款方式、收支记录、废弃状态重置
            const paymentModeElNew = document.getElementById("task-payment-mode");
            if (paymentModeElNew) paymentModeElNew.value = "";
            this.tempPaymentRecords = [];
            this.renderPaymentRecords();
            this.tempPauseHistory = [];
            this.editingPauseId = null;
            this.renderPauseHistory();
            const abandonedElNew = document.getElementById("task-abandoned");
            if (abandonedElNew) abandonedElNew.checked = false;
            const abandonedAtRowNew = document.getElementById("abandoned-at-row");
            const abandonedAtInputNew = document.getElementById("task-abandoned-at");
            if (abandonedAtRowNew) abandonedAtRowNew.classList.add("hidden");
            if (abandonedAtInputNew) abandonedAtInputNew.value = "";
            document.getElementById("task-progress").value = 0;
            document.getElementById("progress-value").textContent = "0%";

            // 初始化时计算并显示建议
            this.updateDeadlineSuggestion();
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
            // 新增任务：预生成 id，图片上传时用它做文件名，保存时复用同一个 id
            this.pendingTaskId = Date.now();
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
        this.currentImagePath = null;
        this.imageSize = null;
        this.deadlineManualOverride = false;
        // 走到这里说明本次编辑结束且没把图挂到任务上 → 删掉刚上传的临时图
        this._discardPendingUpload();
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
                // 任务已落库，本次上传的图已产生引用，不再算临时文件
                this._pendingUploadPath = null;
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

        // 图片还在上传就保存，会把刚选的图漏掉，等它传完再存
        if (this._uploading) {
            this.showMessage("图片还在上传，请稍候再保存");
            return null;
        }

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
        // 输入框里是访问者本地的时间，先转成 ISO UTC，后续计算与写盘都用 UTC
        let starttime = window.taskTime.formatForStorage(getVal("task-starttime"));
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
        const actualStartTime = window.taskTime.formatForStorage(getVal("task-actual-starttime")) || null;
        // 加急：手动勾选框与链式自动推导共用 urgentA 这一个状态
        const urgentA = getBool("task-urgent");
        const estimatedHours = parseInt(document.getElementById("task-hours")?.value) || 8;
        const estimatedDayRaw = parseInt(document.getElementById("task-estimated-days")?.value, 10);
        const estimatedDay = Number.isFinite(estimatedDayRaw) && estimatedDayRaw >= 0 ? estimatedDayRaw : 0;

        // 正在编辑的任务：链式重算时用来保留它自己写的时分
        const editingTask = this.editingTaskId ? this.dataSource.getTask(this.editingTaskId) : null;

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
            const autoStart = this.computeAutoStartTime(lineTaskId, bufferToUse, editingTask);
            if (autoStart) starttime = autoStart;
        }

        let deadline = window.taskTime.formatForStorage(getVal("task-deadline"));
        if (autoCalcEnd && !this.deadlineManualOverride) {
            // urgentA 任务：截止日期基于实际开始时间；普通任务：基于计划开始时间
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
        const pauseHistory = [...(this.tempPauseHistory || [])];
        const totalPausedDays = pauseHistory.reduce((sum, r) => {
            const s = window.taskTime.parseOrInvalid(r.pausedAt), e = window.taskTime.parseOrInvalid(r.resumedAt);
            if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
                return sum + (e - s) / 86400000;
            }
            return sum;
        }, 0);
        const abandoned = getBool("task-abandoned");
        const existingTask = this.editingTaskId ? this.dataSource.getTask(this.editingTaskId) : null;
        const abandonedAtInputVal = document.getElementById("task-abandoned-at")?.value;
        const abandonedAt = abandoned
          ? (abandonedAtInputVal ? window.taskTime.parseOrInvalid(abandonedAtInputVal).toISOString() : (existingTask?.abandonedAt || new Date().toISOString()))
          : null;

        // 图片处理
        let image = null;
        const uploadArea = document.getElementById("image-upload-area");
        if (uploadArea && uploadArea.dataset.cleared === "true") {
            image = null;
        } else if (this.imageChanged && this.currentImagePath) {
            image = this.currentImagePath;
        } else if (this.editingTaskId) {
            // 保留原图
            const orig = this.dataSource.getTask(this.editingTaskId);
            image = orig ? orig.image : null;
        }

        // 输入框里是访问者本地的时间，和 startTime / actualStartTime 一样先转 ISO UTC 再写盘
        const completedAt = window.taskTime.formatForStorage(completedAtInput) || null;

        const task = {
            id: this.editingTaskId || this.pendingTaskId || Date.now(),
            name,
            type,
            source,
            progress,
            startTime: starttime,
            deadline,
            completedAt,
            estimatedHours,
            payment,
            paymentMode: paymentMode || null,
            paymentRecords,
            pauseHistory,
            totalPausedDays,
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
            urgentA,
        };

        // 手动取消加急：记下这组判定值，避免自动推导马上又把「是否确认加急」弹回来
        if (!urgentA && editingTask && editingTask.urgentA && window.taskChain) {
            task.accelerateDismissedFor = window.taskChain.accelerateSignature(task);
        }

        // 若任务已完成，则将所有节点标记为已完成
        if (task.completed && task.nodes) {
            task.nodes.forEach((n) => (n.completed = true));
        }

        // 新上传的图片带上真实尺寸（替换旧图时一并覆盖）
        if (this.imageChanged && this.currentImagePath && this.imageSize) {
            task.w = this.imageSize.w;
            task.h = this.imageSize.h;
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
            const dA = a.deadline ? window.taskTime.parseOrInvalid(a.deadline).getTime() : 0;
            const dB = b.deadline ? window.taskTime.parseOrInvalid(b.deadline).getTime() : 0;
            if (dA !== dB) return dB - dA; // 截止日期倒序
            const sA = a.startTime || a.starttime || a.startDate || "";
            const sB = b.startTime || b.starttime || b.startDate || "";
            return (window.taskTime.parseOrInvalid(sB).getTime() || 0) - (window.taskTime.parseOrInvalid(sA).getTime() || 0);
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
                const dl = t.deadline ? `（截止：${window.taskTime.formatDate(t.deadline)}）` : "";
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
                const editingTask = this.editingTaskId ? this.dataSource.getTask(this.editingTaskId) : null;
                const computed = pid ? this.computeAutoStartTime(pid, bufferToUse, editingTask) : null;
                // computeAutoStartTime 返回存储格式（ISO UTC），输入框只接受本地 datetime-local 格式
                if (computed) startInput.value = this.formatDateTimeLocal(computed);
                const lock = !!pid; // 无前序时允许手动编辑
                startInput.readOnly = lock;
                startInput.classList.toggle("bg-stone-50", lock);
                // 更新建议截止与建议工期提示
                this.updateDeadlineSuggestion();
                this.syncDeadlineGuards();
            } else {
                startInput.readOnly = false;
                startInput.classList.remove("bg-stone-50");
                this.syncDeadlineGuards();
            }
        };
        applyAuto();

        // 更新选择按钮的视觉高亮 (使用 dep-selected CSS 类)
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
    }

    // ═══════════════════════════════════════
    // 自动计算开始时间
    // 对标 app.js computeAutoStartTime
    // ═══════════════════════════════════════
    computeAutoStartTime(predecessorId, bufferDays = 1, childTask = null) {
        const tasks = this.dataSource.getTasks ? this.dataSource.getTasks() : [];
        const prev = tasks.find((t) => t.id === predecessorId);
        if (!prev) return null;
        const endBase = prev.completedAt || prev.deadline;
        if (!endBase) return null;
        let base = window.taskTime.parseOrInvalid(endBase);
        if (Number.isNaN(base.getTime())) return null;

        // 若前序任务尚未完成且其 deadline 已过，则以"今日"为基准，但保留 deadline 的时分
        const todayDate = window.taskTime.today();
        if (!prev.completedAt && prev.deadline) {
            const dl = window.taskTime.parseOrInvalid(prev.deadline);
            if (!Number.isNaN(dl.getTime()) && dl < todayDate) {
                const dp = window.taskTime.parts(dl);
                const tp = window.taskTime.parts(todayDate);
                base = window.taskTime.make(tp.year, tp.month, tp.day, dp.hour, dp.minute, dp.second);
            }
        }

        // bufferDays 语义: -1 => 当天, 0 => 次日, 1 => 后二日
        const rawProvided = Number.isFinite(Number(bufferDays)) ? Math.round(Number(bufferDays)) : null;
        const raw = rawProvided === null ? 1 : Math.max(rawProvided, -1);
        base.setDate(base.getDate() + raw + 1);

        // 链式重排只决定「从哪一天开始」，不重新决定「几点开始」。
        // 时分优先级：子任务自己已有的 → 前序基准的 → 纯日期
        const childRaw = childTask ? childTask.startTime || childTask.starttime : "";
        let tod = null;
        if (childRaw && window.taskTime.hasExplicitTime(childRaw)) tod = window.taskTime.parts(childRaw);
        else if (window.taskTime.hasExplicitTime(endBase)) tod = window.taskTime.parts(base);

        if (!tod) return window.taskTime.formatDate(base);
        const bp = window.taskTime.parts(base);
        return window.taskTime.formatForStorage(
            window.taskTime.make(bp.year, bp.month, bp.day, tod.hour, tod.minute, tod.second)
        );
    }

    // ═══════════════════════════════════════
    // 工期 ↔ 截止日期 双向联动
    // ═══════════════════════════════════════

    /** 工期输入 → 自动计算截止日期 */
    syncEstimatedDaysToDeadline() {
        const startInput = document.getElementById("task-starttime");
        const daysInput = document.getElementById("task-estimated-days");
        const deadlineInput = document.getElementById("task-deadline");
        if (!startInput || !daysInput || !deadlineInput) return;

        const days = parseInt(daysInput.value);
        const startVal = startInput.value;
        if (!Number.isFinite(days) || days < 0 || !startVal) return;

        const start = window.taskTime.parseOrInvalid(startVal);
        if (isNaN(start.getTime())) return;

        const existingDeadline = deadlineInput.value ? window.taskTime.parseOrInvalid(deadlineInput.value) : null;
        const timeSource =
            existingDeadline && !isNaN(existingDeadline.getTime()) ? existingDeadline : start;

        const end = window.taskTime.parseOrInvalid(start);
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

        const start = window.taskTime.parseOrInvalid(startVal);
        const end = window.taskTime.parseOrInvalid(deadlineVal);
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
        const start = startVal ? window.taskTime.parseOrInvalid(startVal) : null;
        const end = deadlineVal ? window.taskTime.parseOrInvalid(deadlineVal) : null;
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
        // 分位数需要更多样本才有意义（n<4 时 P25 与 P50 会重合）
        const MIN_SAMPLES_FOR_QUANTILE = 4;

        // 计算并显示预计工期 (优先使用实际开始时间)
        const days = this.computeSuggestedRequireDays(preferredStart, hours, type);
        const autoEndRaw = preferredStart ? this.computeAutoDeadline(preferredStart, hours, type) : null;

        // 格式化建议截止日期
        let autoEndPretty = null;
        if (autoEndRaw) {
            const dt = window.taskTime.parseOrInvalid(autoEndRaw);
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

        // 仅显示参考工时（完整的分位 / 价格 / 费率分析见左侧「工时稿价分析」面板）
        const hoursSuggEl = document.getElementById("task-hours-suggestion");
        if (hoursSuggEl) {
            const stats = this.getTypeWeightedStats(type);
            const n = stats && Number.isFinite(stats.quantileSampleCount) ? stats.quantileSampleCount : 0;
            const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
            if (n < MIN_SAMPLES_FOR_QUANTILE) {
                hoursSuggEl.textContent = `参考工时 x（数据积累中，已有 ${n} 单）`;
            } else {
                hoursSuggEl.textContent =
                    `参考工时 ${round1(stats.hoursP25)} ~ ${round1(stats.hoursP75)} h（典型 ${round1(stats.hoursP50)} h）`;
            }
        }

        // 计算并显示历史平均缓冲天数
        //const bufSuggEl = document.getElementById("task-buffer-suggestion");
        //if (bufSuggEl) {
        //    const bufStats = this.computeTypeAvgBufferDays(type);
        //    if (bufStats && Number.isFinite(bufStats.avgBufferDays) && bufStats.sampleCount >= MIN_SAMPLES_FOR_SUGGESTION) {
        //        bufSuggEl.textContent = `历史平均休息 ${Math.max(0, Math.round(bufStats.avgBufferDays))} 天`;
        //    } else {
        //        bufSuggEl.textContent = `历史平均休息 x 天`;
            //}
        //}

        // 如果启用了统计数据计算截止且建议可用，则填回截止输入框并同步工期
        // urgentA 任务：截止日期基于实际开始时间计算；普通任务：基于计划开始时间
        const editingTask = this.editingTaskId ? this.dataSource.getTask(this.editingTaskId) : null;
        const isUrgentA = !!(editingTask && editingTask.urgentA && actualStartVal);
        const fillBase = isUrgentA ? actualStartVal : startVal;
        const autoEndForFill = fillBase ? this.computeAutoDeadline(fillBase, hours, type) : null;
        if (autoCalcEndEl && autoCalcEndEl.checked && fillBase && autoEndForFill) {
            this.deadlineManualOverride = false;
            // computeAutoDeadline 返回存储格式（ISO UTC），输入框只接受本地 datetime-local 格式
            if (deadlineEl) deadlineEl.value = this.formatDateTimeLocal(autoEndForFill);
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
                    ...this._computeQuantileStats(entry.samples),
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

    /**
     * 时间衰减加权分位数：按值升序累积权重，取首次达到 q*W 的样本值。
     * 权重 w = 0.5^(距今 / 半衰期 365 天) —— 委托约半年到一年开一次，故半衰期取一年。
     */
    _weightedQuantile(pairs, q) {
        const sorted = (Array.isArray(pairs) ? pairs : [])
            .slice()
            .sort((a, b) => a.value - b.value);
        let total = 0;
        sorted.forEach((p) => { total += p.weight; });
        if (total <= 0) return null;
        let acc = 0;
        for (const p of sorted) {
            acc += p.weight;
            if (acc >= q * total - 1e-9) return p.value;
        }
        return sorted.length ? sorted[sorted.length - 1].value : null;
    }

    /**
     * 近期体感统计：参考工时 / 参考价格 / 费率。
     * 费率由「中位价格 ÷ 中位工时」反推，保证 价格 = 工时 × 费率 恒等自洽。
     */
    _computeQuantileStats(samples) {
        const empty = {
            hoursP25: null, hoursP375: null, hoursP50: null, hoursP75: null,
            priceP25: null, priceP375: null, priceP50: null, priceP75: null,
            rate: null, rateCheck: null,
            quantileSampleCount: 0, pricedSampleCount: 0,
        };
        const now = Date.now();
        const rows = [];
        (Array.isArray(samples) ? samples : []).forEach((s) => {
            if (!s) return;
            const hours = Number(s.hours);
            if (!Number.isFinite(hours) || hours <= 0) return;
            const endMs = window.taskTime.parseOrInvalid(s.completedAt).getTime();
            const ageDays = Number.isFinite(endMs)
                ? Math.max(0, (now - endMs) / 86400000)
                : 0;
            const payment = Number(s.payment);
            rows.push({
                hours,
                weight: Math.pow(0.5, ageDays / this.statisticsHalfLifeDays),
                payment: Number.isFinite(payment) && payment > 0 ? payment : null,
            });
        });
        if (rows.length === 0) return empty;
        const priced = rows.filter((r) => r.payment !== null);
        const hoursPairs = rows.map((r) => ({ value: r.hours, weight: r.weight }));
        const pricePairs = priced.map((r) => ({ value: r.payment, weight: r.weight }));
        const hoursP25 = this._weightedQuantile(hoursPairs, 0.25);
        const hoursP375 = this._weightedQuantile(hoursPairs, 0.375);
        const hoursP50 = this._weightedQuantile(hoursPairs, 0.5);
        const hoursP75 = this._weightedQuantile(hoursPairs, 0.75);
        const priceP25 = this._weightedQuantile(pricePairs, 0.25);
        const priceP375 = this._weightedQuantile(pricePairs, 0.375);
        const priceP50 = this._weightedQuantile(pricePairs, 0.5);
        const priceP75 = this._weightedQuantile(pricePairs, 0.75);
        return {
            hoursP25, hoursP375, hoursP50, hoursP75,
            priceP25, priceP375, priceP50, priceP75,
            rate: hoursP50 && priceP50 ? priceP50 / hoursP50 : null,
            // 交叉校验：单均时薪的加权中位数；与 rate 偏差过大说明价格与工时脱钩
            rateCheck: this._weightedQuantile(
                priced.map((r) => ({ value: r.payment / r.hours, weight: r.weight })), 0.5),
            quantileSampleCount: rows.length,
            pricedSampleCount: priced.length,
        };
    }

    /** 从已完成任务动态计算加权统计 */
    _computeWeightedStatsFromTasks(taskType) {
        if (!this.dataSource.getTasks) return { sampleCount: 0 };
        const tasks = this.dataSource.getTasks();

        const completed = tasks.filter((t) =>
            t && t.completed && t.completedAt && t.type === taskType
        ).sort((a, b) => window.taskTime.parseOrInvalid(b.completedAt) - window.taskTime.parseOrInvalid(a.completedAt))
            .slice(0, 10);

        let sumDaily = 0, sumDays = 0, sumHours = 0, weightSum = 0;
        const collected = [];

        completed.forEach((t, idx) => {
            const start = t.actualStartTime || t.startTime || t.starttime || t.startDate || t.deadline;
            const end = t.completedAt;
            if (!start || !end) return;

            const s = window.taskTime.parseOrInvalid(start);
            const e = window.taskTime.parseOrInvalid(end);
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
            collected.push({ hours, payment: Number(t.payment), completedAt: t.completedAt });
        });

        if (weightSum === 0) return { sampleCount: 0 };
        return {
            avgDailyHours: sumDaily / weightSum,
            avgRequireDays: sumDays / weightSum,
            avgCompletedHours: sumHours / weightSum,
            ...this._computeQuantileStats(collected),
            sampleCount: completed.length,
        };
    }

    computeTypeAvgBufferDays(taskType) {
        if (!this.dataSource.getTasks) return { avgBufferDays: null, sampleCount: 0 };
        const tasks = this.dataSource.getTasks();

        const completed = tasks
            .filter((t) => t && t.completed && t.completedAt && t.type === taskType)
            .sort((a, b) => window.taskTime.parseOrInvalid(b.completedAt) - window.taskTime.parseOrInvalid(a.completedAt))
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
                const aStart = window.taskTime.parseOrInvalid(a.actualStartTime || a.startTime || a.starttime || a.startDate).getTime() || 0;
                const bStart = window.taskTime.parseOrInvalid(b.actualStartTime || b.startTime || b.starttime || b.startDate).getTime() || 0;
                return aStart - bStart;
            });
            const succ = successors[0];
            const sTimeRaw = succ.actualStartTime || succ.startTime || succ.starttime || succ.startDate;
            const endRaw = t.completedAt;
            if (!sTimeRaw || !endRaw) return;

            const sTime = window.taskTime.parseOrInvalid(sTimeRaw);
            const end = window.taskTime.parseOrInvalid(endRaw);
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
        const start = window.taskTime.parseOrInvalid(startTime);
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
        const start = window.taskTime.parseOrInvalid(startTime);
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

        // 默认截止时刻就是当天 23:59：没手动写截止时间时按「当天结束」算。
        // 按小时交付的平台（米画师等）由用户手动填具体时刻，不走这里。
        // 「N 天后」按访问者本地日历算，结果转成 ISO UTC 存储。与 app.js 保持一致。
        const time = window.taskTime;
        const p = time.parts(start);
        return time.formatForStorage(time.make(p.year, p.month, p.day + requireDays, 23, 59, 0));
    }

    // ═══════════════════════════════════════
    // 收支记录管理 (paymentRecords)
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
            const date = datetimeVal ? datetimeVal.slice(0, 10) : window.taskTime.formatDate(new Date());
            const note = noteEl?.value.trim() || "";
            if (!this.tempPaymentRecords) this.tempPaymentRecords = [];
            this.tempPaymentRecords.push({ id: Date.now(), type, amount, date, note });
            this.renderPaymentRecords();
            cleanup();
        };
    }

    // ═══════════════════════════════════════
    // 暂停历史记录管理 (pauseHistory)
    // ═══════════════════════════════════════
    renderPauseHistory() {
        const list = document.getElementById("pause-history-list");
        const empty = document.getElementById("pause-history-empty");
        if (!list) return;
        const records = this.tempPauseHistory || [];
        if (records.length === 0) {
            list.innerHTML = "";
            if (empty) empty.style.display = "";
            return;
        }
        if (empty) empty.style.display = "none";
        const fmt = (v) => {
            if (!v) return "";
            const d = window.taskTime.parseOrInvalid(v);
            return isNaN(d.getTime()) ? "" :
                `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
        };
        list.innerHTML = records.map((r, i) => {
            return `<div class="flex items-center justify-between px-2 py-1 rounded border border-amber-100 bg-amber-50 text-xs gap-2">
              <span class="text-stone-600 flex-1 truncate">${fmt(r.pausedAt)}</span>
              <span class="text-stone-400">—</span>
              <span class="text-stone-600 flex-1 truncate">${fmt(r.resumedAt)}</span>
              <button type="button" data-edit-pause-id="${i}" class="text-stone-400 hover:text-amber-600 shrink-0" title="编辑">
                <span class="material-icons" style="font-size:14px;vertical-align:-3px;">edit</span>
              </button>
              <button type="button" data-remove-pause-id="${i}" class="text-stone-400 hover:text-red-500 shrink-0" title="删除">
                <span class="material-icons" style="font-size:14px;vertical-align:-3px;">close</span>
              </button>
            </div>`;
        }).join("");
        // 绑定删除事件
        list.querySelectorAll("[data-remove-pause-id]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const idx = Number(btn.dataset.removePauseId);
                this.tempPauseHistory = (this.tempPauseHistory || []).filter((_, i) => i !== idx);
                if (this.editingPauseId === idx) this.clearPauseInputs();
                else if (this.editingPauseId !== null && this.editingPauseId > idx) this.editingPauseId--;
                this.renderPauseHistory();
            });
        });
        // 绑定编辑事件
        list.querySelectorAll("[data-edit-pause-id]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const idx = Number(btn.dataset.editPauseId);
                const r = (this.tempPauseHistory || [])[idx];
                if (!r) return;
                const sEl = document.getElementById("pause-start-input");
                const eEl = document.getElementById("pause-end-input");
                if (sEl) sEl.value = this.formatDateTimeLocal(r.pausedAt);
                if (eEl) eEl.value = this.formatDateTimeLocal(r.resumedAt);
                this.editingPauseId = idx;
                this.updatePauseActionButton();
            });
        });
    }

    clearPauseInputs() {
        const sEl = document.getElementById("pause-start-input");
        const eEl = document.getElementById("pause-end-input");
        const errEl = document.getElementById("pause-record-error");
        if (sEl) sEl.value = "";
        if (eEl) eEl.value = "";
        if (errEl) errEl.classList.add("hidden");
        this.editingPauseId = null;
        this.updatePauseActionButton();
    }

    updatePauseActionButton() {
        const btn = document.getElementById("add-pause-record-btn");
        if (!btn) return;
        const icon = btn.querySelector(".material-icons");
        if (this.editingPauseId !== null) {
            if (icon) icon.textContent = "check";
            btn.className = "shrink-0 p-2 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors flex items-center justify-center";
            btn.title = "更新暂停记录";
        } else {
            if (icon) icon.textContent = "add";
            btn.className = "shrink-0 p-2 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors flex items-center justify-center";
            btn.title = "添加暂停记录";
        }
    }

    savePauseRecord() {
        const sEl = document.getElementById("pause-start-input");
        const eEl = document.getElementById("pause-end-input");
        const errEl = document.getElementById("pause-record-error");
        const pausedAt = sEl?.value || "";
        const resumedAt = eEl?.value || "";
        if (!pausedAt || !resumedAt) {
            if (errEl) errEl.classList.remove("hidden");
            return;
        }
        // 验证：结束时间必须晚于开始时间
        if (window.taskTime.parseOrInvalid(resumedAt) <= window.taskTime.parseOrInvalid(pausedAt)) {
            if (errEl) { errEl.textContent = "暂停结束时间必须晚于暂停开始时间"; errEl.classList.remove("hidden"); }
            return;
        }
        if (errEl) errEl.classList.add("hidden");
        const record = {
            pausedAt: window.taskTime.parseOrInvalid(pausedAt).toISOString(),
            resumedAt: window.taskTime.parseOrInvalid(resumedAt).toISOString(),
        };
        if (!this.tempPauseHistory) this.tempPauseHistory = [];
        if (this.editingPauseId !== null) {
            this.tempPauseHistory[this.editingPauseId] = record;
        } else {
            this.tempPauseHistory.push(record);
        }
        this.clearPauseInputs();
        this.renderPauseHistory();
    }

    // ═══════════════════════════════════════
    // 图片上传
    // 选中文件 → 立即上传到 /upload-image → 拿回 pic/xxx.png 与宽高
    // ═══════════════════════════════════════
    bindImageUploadEvents() {
        const input = document.getElementById("task-image");
        if (!input) return;

        input.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) this._uploadImage(file);
        });

        // 拖拽上传：整块虚线区域都接收图片
        const uploadArea = document.getElementById("image-upload-area");
        if (uploadArea) {
            const setDragging = (dragging) => {
                uploadArea.classList.toggle("border-blue-400", dragging);
                uploadArea.classList.toggle("bg-blue-50", dragging);
            };

            uploadArea.addEventListener("dragover", (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                setDragging(true);
            });
            uploadArea.addEventListener("dragleave", (e) => {
                // 在子元素之间移动时不算离开
                if (uploadArea.contains(e.relatedTarget)) return;
                setDragging(false);
            });
            uploadArea.addEventListener("drop", (e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (!file) return;
                if (!file.type.startsWith("image/")) {
                    this.showMessage("只能上传图片文件");
                    return;
                }
                this._uploadImage(file);
            });
        }

        // 点击虚线区域任意位置都能选图（已有预览时即为重新选图，删除按钮除外）
        uploadArea?.addEventListener("click", (e) => {
            if (e.target.closest("#remove-image")) return;
            input.click();
        });
        document.getElementById("remove-image")?.addEventListener("click", () => this.resetImageUpload());
    }

    /** 上传图片：先用本地 blob 立刻预览，上传成功后换成服务器路径 */
    async _uploadImage(file) {
        this._revokePreviewObjectUrl();
        this._previewObjectUrl = URL.createObjectURL(file);
        this.showImagePreview(this._previewObjectUrl);
        this._uploading = true;

        const taskId = this.editingTaskId || this.pendingTaskId || Date.now();
        try {
            const form = new FormData();
            form.append("file", file, file.name);
            form.append("taskId", String(taskId));
            const nameEl = document.getElementById("task-name");
            const taskName = nameEl ? nameEl.value.trim() : "";
            if (taskName) form.append("taskName", taskName);

            const res = await fetch("/upload-image", { method: "POST", body: form });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            // 换图时先丢掉上一张还没落库的临时图
            this._discardPendingUpload();
            this._pendingUploadPath = data.path;
            this.currentImagePath = data.path;
            this.imageSize = { w: data.w, h: data.h };
            this.imageChanged = true;
            const uploadArea = document.getElementById("image-upload-area");
            if (uploadArea) uploadArea.dataset.cleared = "false";
            this.showImagePreview(data.path);
        } catch (err) {
            console.warn("图片上传失败", err);
            this.showMessage("图片上传失败，请重试");
            this.resetImageUpload();
        } finally {
            this._uploading = false;
            this._revokePreviewObjectUrl();
        }
    }

    _revokePreviewObjectUrl() {
        if (this._previewObjectUrl) {
            URL.revokeObjectURL(this._previewObjectUrl);
            this._previewObjectUrl = null;
        }
    }

    /** 删除本次弹窗上传、但任务还没保存因而没有任何引用的图片 */
    _discardPendingUpload() {
        const path = this._pendingUploadPath;
        this._pendingUploadPath = null;
        if (!path) return;
        fetch("/delete-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path }),
        }).catch((e) => console.warn("删除临时图片失败（会由回收宽限期兜底）", e));
    }

    showImagePreview(src) {
        const container = document.getElementById("image-preview-container");
        const preview = document.getElementById("image-preview");
        const placeholder = document.getElementById("upload-placeholder");

        if (container && preview && placeholder) {
            preview.src = window.taskUtils.resolveImageSrc(src);
            container.classList.remove("hidden");
            placeholder.classList.add("hidden");
        }
    }

    resetImageUpload() {
        const input = document.getElementById("task-image");
        if (input) input.value = "";

        this._discardPendingUpload();
        this._revokePreviewObjectUrl();
        this.currentImagePath = null;
        this.imageSize = null;
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

    /** 存储值 → 输入框显示值（本地时区）。只用于回填表单，不要拿它生成写盘数据 */
    formatDateTimeLocal(dateStr) {
        if (!dateStr) return "";
        return window.taskTime.formatDateTime(dateStr);
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
        <div class="flex items-center justify-between text-sm font-medium text-stone-700 mb-1">
          <label for="task-name">任务名称</label>
          <!-- 加急：读写链式同款 urgentA，自动推导（实际开始早于计划）与手工勾选控制的是同一个状态 -->
          <div id="task-urgent-wrap" class="inline-flex items-center gap-2">
            <label for="task-urgent" class="text-sm text-stone-700 cursor-pointer select-none">加急</label>
            <label class="inline-flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" id="task-urgent" class="h-4 w-4" data-testid="task-urgent-checkbox">
            </label>
          </div>
        </div>
        <input type="text" id="task-name"
          class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
          placeholder="输入任务名称" data-testid="task-name-input" data-scrapbook-input-value="">
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-1">任务类型</label>
        <div class="space-y-2" id="task-type-options"><!-- populated dynamically --></div>
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-1">来源平台</label>
        <div class="space-y-2" id="task-source-options"><!-- populated dynamically --></div>
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-1">排单模式</label>
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

      <div class="mb-3 hidden" id="line-task-group">
        <label class="block text-sm font-medium text-stone-700 mb-1">绑定前序任务</label>
        <select id="task-line-task" class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"></select>
        <p class="text-xs text-stone-400 mt-1">按截止日期倒序排列，可选择未开始的任务。</p>
      </div>

      <div class="mb-4">
        <label class="flex items-center justify-between text-sm font-medium text-stone-700 mb-1">
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

      <div class="mb-3">
        <div class="flex gap-3">
          <div class="flex-1">
            <label class="block text-sm font-medium text-stone-700 mb-1">预计工期（天）</label>
            <input type="number" id="task-estimated-days"
              class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
              placeholder="工期" min="0" value="" data-testid="task-estimated-days-input">
          </div>
          <div class="flex-1">
            <label class="block text-sm font-medium text-stone-700 mb-1">预计工时（小时）</label>
            <input type="number" id="task-hours"
              class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
              placeholder="工时" min="1" value="8" data-testid="task-hours-input">
          </div>
        </div>
        <p id="task-hours-suggestion" class="text-xs text-stone-400 mt-1"></p>
      </div>

      <div class="mb-3">
        <label class="flex items-center justify-between text-sm font-medium text-stone-700 mb-1">
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

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-1">实际开始时间（可选）</label>
        <input type="datetime-local" id="task-actual-starttime"
          class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring">
      </div>

      <div class="mb-3">
        <label class="block text-sm font-medium text-stone-700 mb-1">完成时间（可选）</label>
        <input type="datetime-local" id="task-completed-at"
          class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
          data-testid="task-completed-at-input" placeholder="留空表示未完成">
        <p class="text-xs text-stone-400 mt-1">填写则标记为已完成，保存后会显示为完成时间。</p>
      </div>

      <div id="buffer-group" class="mb-3 hidden">
        <label class="block text-sm font-medium text-stone-700 mb-1">缓冲休息（天）</label>
        <input type="number" id="task-buffer-days" min="-1"
          class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring">
        <p class="text-xs text-stone-400 mt-1">输入 -1 表示下一任务当天开始，0 表示明天开始，1 表示后天开始</p>
        <p id="task-buffer-suggestion" class="text-xs text-stone-400 mt-1"></p>
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-1">稿酬与收款</label>
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
        <p class="text-xs text-stone-400 mb-1">不输入约定金额则不显示稿酬信息</p>
        <div id="payment-records-section">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs text-stone-500 font-medium">收支记录</span>
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
          <div id="payment-records-empty" class="text-xs text-stone-400 text-center py-2">暂无收支记录</div>
        </div>
      </div>

      <div id="pause-history-section" class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-1">历史暂停记录</label>
        <div id="pause-history-list" class="space-y-1 max-h-36 overflow-y-auto mb-2"></div>
        <div id="pause-history-empty" class="text-xs text-stone-400 text-center py-2">暂无暂停记录</div>
        <div class="flex gap-2 mb-1">
          <span class="flex-1 text-xs text-stone-500">新增暂停开始时间</span>
          <span class="flex-1 text-xs text-stone-500">暂停结束时间</span>
        </div>
        <div class="flex gap-2 items-center">
          <input type="datetime-local" id="pause-start-input"
            class="flex-1 px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring text-sm"
            data-testid="pause-start-input">
          <input type="datetime-local" id="pause-end-input"
            class="flex-1 px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring text-sm"
            data-testid="pause-end-input">
          <button type="button" id="add-pause-record-btn"
            class="shrink-0 p-2 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors flex items-center justify-center"
            data-testid="add-pause-record-btn">
            <span class="material-icons text-sm">add</span>
          </button>
        </div>
        <p id="pause-record-error" class="text-xs text-red-500 hidden mt-1">请填写完整的暂停开始和结束时间</p>
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-1">废弃状态</label>
        <div class="flex items-center gap-2">
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
        <label class="block text-sm font-medium text-stone-700 mb-1">实际工时（小时）</label>
        <input type="number" id="task-actual-hours"
          class="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
          placeholder="输入实际工时" min="0" value="0" data-testid="task-actual-hours-input">
        <p class="text-xs text-stone-400 mt-1">实际花费的工时，可以超过预计工时</p>
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-1">任务图片（可选）</label>
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
        <label class="block text-sm font-medium text-stone-700 mb-1">
          初始进度: <span id="progress-value" class="text-blue-600 font-bold">0%</span>
        </label>
        <input type="range" id="task-progress" min="0" max="100" value="0" class="w-full"
          data-testid="progress-slider">
      </div>

      <div class="mb-4">
        <label class="block text-sm font-medium text-stone-700 mb-1">任务节点（可选）</label>
        <div class="mb-3">
          <div class="text-xs text-stone-500 mb-2">添加常用节点：</div>
          <div class="flex flex-wrap gap-2" id="preset-nodes"><!-- populated dynamically --></div>
        </div>
        <div id="nodes-container" class="space-y-2">
          <div class="flex gap-2 items-center">
            <input type="text"
              class="node-input flex-1 px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 use-base-ring"
              placeholder="节点名称" data-testid="node-input" data-scrapbook-input-value="">
            <button type="button" id="add-node-btn" data-variant="add-node"
              class="p-2 rounded-lg transition-colors flex items-center justify-center" data-testid="add-node-btn">
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
      <h3 id="pr-modal-title" class="text-base font-bold text-stone-800 mb-4">添加收支记录</h3>
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
