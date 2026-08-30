const runs = new Map();
const m3u8Runs = new Map();

const DETAIL_PAGE_TIMEOUT_MS = 18_000;
const TITLE_RETRY_DELAY_MS = 350;
const VIDEO_PAGE_TIMEOUT_MS = 20_000;
const VIDEO_RETRY_DELAY_MS = 400;

// Knowledge Star pages occasionally expose titles as HTML-escaped text.  Do
// not let the escaped representation leak into the title used for matching or
// copied to the downloader.  This decoder is intentionally DOM-independent
// because the background service worker has no document object.  Multiple
// passes handle double-encoded values such as `&amp;amp;`.
const HTML_ENTITY_NAMES = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  divide: "÷",
  plusmn: "±",
  minus: "−",
  deg: "°",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  sect: "§",
  para: "¶",
});
const HTML_ENTITY_PATTERN = /&(#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/gi;

function decodeHtmlEntities(value) {
  let text = String(value ?? "");
  for (let pass = 0; pass < 3; pass += 1) {
    const decoded = text.replace(HTML_ENTITY_PATTERN, (entity, body) => {
      const normalizedBody = body.toLowerCase();
      if (normalizedBody.startsWith("#x")) {
        const codePoint = Number.parseInt(normalizedBody.slice(2), 16);
        if (
          Number.isInteger(codePoint) &&
          codePoint >= 0 &&
          codePoint <= 0x10ffff &&
          !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return String.fromCodePoint(codePoint);
        }
        return entity;
      }
      if (normalizedBody.startsWith("#")) {
        const codePoint = Number.parseInt(normalizedBody.slice(1), 10);
        if (
          Number.isInteger(codePoint) &&
          codePoint >= 0 &&
          codePoint <= 0x10ffff &&
          !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return String.fromCodePoint(codePoint);
        }
        return entity;
      }
      return Object.prototype.hasOwnProperty.call(
        HTML_ENTITY_NAMES,
        normalizedBody
      )
        ? HTML_ENTITY_NAMES[normalizedBody]
        : entity;
    });
    if (decoded === text) break;
    text = decoded;
  }
  return text;
}

function normalizeTitle(title) {
  return decodeHtmlEntities(String(title ?? ""))
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cleanTitle(title) {
  return normalizeTitle(title)
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
    func: () => {
      const decoder =
        typeof document !== "undefined" &&
        typeof document.createElement === "function"
          ? document.createElement("textarea")
          : null;
      const decodeEntities = (value) => {
        let text = String(value ?? "");
        if (!decoder) return text;
        for (let pass = 0; pass < 3; pass += 1) {
          try {
            decoder.innerHTML = text
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
          } catch {
            return text;
          }
          const decoded = decoder.value;
          if (typeof decoded !== "string") return text;
          if (decoded === text) break;
          text = decoded;
        }
        return text;
      };
      return { href: location.href, title: decodeEntities(document.title) };
    },
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

function isTopicUrl(url) {
  return (
    typeof url === "string" &&
    (url.startsWith("https://t.zsxq.com/") || url.startsWith("https://wx.zsxq.com/"))
  );
}

function isM3u8Url(url) {
  return typeof url === "string" && /\.m3u8(?:[?#]|$)/i.test(url);
}

async function inspectVideoPage(tabId) {
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const entityNames = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: "\u00a0",
        ensp: "\u2002",
        emsp: "\u2003",
        thinsp: "\u2009",
        ndash: "–",
        mdash: "—",
        hellip: "…",
        laquo: "«",
        raquo: "»",
        lsquo: "‘",
        rsquo: "’",
        ldquo: "“",
        rdquo: "”",
        bull: "•",
        middot: "·",
        copy: "©",
        reg: "®",
        trade: "™",
        times: "×",
        divide: "÷",
        plusmn: "±",
        minus: "−",
        deg: "°",
        euro: "€",
        pound: "£",
        yen: "¥",
        cent: "¢",
        sect: "§",
        para: "¶",
      };
      const entityPattern = /&(#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/gi;
      const entityDecoder =
        typeof document !== "undefined" &&
        typeof document.createElement === "function"
          ? document.createElement("textarea")
          : null;
      const decodeEntities = (value) => {
        let text = String(value ?? "");
        for (let pass = 0; pass < 3; pass += 1) {
          const source = text;
          let decoded = source.replace(entityPattern, (entity, body) => {
            const normalizedBody = body.toLowerCase();
            if (normalizedBody.startsWith("#x")) {
              const codePoint = Number.parseInt(normalizedBody.slice(2), 16);
              return Number.isInteger(codePoint) &&
                codePoint >= 0 &&
                codePoint <= 0x10ffff &&
                !(codePoint >= 0xd800 && codePoint <= 0xdfff)
                ? String.fromCodePoint(codePoint)
                : entity;
            }
            if (normalizedBody.startsWith("#")) {
              const codePoint = Number.parseInt(normalizedBody.slice(1), 10);
              return Number.isInteger(codePoint) &&
                codePoint >= 0 &&
                codePoint <= 0x10ffff &&
                !(codePoint >= 0xd800 && codePoint <= 0xdfff)
                ? String.fromCodePoint(codePoint)
                : entity;
            }
            return Object.prototype.hasOwnProperty.call(entityNames, normalizedBody)
              ? entityNames[normalizedBody]
              : entity;
          });

          if (entityDecoder && source.includes("&")) {
            try {
              entityDecoder.innerHTML = source
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
              const parsed = entityDecoder.value;
              if (
                typeof parsed === "string" &&
                (parsed !== source || decoded === source)
              ) {
                decoded = parsed;
              }
            } catch {
              // Keep the manual decoder result if the parser is unavailable.
            }
          }
          if (decoded === text) break;
          text = decoded;
        }
        return text;
      };
      const clean = (value) =>
        decodeEntities(String(value ?? "")).replace(/\s+/g, " ").trim();
      const chapterPattern =
        /第\s*[\d一二三四五六七八九十百]+(?:\s*[-－—]\s*[\d一二三四五六七八九十百]+)?\s*节/;
      const videos = [...document.querySelectorAll("video")];
      const m3u8 =
        videos
          .map((video) => video.dataset?.src || video.getAttribute("data-src") || "")
          .find((value) => /\.m3u8(?:[?#]|$)/i.test(value)) || "";
      const precedingText = (link) => {
        let latest = "";
        let node = link;
        for (let depth = 0; node?.parentNode && depth < 6; depth += 1) {
          const parent = node.parentNode;
          try {
            const range = document.createRange();
            range.selectNodeContents(parent);
            range.setEnd(node, 0);
            const text = clean(range.toString().slice(-160));
            if (text) {
              latest = text;
              if (/课程视频\s*[:：]?\s*$/.test(text)) return text;
            }
          } catch {
            // Try the next ancestor.
          }
          node = parent;
        }

        return latest;
      };

      const candidates = [...document.querySelectorAll("a[href^='https://t.zsxq.com/']")]
        .map((link) => {
          const text = clean(link.textContent);
          const parentText = clean(link.parentElement?.textContent);
          const beforeText = precedingText(link);
          let score = 0;

          if (/课程视频\s*[:：]?\s*$/.test(beforeText)) {
            score += 200;
          } else if (/课程视频/.test(parentText) && (chapterPattern.test(text) || /视频/.test(text))) {
            score += 80;
          }
          if (/^第/.test(text) && chapterPattern.test(text)) score += 50;
          if (/视频/.test(text)) score += 10;

          return score ? { href: link.href, text, score } : null;
        })
        .filter(Boolean)
        .sort((left, right) => right.score - left.score);

      return {
        href: location.href,
        title: clean(document.title),
        m3u8,
        videoLink: candidates[0]?.href || "",
        videoLinkScore: candidates[0]?.score || 0,
      };
    },
  });

  return injected?.result || {
    href: "",
    title: "",
    m3u8: "",
    videoLink: "",
    videoLinkScore: 0,
  };
}

async function waitForVideoData(tabId, signal, allowVideoLink) {
  const deadline = Date.now() + VIDEO_PAGE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (signal.cancelled) {
      throw new Error("已取消");
    }

    try {
      const page = await inspectVideoPage(tabId);
      if (isM3u8Url(page.m3u8)) return page;
      if (allowVideoLink && page.videoLink && page.videoLinkScore >= 80) return page;
    } catch {
      // 页面跳转或脚本注入尚未完成，继续等待。
    }

    await sleep(VIDEO_RETRY_DELAY_MS);
  }

  throw new Error(
    allowVideoLink
      ? "第一层页面未找到课程视频链接"
      : "第二层页面未找到 video[data-src] m3u8 链接"
  );
}

async function navigateForVideo(tabId, url, signal) {
  const previousUrl = (await chrome.tabs.get(tabId)).url || "";
  await chrome.tabs.update(tabId, { url });

  if (url === previousUrl) {
    await sleep(VIDEO_RETRY_DELAY_MS);
    return;
  }

  const deadline = Date.now() + VIDEO_PAGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal.cancelled) {
      throw new Error("已取消");
    }

    try {
      const currentUrl = (await chrome.tabs.get(tabId)).url || "";
      if (currentUrl && currentUrl !== previousUrl && currentUrl !== "about:blank") {
        await sleep(VIDEO_RETRY_DELAY_MS);
        return;
      }
    } catch {
      // 标签页正在跳转，下一轮继续检查。
    }

    await sleep(150);
  }

  throw new Error("课程页面跳转超时");
}

async function extractM3u8ForItem(tabId, item, signal) {
  await navigateForVideo(tabId, item.url, signal);
  const firstLayer = await waitForVideoData(tabId, signal, true);

  // 某些页面本身就是第二层，直接已经有 video[data-src]。
  if (isM3u8Url(firstLayer.m3u8)) {
    return firstLayer.m3u8;
  }

  if (!firstLayer.videoLink) {
    throw new Error("第一层页面未找到课程视频链接");
  }

  if (firstLayer.videoLink === item.url) {
    throw new Error("课程视频链接未跳转到第二层页面");
  }

  await navigateForVideo(tabId, firstLayer.videoLink, signal);
  const secondLayer = await waitForVideoData(tabId, signal, false);
  return secondLayer.m3u8;
}

async function startM3u8Extract(sourceTabId, rawItems) {
  const items = rawItems
    .map((item) =>
      item && typeof item === "object"
        ? { ...item, title: normalizeTitle(item.title) }
        : item
    )
    .filter(
      (item) =>
        item &&
        isTopicUrl(item.url) &&
        typeof item.title === "string" &&
        item.title.trim()
    );

  if (!items.length) {
    await sendToPage(sourceTabId, {
      type: "M3U8_FINISHED",
      error: "当前页面没有可处理的课程标题或链接。",
    });
    return;
  }

  const previousRestore = runs.get(sourceTabId);
  if (previousRestore) previousRestore.cancelled = true;
  const previousRun = m3u8Runs.get(sourceTabId);
  if (previousRun) previousRun.cancelled = true;

  const signal = { cancelled: false };
  m3u8Runs.set(sourceTabId, signal);

  let workerTabId = null;
  try {
    const workerTab = await chrome.tabs.create({
      url: "about:blank",
      active: false,
      openerTabId: sourceTabId,
    });
    workerTabId = workerTab.id;

    for (let index = 0; index < items.length; index += 1) {
      if (signal.cancelled) break;

      const item = items[index];
      let m3u8 = "";
      let error = "";

      try {
        m3u8 = await extractM3u8ForItem(workerTabId, item, signal);
      } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason);
      }

      await sendToPage(sourceTabId, {
        type: "M3U8_PROGRESS",
        sourceUrl: item.url,
        title: item.title,
        order: item.order || null,
        m3u8,
        error,
        current: index + 1,
        total: items.length,
      });
    }

    await sendToPage(sourceTabId, {
      type: "M3U8_FINISHED",
      cancelled: signal.cancelled,
    });
  } catch (reason) {
    await sendToPage(sourceTabId, {
      type: "M3U8_FINISHED",
      error: reason instanceof Error ? reason.message : String(reason),
    });
  } finally {
    if (workerTabId !== null && workerTabId !== undefined) {
      try {
        await chrome.tabs.remove(workerTabId);
      } catch {
        // 后台标签页已被用户关闭时无需处理。
      }
    }

    if (m3u8Runs.get(sourceTabId) === signal) {
      m3u8Runs.delete(sourceTabId);
    }
  }
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
  const previousM3u8Run = m3u8Runs.get(sourceTabId);
  if (previousM3u8Run) {
    previousM3u8Run.cancelled = true;
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

  if (message.type === "START_M3U8") {
    startM3u8Extract(sourceTabId, message.items || []);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "CANCEL_RESTORE") {
    const run = runs.get(sourceTabId);
    if (run) {
      run.cancelled = true;
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "CANCEL_M3U8") {
    const run = m3u8Runs.get(sourceTabId);
    if (run) {
      run.cancelled = true;
    }
    sendResponse({ ok: true });
  }
});
