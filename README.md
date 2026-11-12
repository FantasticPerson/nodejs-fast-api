# Node Magic API Studio

一个参考 magic-api 的 Node.js 快速接口平台。通过浏览器维护 MySQL / Oracle 数据源和 SQL 接口，保存后立即发布为 HTTP API，并为数据表生成标准 CRUD 接口。

当前版本是单机 MVP：管理台、接口定义、SQL 模板、OpenAPI 文档和数据库驱动接入已经实现；真实 MySQL / Oracle 连接仍需在具备数据库和驱动的环境中完成联调。

## 功能

- 浏览器管理台：新建、编辑、启停和删除接口。
- 数据源管理：MySQL / Oracle 连接配置、连接测试、表结构浏览。
- 一键 CRUD：列表、详情、新增、更新、删除。
- SQL 模板：安全绑定参数、条件标签、循环标签和显式原样拼接。
- SELECT 分页：自动生成总数与分页查询。
- OpenAPI 3.0 文档：`/magic/api/openapi.json`。
- 响应模式：包装为 `{ code, message, data }`，或直接返回原始数据。
- 调用日志：内存保留最近 200 条，不记录请求体和密码。
- 密码保护：数据源密码使用 AES-256-GCM 加密保存。
- 零构建前端：不依赖 React/Vue，不需要单独构建静态页面。

## 技术要求

- Node.js `>= 20`。
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
| `CORS_ORIGIN` | `*` | 生成接口的 CORS 允许来源，可填逗号分隔列表；管理 API 不走该配置。 |
| `ORACLE_THICK_MODE` | `false` | 设为 `true` 启用 `node-oracledb` Thick 模式，使用系统动态库路径中的 Oracle Client。 |
| `ORACLE_CLIENT_LIB_DIR` | 空 | Oracle Client 库目录。配置该目录会自动启用 Thick 模式，适合 Oracle 11g。 |
| `STATE_FILE` | `data/state.json` | 数据源和接口定义的 JSON 存储文件。 |
| `SECRET_FILE` | 与状态文件同目录的 `.secret` | 数据源密码加解密密钥文件，权限自动设为 `600`。 |
| `APP_SECRET` | 空 | 可选。设置后用它派生加密密钥，不再使用 `SECRET_FILE`。 |

注意：

- 已保存的数据源密码只能由同一个密钥解密。切换 `APP_SECRET` 或删除/替换 `SECRET_FILE` 后，需要重新编辑数据源并保存密码。
- 状态文件适合单进程、单实例。不要同时启动多个进程写同一个 `STATE_FILE`。
- 不要把管理端口直接暴露到公网。当前没有多用户、角色权限、CSRF 防护或持久化审计。

## 使用流程

1. 启动服务，打开 `/magic`。
2. 进入「数据源」，添加 MySQL 或 Oracle 连接并测试。
3. 点击「浏览表」，选择数据表查看字段、主键和可空属性。
4. 点击「生成 CRUD」，选择路径前缀和所需方法，预览后批量创建接口。
5. 也可以在「接口」页新建自定义 SQL 接口，配置参数、分页、响应模式和测试值。
6. 在「接口文档」页复制 OpenAPI JSON 地址，或直接调用 `/openapi/*` 下的生成接口。

### MySQL 数据源

需要填写主机、端口、数据库名、用户名和密码，默认端口为 `3306`。

### Oracle 数据源

需要填写主机、端口、服务名或 SID、用户名和密码，默认端口为 `1521`。`schema` 可不填，默认使用用户名并转换为大写；也可以直接填写连接字符串覆盖主机配置。

连接 Oracle 11g 时，还需要安装 Oracle Client 库并启用 Thick 模式。通常使用可连接 11.2+ 的 Oracle 19c Instant Client：

```bash
ORACLE_CLIENT_LIB_DIR=/opt/oracle/instantclient_19_XX
```

如果 Oracle Client 已经配置在系统动态库搜索路径中，也可以只设置：

```bash
ORACLE_THICK_MODE=true
```

修改配置后需要重启服务。Thick 模式启用后，MySQL 和 Oracle 12c+ 数据源仍可同时使用。

当前 Oracle 元数据读取按默认大写对象名处理，大小写混合的 quoted identifier 不是主要支持场景。联合主键暂不支持自动 CRUD，请改用自定义 SQL 接口；没有单列主键的表只能生成列表和新增。

Oracle 11g 没有 Identity Column 元数据。由序列和触发器生成主键的表不会自动识别为自增列，自动生成的 POST 接口需要显式提交主键，或改用自定义 SQL 接口。

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

### CRUD 生成约定

- 列表：`GET /users`，支持分页和最多 6 个字符字段的关键字搜索。
- 详情：`GET /users/:id`。
- 新增：`POST /users`。
- 更新：`PUT /users/:id`，未提交或提交 `null` 的字段保持原值。
- 删除：`DELETE /users/:id`。

自动更新接口使用 `COALESCE` 保留旧值，因此无法通过自动生成的更新接口把字段显式置为 `NULL`。需要置空时请创建自定义 SQL 接口。

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
- 数据源密码加密后写入状态文件，API 响应不会返回密码。
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
  openapi.js             OpenAPI 文档生成
  services/              数据源、接口定义、查询、CRUD 业务逻辑
  sql/                   模板解析、表达式求值、标识符处理
public/
  index.html             管理台入口
  js/                    原生 ESM 前端模块
  styles.css             管理台样式
tests/                   Node 内置测试
data/                    运行期状态文件和密钥文件，默认不提交
```

## 验证

```bash
npm test
npm run check
```

当前自动化测试覆盖模板渲染、表达式求值、CRUD 生成、路径匹配、参数转换、密码加解密、Oracle 11g 分页与元数据兼容、Oracle Thick 模式初始化，以及应用处理器级的管理鉴权、静态页面、SQL 预览和 OpenAPI 文档生成。

真实 MySQL / Oracle 连接、数据库方言执行结果、浏览器视觉回归和真实端口启动不属于当前沙箱已验证范围，需要在有数据库和网络的环境中继续联调。

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

确认已安装 Oracle Client 库，并配置 `ORACLE_CLIENT_LIB_DIR`，或设置 `ORACLE_THICK_MODE=true` 后重启服务。默认 Thin 模式不能连接 Oracle 11g。

**接口返回 502**

查看「调用日志」中的错误，并先使用数据源的「测试连接」确认网络、账号和权限。数据库错误会返回执行失败信息，但不会返回数据源密码。
