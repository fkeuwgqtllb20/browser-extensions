# 浏览器扩展集合

集中存放个人浏览器扩展，每个扩展独立放在 `extensions/` 下的一个子目录中。

## 扩展列表

| 扩展 | 说明 | 目录 |
| --- | --- | --- |
| 知识星球可折叠目录 | 在知识星球文章页自动生成可折叠目录，支持点击跳转和当前章节高亮。 | `extensions/zsxq-collapsible-toc/` |
| 知识星球完整标题恢复 | 直接解码完整 `title`，并通过单个后台标签页恢复真正被 `...` 截断的课程标题，支持复制标题列表。 | `extensions/zsxq-title-restorer/` |

## 安装方式

1. 打开 Chrome：`chrome://extensions/`
2. 打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择需要安装的扩展子目录，例如：`D:\browser-extensions\extensions\zsxq-title-restorer`。
5. 如已加载过该扩展，修改文件后点击扩展卡片上的“重新加载”。
6. 刷新目标网页后使用。

## 知识星球完整标题恢复

适用于 `https://wx.zsxq.com/` 内包含课程目录的页面。

1. 保持知识星球已登录并打开课程目录页。
2. 页面右下角会显示“完整课程标题”面板。
3. 点击“恢复完整标题”。
   - `title` 属性完整的课程会立即恢复，不访问详情页。
   - `title` 本身含 `...` 的课程，会在**一个不抢焦点的后台标签页**中依次读取详情页标题。
   - 全部处理完毕后，后台标签页会自动关闭。
4. 点击“复制当前标题”，将整个页面的课程标题列表复制到剪贴板。

该扩展不使用嵌入式 iframe，以避免知识星球页面可能出现的 `login id is invalid` 错误。

## 目录约定

```text
extensions/
  zsxq-collapsible-toc/
    manifest.json
    content.js
    content.css
    README.md
  zsxq-title-restorer/
    manifest.json
    background.js
    content.js
    content.css
    README.md
```
