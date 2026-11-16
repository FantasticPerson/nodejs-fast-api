# Node Magic API 内网离线部署指南

更新时间：2026-11-16

适用环境：

- 内网 Ubuntu 20.04 x86_64。
- Node.js 20 或 22，项目要求 `>= 20`。
- MySQL 与 Oracle 可同时使用。
- Oracle Database 11g 使用 `node-oracledb` Thick 模式和 Oracle Instant Client 19c。
- 使用 systemd 管理服务，不依赖 PM2。

本文示例使用以下目录，实际路径不同时请整体替换：

```text
项目目录       /opt/deploy/fastapi
Node.js        /opt/nodejs/current
Instant Client /opt/oracle/instantclient_19_33
运行用户       root（示例先用 root，正式环境建议专用用户）
```

## 1. 离线部署包清单

内网服务器至少需要准备以下文件：

- Node.js Linux x64 二进制包，例如 `node-v22.XX.0-linux-x64.tar.xz`。
- GitHub Actions 生成的 `fastapi-npm-cache.tgz` 和对应 SHA-256 文件。
- 项目源码压缩包，或通过内网 Git 仓库获取的源码。
- Oracle Instant Client 19c Basic 包，例如 `instantclient-basic-linux.x64-19.33.0.0.0dbru.zip`。
- Oracle Instant Client SQL*Plus 包，可选。
- Ubuntu 的 `libaio1` 和 `unzip` 安装包，若服务器没有本地 APT 源则需要手动准备。

Oracle Instant Client SDK 不用于 `node-oracledb` 预编译二进制运行，运行时只需要 Basic 包。

## 2. 离线安装 Node.js

先检查旧 Node.js 的来源：

```bash
node -v
command -v node
dpkg -S "$(command -v node)" 2>/dev/null || true
```

如果旧版本由 APT 包安装：

```bash
sudo apt-get remove --purge -y nodejs
sudo apt-get autoremove -y
hash -r
```

如果是手动安装在 `/usr/local` 的旧版本，先确认具体文件，不要直接删除整个目录。

解压新的 Node.js：

```bash
sudo mkdir -p /opt/nodejs
sudo tar -xJf /path/to/node-v22.XX.0-linux-x64.tar.xz -C /opt/nodejs
sudo ln -sfn /opt/nodejs/node-v22.XX.0-linux-x64 /opt/nodejs/current

sudo ln -sf /opt/nodejs/current/bin/node /usr/local/bin/node
sudo ln -sf /opt/nodejs/current/bin/npm /usr/local/bin/npm
sudo ln -sf /opt/nodejs/current/bin/npx /usr/local/bin/npx

hash -r
node -v
npm -v
command -v node
```

`/usr/local/bin` 通常优先于 `/usr/bin`。确认 `node -v` 至少为 20。

## 3. 安装 Oracle Instant Client 19c

### 3.1 安装系统依赖

联网或具备本地 APT 源时：

```bash
sudo apt-get update
sudo apt-get install -y libaio1 unzip
```

内网离线环境需要提前准备对应的 `.deb` 文件，并通过 `dpkg -i` 或本地 APT 源安装。

### 3.2 解压 Basic 包

确认系统架构：

```bash
uname -m
```

应输出 `x86_64`。解压 Basic 包：

```bash
sudo mkdir -p /opt/oracle
sudo unzip /path/to/instantclient-basic-linux.x64-19.33.0.0.0dbru.zip -d /opt/oracle
```

确认目录：

```bash
ls -ld /opt/oracle/instantclient_19_*
```

确认关键库存在：

```bash
ls -l /opt/oracle/instantclient_19_33/libclntsh.so \
      /opt/oracle/instantclient_19_33/libclntsh.so.19.1 \
      /opt/oracle/instantclient_19_33/libclntshcore.so.19.1 \
      /opt/oracle/instantclient_19_33/libnnz19.so
```

如果 `libclntshcore.so.19.1` 不存在，不能通过创建软链接解决，应重新解压完整的 Basic ZIP。Oracle Instant Client 19c 可以连接 Oracle Database 11.2 及以上版本。

### 3.3 配置 Linux 动态库路径

这一步必须完成。`ORACLE_CLIENT_LIB_DIR` 不能替代 Linux 系统动态库搜索路径。

使用 vi 编辑：

```bash
sudo vi /etc/ld.so.conf.d/oracle-instantclient.conf
```

写入实际目录：

```text
/opt/oracle/instantclient_19_33
```

保存后执行：

```bash
sudo ldconfig
sudo ldconfig -p | grep -E 'libnnz19|libclntshcore'
```

检查依赖：

```bash
ldd /opt/oracle/instantclient_19_33/libclntsh.so | grep "not found"
```

没有输出表示依赖完整。若仍有 `libnnz19.so` 或 `libclntshcore.so.19.1` 找不到，检查 `/etc/ld.so.conf.d/oracle-instantclient.conf` 的目录是否准确，并确认对应文件真实存在。

### 3.4 SQL*Plus（可选）

需要 SQL*Plus 时，将 SQL*Plus ZIP 解压到同一个 Instant Client 目录：

```bash
sudo unzip /path/to/instantclient-sqlplus-linux.x64-19.33.0.0.0dbru.zip -d /opt/oracle
```

临时测试：

```bash
export LD_LIBRARY_PATH=/opt/oracle/instantclient_19_33:$LD_LIBRARY_PATH
export PATH=/opt/oracle/instantclient_19_33:$PATH
sqlplus user/password@//host:1521/service_name
```

## 4. 配置项目环境变量

进入项目目录：

```bash
cd /opt/deploy/fastapi
```

复制配置模板：

```bash
cp .env.example .env
```

使用 vi 编辑：

```bash
vi .env
```

内网局域网访问和 Oracle 11g 至少需要以下配置：

```dotenv
HOST=0.0.0.0
PORT=3000

ADMIN_TOKEN=请替换为足够长的随机字符串
OPENAPI_TOKEN=

ORACLE_THICK_MODE=true
ORACLE_CLIENT_LIB_DIR=/opt/oracle/instantclient_19_33

OPENAPI_PATH=/openapi
QUERY_TIMEOUT_MS=30000
CORS_ORIGIN=*
```

配置说明：

- `HOST=127.0.0.1` 只允许服务器本机访问；局域网访问必须使用 `0.0.0.0`。
- `ADMIN_TOKEN` 为管理 API 和 OpenAPI 文档访问令牌，非本机管理请求必须提供。
- `ORACLE_THICK_MODE=true` 是 Oracle 11g 的必需配置。
- `ORACLE_CLIENT_LIB_DIR` 指向包含 `libclntsh.so` 的 Instant Client 目录。
- 配置 `ORACLE_CLIENT_LIB_DIR` 本身也会在项目代码中启用 Thick 模式，但建议同时显式设置 `ORACLE_THICK_MODE=true`。
- `QUERY_TIMEOUT_MS=0` 表示关闭全局查询超时。

不要提交或公开 `.env`、`data/`、`data/.secret`。

## 5. 离线安装 npm 依赖

### 5.1 生成离线 cache

项目提供手动触发的 GitHub Actions 工作流：

```text
.github/workflows/build-npm-cache.yml
```

操作步骤：

1. 将项目推送到 GitHub。
2. 打开仓库的 Actions 页面。
3. 选择 `Build Offline npm Cache`。
4. 点击 `Run workflow`。
5. 下载 `fastapi-npm-cache` artifact。

artifact 中包含：

```text
fastapi-npm-cache.tgz
fastapi-npm-cache.tgz.sha256
```

该 artifact 只包含 npm cache，不包含项目源码。项目源码需要单独传入内网。

### 5.2 在内网解压 cache

把下载的 artifact 和项目源码传入服务器，例如放到 `/opt/deploy`：

```bash
mkdir -p /opt/deploy
cd /opt/deploy

unzip fastapi-npm-cache.zip -d /opt/deploy
sha256sum -c fastapi-npm-cache.tgz.sha256
tar -xzf fastapi-npm-cache.tgz -C /opt/deploy
```

解压后应有：

```text
/opt/deploy/npm-cache
```

### 5.3 使用离线 cache 安装

进入项目源码目录：

```bash
cd /opt/deploy/fastapi
npm ci --offline --no-audit --no-fund \
  --cache /opt/deploy/npm-cache
```

也可以先设置环境变量：

```bash
export NPM_CONFIG_CACHE=/opt/deploy/npm-cache
npm ci --offline --no-audit --no-fund
```

必须使用 `npm ci`，它会严格按 `package-lock.json` 安装。不要使用 `npm install` 替代。

验证依赖：

```bash
node -e "require('mysql2'); require('oracledb'); console.log('drivers ok')"
```

### 5.4 `ENOTCACHED` 的处理

如果出现：

```text
npm error code ENOTCACHED
request to https://registry.npmjs.org/... failed
```

说明当前 cache 缺少对应包的 registry 元数据或 tarball。离线环境无法补下载，需要回到联网机器重新生成 cache。确认 `package-lock.json` 与生成 cache 时使用的版本一致。

## 6. 使用 systemd 管理服务

systemd 比 `nohup`、`screen`、`tmux` 更适合长期运行，支持开机自启、崩溃重启和统一日志。

### 6.1 确认 Node 路径

```bash
command -v node
```

例如输出 `/usr/local/bin/node`，服务文件中应使用这个绝对路径。

### 6.2 创建服务文件

使用 vi：

```bash
sudo vi /etc/systemd/system/node-magic-api.service
```

写入：

```ini
[Unit]
Description=Node Magic API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/deploy/fastapi
ExecStart=/usr/local/bin/node /opt/deploy/fastapi/server/index.js
Restart=on-failure
RestartSec=3
Environment=LD_LIBRARY_PATH=/opt/oracle/instantclient_19_33
KillSignal=SIGTERM
TimeoutStopSec=30
SyslogIdentifier=node-magic-api
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

保存退出后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now node-magic-api
sudo systemctl status node-magic-api --no-pager
```

示例先用 `User=root`。正式环境建议创建专用用户，并确保该用户拥有项目目录及 `data/` 的读写权限。同时确认专用用户对 Instant Client 目录具有读取和执行权限。

如果已经通过 `ldconfig` 配置了系统动态库路径，`Environment=LD_LIBRARY_PATH=...` 可以作为额外保险保留。

### 6.3 常用管理命令

```bash
sudo systemctl start node-magic-api
sudo systemctl stop node-magic-api
sudo systemctl restart node-magic-api
sudo systemctl status node-magic-api --no-pager
sudo systemctl disable node-magic-api
```

### 6.4 与 PM2 共存注意事项

不要让 PM2 和 systemd 同时管理同一个进程，否则容易发生 3000 端口占用。若曾执行过 `pm2 startup`，检查：

```bash
sudo systemctl list-unit-files | grep -i pm2
```

如果存在 PM2 开机服务，按实际名称禁用：

```bash
sudo systemctl disable pm2-root
```

## 7. 验证部署

检查监听地址：

```bash
ss -lntp | grep ':3000'
```

应看到：

```text
0.0.0.0:3000
```

本机健康检查：

```bash
curl -i http://127.0.0.1:3000/magic/api/health
```

局域网访问：

```text
http://服务器IP:3000/magic
```

首次进入管理台时，在页面右上角填写 `ADMIN_TOKEN`。

验证 Oracle Thick 模式：

```bash
cd /opt/deploy/fastapi
LD_LIBRARY_PATH=/opt/oracle/instantclient_19_33 \
node -e "const oracledb=require('oracledb'); oracledb.initOracleClient(); console.log('thin=', oracledb.thin)"
```

输出 `thin= false` 表示 Thick 模式加载成功。之后在管理台数据源页面测试 Oracle 11g 连接。

如果服务器启用了 UFW：

```bash
sudo ufw status verbose
sudo ufw allow 3000/tcp
```

## 8. 日志

### 8.1 systemd 日志

查看最近日志：

```bash
sudo journalctl -u node-magic-api -n 200 --no-pager
```

实时查看：

```bash
sudo journalctl -u node-magic-api -f
```

正常启动应包含：

```text
Node Magic API Studio: http://0.0.0.0:3000
Generated APIs:       ...
```

### 8.2 写入独立日志文件

如果操作部门更习惯直接看文件，可以把服务配置中的：

```ini
StandardOutput=journal
StandardError=journal
```

改为：

```ini
StandardOutput=append:/var/log/node-magic-api.log
StandardError=append:/var/log/node-magic-api.log
```

然后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart node-magic-api
sudo tail -f /var/log/node-magic-api.log
```

`append:` 写法不需要重定向符号；需要确保运行用户对日志文件有写权限。

### 8.3 请求日志说明

项目只会向 stdout 输出启动信息。`/openapi/*` 的每次调用记录保存在管理台「调用日志」页面，最多 200 条，进程重启后清空，不自动写入 systemd 日志或磁盘文件。

如果需要持久化每次接口调用，需要后续增加文件日志或外部日志组件。

## 9. PM2（可选）

项目不依赖 PM2。systemd 是推荐的生产运行方式。

如果临时使用项目内 PM2：

```bash
cd /opt/deploy/fastapi
./node_modules/.bin/pm2 start server/index.js --name node-magic-api
./node_modules/.bin/pm2 status
```

需要直接使用 `pm2` 命令时，可以创建软链接：

```bash
sudo ln -sf /opt/deploy/fastapi/node_modules/.bin/pm2 /usr/local/bin/pm2
hash -r
pm2 -v
```

不建议在内网执行 `npm install -g pm2`。项目离线 cache 是由 `npm ci` 生成的锁文件安装缓存，包含项目依赖，但通常不包含 `npm install -g` 所需的完整 registry 元数据。全局安装会请求 `https://registry.npmjs.org/pm2`，因此可能报 `ENOTCACHED`。项目内 PM2 已经可用，无需全局安装。

## 10. 常见问题

### 10.1 本机可以访问，局域网无法访问

检查 `.env`：

```dotenv
HOST=0.0.0.0
```

执行：

```bash
ss -lntp | grep ':3000'
sudo ufw status verbose
```

如果监听地址仍是 `127.0.0.1:3000`，说明配置未生效或进程使用了其他环境。

### 10.2 管理台返回 401

非本机访问管理 API 时必须配置 `ADMIN_TOKEN`，并在管理台右上角填写同一个值。

### 10.3 `libnnz19.so` 或 `libclntshcore.so.19.1` not found

- `libnnz19.so` 存在但找不到：检查 `/etc/ld.so.conf.d/oracle-instantclient.conf` 并重新执行 `sudo ldconfig`。
- `libclntshcore.so.19.1` 不存在：Instant Client 目录不完整，重新解压完整 Basic ZIP。
- `ldd` 不会自动从当前目录查找依赖，即使当前 shell 位于 Instant Client 目录。

### 10.4 Oracle 提示客户端库初始化失败

确认：

```bash
ls -l /opt/oracle/instantclient_19_33/libclntsh.so
ldd /opt/oracle/instantclient_19_33/libclntsh.so | grep "not found"
```

并确认 `.env`、systemd 环境和实际目录一致。

### 10.5 端口已被占用

```bash
ss -lntp | grep ':3000'
```

如果仍有旧 Node 或 PM2 进程，先停止旧进程，再重启 systemd 服务。不要同时使用 PM2 和 systemd 启动同一项目。

### 10.6 systemd 启动但网页打不开

查看：

```bash
sudo systemctl status node-magic-api --no-pager
sudo journalctl -u node-magic-api -n 200 --no-pager
ss -lntp | grep ':3000'
```

优先确认 `ExecStart` 的 Node 绝对路径、`WorkingDirectory`、`.env`、监听地址和防火墙。

## 11. 更新与备份

升级前备份：

```bash
cd /opt/deploy/fastapi
tar -czf /opt/backup/fastapi-data-$(date +%F-%H%M%S).tgz data
```

需要备份：

- `data/state.json`：数据源和接口定义。
- `data/.secret`：数据源密码解密密钥。

两者必须配套备份。只恢复状态文件而丢失密钥，已保存的数据源密码将无法解密。

升级流程建议：

1. 停止 systemd 服务。
2. 备份 `data/`。
3. 更新源码与 `package-lock.json`。
4. 使用对应版本的离线 npm cache 执行 `npm ci --offline`。
5. 启动服务并检查健康接口、管理台和数据库连接。
