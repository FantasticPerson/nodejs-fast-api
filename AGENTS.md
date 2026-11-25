# Node Magic API 项目约定

## 项目定位

这是一个参考 magic-api 的 Node.js 快速接口平台：在网页里维护 MySQL / Oracle 数据源与 SQL 接口，保存后立即暴露为 `/openapi/*` HTTP API。

## 工程约定

- Node.js ESM，不使用 TypeScript，不引入前端框架或打包器。
- 服务端基于 Node 内置 `http`，管理前端是静态原生 JS；除数据库驱动外不增加运行时依赖。
- `mysql2` 和 `oracledb` 是可选依赖。缺失驱动时，管理界面必须仍可启动，并给出明确安装提示。
- 数据源密码只能加密落盘，任何 API 响应、日志、错误消息都不能返回密码。
- SQL 默认只允许 `#{name}` 绑定占位符；`${name}` 原样拼接必须由接口级 `allowRawSql` 显式开启。
- 所有 SQL 模板解析、表达式求值、CRUD 生成逻辑保持为纯函数，便于用 `node --test` 覆盖。
- 目录约定：`server/sql` 放模板与表达式，`server/services` 放业务逻辑，`public/js` 放前端模块。
- 操作说明真源是 `public/manual.html`（管理台 `/manual`）。新增或修改任何功能的用户操作方式、入口、参数、限制、错误码或默认行为时，必须同步更新该手册。
- 纯内部重构且用户操作不变时，可不改手册正文，但提交前必须确认操作说明无需变更，并在提交说明中写清。

## 验证

- 运行 `npm test` 执行单元测试。
- 启动 `npm start` 后，至少检查 `/magic/api/health`、管理页和 OpenAPI 文档 JSON。
- 功能交付前检查 `/manual` 页面可访问，并确认本次功能对应的操作说明已经更新；操作说明缺失的功能不视为完整交付。
- 未连接真实 MySQL / Oracle 时，不得把数据库连接测试写成已验证。

## 进度

- 每次完成可验证的功能后同步更新 `ROADMAP.md`。
- 每次新增或修改用户可见功能时，功能代码、操作手册和进度记录一起提交。
- 规划、只读分析不改 `ROADMAP.md`。
