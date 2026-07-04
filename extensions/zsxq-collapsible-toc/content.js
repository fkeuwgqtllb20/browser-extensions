(() => {
  'use strict';

  const ROOT_ID = 'zsxq-toc-root';
  const STORAGE_KEY = 'zsxq-toc-collapsed';
  const ARTICLE_SELECTORS = [
    '.content.ql-editor',
    'article',
    'main',
    '.post .content',
    '.post'
  ];

  let refreshTimer = 0;
  let observer = null;
  let activeIndex = -1;

  function textOf(element) {
    return (element?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function findArticle() {
    const candidates = ARTICLE_SELECTORS.flatMap(selector => [...document.querySelectorAll(selector)]);
    return candidates
      .filter(element => !element.closest(`#${ROOT_ID}`))
      .map(element => ({ element, headings: getRawHeadings(element), textLength: textOf(element).length }))
      .filter(item => item.headings.length > 0)
      .sort((a, b) => scoreArticle(b) - scoreArticle(a))[0]?.element || null;
  }

  function scoreArticle(item) {
    const contentBonus = item.element.matches('.content.ql-editor') ? 10000 : 0;
    return contentBonus + item.headings.length * 100 + Math.min(item.textLength, 10000);
  }

  function getRawHeadings(container) {
    return [...container.querySelectorAll('h2,h3,h4')]
      .filter(heading => textOf(heading).length > 0)
      .filter(isVisible);
  }

  function collectHeadings() {
    const article = findArticle();
    if (!article) return [];

    return getRawHeadings(article).map((element, index) => {
      element.dataset.zsxqTocIndex = String(index);
      return {
        element,
        index,
        level: Number(element.tagName.slice(1)),
        text: textOf(element)
      };
    });
  }

  function createRoot() {
    const root = document.createElement('aside');
    root.id = ROOT_ID;
    root.setAttribute('aria-label', '文章目录');
    document.body.appendChild(root);
    return root;
  }

  function render() {
    const headings = collectHeadings();
    const oldRoot = document.getElementById(ROOT_ID);

    if (headings.length < 2) {
      oldRoot?.remove();
      return;
    }

    const root = oldRoot || createRoot();
    const collapsed = localStorage.getItem(STORAGE_KEY) === '1';
    root.className = collapsed ? 'zsxq-toc is-collapsed' : 'zsxq-toc';
    root.innerHTML = buildHtml(headings, collapsed);
    bindEvents(root, headings);
    updateActive(headings);
  }

  function buildHtml(headings, collapsed) {
    const label = collapsed ? '展开目录' : '收起目录';
    const arrow = collapsed ? '›' : '‹';
    const items = headings.map(heading => `
      <button class="zsxq-toc__item zsxq-toc__item--h${heading.level}" data-index="${heading.index}" title="${escapeHtml(heading.text)}">
        <span class="zsxq-toc__dot"></span>
        <span class="zsxq-toc__text">${escapeHtml(heading.text)}</span>
      </button>
    `).join('');

    return `
      <div class="zsxq-toc__header">
        <strong class="zsxq-toc__title">目录</strong>
        <button class="zsxq-toc__toggle" type="button" aria-label="${label}" title="${label}">${arrow}</button>
      </div>
      <div class="zsxq-toc__body">${items}</div>
    `;
  }

  function bindEvents(root, headings) {
    root.querySelector('.zsxq-toc__toggle')?.addEventListener('click', () => toggle(root));
    root.querySelectorAll('.zsxq-toc__item').forEach(button => {
      button.addEventListener('click', () => scrollToHeading(button, headings));
    });
  }

  function toggle(root) {
    const collapsed = !root.classList.contains('is-collapsed');
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    render();
  }

  function scrollToHeading(button, headings) {
    const item = headings[Number(button.dataset.index)];
    if (!item) return;

    const top = Math.max(0, item.element.getBoundingClientRect().top + window.scrollY - 16);
    window.scrollTo({ top, behavior: 'smooth' });
    window.setTimeout(() => {
      if (Math.abs(item.element.getBoundingClientRect().top - 16) > 28) window.scrollTo(0, top);
    }, 450);

    history.replaceState(null, '', `${location.pathname}${location.search}#toc-${item.index + 1}`);
    setActive(item.index);
  }

  function updateActive(headings) {
    const viewportOffset = 120;
    let current = 0;

    for (const heading of headings) {
      if (heading.element.getBoundingClientRect().top <= viewportOffset) current = heading.index;
      else break;
    }

    setActive(current);
  }

  function setActive(index) {
    if (activeIndex === index) return;
    activeIndex = index;

    document.querySelectorAll(`#${ROOT_ID} .zsxq-toc__item`).forEach(button => {
      button.classList.toggle('is-active', Number(button.dataset.index) === index);
    });
  }

  function escapeHtml(value) {
    return value.replace(/[&<>'"]/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[char]));
  }

  function scheduleRender() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(render, 250);
  }

  function startObserver() {
    observer?.disconnect();
    observer = new MutationObserver(mutations => {
      if (mutations.every(mutation => document.getElementById(ROOT_ID)?.contains(mutation.target))) return;
      scheduleRender();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('scroll', () => updateActive(collectHeadings()), { passive: true });
  window.addEventListener('resize', scheduleRender, { passive: true });
  render();
  startObserver();
})();
