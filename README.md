# Node Magic API Studio

一个参考 magic-api 的 Node.js 快速接口平台。通过浏览器维护 MySQL / Oracle 数据源和 SQL 接口，保存后立即发布为 HTTP API，并为数据表生成标准 CRUD 接口。

当前版本是单机 MVP：管理台、接口定义、SQL 模板、OpenAPI 文档和数据库驱动接入已经实现；真实 MySQL / Oracle 连接仍需在具备数据库和驱动的环境中完成联调。

## 功能

- 浏览器管理台：新建、编辑、启停和删除接口。
- 接口分组：默认分组与自定义分组按导航切换，编辑接口时可选择已有分组或直接输入新分组。
- 数据源管理：MySQL / Oracle 连接配置、连接测试、表结构浏览。
- 一键 CRUD：列表、详情、新增、更新、删除。
- SQL 模板：安全绑定参数、条件标签、循环标签和显式原样拼接。
- JavaScript 业务脚本：在 Worker 中执行多查询、事务、共享脚本、HTTP 调用和服务端插件。
- 共享脚本库：公共业务函数可在多个脚本接口中以 `ctx.libs.名称.函数()` 复用。
- 脚本编辑器补全：参数、上下文 API、共享脚本和插件方法按输入位置自动提示。
- 内置操作手册：管理台侧边栏可直接打开 `/manual`，覆盖数据源、接口、脚本、分组、调试、文档和排错流程。
- 版本历史：接口与共享脚本每次保存生成快照，可在管理台查看并回滚。
- SELECT 分页：自动生成总数与分页查询。
- 查询超时：全局默认值与接口级覆盖，超时返回 HTTP 504。
- 数据源只读模式：写语句在执行前被拒绝，自动 CRUD 只生成查询接口。
- OpenAPI 3.0 文档：`/magic/api/openapi.json`。
- 响应模式：包装为 `{ code, message, data }`，或直接返回原始数据。
- 调用日志：内存保留最近 200 条，不记录请求体和密码。
- 密码保护：数据源密码使用 AES-256-GCM 加密保存。
- SQLite 状态存储：数据源、接口、参数和调用统计使用 SQLite 持久化，不再全量重写 JSON 文件。
- 零构建前端：不依赖 React/Vue，不需要单独构建静态页面。

## 技术要求

- Node.js `>= 22.14`（使用内置 `node:sqlite`）。
- Node 22 会把 `node:sqlite` 标记为实验特性，启动时可能输出 `ExperimentalWarning`；不影响当前功能和测试。
- 管理台浏览器兼容 Chrome 102 及以上，样式不使用 `color-mix()` 等新版本专属语法。
- MySQL 驱动：`mysql2`。
- Oracle 驱动：`oracledb`。
- Oracle 11g、12c 及以上均可使用；分页统一使用 11g 兼容的 `ROWNUM` 写法。
- Oracle 11g 必须使用 `node-oracledb` 的 Thick 模式，并安装 Oracle Client 库。默认 Thin 模式只支持 Oracle Database 12.1 及以上。

服务端核心使用 Node 内置 `http`，没有强制引入 Express/Koa。这样可以保证数据库驱动缺失时管理台仍能启动，并且项目除数据库驱动外没有额外运行时依赖。核心 `handler` 使用标准 `(req, res)` 接口，后续如需接入 Express/Koa，可在外层挂载。

## 快速开始

```bash
cp .env.example .env
npm install
npm start
```

启动后打开：

```text
http://127.0.0.1:3000/magic
```

项目支持 MySQL 和 Oracle 数据源同时存在。标准 `npm install` 会尝试安装两个可选驱动；如果可选依赖没有装入，可以明确安装两者：

```bash
npm install mysql2 oracledb
```

只使用其中一种数据库时，也可以只安装对应驱动。服务启动时不会做数据库类型切换；添加几个数据源就会创建几个独立连接池。

检查驱动安装状态和健康状态：

```bash
curl http://127.0.0.1:3000/magic/api/health
```

开发模式：

```bash
npm run dev
```

## 配置

复制 `.env.example` 为 `.env` 后按需修改。实际 `.env` 已被 `.gitignore` 排除。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址。局域网或容器访问可改为 `0.0.0.0`，同时应配置管理令牌。 |
| `PORT` | `3000` | HTTP 端口。 |
| `ADMIN_TOKEN` | 空 | 管理 API 和 OpenAPI 文档访问令牌。为空时管理接口只允许本机回环地址访问。 |
| `OPENAPI_TOKEN` | 空 | 生成接口的访问令牌。非空时请求需携带 `x-api-token` 或 Bearer token。 |
| `OPENAPI_PATH` | `/openapi` | 生成接口的基础路径。 |
| `QUERY_TIMEOUT_MS` | `30000` | 单个生成接口的数据库查询总超时，单位毫秒；设为 `0` 可关闭全局超时。 |
| `SCRIPT_TIMEOUT_MS` | `30000` | 脚本接口默认执行超时；接口级 `timeoutMs` 可覆盖。 |
| `SCRIPT_HTTP_ALLOWLIST` | 空 | 脚本 `http.fetch` 允许访问的域名列表，支持 `api.example.com` 和 `*.example.com`；为空时全部拒绝。 |
| `SCRIPT_HTTP_MAX_RESPONSE_BYTES` | `1048576` | 脚本外部 HTTP 响应体大小上限。 |
| `SCRIPT_WORKER_MEMORY_MB` | `128` | 单个脚本 Worker 的内存上限。 |
| `PLUGINS_DIR` | `plugins` | 服务端插件目录，启动时加载其中的 `.js` / `.mjs` 文件。 |
| `CORS_ORIGIN` | `*` | 生成接口的 CORS 允许来源，可填逗号分隔列表；管理 API 不走该配置。 |
| `ORACLE_THICK_MODE` | `false` | 设为 `true` 启用 `node-oracledb` Thick 模式，使用系统动态库路径中的 Oracle Client。 |
| `ORACLE_CLIENT_LIB_DIR` | 空 | Oracle Client 库目录。配置该目录会自动启用 Thick 模式，适合 Oracle 11g；Linux 上还需通过 `ldconfig` 或 `LD_LIBRARY_PATH` 提供系统动态库路径。 |
| `STATE_DB` | `data/state.sqlite` | SQLite 状态库，保存数据源、接口、参数和调用统计。 |
| `STATE_FILE` | `data/state.json` | 旧版 JSON 状态文件。仅在 SQLite 尚未初始化时自动导入一次，导入后原文件保留。 |
| `SECRET_FILE` | 与旧状态文件同目录的 `.secret` | 数据源密码加解密密钥文件，权限自动设为 `600`。 |
| `APP_SECRET` | 空 | 可选。设置后用它派生加密密钥，不再使用 `SECRET_FILE`。 |

注意：

- 已保存的数据源密码只能由同一个密钥解密。切换 `APP_SECRET` 或删除/替换 `SECRET_FILE` 后，需要重新编辑数据源并保存密码。
- SQLite 使用 WAL，但应用仍以单进程内存缓存为准；不要同时启动多个进程写同一个 `STATE_DB`。
- 首次升级时，如果 SQLite 状态库尚未初始化且 `STATE_FILE` 存在，会在一个事务中导入旧 JSON。失败时回滚并拒绝启动，旧文件不会被删除。
- 不要把管理端口直接暴露到公网。当前没有多用户、角色权限、CSRF 防护或持久化审计。

升级前应停止服务并备份整个 `data/` 目录。SQLite 备份需要同时保留 `state.sqlite`、可能存在的 `state.sqlite-wal`、`state.sqlite-shm` 和 `.secret`；不要把旧 JSON 与密钥分开恢复。

## 使用流程

1. 启动服务，打开 `/magic`。
2. 进入「数据源」，添加 MySQL 或 Oracle 连接并测试。
3. 点击「浏览表」，选择数据表查看字段、主键和可空属性。
4. 点击「生成 CRUD」，选择路径前缀和所需方法，预览后批量创建接口。
5. 也可以在「接口」页新建自定义 SQL 接口，配置参数、分页、响应模式、接口超时和测试值。
6. 在「接口文档」页复制 OpenAPI JSON 地址，或直接调用 `/openapi/*` 下的生成接口。
7. 需要查阅完整操作步骤时，打开管理台侧边栏的「操作手册」，或直接访问 `/manual`。

### MySQL 数据源

需要填写主机、端口、数据库名、用户名和密码，默认端口为 `3306`。

### Oracle 数据源

需要填写主机、端口、服务名或 SID、用户名和密码，默认端口为 `1521`。连接方式必须明确选择「服务名」或「SID」：服务名生成 `HOST:PORT/SERVICE_NAME`，SID 生成 `HOST:PORT:SID`。`schema` 可不填，默认使用用户名并转换为大写；也可以直接填写连接字符串覆盖主机和服务名 / SID 配置。

连接 Oracle 11g 时，还需要安装 Oracle Client 库并启用 Thick 模式。通常使用可连接 11.2+ 的 Oracle 19c Instant Client：

```dotenv
ORACLE_THICK_MODE=true
ORACLE_CLIENT_LIB_DIR=/opt/oracle/instantclient_19_XX
```

Linux 上还必须把 Instant Client 目录加入系统动态库路径，例如写入 `/etc/ld.so.conf.d/oracle-instantclient.conf` 后执行 `sudo ldconfig`。如果 Oracle Client 已经配置在系统动态库搜索路径中，也可以只设置：

```dotenv
ORACLE_THICK_MODE=true
```

修改配置后需要重启服务。完整步骤见 [docs/offline-deployment.md](docs/offline-deployment.md)。Thick 模式启用后，MySQL 和 Oracle 12c+ 数据源仍可同时使用。

当前 Oracle 元数据读取按默认大写对象名处理，大小写混合的 quoted identifier 不是主要支持场景。联合主键暂不支持自动 CRUD，请改用自定义 SQL 接口；没有单列主键的表只能生成列表和新增。

Oracle `CLOB` / `NCLOB` 字段和 `GETCLOBVAL()` 返回值会由驱动读取完整内容后序列化为字符串。长 CLOB 按 32767 字符分块读取再拼接，不再依赖 `DBMS_LOB.SUBSTR` 的 4000 字符限制；超大字段会占用相应内存并增大 JSON 响应体，接口层仍建议控制返回字段和分页大小。

Oracle 11g 没有 Identity Column 元数据。由序列和触发器生成主键的表不会自动识别为自增列，自动生成的 POST 接口需要显式提交主键，或改用自定义 SQL 接口。

普通 SQL 接口中的 Oracle 写操作启用 `autoCommit`，单条 `INSERT`、`UPDATE`、`DELETE` 成功后立即提交。需要跨多条 SQL 的事务编排时，请使用 JavaScript 脚本接口中的 `db.transaction()`。

### 只读数据源

添加或编辑数据源时可以开启「只读数据源」。开启后允许执行 `SELECT`、查询型 `WITH` 和 `EXPLAIN`，其他 SQL 在进入数据库前直接返回 HTTP `403`，错误码为 `DATASOURCE_READ_ONLY`。

- 已存在的写接口不会被删除，但调用时会统一被拒绝。
- 「生成 CRUD」对只读数据源只允许生成列表和详情接口。
- 只读设置是应用层保护，不能替代数据库权限。生产环境仍应为只读数据源配置只有 `SELECT` 权限的数据库账号。

包装模式错误示例：

```json
{
  "code": 403,
  "message": "数据源「只读库」已启用只读模式，只能执行查询语句",
  "data": null,
  "errorCode": "DATASOURCE_READ_ONLY"
}
```

### 同时使用 MySQL 和 Oracle

- 安装两个驱动：`npm install mysql2 oracledb`。
- 在「数据源」中分别添加 MySQL 和 Oracle 连接，两者可以同时保存和测试。
- 每个数据源使用自己的连接池，池按数据源 `id` 隔离，不会因为添加 Oracle 而覆盖 MySQL 连接。
- 每个接口绑定一个 `datasourceId`。运行时按该数据源类型自动选择 `?` 或 `:pN` 绑定方式、标识符引用和 SQL 方言。
- 管理台左侧的 `DRIVERS` 区域会分别显示 MySQL 和 Oracle 驱动状态。
- 一个接口只使用一个数据源；不同接口可以同时指向 MySQL 和 Oracle。

## SQL 写法

### 安全参数

`#{name}` 会转换成数据库绑定参数。MySQL 使用 `?`，Oracle 使用 `:pN`。

```sql
SELECT id, name, email
FROM users
WHERE id = #{id}
```

### 原样拼接

`${name}` 会直接拼接到 SQL 中，默认禁止。只有接口显式开启「允许原样 SQL」后才会执行。不要对用户可控参数使用它。

### 动态标签

```sql
SELECT id, name, email
FROM users
<where>
  <if test="keyword != null and keyword != ''">
    name LIKE CONCAT('%', #{keyword}, '%')
  </if>
  <if test="status != null">
    AND status = #{status}
  </if>
</where>
ORDER BY id DESC
```

支持的标签：

| 标签 | 说明 |
| --- | --- |
| `<if test="">` | 条件成立时渲染标签内容。 |
| `<choose> / <when> / <otherwise>` | 多分支条件。 |
| `<foreach collection item separator open close>` | 遍历数组，常用于批量 ID。 |
| `<set>` | 生成更新语句的 `SET` 段，并清理末尾逗号。 |
| `<where>` | 生成 `WHERE` 段，并清理开头的 `AND` / `OR`。 |

表达式支持比较、`and/or/not`、空值判断、字符串/数字/布尔字面量和对象属性访问，不执行任意 JavaScript，也不支持函数调用。

### 参数位置与类型

接口参数可来自 `query`、`body`、`path`、`header`。类型支持 `string`、`number`、`boolean`、`date`、`json`、`array`。数组参数从 query 读取时可用逗号分隔。

如果没有显式声明参数，query 和 body 中的同名字段仍可用于 SQL 表达式；路径参数会自动补充。

### 分页

为以 `SELECT`、`WITH` 或 `EXPLAIN` 开头的接口开启分页后，返回：

```json
{
  "list": [],
  "total": 0,
  "page": 1,
  "pageSize": 20,
  "totalPages": 0
}
```

MySQL 使用 `LIMIT` / `OFFSET`；Oracle 使用兼容 11g 的 `ROWNUM` 嵌套查询，不依赖 `OFFSET ... FETCH`。

### 查询超时

每个生成接口默认使用 `QUERY_TIMEOUT_MS`，默认 `30000` 毫秒。接口编辑页的「接口超时（毫秒）」可单独覆盖；填 `0` 时继承全局配置。分页接口的总数查询和列表查询共享同一个超时预算，不会各算一次。

超时后接口返回 HTTP `504`，错误码为 `DB_QUERY_TIMEOUT`。包装模式示例：

```json
{
  "code": 504,
  "message": "数据库查询超时（30000 ms）",
  "data": null,
  "errorCode": "DB_QUERY_TIMEOUT"
}
```

MySQL 超时会销毁当前连接，避免仍在执行的 SQL 被放回连接池。Oracle 同时设置 `callTimeout` 并在总超时触发时调用 `breakExecution()`；真实 Oracle 11g 下的服务端中断效果仍需在数据库环境验证。若接口前面还有 Nginx 等反向代理，也要同时检查代理的读取超时。

### CRUD 生成约定

- 列表：`GET /users`，支持分页和最多 6 个字符字段的关键字搜索。
- 详情：`GET /users/:id`。
- 新增：`POST /users`。
- 更新：`PUT /users/:id`，未提交或提交 `null` 的字段保持原值。
- 删除：`DELETE /users/:id`。

自动更新接口使用 `COALESCE` 保留旧值，因此无法通过自动生成的更新接口把字段显式置为 `NULL`。需要置空时请创建自定义 SQL 接口。

## JavaScript 业务脚本

接口编辑页可将「实现方式」切换为「JavaScript 业务脚本」。脚本代码是一段异步函数体，使用 `return` 返回可 JSON 序列化的数据。

```javascript
const user = await ctx.db.queryOne(
  'SELECT id, name FROM users WHERE id = #{id}',
  { id: ctx.params.id }
);
if (!user) throw new Error('用户不存在');
return { ...user, source: 'script' };
```

可用上下文：

| API | 说明 |
| --- | --- |
| `ctx.params` | 按接口参数声明解析、校验和类型转换后的参数。 |
| `ctx.request` | 已移除鉴权、Cookie 等敏感请求头的 query/body/path/headers。 |
| `db.query(sql, params)` / `db.queryOne` | 执行查询，SQL 使用 `#{name}` 安全绑定。 |
| `db.execute(sql, params)` | 执行写入并返回 `affectedRows`、`insertId`。 |
| `db.transaction(async (tx) => {})` | 开启事务；`tx.query`、`tx.queryOne`、`tx.execute` 共享同一连接，异常自动回滚。 |
| `http.fetch(url, options)` | 外部 HTTP；接口需开启「允许外部 HTTP」，且目标域名必须命中 `SCRIPT_HTTP_ALLOWLIST`。 |
| `ctx.libs` | 已启用的共享脚本对象，例如 `ctx.libs.helper.normalize(value)`。 |
| `ctx.plugins` | 启动时从插件目录加载的服务端插件，例如 `ctx.plugins.pricing.calculate(input)`。 |

执行安全：

- 脚本在独立 Worker 中运行，受超时和内存上限约束。
- 不向脚本暴露 `require`、`process`、`fs`、`child_process`。
- Worker 崩溃或超时会被主进程终止，未提交事务会回滚。
- 脚本代码存储于 SQLite 明文，不要写入密钥或密码；敏感配置应放在环境变量或数据库加密配置中。

### 脚本编辑器补全

切换到「JavaScript 业务脚本」后，编辑器会按当前输入位置提供补全：

- 输入 `.` 自动打开补全；按 `Ctrl+Space` 手动打开，macOS 也可使用 `Option+/`。
- `ctx.params.` 列出当前接口已声明的参数；`ctx.request.`、`ctx.endpoint.`、`db.`、`http.`、`plugins.`、`logger.` 提供对应 API。
- `ctx.libs.` 列出已启用的共享脚本；继续输入库名后，列出该脚本返回对象中的方法。
- 每个提示显示函数签名和说明；使用 `↑` / `↓` 选择，`Enter` / `Tab` 插入，`Esc` 关闭。
- 编辑器下方「本接口可用 API」提供常用 API、共享脚本方法和插入按钮，并可展开查看共享脚本原代码。

共享脚本方法由前端静态解析顶层 `return { ... }` 的对象成员。动态生成的对象、展开运算符或复杂计算属性无法可靠识别；此时仍会展示完整共享脚本代码，不会伪造方法提示。

### 共享脚本

「共享脚本」必须 `return` 一个对象。启用后会自动注入所有脚本接口：

```javascript
return {
  normalize(value) {
    return String(value || '').trim().toLowerCase();
  }
};
```

接口中调用：

```javascript
return { name: ctx.libs.helper.normalize(ctx.params.name) };
```

接口和共享脚本每次保存都会生成版本快照，可在「历史版本」中恢复。

### 服务端插件

插件由开发人员放入 `PLUGINS_DIR` 指向的目录，启动时加载，不提供管理台上传接口。插件文件示例：

```javascript
export const actions = {
  async calculate(input, context) {
    return { total: input.amount * 2, endpoint: context.endpoint.name };
  }
};
```

脚本通过 `ctx.plugins.pricing.calculate(input)` 调用。插件函数第二个参数包含 `params`、`request`、`endpoint`、`db`、`http` 和 `logger`。插件代码属于可信服务端代码，可使用完整 Node.js 能力，因此只能由负责部署的开发人员维护。

## HTTP 接口

### 管理地址

| 地址 | 说明 |
| --- | --- |
| `/magic` | 管理台页面。 |
| `/magic/api/health` | 公开健康检查。 |
| `/magic/api/bootstrap` | 管理台初始化数据。 |
| `/magic/api/datasources` | 数据源管理。 |
| `/magic/api/endpoints` | 接口定义管理。 |
| `/magic/api/console/render` | 只渲染 SQL，不连接数据库。 |
| `/magic/api/console/run` | 渲染并执行 SQL。 |
| `/magic/api/logs` | 内存调用日志。 |
| `/magic/api/openapi.json` | OpenAPI 3.0 文档。 |

配置 `ADMIN_TOKEN` 后，管理 API 必须携带：

```http
x-admin-token: <ADMIN_TOKEN>
```

或：

```http
Authorization: Bearer <ADMIN_TOKEN>
```

### 生成接口

默认基础路径是 `/openapi`。接口定义中的路径 `/users` 最终发布为 `/openapi/users`。

配置 `OPENAPI_TOKEN` 后，运行接口必须携带：

```http
x-api-token: <OPENAPI_TOKEN>
```

### 响应格式

包装模式：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

原始模式直接返回查询结果数组，或非查询语句的 `affectedRows` / MySQL `insertId`。

## 安全说明

- `#{name}` 是默认且推荐的安全绑定方式。
- `${name}` 属于 SQL 拼接，必须由每个接口显式开启，仍可能造成 SQL 注入。
- 生成接口使用数据源配置中的数据库账号权限执行。生产环境应使用最小权限账号，查询接口优先只读账号。
- 「只读数据源」会在运行时拒绝非查询 SQL，但数据库账号权限仍是最终安全边界，不能只依赖该开关。
- 数据源密码加密后写入 SQLite 状态库，API 响应不会返回密码。
- 管理令牌只保存在当前浏览器 `localStorage`，不会写入项目文件。
- 运行时日志只在内存保存最近 200 条，服务重启后清空。
- 当前版本没有租户隔离、角色权限、接口级限流、分布式锁和持久化审计，不适合直接作为公网多租户网关。

## 项目结构

```text
server/
  app.js                 管理 API、静态资源和路由分发
  index.js               启动入口与优雅退出
  driver-manager.js      MySQL / Oracle 连接池与执行适配
  metadata.js            表、字段、主键元数据读取
  generator.js           CRUD 接口定义生成
  runtime.js             /openapi/* 运行时分发
  store.js               SQLite 状态库、内存索引和旧 JSON 迁移
  openapi.js             OpenAPI 文档生成
  plugins.js             服务端插件加载、注册和调用
  script/                脚本服务调度、Worker 沙箱和数据库 RPC
  services/              数据源、接口定义、共享脚本、查询、CRUD 业务逻辑
  sql/                   模板解析、表达式求值、标识符处理、脚本 SQL 绑定
public/
  index.html             管理台入口
  js/                    原生 ESM 前端模块
  styles.css             管理台样式
plugins/                 可信服务端插件目录，默认从 PLUGINS_DIR 加载
tests/                   Node 内置测试
data/                    SQLite 状态库、旧 JSON、WAL 文件和密钥文件，默认不提交
```

## 验证

```bash
npm test
npm run check
```

当前自动化测试覆盖模板渲染、表达式求值、CRUD 生成、路径匹配、参数转换、密码加解密、SQLite 重启持久化与统计批量刷新、旧 JSON 迁移及失败回滚、schema v2 → v3 迁移、脚本 Worker 参数与共享脚本注入、脚本超时、事务提交与回滚、外部 HTTP 开关与白名单、插件加载、脚本编辑器补全与方法提取、接口与共享脚本版本快照和恢复、Oracle 11g 分页与元数据兼容、Oracle Thick 模式初始化、Oracle DML 自动提交、数据源只读持久化与 403 拦截、查询超时与连接中断路径，以及应用处理器级的管理鉴权、静态页面、SQL 预览、脚本试运行、超时响应和 OpenAPI 文档生成。

真实 MySQL / Oracle 连接、数据库方言执行结果、浏览器视觉回归和真实端口启动不属于当前沙箱已验证范围，需要在有数据库和网络的环境中继续联调。

## 内网离线部署

Ubuntu 20.04 x86_64 内网部署、Node.js 离线安装、Oracle 11g / Instant Client 19c、离线 npm cache、systemd 管理、日志和排障，统一记录在：

[docs/offline-deployment.md](docs/offline-deployment.md)

## 常见问题

**提示 `DRIVER_MISSING`**

对应驱动未安装。运行 `npm install mysql2` 或 `npm install oracledb`。

**管理 API 返回 401**

配置了 `ADMIN_TOKEN` 时，在管理台右上角设置访问令牌；未配置时，非本机请求会被拒绝。

**提示密码无法解密**

`SECRET_FILE` 或 `APP_SECRET` 与保存密码时不一致。重新编辑数据源并输入密码后保存。

**Oracle 分页报语法错误**

当前使用 11g 兼容的 `ROWNUM` 分页，11g、12c 及以上均适用。如果仍有语法错误，检查自定义 SQL 本身是否使用了目标数据库不支持的语法。

**Oracle 11g 提示连接失败或版本不支持**

确认已安装 Oracle Client 库，配置 `ORACLE_CLIENT_LIB_DIR` 和 `ORACLE_THICK_MODE=true`，并在 Linux 上执行 `ldconfig` 或设置 `LD_LIBRARY_PATH` 后重启服务。默认 Thin 模式不能连接 Oracle 11g。完整步骤见 [docs/offline-deployment.md](docs/offline-deployment.md)。

**接口返回 502**

查看「调用日志」中的错误，并先使用数据源的「测试连接」确认网络、账号和权限。数据库错误会返回执行失败信息，但不会返回数据源密码。

**接口返回 504 / `DB_QUERY_TIMEOUT`**

SQL 执行超过了全局 `QUERY_TIMEOUT_MS` 或接口自身配置的 `timeoutMs`。先优化 SQL、缩小结果集或补充索引；确有必要时再提高该接口的超时值。若接口经反向代理访问，确认代理超时没有更短。
