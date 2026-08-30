(() => {
  const PANEL_ID = "zsxq-title-restorer-panel";
  const TOPIC_SELECTOR = "a.link-of-topic[href^='https://t.zsxq.com/']";

  let restoring = false;
  let restoredCount = 0;
  let failedCount = 0;
  let activeTask = "";
  let m3u8Results = [];
  let m3u8FailureCount = 0;
  let m3u8MissingCount = 0;

  // Titles can arrive from rich-text/API responses with HTML entities (for
  // example `&amp;`).  Keep a small decoder with a DOM-independent fallback so
  // the value used for display, matching, and copying is always canonical.  A
  // few passes also handle values that were encoded more than once, such as
  // `&amp;amp;`.
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
  const HTML_ENTITY_PATTERN =
    /&(#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/gi;
  let htmlEntityDecoder;

  function decodeHtmlEntities(value) {
    let text = String(value ?? "");
    for (let pass = 0; pass < 3; pass += 1) {
      const source = text;
      let decoded = source.replace(HTML_ENTITY_PATTERN, (entity, body) => {
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

      // The map above covers the entities most often emitted by the site.
      // Use the browser's HTML parser as a fallback for less common named
      // entities (for example `&colon;`) while escaping literal angle brackets
      // so a title is never interpreted as markup.
      if (
        source.includes("&") &&
        typeof document !== "undefined" &&
        typeof document.createElement === "function"
      ) {
        try {
          htmlEntityDecoder ||= document.createElement("textarea");
          htmlEntityDecoder.innerHTML = source
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          const parsed = htmlEntityDecoder.value;
          // Prefer the browser parser for complete HTML5 entity coverage;
          // retain the manual result if a non-standard test DOM did not parse.
          if (
            typeof parsed === "string" &&
            (parsed !== source || decoded === source)
          ) {
            decoded = parsed;
          }
        } catch {
          // Keep the DOM-independent result when the fallback is unavailable.
        }
      }
      if (decoded === text) break;
      text = decoded;
    }
    return text;
  }

  function decodeTitle(value) {
    let text = String(value ?? "");
    try {
      text = decodeURIComponent(text);
    } catch {
      // Keep the original text when it contains a malformed URI escape.
    }
    return decodeHtmlEntities(text).trim();
  }

  function getLinks() {
    return [...document.querySelectorAll(TOPIC_SELECTOR)];
  }

  /**
   * Return the text immediately before a link.  The course directory is
   * rendered as one rich-text container, so the order marker (for example
   * `- 16：`) is usually a text node directly before the anchor.  Using a
   * Range also handles the case where the marker is wrapped in a span or
   * another inline element.
   */
  function textBeforeLink(link) {
    let node = link;
    let lastText = "";

    for (let depth = 0; node?.parentNode && depth < 8; depth += 1) {
      const parent = node.parentNode;

      if (typeof document.createRange === "function") {
        try {
          const range = document.createRange();
          range.selectNodeContents(parent);
          range.setEnd(node, 0);
          const text = range.toString();
          if (text) {
            lastText = text.slice(-1024);
            // A wrapped link may need the next ancestor before its marker is
            // visible.  Stop as soon as the current range ends in a marker.
            if (parseOrderMarker(text)) return lastText;
          }
        } catch {
          // Continue with the sibling fallback below.
        }
      }

      node = parent;
    }

    // A small fallback for browsers/test DOMs without Range support.
    const chunks = [];
    node = link;
    for (let depth = 0; node?.parentNode && depth < 8; depth += 1) {
      let sibling = node.previousSibling;
      while (sibling) {
        chunks.unshift(sibling.textContent || "");
        sibling = sibling.previousSibling;
      }
      node = node.parentNode;
    }
    const fallbackText = chunks.join("").slice(-1024);
    return parseOrderMarker(lastText) ? lastText : fallbackText || lastText;
  }

  function normalizeMarkerText(value) {
    return decodeHtmlEntities(String(value || ""))
      .replace(/\u00a0/g, " ")
      .replace(/[\u200b\ufeff]/g, "")
      .replace(/\r\n?/g, "\n");
  }

  function parseOrderMarker(value) {
    const text = normalizeMarkerText(value);

    // Normal directory rows start on their own line: "- 16：".
    let match = text.match(/(?:^|\n)\s*(?:[-*•－]\s*)?(\d+)\s*([:：])\s*$/);
    // Some rows have an inline note before the marker, e.g. "... - 30：".
    if (!match) {
      match = text.match(/(?:^|[ \t])[-－–—]\s*(\d+)\s*([:：])\s*$/);
    }

    return match ? { number: match[1], separator: match[2] } : null;
  }

  function getOrder(link) {
    // The learning number is rendered outside the anchor; never infer it
    // from the chapter number contained in the title.
    return parseOrderMarker(textBeforeLink(link));
  }

  function getTitle(link) {
    const restoredTitle = link.dataset.zsxqFullTitle;
    if (restoredTitle) return normalizeLookupTitle(restoredTitle);
    return normalizeLookupTitle(
      link.textContent || decodeTitle(link.getAttribute("title"))
    );
  }

  function getCopyItems() {
    const entries = getLinks()
      .map((link) => ({ link, title: getTitle(link), order: getOrder(link) }))
      .filter((entry) => entry.title);
    return entries;
  }

  function uniqueCopyItems(items) {
    const seen = new Set();
    return items.filter((item) => {
      const order = item.order?.number || "";
      const key = `${order}\u0000${item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function formatCopyItem(item) {
    if (!item.order) return item.title;
    return `- ${item.order.number}${item.order.separator} ${item.title}`;
  }

  function normalizeLookupTitle(value) {
    return decodeHtmlEntities(String(value || ""))
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseTitleLines(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map((line) => decodeHtmlEntities(line.split(/\t/, 1)[0]).trim())
      .map((line) => {
        const numbered = line.match(/^\s*[-*•－–—]\s*(\d+)\s*([:：])\s*(.+)$/);
        if (numbered) {
          return {
            title: normalizeLookupTitle(numbered[3]),
            order: { number: numbered[1], separator: numbered[2] },
          };
        }

        const bareNumber = line.match(/^\s*(\d+)\s*([:：])\s*(.+)$/);
        const unnumbered = bareNumber
          ? bareNumber[3]
          : line.replace(/^\s*[-*•－–—]\s+/, "");
        return {
          title: normalizeLookupTitle(unnumbered),
          order: bareNumber
            ? { number: bareNumber[1], separator: bareNumber[2] }
            : null,
        };
      })
      .filter((item) => item.title);
  }

  function titleMatchKey(value) {
    return normalizeLookupTitle(value)
      .replace(/[.…]+$/g, "")
      .trim();
  }

  function likelyVideoItems(items) {
    const likely = items.filter(
      (item) =>
        item.order ||
        /《[^》]+》/.test(item.title) ||
        /第\s*[\d一二三四五六七八九十百]+(?:\s*[-－—]\s*[\d一二三四五六七八九十百]+)?\s*节/.test(item.title)
    );
    return likely.length ? likely : items;
  }

  function currentTopicTitle() {
    const content = [...document.querySelectorAll(".content")].find((element) =>
      element.querySelector(TOPIC_SELECTOR)
    );
    const heading =
      content?.querySelector("strong")?.textContent ||
      content?.querySelector("h1,h2")?.textContent ||
      document.title.replace(/\s*[-–—]\s*知识星球\s*$/, "");
    return normalizeLookupTitle(heading);
  }

  function currentTopicVideoItem() {
    if (!/\/topic\//.test(location.pathname)) return null;

    const hasDirectVideo = Boolean(document.querySelector("video[data-src]"));
    const content = [...document.querySelectorAll(".content")].find((element) =>
      element.querySelector(TOPIC_SELECTOR)
    );
    const title = currentTopicTitle();

    if (hasDirectVideo && title) {
      return {
        link: null,
        url: location.href,
        title,
        order: null,
        direct: true,
      };
    }

    const link = [...(content || document).querySelectorAll(TOPIC_SELECTOR)].find(
      (candidate) =>
        /课程视频/.test(textBeforeLink(candidate).slice(-100)) &&
        /第\s*[\d一二三四五六七八九十百]+(?:\s*[-－—]\s*[\d一二三四五六七八九十百]+)?\s*节/.test(
          getTitle(candidate)
        )
    );
    if (!link || !title) return null;

    return {
      link,
      url: link.href,
      title,
      order: null,
      direct: false,
    };
  }

  function mergeItemsByUrl(items) {
    const merged = new Map();
    for (const item of items) {
      if (!item.url) continue;
      const existing = merged.get(item.url);
      if (!existing) {
        merged.set(item.url, item);
        continue;
      }

      if (item.title.length > existing.title.length) existing.title = item.title;
      if (!existing.order && item.order) existing.order = item.order;
    }
    return [...merged.values()];
  }

  function getM3u8Items() {
    const rawEntries = getCopyItems().map((item) => ({
      ...item,
      url: item.link.href,
    }));
    const currentItem = currentTopicVideoItem();
    const entries = mergeItemsByUrl(currentItem ? [...rawEntries, currentItem] : rawEntries);
    const input =
      document.querySelector("#" + PANEL_ID + " [data-role='m3u8-input']")?.value || "";

    if (!input.trim() && currentItem?.direct) {
      return { items: [currentItem], missing: [] };
    }

    if (!input.trim()) {
      return { items: likelyVideoItems(entries), missing: [] };
    }

    const requested = parseTitleLines(input);
    const usedUrls = new Set();
    const items = [];
    const missing = [];

    for (const request of requested) {
      const requestedKey = titleMatchKey(request.title);
      let match = entries.find(
        (entry) =>
          !usedUrls.has(entry.url) && titleMatchKey(entry.title) === requestedKey
      );

      if (!match) {
        const partialMatches = entries.filter(
          (entry) =>
            !usedUrls.has(entry.url) &&
            (titleMatchKey(entry.title).startsWith(requestedKey) ||
              requestedKey.startsWith(titleMatchKey(entry.title)))
        );
        if (partialMatches.length === 1) match = partialMatches[0];
      }

      if (!match) {
        missing.push(request.title);
        continue;
      }

      usedUrls.add(match.url);
      items.push({
        ...match,
        order: match.order || request.order,
      });
    }

    return { items, missing };
  }

  async function writeClipboard(value) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("浏览器不支持剪贴板 API");
      let timeoutId;
      try {
        await Promise.race([
          navigator.clipboard.writeText(value),
          new Promise((_, reject) => {
            timeoutId = window.setTimeout(
              () => reject(new Error("剪贴板写入超时")),
              2000
            );
          }),
        ]);
      } finally {
        window.clearTimeout(timeoutId);
      }
      return;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px;";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        if (!document.execCommand("copy")) {
          throw new Error("无法写入剪贴板");
        }
      } finally {
        textarea.remove();
      }
    }
  }

  function setStatus(text, kind = "") {
    const status = document.querySelector(`#${PANEL_ID} [data-role='status']`);
    if (!status) return;
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function updateM3u8CopyButton() {
    const button = document.querySelector(
      "#" + PANEL_ID + " [data-action='copy-m3u8']"
    );
    if (button) button.disabled = restoring || !m3u8Results.length;
  }

  function setBusy(busy, task = "") {
    restoring = busy;
    activeTask = busy ? task : "";
    const restoreButton = document.querySelector(`#${PANEL_ID} [data-action='restore']`);
    const copyButton = document.querySelector(`#${PANEL_ID} [data-action='copy']`);
    const extractButton = document.querySelector(`#${PANEL_ID} [data-action='extract-m3u8']`);
    const input = document.querySelector(`#${PANEL_ID} [data-role='m3u8-input']`);
    const cancelButton = document.querySelector(`#${PANEL_ID} [data-action='cancel']`);
    if (restoreButton) restoreButton.disabled = busy;
    if (copyButton) copyButton.disabled = busy;
    if (extractButton) extractButton.disabled = busy;
    if (input) input.disabled = busy;
    if (cancelButton) cancelButton.hidden = !busy;
    updateM3u8CopyButton();
  }

  function revealLink(link, title) {
    const normalizedTitle = normalizeLookupTitle(title);
    link.textContent = normalizedTitle;
    link.title = normalizedTitle;
    link.dataset.zsxqFullTitle = normalizedTitle;

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
    const items = uniqueCopyItems(getCopyItems());
    const result = items.map(formatCopyItem).join("\n");

    if (!result) {
      setStatus("当前页面没有可复制的课程标题。", "error");
      return;
    }

    try {
      await writeClipboard(result);
    } catch (reason) {
      setStatus(
        "复制失败：" + (reason instanceof Error ? reason.message : String(reason)),
        "error"
      );
      return;
    }

    const hasOrder = items.some((item) => item.order);
    setStatus(
      hasOrder
        ? `已复制 ${items.length} 条课程标题（含学习序号，未标号条目已保留）。`
        : `已复制 ${items.length} 条标题。`,
      "success"
    );
  }

  async function copyM3u8Results() {
    if (!m3u8Results.length) {
      setStatus("当前没有可复制的 m3u8 结果。", "error");
      return;
    }

    const result = m3u8Results
      .map((item) => formatCopyItem(item) + "\t" + item.m3u8)
      .join("\n");

    try {
      await writeClipboard(result);
    } catch (reason) {
      setStatus(
        "复制失败：" + (reason instanceof Error ? reason.message : String(reason)),
        "error"
      );
      return;
    }

    setStatus("已复制 " + m3u8Results.length + " 条 m3u8 链接。", "success");
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

    if (!links.length) {
      setStatus("当前页面没有课程链接，请先打开课程目录。", "error");
      return;
    }

    restoredCount = recoveredUrls.size;
    failedCount = 0;

    if (!uniqueItems.length) {
      setStatus(`完成：已从 title 属性直接恢复 ${restoredCount} 条。`, "success");
      return;
    }

    setBusy(true, "restore");
    setStatus(`已直接恢复 ${restoredCount} 条；正在后台恢复 0/${uniqueItems.length} 条…`);

    try {
      await chrome.runtime.sendMessage({ type: "START_RESTORE", items: uniqueItems });
    } catch {
      setBusy(false);
      setStatus("扩展后台启动失败，请在 chrome://extensions/ 重新加载扩展。", "error");
    }
  }

  async function extractM3u8Links() {
    if (restoring) return;

    const selection = getM3u8Items();
    m3u8Results = [];
    m3u8MissingCount = selection.missing.length;
    m3u8FailureCount = 0;
    updateM3u8CopyButton();

    if (!selection.items.length) {
      setStatus(
        selection.missing.length
          ? "未找到可处理的第一层课程链接（未匹配 " + selection.missing.length + " 条标题）。"
          : "当前页面没有可处理的课程链接。",
        "error"
      );
      return;
    }

    setBusy(true, "m3u8");
    const missingHint = selection.missing.length
      ? "，另有 " + selection.missing.length + " 条标题未匹配"
      : "";
    setStatus(
      "正在提取视频链接 0/" + selection.items.length + " 条" + missingHint + "…"
    );

    try {
      await chrome.runtime.sendMessage({
        type: "START_M3U8",
        items: selection.items.map((item) => ({
          url: item.url,
          title: item.title,
          order: item.order || null,
        })),
      });
    } catch (reason) {
      setBusy(false);
      setStatus(
        "视频链接提取启动失败：" +
          (reason instanceof Error ? reason.message : String(reason)),
        "error"
      );
    }
  }

  function cancelTask() {
    if (!activeTask) return;
    chrome.runtime.sendMessage({
      type: activeTask === "m3u8" ? "CANCEL_M3U8" : "CANCEL_RESTORE",
    });
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
      <label class="zsxq-title-restorer__label" for="zsxq-title-restorer-m3u8-input">
        标题列表（可选）
      </label>
      <textarea id="zsxq-title-restorer-m3u8-input" data-role="m3u8-input" rows="4" placeholder="粘贴标题列表；留空则处理当前页面课程链接"></textarea>
      <div class="zsxq-title-restorer__actions">
        <button type="button" data-action="restore">恢复完整标题</button>
        <button type="button" data-action="copy">复制标题（含序号）</button>
        <button type="button" data-action="extract-m3u8">提取 m3u8</button>
        <button type="button" data-action="copy-m3u8" disabled>复制 m3u8 结果</button>
        <button type="button" data-action="cancel" hidden>停止</button>
      </div>
      <small>可粘贴带序号标题；提取会依次经过第一层和第二层页面。m3u8 链接带时效 token，请及时保存。</small>
    `;
    document.documentElement.appendChild(panel);

    panel.querySelector("[data-action='restore']").addEventListener("click", restoreTitles);
    panel.querySelector("[data-action='copy']").addEventListener("click", copyTitles);
    panel.querySelector("[data-action='extract-m3u8']").addEventListener("click", extractM3u8Links);
    panel.querySelector("[data-action='copy-m3u8']").addEventListener("click", copyM3u8Results);
    panel.querySelector("[data-action='cancel']").addEventListener("click", cancelTask);
    panel.querySelector("[data-action='minimize']").addEventListener("click", () => {
      panel.classList.toggle("is-minimized");
    });
    updateM3u8CopyButton();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "RESTORE_PROGRESS") {
      if (activeTask !== "restore") return;
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
      if (activeTask !== "restore") return;
      setBusy(false);
      if (message.error) {
        setStatus(`处理失败：${message.error}`, "error");
      } else if (message.cancelled) {
        setStatus(`已停止：成功恢复 ${restoredCount} 条。`, "error");
      } else {
        setStatus(`完成：恢复 ${restoredCount} 条，失败 ${failedCount} 条。请点击“复制标题（含序号）”。`, "success");
      }
      return;
    }

    if (message?.type === "M3U8_PROGRESS") {
      if (activeTask !== "m3u8") return;

      if (message.m3u8) {
        m3u8Results.push({
          title: normalizeLookupTitle(message.title),
          order: message.order || null,
          m3u8: String(message.m3u8).trim(),
          sourceUrl: message.sourceUrl || "",
        });
      } else {
        m3u8FailureCount += 1;
      }

      updateM3u8CopyButton();
      setStatus(
        "视频链接提取：" +
          message.current +
          "/" +
          message.total +
          "（成功 " +
          m3u8Results.length +
          "，失败 " +
          m3u8FailureCount +
          "）",
        message.error ? "error" : ""
      );
      return;
    }

    if (message?.type === "M3U8_FINISHED") {
      if (activeTask !== "m3u8") return;

      setBusy(false);
      if (message.error) {
        setStatus("视频链接提取失败：" + message.error, "error");
      } else if (message.cancelled) {
        const totalFailed = m3u8FailureCount + m3u8MissingCount;
        setStatus(
          "已停止：成功提取 " +
            m3u8Results.length +
            " 条，失败 " +
            totalFailed +
            " 条。",
          "error"
        );
      } else {
        const missingHint = m3u8MissingCount
          ? "，未匹配 " + m3u8MissingCount + " 条标题"
          : "";
        const totalFailed = m3u8FailureCount + m3u8MissingCount;
        setStatus(
          "完成：成功提取 " +
            m3u8Results.length +
            " 条，失败 " +
            totalFailed +
            " 条" +
            missingHint +
            "。可点击“复制 m3u8 结果”。",
          m3u8Results.length ? "success" : "error"
        );
      }
    }
  });

  createPanel();
})();
