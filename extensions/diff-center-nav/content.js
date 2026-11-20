(() => {
  'use strict';

  const core = window.__BCDN_CORE;
  if (!core || document.getElementById('bcdn-root')) return;

  const STORAGE_KEY = 'bcdn-prefs';
  const MIN_RUN_TO_COLLAPSE = 3;

  let table = null;
  let groups = [];
  let current = -1;
  let collapsed = false;
  let placeholders = [];
  let ui = null;
  let modal = null;
  let modalParts = null;
  let scrollLock = false;

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

  /* ---------------- 工具条 ---------------- */

  function buildPanel() {
    const root = document.createElement('div');
    root.id = 'bcdn-root';
    root.className = 'bcdn-bar';
    root.innerHTML = `
      <div class="bcdn-bar__main">
        <button type="button" class="bcdn-step" data-act="prev" title="上一个差异 (Alt+↑)">◀</button>
        <span class="bcdn-count" data-role="count" title="当前 / 总差异数">—</span>
        <button type="button" class="bcdn-step" data-act="next" title="下一个差异 (Alt+↓)">▶</button>
        <span class="bcdn-sep"></span>
        <button type="button" class="bcdn-chip" data-act="collapse" aria-pressed="false" title="折叠连续相同的行">仅看差异</button>
        <button type="button" class="bcdn-icon" data-act="zoom" title="放大对照当前差异（也可双击差异行）">⤢</button>
        <button type="button" class="bcdn-icon" data-act="rescan" title="重新扫描差异">⟳</button>
        <button type="button" class="bcdn-icon" data-act="minimize" title="收起">–</button>
      </div>
      <button type="button" class="bcdn-pill" data-act="expand" title="展开差异导航">
        差异 <b data-role="mini">—</b>
      </button>
    `;

    root.querySelector('[data-act="collapse"]').setAttribute('aria-pressed', String(collapsed));

    root.addEventListener('click', event => {
      const button = event.target.closest('button[data-act]');
      if (!button) return;
      const action = button.dataset.act;
      if (action === 'prev') go(-1);
      if (action === 'next') go(1);
      if (action === 'rescan') rescan();
      if (action === 'collapse') setCollapsed(!collapsed);
      if (action === 'zoom') openModal(groups[current >= 0 ? current : 0]);
      if (action === 'minimize') root.classList.add('bcdn-bar--mini');
      if (action === 'expand') root.classList.remove('bcdn-bar--mini');
    });

    document.documentElement.appendChild(root);
    ui = root;
  }

  function setCollapsed(next) {
    collapsed = next;
    const chip = ui?.querySelector('[data-act="collapse"]');
    if (chip) chip.setAttribute('aria-pressed', String(collapsed));
    savePrefs();
    applyCollapse();
    if (current >= 0 && groups[current]) centerGroup(groups[current]);
  }

  /* ---------------- 差异扫描 ---------------- */

  function rescan() {
    expandAll();
    groups = core.collectGroups(table);
    groups.forEach((group, index) => {
      group.rows.forEach(row => {
        row.dataset.bcdnGroup = String(index);
        row.classList.add('bcdn-diff');
        row.classList.toggle('bcdn-sig', group.significant);
        row.classList.remove('bcdn-active', 'bcdn-active-first', 'bcdn-active-last');
      });
    });
    if (current >= groups.length) current = groups.length - 1;
    applyCollapse();
    updateCounter();
    if (current >= 0 && groups[current]) setActive(current, false);
    else current = -1;
  }

  function applyCollapse() {
    expandAll();
    if (!collapsed || groups.length === 0) {
      updateCounter();
      return;
    }
    const runs = collectRuns();
    if (runs.length) {
      // 先按展开状态量好列宽再隐藏行，否则浏览器会按剩余可见行重排列宽
      freezeColumnWidths();
      runs.forEach(collapseRun);
    }
    updateCounter();
  }

  function collectRuns() {
    const runs = [];
    let run = [];
    for (const row of [...table.rows]) {
      if (row.classList.contains('bcdn-diff')) {
        if (run.length) runs.push(run.splice(0));
        continue;
      }
      run.push(row);
    }
    if (run.length) runs.push(run);
    return runs;
  }

  function freezeColumnWidths() {
    if (!table || table.querySelector('colgroup.bcdn-cols')) return;
    const ref = [...table.rows].find(row => !row.hidden && row.cells.length === 5);
    if (!ref) return;
    const widths = [...ref.cells].map(cell => cell.getBoundingClientRect().width);
    const total = widths.reduce((sum, width) => sum + width, 0);
    if (!total) return;

    // 必须用绝对像素并显式锁定表格总宽：
    // 百分比列宽配 table-layout:fixed 会让整表收缩到视口宽，
    // 在超宽报告（列宽上千 px）上会把内容压扁。
    const colgroup = document.createElement('colgroup');
    colgroup.className = 'bcdn-cols';
    widths.forEach(width => {
      const col = document.createElement('col');
      col.style.width = `${Math.round(width)}px`;
      colgroup.appendChild(col);
    });
    table.insertBefore(colgroup, table.firstChild);
    table.style.width = `${Math.round(total)}px`;
    table.style.tableLayout = 'fixed';
  }

  function unfreezeColumnWidths() {
    if (!table) return;
    table.querySelector('colgroup.bcdn-cols')?.remove();
    table.style.tableLayout = '';
    table.style.width = '';
  }

  function collapseRun(rows) {
    if (rows.length < MIN_RUN_TO_COLLAPSE) return;
    const holder = document.createElement('tr');
    holder.className = 'bcdn-collapsed-row';
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = `⋯ 已折叠 ${rows.length} 行相同内容 · 点击展开`;
    cell.addEventListener('click', () => expandRun(holder, rows));
    holder.appendChild(cell);
    rows.forEach(row => { row.hidden = true; });
    rows[rows.length - 1].after(holder);
    placeholders.push({ holder, rows });
  }

  function expandRun(holder, rows) {
    rows.forEach(row => { row.hidden = false; });
    holder.remove();
    placeholders = placeholders.filter(item => item.holder !== holder);
  }

  function expandAll() {
    placeholders.forEach(({ holder }) => holder.remove());
    placeholders = [];
    if (!table) return;
    for (const row of table.rows) {
      if (row.hidden) row.hidden = false;
    }
    unfreezeColumnWidths();
  }

  /* ---------------- 跳转与高亮 ---------------- */

  function go(step) {
    if (groups.length === 0) return;
    if (current < 0) {
      goTo(step > 0 ? 0 : groups.length - 1);
      return;
    }
    goTo((current + step + groups.length) % groups.length);
  }

  function goTo(index) {
    if (groups.length === 0) return;
    setActive(Math.max(0, Math.min(index, groups.length - 1)), true);
  }

  function setActive(index, shouldScroll) {
    if (groups[current]) {
      groups[current].rows.forEach(row => {
        row.classList.remove('bcdn-active', 'bcdn-active-first', 'bcdn-active-last');
      });
    }
    current = index;
    const group = groups[index];
    if (!group) return;

    group.rows.forEach(row => row.classList.add('bcdn-active'));
    group.rows[0].classList.add('bcdn-active-first');
    group.rows[group.rows.length - 1].classList.add('bcdn-active-last');

    updateCounter();
    if (shouldScroll) {
      centerGroup(group);
      pulsePanel();
    }
  }

  function centerGroup(group) {
    const visible = group.rows.filter(row => !row.hidden);
    if (visible.length === 0) return;
    const first = visible[0].getBoundingClientRect();
    const last = visible[visible.length - 1].getBoundingClientRect();
    const height = last.bottom - first.top;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = reduce ? 'auto' : 'smooth';
    const topGuard = 72;
    const offset = height > window.innerHeight * 0.8
      ? first.top - topGuard
      : (first.top + last.bottom) / 2 - window.innerHeight / 2;
    window.scrollTo({ top: Math.max(0, window.scrollY + offset), behavior });
  }

  function updateCounter() {
    if (!ui) return;
    const counter = ui.querySelector('[data-role="count"]');
    const mini = ui.querySelector('[data-role="mini"]');
    const significant = groups.filter(group => group.significant).length;

    if (groups.length === 0) {
      counter.textContent = '无差异';
      mini.textContent = '无';
      return;
    }
    const position = current >= 0 ? `${current + 1}/${groups.length}` : `共 ${groups.length}`;
    counter.textContent = `${position} · 显著 ${significant}`;
    mini.textContent = position;
  }

  function pulsePanel() {
    if (!ui) return;
    ui.classList.remove('bcdn-flash');
    void ui.offsetWidth;
    ui.classList.add('bcdn-flash');
  }

  /* ---------------- 双击放大对照 ---------------- */

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
          <span class="bcdn-modal__hint">左右/上下横向联动滚动 · Esc 关闭</span>
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

    // 横向联动：滚任意一边，另一边跟着滚；纵向各自独立
    const { leftCode, rightCode } = modalParts;
    leftCode.addEventListener('scroll', () => mirrorScroll(leftCode, rightCode));
    rightCode.addEventListener('scroll', () => mirrorScroll(rightCode, leftCode));

    document.documentElement.appendChild(modal);

    // 窗口尺寸变化后两侧可用宽度会变，需重新对齐滚动范围
    window.addEventListener('resize', () => {
      if (!modal.hidden) alignScrollRanges();
    });
  }

  function mirrorScroll(from, to) {
    if (scrollLock || to.scrollLeft === from.scrollLeft) return;
    scrollLock = true;
    to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => { scrollLock = false; });
  }

  function lineCellsOf(row) {
    return {
      leftNum: (row.cells[0].textContent || '').trim(),
      leftText: row.cells[1].textContent || '',
      rightNum: (row.cells[3].textContent || '').trim(),
      rightText: row.cells[4].textContent || ''
    };
  }

  function renderSide(container, lines, numberKey, textKey) {
    container.textContent = '';
    const inner = document.createElement('div');
    inner.className = 'bcdn-code__inner';

    const hasText = lines.some(line => line[textKey].trim().length > 0);
    if (!hasText) {
      const empty = document.createElement('div');
      empty.className = 'bcdn-code__empty';
      empty.textContent = '（该侧无对应内容）';
      inner.appendChild(empty);
      container.appendChild(inner);
      return;
    }

    const fragment = document.createDocumentFragment();
    lines.forEach(line => {
      const row = document.createElement('div');
      row.className = 'bcdn-line';
      const num = document.createElement('span');
      num.className = 'bcdn-ln';
      num.textContent = line[numberKey] || '';
      const text = document.createElement('span');
      text.className = 'bcdn-txt';
      // 空行补一个空格，撑住行高，保证两侧行对齐
      text.textContent = line[textKey] || ' ';
      row.append(num, text);
      fragment.appendChild(row);
    });
    inner.appendChild(fragment);
    container.appendChild(inner);
  }

  // 两侧内容宽度取一致，否则短的一侧没有可滚动范围，横向联动会失效
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

  function openModal(group) {
    if (!modal) buildModal();
    if (!group || group.rows.length === 0) return;

    const lines = group.rows.map(lineCellsOf);
    const leftSpan = lineRange(lines.map(line => line.leftNum));
    const rightSpan = lineRange(lines.map(line => line.rightNum));

    modalParts.title.textContent = `差异对照 · 左 ${leftSpan} · 右 ${rightSpan}`;
    modalParts.leftLines.textContent = leftSpan;
    modalParts.rightLines.textContent = rightSpan;
    renderSide(modalParts.leftCode, lines, 'leftNum', 'leftText');
    renderSide(modalParts.rightCode, lines, 'rightNum', 'rightText');

    modal.hidden = false;
    alignScrollRanges();
    modalParts.leftCode.scrollLeft = 0;
    modalParts.rightCode.scrollLeft = 0;
    modalParts.leftCode.scrollTop = 0;
    modalParts.rightCode.scrollTop = 0;
  }

  function lineRange(numbers) {
    const valid = numbers.filter(Boolean);
    if (valid.length === 0) return '—';
    if (valid.length === 1) return valid[0];
    return `${valid[0]}–${valid[valid.length - 1]}`;
  }

  function closeModal() {
    if (modal) modal.hidden = true;
  }

  function onDoubleClick(event) {
    const row = event.target.closest('tr');
    if (!row || !table.contains(row) || row.classList.contains('bcdn-collapsed-row')) return;
    const index = row.dataset.bcdnGroup;
    if (index === undefined) return;
    event.preventDefault();
    openModal(groups[Number(index)]);
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
        // 对话框内也可直接切换上下一个差异
        event.preventDefault();
        go(event.key === 'ArrowDown' ? 1 : -1);
        if (groups[current]) openModal(groups[current]);
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
    table.classList.add('bcdn-table');
    collapsed = Boolean(prefs.collapsed);
    buildPanel();
    buildModal();
    rescan();
    table.addEventListener('dblclick', onDoubleClick);
    document.addEventListener('keydown', onKeydown, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
