# 渲染管线

[← 返回首页](../README.md)

1. 读盘
2. `marked` 解析
3. `highlight.js` 上色
4. 拼装 HTML 外壳

```mermaid
flowchart LR
  A[读盘] --> B[marked]
  B --> C[highlight.js]
  C --> D[输出]
```

上一篇：[安装与配置](install.md)
