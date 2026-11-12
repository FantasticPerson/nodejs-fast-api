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

## 验证

- 运行 `npm test` 执行单元测试。
- 启动 `npm start` 后，至少检查 `/magic/api/health`、管理页和 OpenAPI 文档 JSON。
- 未连接真实 MySQL / Oracle 时，不得把数据库连接测试写成已验证。

## 进度

- 每次完成可验证的功能后同步更新 `ROADMAP.md`。
- 规划、只读分析不改 `ROADMAP.md`。
