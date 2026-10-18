// 图片回收站操作（MainView / BarView 共用）
// ---------------------------------------------------------------
// 之前两个视图各写了一份一模一样的「移入回收站 / 从回收站恢复」，
// 区别只有请求前缀判断，统一到这里。
//
// 依赖：scripts/task-utils.js（路径归一化）
// 约定：请求失败或路径不匹配时原样返回入参，调用方可以无脑赋值。
(function () {
  const post = async (url, imagePath) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: imagePath }),
    });
    if (!res.ok) return imagePath;
    const data = await res.json();
    return data.newPath || imagePath;
  };

  /** 是否为 pic/ 下的图片（大小写不敏感） */
  const isPicImage = (imagePath) =>
    /^pic\//i.test(window.taskUtils.normalizeImagePath(imagePath));

  /** 把图片从 pic/ 移到回收站目录，返回新路径 */
  const moveToRecycle = async (imagePath) => {
    if (!imagePath || typeof imagePath !== "string") return imagePath;
    if (!isPicImage(imagePath)) return imagePath;
    try {
      return await post("/move-image-to-recycle", imagePath);
    } catch (e) {
      console.warn("moveImageToRecycle error", e);
      return imagePath;
    }
  };

  /** 把图片从回收站目录移回 pic/，返回新路径 */
  const restoreFromRecycle = async (imagePath) => {
    if (!imagePath || typeof imagePath !== "string") return imagePath;
    if (!window.taskUtils.isRecycleImage(imagePath)) return imagePath;
    try {
      return await post("/restore-image-from-recycle", imagePath);
    } catch (e) {
      console.warn("restoreImageFromRecycle error", e);
      return imagePath;
    }
  };

  window.taskImage = { moveToRecycle, restoreFromRecycle, isPicImage };
})();
