# ROADMAP

更新时间：2026-11-16

## 当前阶段

单机 MVP 已实现，处于「真实数据库联调与浏览器验收待完成」阶段。

当前版本可以在没有数据库驱动时启动管理台骨架，但 MySQL / Oracle 的实际连接、元数据读取、SQL 执行和 CRUD 运行仍需在具备数据库与驱动的环境验证。

## 已完成

- Node.js ESM 服务端、管理台视图与静态资源路由。
- 管理台接口：数据源、接口定义、SQL 预览、SQL 执行、日志和 OpenAPI JSON。
- 一键生成列表、详情、新增、更新、删除接口；MySQL / Oracle SQL 生成测试通过。
- Oracle 11g 兼容的 `ROWNUM` 分页绑定顺序和结果字段清理测试通过。
- Oracle `Y/N` 可空字段、大写元数据字段和主键读取测试通过。
- Oracle 11g 元数据分支已避开 12c 才有的 `IDENTITY_COLUMN`，并有测试覆盖。
- `node-oracledb` Thick 模式初始化配置和单次初始化测试通过。
- MySQL 与 Oracle 数据源同时存在、同时初始化并分别提供接口的处理器级测试通过。
- `#{name}` 安全绑定、`${name}` 显式原样拼接开关及模板错误测试。
- `<if>`、`<choose>`、`<foreach>`、`<set>`、`<where>` 动态 SQL 标签测试。
- 参数位置、类型转换、必填校验、默认值和分页参数测试。
- 查询超时：全局 `QUERY_TIMEOUT_MS`、接口级 `timeoutMs`、分页共享总预算、HTTP 504 / `DB_QUERY_TIMEOUT` 响应，以及 MySQL 连接销毁和 Oracle `callTimeout` / `breakExecution()` 中断路径。
- 管理台编辑页支持配置接口超时，管理 API 保存并回显 `timeoutMs`。
- Oracle 非查询语句启用 `autoCommit`，通过驱动选项测试确认 DML 执行后提交。
- 数据源支持持久化只读设置；运行时对非查询 SQL 返回 HTTP 403 / `DATASOURCE_READ_ONLY`，只读数据源的 CRUD 生成仅保留查询接口。
- 管理 API 本机回环限制及 `ADMIN_TOKEN` 鉴权测试。
- 生成接口的 `OPENAPI_TOKEN` 鉴权与 CORS 实现。
- AES-256-GCM 数据源密码加密、密钥文件权限和响应脱敏测试。
- OpenAPI 3.0 文档生成测试。
- 内存调用日志，最多保留 200 条。
- 管理台主题切换图标改用可正常渲染的实心弯月路径，并增加渲染断言；已在 Chrome 中强制刷新后实测浅色月亮与深色太阳图标均可显示、可切换。
- README 使用文档与本路线图。
- 内网离线部署文档，覆盖 Node.js、Oracle Instant Client、Oracle 11g Thick 模式、离线 npm cache、systemd、日志与排障。

## 已实现，待真实数据库验证

- MySQL / Oracle 连接池与参数绑定适配。
- MySQL `information_schema` 与 Oracle `all_tab_columns` / `all_constraints` 真实查询。
- 数据源连接测试、表列表读取和表结构读取。
- CRUD 接口在真实数据库中的执行结果。
- Oracle 真实数据库中的分页和 `COALESCE` NULL 绑定行为。
- 真实 MySQL / Oracle 11g 下的慢 SQL 超时中断、连接池恢复和 Oracle `breakExecution()` 行为。
- Oracle 真实数据库中的 DML 自动提交、回滚行为和连接池恢复。

## 已实现，待 GitHub Actions 验证

- 手动触发 `Build Offline npm Cache` workflow，在 Ubuntu x86_64 runner 上生成项目专属 npm cache。
- workflow 会删除 `node_modules` 后用 `npm ci --offline` 重新安装，检查 MySQL/Oracle 驱动、Linux x64 Oracle 二进制并运行测试。
- 产物为 `fastapi-npm-cache.tgz` 与 SHA-256 文件，保留 30 天。
- 本地已完成 YAML 解析、`npm test` 和 `npm run check`；尚未在 GitHub Actions 实际运行。

## 待验证

- 使用真实 MySQL 8 执行连接测试、读取表结构、运行 CRUD 和分页查询。
- 使用真实 Oracle 11g / 12c+ 执行连接测试、读取元数据、运行 CRUD 和 `ROWNUM` 分页。
- 验证 Oracle 更新语句中的 `COALESCE` 与 NULL 绑定行为。
- 验证 Oracle 元数据返回字段大小写和默认 schema / connect string 组合。
- 验证驱动缺失、网络中断、认证失败和数据库错误不会泄露数据源密码。
- 在真实端口启动服务，检查 `/magic/api/health`、管理页、静态资源和 OpenAPI 文档。
- 在浏览器中完成管理台视觉与交互验收。
- 在 GitHub Actions 手动运行离线 npm cache workflow，并确认 artifact 可下载。
- 在内网 Ubuntu 20.04 x86_64 上使用下载的 cache 执行 `npm ci --offline`，验证 MySQL/Oracle 驱动可加载。

## 待办

- 为真实 MySQL / Oracle 联调补充可重复的测试环境说明或容器配置。
- 增加 Oracle 11g 真实分页、更新置空和元数据大小写的联调测试。
- 评估管理台对多用户、接口级权限、限流和持久化审计的需求。
- 评估是否需要在保持核心零依赖的前提下增加 Koa/Express 外层适配。
- 增加反向代理示例和备份恢复脚本。

## 当前阻塞

- 当前沙箱无法解析 npm registry：`npm view mysql2 version` 返回 `ENOTFOUND registry.npmmirror.com`；已提供 GitHub Actions 构建路径，待实际运行验证。
- 当前沙箱禁止额外监听本地端口：在沙箱内执行 `node server/index.js` 返回 `listen EPERM`；已有服务实例可通过 Chrome 访问。
- 真实 MySQL / Oracle 数据库环境仍未接入，数据库联调尚未完成。

## 已知限制

- 状态存储为单进程 JSON 文件，不支持多实例并发写入。
- 自动 CRUD 只支持单列主键；联合主键和无主键表需要自定义 SQL。
- Oracle 默认大写对象名，大小写混合的 quoted identifier 不是主要支持路径。
- Oracle 11g 必须使用 Thick 模式；由序列和触发器生成的主键不能从元数据中自动识别。
- 自动更新使用 `COALESCE` 保留旧值，因此不能把字段显式更新为 `NULL`。
- 没有多用户、角色权限、租户隔离、接口级限流和持久化审计。
- 查询超时依赖客户端中断；Oracle 11g 上的服务端 SQL 是否立即结束仍需真实数据库验证。
- `${name}` 原样拼接需要接口级显式开启，开启后仍存在 SQL 注入风险。

## 最近验证

2026-11-16：

- `npm test`：47 项通过，0 失败。
- `npm run check`：通过。
- 针对性测试已验证超时归一化、超时错误识别、分页共享总预算、接口覆盖全局超时、MySQL 超时销毁连接、Oracle 超时调用 `breakExecution()`、接口超时持久化与非法值拒绝、编辑页超时字段渲染和生成接口 504 / `DB_QUERY_TIMEOUT` 响应。
- 针对性测试已验证 Oracle 执行选项包含 `autoCommit: true`、只读数据源拒绝写操作且不打开连接、写请求 HTTP 403 / `DATASOURCE_READ_ONLY`、只读设置持久化与关闭、只读数据源 CRUD 生成限制，以及 SQL 注释和写 CTE 的分类。
- 真实 MySQL / Oracle 11g 超时中断：未验证。
- 真实 Oracle 数据库中的自动提交结果：未验证。

2026-11-13：

- `npm test`：31 项通过，0 失败。
- `npm run check`：通过。
- `.github/workflows/build-npm-cache.yml`：YAML 语法解析通过。

2026-11-12：

- `npm test`：31 项通过，0 失败。
- `npm run check`：通过。
- 本地驱动检查：`mysql2@3.24.6`、`oracledb@6.10.0` 已安装。
- 应用处理器级测试已验证健康检查、管理鉴权、SQL 渲染、静态页面和 OpenAPI JSON 生成。
- 针对性测试已验证 Oracle 大写元数据字段、主键、`Y/N` 可空判断、11g 元数据分支、`ROWNUM` 分页、Thick 模式初始化顺序和 `COALESCE` 渲染。
- 管理台渲染测试已验证主题切换按钮输出 `moon-glyph` 图标与实心弯月路径。
- Chrome 实测：强制刷新后浅色主题显示月亮，切换深色主题显示太阳，切回浅色主题月亮仍正常显示。
- 双数据库测试已验证两个不同类型的数据源和接口可以同时存在并按各自方言运行。
- `node server/index.js`：因沙箱 `EPERM` 无法监听端口，未完成 HTTP 冒烟测试。
- 真实 MySQL / Oracle 连接：未验证。
