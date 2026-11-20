(() => {
  'use strict';

  const core = window.__BCDN_CORE;
  if (!core || document.getElementById('bcdn-app')) return;

  const STORAGE_KEY = 'bcdn-prefs';
  const MIN_RUN_TO_COLLAPSE = 3;
  const TOP_GUARD = 8;

  let report = { rows: [], groups: [] };
  let table = null;
  let current = -1;
  let collapsed = false;
  let leftBody = null;
  let rightBody = null;
  let rowNodes = { left: [], right: [] };
  let scrollLock = false;
  let modal = null;
  let modalParts = null;
  let ui = null;

  const prefs = loadPrefs();

  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch (error) {
      return {};
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ collapsed }));
    } catch (error) {
      /* file:// 下可能禁止存储，忽略 */
    }
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
    ));
  }

  function basename(path) {
    const parts = String(path).split(/[\\/]/);
    return parts[parts.length - 1] || path;
  }

  // 从报告顶部文字里取左右文件名，展示在标题栏，避免丢失上下文
  function readFileNames() {
    const text = document.body.textContent || '';
    const left = text.match(/Left file:\s*(.+)/i);
    const right = text.match(/Right file:\s*(.+)/i);
    return {
      left: left ? basename(left[1].trim()) : '左文件',
      right: right ? basename(right[1].trim()) : '右文件'
    };
  }

  /* ---------------- 视图搭建 ---------------- */

  function build() {
    const names = readFileNames();
    const app = document.createElement('div');
    app.id = 'bcdn-app';
    app.innerHTML = `
      <div class="bcdn-bar">
        <div class="bcdn-bar__main">
          <button type="button" class="bcdn-step" data-act="prev" title="上一个差异 (Alt+↑)">◀</button>
          <span class="bcdn-count" data-role="count" title="当前 / 总差异数">—</span>
          <button type="button" class="bcdn-step" data-act="next" title="下一个差异 (Alt+↓)">▶</button>
          <span class="bcdn-sep"></span>
          <button type="button" class="bcdn-chip" data-act="collapse" aria-pressed="false" title="折叠连续相同的行">仅看差异</button>
          <button type="button" class="bcdn-icon" data-act="zoom" title="放大对照当前差异（也可双击差异行）">⤢</button>
          <button type="button" class="bcdn-icon" data-act="minimize" title="收起工具条">–</button>
        </div>
        <button type="button" class="bcdn-pill" data-act="expand" title="展开工具条">
          差异 <b data-role="mini">—</b>
        </button>
      </div>
      <div class="bcdn-split">
        <section class="bcdn-pane bcdn-pane--left">
          <header class="bcdn-pane__head">
            <span class="bcdn-pane__tag bcdn-pane__tag--left">左</span>
            <span class="bcdn-pane__file" title="${escapeHtml(names.left)}">${escapeHtml(names.left)}</span>
            <span class="bcdn-pane__hint">滚轮/拖动任一侧，另一侧同步</span>
          </header>
          <div class="bcdn-body" data-role="left-body" tabindex="0"></div>
        </section>
        <div class="bcdn-divider" title="拖动调整左右宽度"></div>
        <section class="bcdn-pane bcdn-pane--right">
          <header class="bcdn-pane__head">
            <span class="bcdn-pane__tag bcdn-pane__tag--right">右</span>
            <span class="bcdn-pane__file" title="${escapeHtml(names.right)}">${escapeHtml(names.right)}</span>
          </header>
          <div class="bcdn-body" data-role="right-body" tabindex="0"></div>
        </section>
      </div>
    `;

    document.documentElement.appendChild(app);
    ui = app;

    leftBody = app.querySelector('[data-role="left-body"]');
    rightBody = app.querySelector('[data-role="right-body"]');

    app.querySelector('[data-act="collapse"]').setAttribute('aria-pressed', String(collapsed));

    app.addEventListener('click', event => {
      const button = event.target.closest('button[data-act]');
      if (!button) return;
      const action = button.dataset.act;
      if (action === 'prev') go(-1);
      if (action === 'next') go(1);
      if (action === 'collapse') setCollapsed(!collapsed);
      if (action === 'zoom') openModal(current >= 0 ? current : 0);
      if (action === 'minimize') app.classList.add('bcdn-app--mini');
      if (action === 'expand') app.classList.remove('bcdn-app--mini');
    });

    // 双栏横向 + 纵向联动
    leftBody.addEventListener('scroll', () => mirror(leftBody, rightBody));
    rightBody.addEventListener('scroll', () => mirror(rightBody, leftBody));

    // 双击差异行放大对照
    leftBody.addEventListener('dblclick', onRowDoubleClick);
    rightBody.addEventListener('dblclick', onRowDoubleClick);

    buildDivider(app.querySelector('.bcdn-divider'));

    document.body.classList.add('bcdn-has-app');
    if (table) table.classList.add('bcdn-src-hidden');
  }

  function buildDivider(divider) {
    let dragging = false;

    divider.addEventListener('pointerdown', event => {
      dragging = true;
      divider.setPointerCapture(event.pointerId);
      document.body.classList.add('bcdn-dragging');
    });

    divider.addEventListener('pointermove', event => {
      if (!dragging) return;
      const split = divider.parentElement.getBoundingClientRect();
      const ratio = (event.clientX - split.left) / split.width;
      const clamped = Math.min(0.8, Math.max(0.2, ratio));
      ui.style.setProperty('--bcdn-split', `${(clamped * 100).toFixed(2)}%`);
    });

    const stop = () => {
      dragging = false;
      document.body.classList.remove('bcdn-dragging');
    };
    divider.addEventListener('pointerup', stop);
    divider.addEventListener('pointercancel', stop);
  }

  function mirror(from, to) {
    if (scrollLock) return;
    const sameX = Math.abs(to.scrollLeft - from.scrollLeft) < 1;
    const sameY = Math.abs(to.scrollTop - from.scrollTop) < 1;
    if (sameX && sameY) return;
    scrollLock = true;
    to.scrollLeft = from.scrollLeft;
    to.scrollTop = from.scrollTop;
    requestAnimationFrame(() => { scrollLock = false; });
  }

  /* ---------------- 行渲染 ---------------- */

  function cellClasses(row, side) {
    const cls = side === 'left' ? row.leftClass : row.rightClass;
    const classes = ['bcdn-cell'];
    if (row.diff) classes.push('bcdn-cell--diff');
    if (row.significant) classes.push('bcdn-cell--sig');
    if (/\bTextItem(?:Sig|Insig)Add\b/.test(cls || '')) classes.push('bcdn-cell--add');
    if (/\bTextItem(?:Sig|Insig)Del\b/.test(cls || '')) classes.push('bcdn-cell--del');
    if (/\bTextItem(?:Sig|Insig)Orphan\b/.test(cls || '')) classes.push('bcdn-cell--orphan');
    return classes.join(' ');
  }

  function makeRow(row, side) {
    const el = document.createElement('div');
    el.className = 'bcdn-row';
    el.dataset.row = String(row.index);
    el.dataset.side = side;

    const num = document.createElement('span');
    num.className = 'bcdn-ln';
    num.textContent = (side === 'left' ? row.leftNum : row.rightNum) || '';

    const code = document.createElement('span');
    code.className = cellClasses(row, side);
    // 复用原报告的 HTML，保留语法高亮与 &nbsp; 缩进
    code.innerHTML = (side === 'left' ? row.leftHTML : row.rightHTML) || '&nbsp;';

    el.append(num, code);
    return el;
  }

  function makeGap(count) {
    const el = document.createElement('div');
    el.className = 'bcdn-row bcdn-row--gap';
    el.innerHTML = `<span class="bcdn-gap">⋯ 已折叠 ${count} 行相同内容</span>`;
    return el;
  }

  // 生成“渲染计划”：折叠时把成段的相同行替换为一个占位条
  function planRows() {
    const plan = [];
    if (!collapsed) {
      report.rows.forEach(row => plan.push({ type: 'row', row }));
      return plan;
    }
    let run = 0;
    let runStart = null;
    report.rows.forEach(row => {
      if (row.diff) {
        if (run) {
          if (run >= MIN_RUN_TO_COLLAPSE) plan.push({ type: 'gap', count: run });
          else for (let i = 0; i < run; i++) plan.push({ type: 'row', row: report.rows[runStart + i] });
          run = 0;
        }
        plan.push({ type: 'row', row });
        return;
      }
      if (!run) runStart = row.index;
      run += 1;
    });
    if (run) {
      if (run >= MIN_RUN_TO_COLLAPSE) plan.push({ type: 'gap', count: run });
      else for (let i = 0; i < run; i++) plan.push({ type: 'row', row: report.rows[runStart + i] });
    }
    return plan;
  }

  function render() {
    const plan = planRows();
    const leftFrag = document.createDocumentFragment();
    const rightFrag = document.createDocumentFragment();
    rowNodes = { left: new Array(report.rows.length), right: new Array(report.rows.length) };

    plan.forEach(item => {
      if (item.type === 'gap') {
        leftFrag.appendChild(makeGap(item.count));
        rightFrag.appendChild(makeGap(item.count));
        return;
      }
      const leftEl = makeRow(item.row, 'left');
      const rightEl = makeRow(item.row, 'right');
      rowNodes.left[item.row.index] = leftEl;
      rowNodes.right[item.row.index] = rightEl;
      leftFrag.appendChild(leftEl);
      rightFrag.appendChild(rightEl);
    });

    const keepTop = leftBody.scrollTop;
    leftBody.textContent = '';
    rightBody.textContent = '';
    leftBody.appendChild(leftFrag);
    rightBody.appendChild(rightFrag);
    leftBody.scrollTop = keepTop;
    rightBody.scrollTop = keepTop;

    applyActiveClasses();
  }

  function applyActiveClasses() {
    for (const side of ['left', 'right']) {
      document.querySelectorAll('.bcdn-row--active').forEach(el => {
        el.classList.remove('bcdn-row--active', 'bcdn-row--active-first', 'bcdn-row--active-last');
      });
      rowNodes[side] = rowNodes[side] || [];
    }
    const group = report.groups[current];
    if (!group) return;
    for (const side of ['left', 'right']) {
      for (let i = group.start; i <= group.end; i++) {
        const el = rowNodes[side][i];
        if (!el) continue;
        el.classList.add('bcdn-row--active');
        if (i === group.start) el.classList.add('bcdn-row--active-first');
        if (i === group.end) el.classList.add('bcdn-row--active-last');
      }
    }
  }

  /* ---------------- 导航 ---------------- */

  function setCollapsed(next) {
    collapsed = next;
    const chip = ui?.querySelector('[data-act="collapse"]');
    if (chip) chip.setAttribute('aria-pressed', String(collapsed));
    savePrefs();
    render();
    if (current >= 0) centerGroup(report.groups[current]);
  }

  function go(step) {
    if (report.groups.length === 0) return;
    if (current < 0) {
      goTo(step > 0 ? 0 : report.groups.length - 1);
      return;
    }
    goTo((current + step + report.groups.length) % report.groups.length);
  }

  function goTo(index) {
    if (report.groups.length === 0) return;
    current = Math.max(0, Math.min(index, report.groups.length - 1));
    applyActiveClasses();
    updateCounter();
    centerGroup(report.groups[current]);
  }

  function centerGroup(group) {
    const target = rowNodes.left[group.start];
    if (!target) return;
    const lastEl = rowNodes.left[group.end] || target;
    const offsetTop = target.offsetTop;
    const height = lastEl.offsetTop + lastEl.offsetHeight - offsetTop;
    const viewH = leftBody.clientHeight;

    // 一块装不下时贴顶显示，否则整体垂直居中
    const top = height > viewH * 0.8
      ? offsetTop - TOP_GUARD
      : offsetTop - (viewH - height) / 2;

    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const value = Math.max(0, top);
    leftBody.scrollTo({ top: value, behavior });
    rightBody.scrollTo({ top: value, behavior });
  }

  function updateCounter() {
    if (!ui) return;
    const counter = ui.querySelector('[data-role="count"]');
    const mini = ui.querySelector('[data-role="mini"]');
    const total = report.groups.length;
    if (total === 0) {
      counter.textContent = '无差异';
      mini.textContent = '无';
      return;
    }
    const significant = report.groups.filter(group => group.significant).length;
    const position = current >= 0 ? `${current + 1}/${total}` : `共 ${total}`;
    counter.textContent = `${position} · 显著 ${significant}`;
    mini.textContent = position;
  }

  /* ---------------- 放大对照 ---------------- */

  function buildModal() {
    modal = document.createElement('div');
    modal.id = 'bcdn-modal';
    modal.className = 'bcdn-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="bcdn-modal__backdrop" data-act="close"></div>
      <div class="bcdn-modal__box" role="dialog" aria-modal="true" aria-label="差异对照">
        <div class="bcdn-modal__head">
          <span class="bcdn-modal__title" data-role="title">差异对照</span>
          <span class="bcdn-modal__hint">上下结构 · 横向联动滚动 · Esc 关闭 · Alt+↑/↓ 切换差异</span>
          <button type="button" class="bcdn-modal__close" data-act="close" title="关闭 (Esc)">✕</button>
        </div>
        <div class="bcdn-modal__panes">
          <section class="bcdn-pane">
            <div class="bcdn-pane__head">
              <span class="bcdn-pane__tag bcdn-pane__tag--left">左</span>
              <span class="bcdn-pane__lines" data-role="left-lines"></span>
            </div>
            <div class="bcdn-code" data-role="left-code" tabindex="0"></div>
          </section>
          <section class="bcdn-pane">
            <div class="bcdn-pane__head">
              <span class="bcdn-pane__tag bcdn-pane__tag--right">右</span>
              <span class="bcdn-pane__lines" data-role="right-lines"></span>
            </div>
            <div class="bcdn-code" data-role="right-code" tabindex="0"></div>
          </section>
        </div>
      </div>
    `;

    modal.addEventListener('click', event => {
      if (event.target.closest('[data-act="close"]')) closeModal();
    });

    modalParts = {
      title: modal.querySelector('[data-role="title"]'),
      leftCode: modal.querySelector('[data-role="left-code"]'),
      rightCode: modal.querySelector('[data-role="right-code"]'),
      leftLines: modal.querySelector('[data-role="left-lines"]'),
      rightLines: modal.querySelector('[data-role="right-lines"]')
    };

    modalParts.leftCode.addEventListener('scroll', () => mirror(modalParts.leftCode, modalParts.rightCode));
    modalParts.rightCode.addEventListener('scroll', () => mirror(modalParts.rightCode, modalParts.leftCode));

    document.documentElement.appendChild(modal);

    window.addEventListener('resize', () => {
      if (!modal.hidden) alignScrollRanges();
    });
  }

  function lineRange(numbers) {
    const valid = numbers.filter(Boolean);
    if (valid.length === 0) return '—';
    if (valid.length === 1) return valid[0];
    return `${valid[0]}–${valid[valid.length - 1]}`;
  }

  // 报告里空行写作 &nbsp;，剥离标签与实体后再判断是否真的没内容
  function isBlankHtml(html) {
    return String(html || '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;|&#160;/gi, '')
      .trim().length === 0;
  }

  function renderModalSide(container, rows, side) {
    container.textContent = '';
    const inner = document.createElement('div');
    inner.className = 'bcdn-code__inner';

    const htmlKey = side === 'left' ? 'leftHTML' : 'rightHTML';
    const numKey = side === 'left' ? 'leftNum' : 'rightNum';
    const hasText = rows.some(row => !isBlankHtml(row[htmlKey]));

    if (!hasText) {
      const empty = document.createElement('div');
      empty.className = 'bcdn-code__empty';
      empty.textContent = '（该侧无对应内容）';
      inner.appendChild(empty);
      container.appendChild(inner);
      return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach(row => {
      const el = document.createElement('div');
      el.className = 'bcdn-line';
      const num = document.createElement('span');
      num.className = 'bcdn-ln';
      num.textContent = row[numKey] || '';
      const code = document.createElement('span');
      code.className = cellClasses(row, side);
      code.innerHTML = row[htmlKey] || '&nbsp;';
      el.append(num, code);
      fragment.appendChild(el);
    });
    inner.appendChild(fragment);
    container.appendChild(inner);
  }

  function alignScrollRanges() {
    const { leftCode, rightCode } = modalParts;
    [leftCode, rightCode].forEach(code => {
      const inner = code.firstElementChild;
      if (inner) inner.style.minWidth = '';
    });
    const width = Math.max(leftCode.scrollWidth, rightCode.scrollWidth);
    if (!width) return;
    [leftCode, rightCode].forEach(code => {
      const inner = code.firstElementChild;
      if (inner) inner.style.minWidth = `${width}px`;
    });
  }

  function openModal(groupIndex) {
    if (!modal) buildModal();
    const group = report.groups[groupIndex];
    if (!group) return;

    const rows = report.rows.slice(group.start, group.end + 1);
    const leftSpan = lineRange(rows.map(row => row.leftNum));
    const rightSpan = lineRange(rows.map(row => row.rightNum));

    modalParts.title.textContent = `差异对照 · 左 ${leftSpan} · 右 ${rightSpan}`;
    modalParts.leftLines.textContent = leftSpan;
    modalParts.rightLines.textContent = rightSpan;
    renderModalSide(modalParts.leftCode, rows, 'left');
    renderModalSide(modalParts.rightCode, rows, 'right');

    modal.hidden = false;
    alignScrollRanges();
    modalParts.leftCode.scrollLeft = 0;
    modalParts.rightCode.scrollLeft = 0;
    modalParts.leftCode.scrollTop = 0;
    modalParts.rightCode.scrollTop = 0;
  }

  function closeModal() {
    if (modal) modal.hidden = true;
  }

  function onRowDoubleClick(event) {
    const rowEl = event.target.closest('.bcdn-row[data-row]');
    if (!rowEl) return;
    const index = Number(rowEl.dataset.row);
    const group = report.groups.find(g => index >= g.start && index <= g.end);
    if (!group) return;
    event.preventDefault();
    openModal(group.index);
  }

  /* ---------------- 事件 ---------------- */

  function onKeydown(event) {
    if (modal && !modal.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        go(event.key === 'ArrowDown' ? 1 : -1);
        if (report.groups[current]) openModal(current);
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) return;
    if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      go(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.altKey && event.key === 'Home') {
      event.preventDefault();
      goTo(0);
    }
  }

  function start() {
    table = core.findReportTable();
    if (!table) return;
    report = core.describeReport(table);
    if (report.rows.length === 0) return;

    collapsed = Boolean(prefs.collapsed);
    build();
    render();
    updateCounter();
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('resize', () => {
      if (modal && !modal.hidden) alignScrollRanges();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
