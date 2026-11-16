#!/usr/bin/env node
import { parseArgs } from 'node:util';
import oracledb from 'oracledb';

const { values } = parseArgs({
  options: {
    user: { type: 'string' },
    connect: { type: 'string' },
    'client-lib': { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  }
});

if (values.help) {
  printUsage();
  process.exit(0);
}

const user = values.user || process.env.ORACLE_USER || '';
const connectString = values.connect || process.env.ORACLE_CONNECT_STRING || '';
const password = process.env.ORACLE_PASSWORD || '';
const clientLibDir = values['client-lib'] || process.env.ORACLE_CLIENT_LIB_DIR || '';

if (!user || !connectString || !password) {
  console.error('缺少 Oracle 用户名、连接字符串或 ORACLE_PASSWORD 环境变量。');
  printUsage();
  process.exit(2);
}

let connection = null;
try {
  if (clientLibDir) {
    oracledb.initOracleClient({ libDir: clientLibDir });
  } else {
    oracledb.initOracleClient();
  }
  console.log(`node=${process.version}`);
  console.log(`driver=${oracledb.version}`);
  console.log(`thin=${oracledb.thin}`);
  console.log(`client=${oracledb.oracleClientVersionString || '未加载 Oracle Client'}`);
  console.log(`user=${user}`);
  console.log(`connectString=${connectString}`);

  connection = await oracledb.getConnection({ user, password, connectString });
  const result = await connection.execute(
    'SELECT USER AS CURRENT_USER FROM DUAL',
    [],
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  console.log('连接成功：', result.rows);
} catch (error) {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
} finally {
  if (connection) {
    await connection.close().catch(() => {});
  }
}

function printUsage() {
  console.error(`用法：
  read -r -s ORACLE_PASSWORD
  export ORACLE_PASSWORD
  node scripts/check-oracle-connection.mjs \\
    --user scott \\
    --connect HOST:1521/SERVICE_NAME \\
    --client-lib /opt/oracle/instantclient_19_33

连接串示例：
  服务名：HOST:1521/SERVICE_NAME
  SID：   HOST:1521:SID

密码不会出现在命令行参数中。用完可执行 unset ORACLE_PASSWORD。`);
}
