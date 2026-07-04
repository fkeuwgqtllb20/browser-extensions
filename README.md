# 浏览器扩展集合

集中存放个人浏览器扩展，每个扩展独立放在 `extensions/` 下的一个子目录中。

## 扩展列表

| 扩展 | 说明 | 目录 |
| --- | --- | --- |
| 知识星球可折叠目录 | 在知识星球文章页自动生成可折叠目录，支持点击跳转和当前章节高亮。 | `extensions/zsxq-collapsible-toc/` |

## 安装方式

1. 打开 Chrome：`chrome://extensions/`
2. 打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择需要安装的扩展子目录，例如：`extensions/zsxq-collapsible-toc/`。
5. 刷新目标网页后使用。

## 目录约定

```text
extensions/
  zsxq-collapsible-toc/
    manifest.json
    content.js
    content.css
    README.md
```
