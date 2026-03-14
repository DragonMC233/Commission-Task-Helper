(function () {
  function addEventListenerOnce(element, event, handler) {
    function wrapper() {
      handler.apply(this, arguments);
      element.removeEventListener(event, wrapper);
    }
    element.addEventListener(event, wrapper);
  }
  var LOG_PREFIX = "[MiniApp]";
  console.log(LOG_PREFIX + " head标签开始");
  function logHeadScripts() {
    var head = document.head || document.getElementsByTagName("head")[0];
    if (!head) {
      setTimeout(logHeadScripts, 10);
      return;
    }
    var scripts = head.querySelectorAll("script:not([data-logging-script])");
    scripts.forEach(function (script) {
      var src = script.src || "内联脚本";
      console.log(LOG_PREFIX + " script开始执行:", src);
      if (script.src) {
        addEventListenerOnce(script, "load", function () {
          console.log(LOG_PREFIX + " script执行完成:", src);
        });
      } else {
        setTimeout(function () {
          console.log(LOG_PREFIX + " script执行完成:", src);
        }, 0);
      }
    });
  }
  var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType === 1) {
          if (
            node.tagName === "SCRIPT" &&
            !node.hasAttribute("data-logging-script")
          ) {
            var src = node.src || "内联脚本";
            console.log(LOG_PREFIX + " script开始执行:", src);
            if (node.src) {
              addEventListenerOnce(node, "load", function () {
                console.log(LOG_PREFIX + " script执行完成:", src);
              });
            }
          }
          if (
            node.tagName === "LINK" &&
            node.rel === "stylesheet" &&
            !node.hasAttribute("data-logging-script")
          ) {
            var href = node.href || "内联样式";
            console.log(LOG_PREFIX + " CSS样式表开始加载:", href);
            addEventListenerOnce(node, "load", function () {
              console.log(LOG_PREFIX + " CSS样式表加载完成:", href);
            });
            addEventListenerOnce(node, "error", function () {
              console.log(LOG_PREFIX + " CSS样式表加载失败:", href);
            });
          }
          if (
            node.tagName === "IMG" &&
            !node.hasAttribute("data-logging-script")
          ) {
            var src = node.src || node.getAttribute("src") || "未知";
            addEventListenerOnce(node, "error", function () {
              console.log(LOG_PREFIX + " 图片加载失败:", src);
            });
          }
          if (node.querySelectorAll) {
            var scripts = node.querySelectorAll(
              "script:not([data-logging-script])"
            );
            scripts.forEach(function (script) {
              var src = script.src || "内联脚本";
              console.log(LOG_PREFIX + " script开始执行:", src);
              if (script.src) {
                addEventListenerOnce(script, "load", function () {
                  console.log(LOG_PREFIX + " script执行完成:", src);
                });
              }
            });
            var links = node.querySelectorAll(
              'link[rel="stylesheet"]:not([data-logging-script])'
            );
            links.forEach(function (link) {
              var href = link.href || "内联样式";
              console.log(LOG_PREFIX + " CSS样式表开始加载:", href);
              addEventListenerOnce(link, "load", function () {
                console.log(LOG_PREFIX + " CSS样式表加载完成:", href);
              });
              addEventListenerOnce(link, "error", function () {
                console.log(LOG_PREFIX + " CSS样式表加载失败:", href);
              });
            });
            var images = node.querySelectorAll(
              "img:not([data-logging-script])"
            );
            images.forEach(function (img) {
              var src = img.src || img.getAttribute("src") || "未知";
              addEventListenerOnce(img, "error", function () {
                console.log(LOG_PREFIX + " 图片加载失败:", src);
              });
            });
          }
        }
      });
    });
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  function logBeforeBodyEnd() {
    if (document.body) {
      var logScript = document.createElement("script");
      logScript.setAttribute("data-logging-script", "true");
      logScript.textContent = 'console.log("' + LOG_PREFIX + ' body结束前");';
      document.body.appendChild(logScript);
    }
  }
  if (document.currentScript) {
    document.currentScript.setAttribute("data-logging-script", "true");
  }
  function logStylesheets() {
    var head = document.head || document.getElementsByTagName("head")[0];
    if (!head) {
      setTimeout(logStylesheets, 10);
      return;
    }
    var links = head.querySelectorAll(
      'link[rel="stylesheet"]:not([data-logging-script])'
    );
    links.forEach(function (link) {
      var href = link.href || "内联样式";
      console.log(LOG_PREFIX + " CSS样式表开始加载:", href);
      addEventListenerOnce(link, "load", function () {
        console.log(LOG_PREFIX + " CSS样式表加载完成:", href);
      });
      addEventListenerOnce(link, "error", function () {
        console.log(LOG_PREFIX + " CSS样式表加载失败:", href);
      });
    });
  }
  function logImageErrors() {
    var images = document.querySelectorAll("img:not([data-logging-script])");
    images.forEach(function (img) {
      var src = img.src || img.getAttribute("src") || "未知";
      addEventListenerOnce(img, "error", function () {
        console.log(LOG_PREFIX + " 图片加载失败:", src);
      });
    });
  }
  var lastReadyState = document.readyState;
  console.log(LOG_PREFIX + " document.readyState:", lastReadyState);
  function checkReadyState() {
    var currentState = document.readyState;
    if (currentState !== lastReadyState) {
      console.log(
        LOG_PREFIX + " document.readyState变化:",
        lastReadyState + " -> " + currentState
      );
      lastReadyState = currentState;
    }
  }
  var readyStateInterval = setInterval(function () {
    checkReadyState();
    if (document.readyState === "complete") {
      clearInterval(readyStateInterval);
    }
  }, 10);
  addEventListenerOnce(window, "load", function () {
    console.log(LOG_PREFIX + " window.onload事件触发 - 所有资源加载完成");
  });
  window.addEventListener(
    "error",
    function (event) {
      console.log(LOG_PREFIX + " JavaScript运行时错误:", {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error ? event.error.toString() : "未知错误",
      });
    },
    true
  );
  window.addEventListener("unhandledrejection", function (event) {
    console.log(LOG_PREFIX + " Promise未捕获的拒绝:", {
      reason: event.reason
        ? event.reason.toString
          ? event.reason.toString()
          : JSON.stringify(event.reason)
        : "未知原因",
      promise: event.promise,
    });
  });
  logHeadScripts();
  logStylesheets();
  function handleDOMContentLoaded() {
    console.log(LOG_PREFIX + " DOMContentLoaded事件触发");
    logBeforeBodyEnd();
    logImageErrors();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", handleDOMContentLoaded);
  } else {
    handleDOMContentLoaded();
  }
})();
