// 任务系统共享工具函数
// 同时被 task-card-shared.js 和 task-modal-shared.js 依赖
// 需在两者之前加载
(() => {
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
    getIconClassForSource,
    defaultGetNodePresentation,
  });
})();
