# 知识星球可折叠目录 Chrome 扩展

## 功能

- 只在 `articles.zsxq.com` 文章页运行。
- 从文章正文 `.content.ql-editor` 中提取 `h2/h3/h4` 标题生成目录。
- 支持目录折叠、点击跳转、滚动时高亮当前章节。
- 折叠状态会保存在当前浏览器的 `localStorage`。

## 安装

1. 打开 Chrome：`chrome://extensions/`
2. 打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本文件夹：`zsxq-collapsible-toc-extension`。
5. 刷新知识星球文章页即可看到左侧目录。

## 文件说明

- `manifest.json`：扩展声明。
- `content.js`：目录生成、折叠、跳转和高亮逻辑。
- `content.css`：目录面板样式。
