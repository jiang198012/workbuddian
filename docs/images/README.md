# Images

README 首屏素材存放处。核心流程演示 GIF 在 `../assets/workbuddian-demo.gif`（由 `scripts/e2e/make-demo-gif.mjs` 生成）；功能特写截图放本目录。`docs/images/` 下的其他子目录是测试报告用的截图，不用于 README。

中英文 README（[`README.md`](../../README.md)、[`README.en.md`](../../README.en.md)）的首屏布局相同：一段介绍之后，居中放演示 GIF（宽 85%），下面两张截图并排（各宽 49%）。

```html
<p align="center">
  <img src="docs/assets/workbuddian-demo.gif" alt="…" width="85%"/>
</p>

<p align="center">
  <img src="docs/images/chat-demo.png" alt="流式对话与 Markdown 渲染" width="49%"/>
  <img src="docs/images/chat-atsuggest.png" alt="@ 引用与附件" width="49%"/>
</p>
```

替换截图时保持文件名不变，两份 README 无需修改。
