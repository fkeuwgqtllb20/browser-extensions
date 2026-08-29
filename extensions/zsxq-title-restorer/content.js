(() => {
  const PANEL_ID = "zsxq-title-restorer-panel";
  const TOPIC_SELECTOR = "a.link-of-topic[href^='https://t.zsxq.com/']";

  let restoring = false;
  let restoredCount = 0;
  let failedCount = 0;

  function decodeTitle(value) {
    try {
      return decodeURIComponent(value || "").trim();
    } catch {
      return String(value || "").trim();
    }
  }

  function getLinks() {
    return [...document.querySelectorAll(TOPIC_SELECTOR)];
  }

  function getTitle(link) {
    return (link.textContent || decodeTitle(link.getAttribute("title"))).replace(/\s+/g, " ").trim();
  }

  function setStatus(text, kind = "") {
    const status = document.querySelector(`#${PANEL_ID} [data-role='status']`);
    if (!status) return;
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function setBusy(busy) {
    restoring = busy;
    const restoreButton = document.querySelector(`#${PANEL_ID} [data-action='restore']`);
    const cancelButton = document.querySelector(`#${PANEL_ID} [data-action='cancel']`);
    if (restoreButton) restoreButton.disabled = busy;
    if (cancelButton) cancelButton.hidden = !busy;
  }

  function revealLink(link, title) {
    link.textContent = title;
    link.title = title;
    link.dataset.zsxqFullTitle = title;

    let node = link;
    for (let level = 0; node && level < 5; level += 1, node = node.parentElement) {
      node.style.setProperty("white-space", "normal", "important");
      node.style.setProperty("overflow", "visible", "important");
      node.style.setProperty("text-overflow", "clip", "important");
      node.style.setProperty("max-width", "none", "important");
      node.style.setProperty("height", "auto", "important");
      node.style.setProperty("word-break", "break-word", "important");
      node.style.setProperty("-webkit-line-clamp", "unset", "important");
    }
  }

  async function copyTitles() {
    const titles = getLinks().map(getTitle).filter(Boolean);
    const result = [...new Set(titles)].join("\n");

    if (!result) {
      setStatus("当前页面没有可复制的课程标题。", "error");
      return;
    }

    try {
      await navigator.clipboard.writeText(result);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = result;
      textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px;";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    setStatus(`已复制 ${titles.length} 条标题。`, "success");
  }

  async function restoreTitles() {
    const links = getLinks();
    const unresolved = new Map();
    const recoveredUrls = new Set();

    // title 属性完整时直接解码，不需要打开后台详情页。
    for (const link of links) {
      const decodedTitle = decodeTitle(link.getAttribute("title"));
      if (decodedTitle && !decodedTitle.includes("...")) {
        revealLink(link, decodedTitle);
        recoveredUrls.add(link.href);
      } else {
        unresolved.set(link.href, { url: link.href });
      }
    }

    recoveredUrls.forEach((url) => unresolved.delete(url));

    const uniqueItems = [...unresolved.values()];

    if (!uniqueItems.length) {
      setStatus("当前页面没有课程链接，请先打开课程目录。", "error");
      return;
    }

    restoredCount = recoveredUrls.size;
    failedCount = 0;

    if (!uniqueItems.length) {
      setStatus(`完成：已从 title 属性直接恢复 ${restoredCount} 条。`, "success");
      return;
    }

    setBusy(true);
    setStatus(`已直接恢复 ${restoredCount} 条；正在后台恢复 0/${uniqueItems.length} 条…`);

    try {
      await chrome.runtime.sendMessage({ type: "START_RESTORE", items: uniqueItems });
    } catch {
      setBusy(false);
      setStatus("扩展后台启动失败，请在 chrome://extensions/ 重新加载扩展。", "error");
    }
  }

  function cancelRestore() {
    chrome.runtime.sendMessage({ type: "CANCEL_RESTORE" });
    setStatus("正在停止…");
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="zsxq-title-restorer__heading">
        <strong>完整课程标题</strong>
        <button type="button" data-action="minimize" title="收起">−</button>
      </div>
      <p data-role="status">等待处理当前页面课程目录。</p>
      <div class="zsxq-title-restorer__actions">
        <button type="button" data-action="restore">恢复完整标题</button>
        <button type="button" data-action="copy">复制当前标题</button>
        <button type="button" data-action="cancel" hidden>停止</button>
      </div>
      <small>仅创建一个后台标签页，完成后会自动关闭。</small>
    `;
    document.documentElement.appendChild(panel);

    panel.querySelector("[data-action='restore']").addEventListener("click", restoreTitles);
    panel.querySelector("[data-action='copy']").addEventListener("click", copyTitles);
    panel.querySelector("[data-action='cancel']").addEventListener("click", cancelRestore);
    panel.querySelector("[data-action='minimize']").addEventListener("click", () => {
      panel.classList.toggle("is-minimized");
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "RESTORE_PROGRESS") {
      if (message.title) {
        getLinks()
          .filter((link) => link.href === message.url)
          .forEach((link) => revealLink(link, message.title));
        restoredCount += 1;
      } else {
        failedCount += 1;
      }

      setStatus(
        `后台恢复：${message.current}/${message.total}（成功 ${restoredCount}，失败 ${failedCount}）`,
        message.error ? "error" : ""
      );
      return;
    }

    if (message?.type === "RESTORE_FINISHED") {
      setBusy(false);
      if (message.error) {
        setStatus(`处理失败：${message.error}`, "error");
      } else if (message.cancelled) {
        setStatus(`已停止：成功恢复 ${restoredCount} 条。`, "error");
      } else {
        setStatus(`完成：恢复 ${restoredCount} 条，失败 ${failedCount} 条。请点击“复制当前标题”。`, "success");
      }
    }
  });

  createPanel();
})();
