// 兜底注入：content_scripts 未匹配到（例如 file:// 未授予访问权限）时，
// 点击扩展图标把脚本直接注入当前标签页。
chrome.action.onClicked.addListener(async tab => {
  if (!tab?.id) return;
  try {
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Boolean(document.getElementById('bcdn-root'))
    });
    if (probe?.result) return;

    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['diff-core.js', 'content.js']
    });
  } catch (error) {
    console.warn('[差异导航] 注入失败：', error);
  }
});
