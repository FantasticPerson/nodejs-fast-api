# ROADMAP

更新时间：2026-11-19

## 当前阶段

单机 MVP 已实现，处于「真实数据库联调与浏览器验收待完成」阶段。

当前版本可以在没有数据库驱动时启动管理台骨架，但 MySQL / Oracle 的实际连接、元数据读取、SQL 执行和 CRUD 运行仍需在具备数据库与驱动的环境验证。

## 已完成

- Node.js ESM 服务端、管理台视图与静态资源路由。
- 管理台接口：数据源、接口定义、SQL 预览、SQL 执行、日志和 OpenAPI JSON。
- 状态持久化迁移到 SQLite：数据源、接口、参数和调用统计分表存储，配置写入不再全量重写 JSON 文件。
- 首次启动支持从旧 `data/state.json` 在单个事务中导入 SQLite；失败回滚并保留旧文件，初始化标记防止重复导入。
- `/openapi/*` 运行时改为读取内存路由索引，不再每个请求克隆全量状态；调用统计在内存累加并每 5 秒批量刷新 SQLite。
- Node.js 运行要求更新为 `>= 22.14`，使用内置 `node:sqlite`，不增加额外运行时依赖。
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
- 接口新增 `sql` / `script` 双引擎；脚本接口在独立 Worker 中执行，通过受控 `ctx` 提供参数、数据库、事务、外部 HTTP、共享脚本库和插件调用。
- 脚本数据库操作由主进程 RPC 执行，支持 MySQL / Oracle 手动事务，提交失败和脚本异常自动回滚。
- 共享脚本库支持管理台 CRUD、启停、描述、版本快照和历史恢复；接口与共享脚本每次保存都会追加版本，不覆盖旧版本。
- 脚本接口支持执行超时、Worker 内存上限、返回结果大小上限、事务清理和 `SCRIPT_TIMEOUT` 错误。
- 外部 HTTP 默认关闭，接口显式开启后还需命中 `SCRIPT_HTTP_ALLOWLIST`；默认响应体上限 1 MB。
- 服务端插件从 `PLUGINS_DIR` 加载，只允许部署人员通过文件维护，不提供管理台上传入口。
- SQLite schema 升级到 v3，新增接口引擎、脚本代码、HTTP 开关、接口版本表、共享脚本表和共享脚本版本表；v2 数据库自动补列并回填接口版本。
- 修复只读 SQL 分类对外层括号、括号主查询、多个 CTE、CTE 列别名和带 `UNION` 的首个 CTE 分支的误判；写语句和写 CTE 仍会被拒绝。
- 修复 ESM 加载 CommonJS `oracledb` 时未解包 `default`、导致 `initOracleClient` 不可用的问题。
- 增加 Oracle 独立连接诊断脚本，输出 Thick 模式状态和真实账号认证结果。
- 修复 Oracle 连接池在认证失败时仍被缓存、导致修正密码后持续报 `ORA-01017` 的问题；连接池只在成功建立认证连接后缓存，草稿测试使用临时池并在结束后关闭。
- Oracle 数据源增加服务名 / SID 连接方式选择，SID 使用 `HOST:PORT:SID` 拼接；相应连接串、临时池和 SID 配置均有单元测试覆盖。
- 修复管理台 Oracle 服务名连接方式因后端大小写归一化错误而被拒绝的问题；`serviceName`、`service_name` 均保存为规范值 `serviceName`。
- Oracle `CLOB` / `NCLOB` 结果不再把驱动 `Lob` 流对象直接交给 JSON 序列化；长 CLOB 按 32767 字符分块读取并拼接为字符串，覆盖 `GETCLOBVAL()` 和嵌套结果字段。
- 管理台样式移除 Chrome 102 不支持的 `color-mix()` 等语法，暗黑模式背景、边框和提示色改为兼容的静态主题变量；SQL 编辑器选区改为高对比固定颜色。
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
- 真实 MySQL / Oracle 中的脚本 `db.transaction()` 提交、异常回滚和连接池恢复。

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
- 在浏览器中完成管理台视觉与交互验收。
- 在真实浏览器中验收脚本编辑器、共享脚本页面、版本历史弹窗和脚本试运行交互。
- 在 GitHub Actions 手动运行离线 npm cache workflow，并确认 artifact 可下载。
- 在内网 Ubuntu 20.04 x86_64 上使用下载的 cache 执行 `npm ci --offline`，验证 MySQL/Oracle 驱动可加载。
- 使用内网目标 Oracle 账号在管理台完成连接测试、元数据读取和实际接口调用。

## 待办

- 为真实 MySQL / Oracle 联调补充可重复的测试环境说明或容器配置。
- 增加 Oracle 11g 真实分页、更新置空和元数据大小写的联调测试。
- 评估管理台对多用户、接口级权限、限流和持久化审计的需求。
- 评估是否需要在保持核心零依赖的前提下增加 Koa/Express 外层适配。
- 增加反向代理示例和备份恢复脚本。

## 当前阻塞

- 当前沙箱无法解析 npm registry：`npm view mysql2 version` 返回 `ENOTFOUND registry.npmmirror.com`；已提供 GitHub Actions 构建路径，待实际运行验证。
- 真实 MySQL / Oracle 数据库环境仍未接入，数据库联调尚未完成。

## 已知限制

- 状态库使用 SQLite WAL，但应用仍以单进程内存缓存为准，不支持多实例并发管理；进程异常退出时最多丢失最近 5 秒的调用统计。
- Node 22 的 `node:sqlite` 仍标记为实验特性，当前版本和测试通过，但后续升级 Node 时需要复查 API 兼容性。
- 自动 CRUD 只支持单列主键；联合主键和无主键表需要自定义 SQL。
- Oracle 默认大写对象名，大小写混合的 quoted identifier 不是主要支持路径。
- Oracle 11g 必须使用 Thick 模式；由序列和触发器生成的主键不能从元数据中自动识别。
- 自动更新使用 `COALESCE` 保留旧值，因此不能把字段显式更新为 `NULL`。
- 没有多用户、角色权限、租户隔离、接口级限流和持久化审计。
- 查询超时依赖客户端中断；Oracle 11g 上的服务端 SQL 是否立即结束仍需真实数据库验证。
- `${name}` 原样拼接需要接口级显式开启，开启后仍存在 SQL 注入风险。
- 脚本 Worker 与 `vm` 提供执行隔离，但不是对完全不可信代码的强安全沙箱；脚本接口只应开放给可信管理员。
- 脚本代码以明文存储在 SQLite 中，不能写入密码、令牌或其他密钥。
- 插件属于可信服务端代码，可调用完整 Node.js 能力，只能由部署人员维护。
- `SCRIPT_HTTP_ALLOWLIST` 只限制目标域名，未覆盖 DNS rebinding 等高级 SSRF 场景。

## 最近验证

2026-11-19：

- `npm test`：67 项通过，0 失败。
- `npm run check`：通过。
- `git diff --check`：通过。
- 新增脚本专项测试覆盖 Worker 参数与共享脚本注入、数据库查询与事务、脚本超时、HTTP 开关与白名单、插件加载、接口版本与共享脚本版本恢复，以及 schema v2 → v3 迁移。
- 新增或修改的脚本、插件、版本和迁移 JS 文件逐个通过 `node --check`。
- 使用临时 SQLite 库在 `127.0.0.1:43119` 再次启动服务，`/magic/api/health` 返回正常，`/magic/api/bootstrap` 返回 `datasources`、`endpoints`、`scripts`、`logs`、`config`，脚本和插件配置均可读取。
- 新增 SQLite 专项测试覆盖重启后数据源、接口、参数和统计持久化，调用统计批量刷新，旧 JSON 一次性迁移，旧文件保留，以及迁移失败回滚后修复重试。
- 使用真实 `data/state.json` 的临时副本完成迁移验证：1 个数据源、1 个接口、1 个参数、`callCount=1` 均正确导入，原 JSON 未改动。
- 使用临时 SQLite 库在 `127.0.0.1:43119` 实际启动服务，`/magic`、`/magic/api/health`、`/magic/api/bootstrap` 和 `/magic/api/openapi.json` 均返回 HTTP 200。

2026-11-17：

- `npm test`：56 项通过，0 失败。
- `npm run check`：通过。
- `git diff --check`：通过。
- 针对性测试已验证外层括号包裹的 CTE、括号主查询、多个 CTE、CTE 列别名、首个 CTE 分支接 `UNION` 的只读查询能够通过，括号中的 `DELETE` / `UPDATE` 和多个 CTE 后接写语句仍被拒绝。
- 针对性测试已验证只读数据源执行括号 CTE 查询不会被 `DATASOURCE_READ_ONLY` 拦截，并确认写操作仍在打开连接前被拒绝。
- 针对性测试已验证 Oracle 草稿测试接受管理台提交的 `serviceName`，服务名连接方式保持规范化，SID 方式不受影响。

2026-11-16：

- `npm test`：54 项通过，0 失败。
- `npm run check`：通过。
- 针对性测试已验证超时归一化、超时错误识别、分页共享总预算、接口覆盖全局超时、MySQL 超时销毁连接、Oracle 超时调用 `breakExecution()`、接口超时持久化与非法值拒绝、编辑页超时字段渲染和生成接口 504 / `DB_QUERY_TIMEOUT` 响应。
- 针对性测试已验证 Oracle 执行选项包含 `autoCommit: true`、只读数据源拒绝写操作且不打开连接、写请求 HTTP 403 / `DATASOURCE_READ_ONLY`、只读设置持久化与关闭、只读数据源 CRUD 生成限制，以及 SQL 注释和写 CTE 的分类。
- 针对性测试已验证 CommonJS 驱动从 ESM 命名空间解包后能取得 `initOracleClient`。
- 针对性测试已验证 Oracle 认证失败池不会进入缓存、修正配置后可重新创建连接，草稿测试使用临时池并关闭，以及服务名 / SID 连接串拼接。
- 针对性测试已验证超过单次读取块大小、包含中文和 emoji 的 Oracle CLOB 能按代码点正确分块并拼接为完整字符串。
- 针对性测试已验证管理台 CSS 不包含 Chrome 102 不支持的 `color-mix()`、`:has()`、容器查询、`oklch()`、`light-dark()` 和 `text-wrap: balance`，并确认普通选区与 SQL 编辑器选区都有显式高对比颜色。
- 用户已在内网使用 `scripts/check-oracle-connection.mjs` 完成目标 Oracle 账号的真实登录验证；管理台真实连接测试仍待修复版本部署后确认。
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
