const runs = new Map();

const DETAIL_PAGE_TIMEOUT_MS = 18_000;
const TITLE_RETRY_DELAY_MS = 350;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cleanTitle(title) {
  return String(title || "")
    .replace(/\s*[-–—]\s*知识星球\s*$/, "")
    .trim();
}

async function sendToPage(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // 页面被关闭、刷新或尚未注入 content script 时忽略即可。
  }
}

async function titleFromTab(tabId) {
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ href: location.href, title: document.title }),
  });
  return injected?.result || { href: "", title: "" };
}

async function waitForFullTitle(tabId, previousUrl, signal) {
  const deadline = Date.now() + DETAIL_PAGE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (signal.cancelled) {
      throw new Error("已取消");
    }

    try {
      const { href, title } = await titleFromTab(tabId);
      const cleaned = cleanTitle(title);
      if (
        href.startsWith("https://wx.zsxq.com/") &&
        href !== previousUrl &&
        cleaned &&
        !cleaned.startsWith("知识星球 |")
      ) {
        return cleaned;
      }
    } catch {
      // 页面跳转中，executeScript 可能暂时不可用，继续等待。
    }

    await sleep(TITLE_RETRY_DELAY_MS);
  }

  throw new Error("详情页加载超时");
}

async function navigateAndRead(tabId, url, signal) {
  const previousUrl = (await chrome.tabs.get(tabId)).url || "";
  await chrome.tabs.update(tabId, { url });
  return waitForFullTitle(tabId, previousUrl, signal);
}

async function startRestore(sourceTabId, rawItems) {
  const items = rawItems.filter(
    (item) => item && typeof item.url === "string" && item.url.startsWith("https://t.zsxq.com/")
  );

  if (!items.length) {
    await sendToPage(sourceTabId, {
      type: "RESTORE_FINISHED",
      error: "当前页面没有可处理的知识星球课程链接。",
    });
    return;
  }

  const previousRun = runs.get(sourceTabId);
  if (previousRun) {
    previousRun.cancelled = true;
  }

  const signal = { cancelled: false };
  runs.set(sourceTabId, signal);

  // 只创建一个非激活后台标签页；所有详情在这个标签页中依次加载，最后自动关闭。
  let workerTabId;
  try {
    const workerTab = await chrome.tabs.create({
      url: "about:blank",
      active: false,
      openerTabId: sourceTabId,
    });
    workerTabId = workerTab.id;

    for (let index = 0; index < items.length; index += 1) {
      if (signal.cancelled) {
        break;
      }

      const item = items[index];
      let title = "";
      let error = "";

      try {
        title = await navigateAndRead(workerTabId, item.url, signal);
      } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason);
      }

      await sendToPage(sourceTabId, {
        type: "RESTORE_PROGRESS",
        url: item.url,
        title,
        error,
        current: index + 1,
        total: items.length,
      });
    }

    await sendToPage(sourceTabId, {
      type: "RESTORE_FINISHED",
      cancelled: signal.cancelled,
    });
  } catch (reason) {
    await sendToPage(sourceTabId, {
      type: "RESTORE_FINISHED",
      error: reason instanceof Error ? reason.message : String(reason),
    });
  } finally {
    if (workerTabId) {
      try {
        await chrome.tabs.remove(workerTabId);
      } catch {
        // 后台标签页已被用户关闭时无需处理。
      }
    }

    if (runs.get(sourceTabId) === signal) {
      runs.delete(sourceTabId);
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const sourceTabId = sender.tab?.id;
  if (!sourceTabId || !message?.type) {
    return;
  }

  if (message.type === "START_RESTORE") {
    startRestore(sourceTabId, message.items || []);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "CANCEL_RESTORE") {
    const run = runs.get(sourceTabId);
    if (run) {
      run.cancelled = true;
    }
    sendResponse({ ok: true });
  }
});
