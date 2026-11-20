(() => {
  'use strict';

  // Beyond Compare 导出的 HTML 报告结构：
  // table.fc > tr.Section* > 5 个 td（左行号 / 左文本 / 中间标记 / 右行号 / 右文本）
  const SECTION_ROW = /^(Section|Subsection)/;
  const DIFF_CELL = /^TextItem(?:Sig|Insig)(?:Mod|Add|Del|Orphan)$/;
  const SIG_CELL = /^TextItemSig/;

  function hasSectionClass(row) {
    return [...row.classList].some(name => SECTION_ROW.test(name));
  }

  function isReportTable(table) {
    if (!table || !table.rows || table.rows.length < 3) return false;
    let valid = 0;
    for (const row of table.rows) {
      if (!hasSectionClass(row) || row.cells.length < 5) continue;
      if (row.cells[2].classList.contains('AlignCenter')) valid += 1;
    }
    return valid >= 3;
  }

  function findReportTable(root = document) {
    return [...root.querySelectorAll('table.fc')].find(isReportTable) || null;
  }

  function isDiffCell(cell) {
    return Boolean(cell) && [...cell.classList].some(name => DIFF_CELL.test(name));
  }

  function isDiffRow(row) {
    if (row.classList.contains('SectionGap')) return false;
    if (!row.cells || row.cells.length < 5) return false;
    const marker = (row.cells[2].textContent || '').trim();
    if (marker.includes('+')) return true;
    return isDiffCell(row.cells[1]) || isDiffCell(row.cells[4]);
  }

  function isSignificantRow(row) {
    const cells = row.cells;
    if ((cells[2].textContent || '').includes('+')) return true;
    return [cells[1], cells[4]].some(cell =>
      [...cell.classList].some(name => SIG_CELL.test(name))
    );
  }

  function lineNumberOf(cell) {
    return (cell?.textContent || '').replace(/\s+/g, '');
  }

  // 把连续的差异行合并成“差异块”，用于一次跳转覆盖整段修改
  function collectGroups(table) {
    const groups = [];
    let active = null;

    for (const row of table.rows) {
      if (!isDiffRow(row)) {
        active = null;
        continue;
      }
      if (!active) {
        active = {
          index: groups.length,
          rows: [],
          significant: false,
          leftLine: '',
          rightLine: ''
        };
        groups.push(active);
      }
      active.rows.push(row);
      if (!active.significant && isSignificantRow(row)) active.significant = true;
      if (!active.leftLine) active.leftLine = lineNumberOf(row.cells[0]);
      if (!active.rightLine) active.rightLine = lineNumberOf(row.cells[3]);
    }

    return groups;
  }

  window.__BCDN_CORE = {
    findReportTable,
    collectGroups,
    isDiffRow,
    isDiffCell
  };
})();
