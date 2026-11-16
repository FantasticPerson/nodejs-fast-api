import { AppError } from './errors.js';
import { isSelectSql } from './sql/statement.js';
import { jsonSafe, parseBoolean, truncate } from './utils.js';
import {
  createQueryDeadline,
  isDriverTimeoutError,
  normalizeTimeoutMs,
  queryTimeoutError,
  runWithTimeout
} from './timeout.js';

const INSTALL_HINTS = {
  mysql: 'npm install mysql2',
  oracle: 'npm install oracledb'
};

export class DriverManager {
  constructor({ oracleThickMode = false, oracleClientLibDir = '' } = {}) {
    this.pools = new Map();
    this.driverCache = null;
    this.oracleThickMode = Boolean(oracleThickMode || oracleClientLibDir);
    this.oracleClientLibDir = oracleClientLibDir;
    this.oracleClientInitialized = false;
  }

  async driverStatus() {
    if (!this.driverCache) {
      this.driverCache = (async () => {
        const [mysql, oracle] = await Promise.all([
          probeModule('mysql2/promise'),
          probeModule('oracledb')
        ]);
        return { mysql, oracle };
      })();
    }
    return this.driverCache;
  }

  async getPool(datasource) {
    const cached = this.pools.get(datasource.id);
    if (cached) return cached;

    if (datasource.type === 'mysql') {
      const mysql = await loadModule('mysql2/promise', 'mysql');
      const pool = mysql.createPool({
        host: datasource.host,
        port: datasource.port,
        user: datasource.username,
        password: datasource.password,
        database: datasource.database,
        charset: 'utf8mb4',
        waitForConnections: true,
        connectionLimit: 6,
        queueLimit: 0,
        connectTimeout: 15000,
        enableKeepAlive: true,
        supportBigNumbers: true,
        bigNumberStrings: true
      });
      const entry = { type: 'mysql', pool };
      this.pools.set(datasource.id, entry);
      return entry;
    }

    if (datasource.type === 'oracle') {
      const oracledb = await loadModule('oracledb', 'oracle');
      this.enableOracleThickMode(oracledb);
      const connectString =
        datasource.connectString || `${datasource.host}:${datasource.port}/${datasource.serviceName}`;
      const pool = await oracledb.createPool({
        user: datasource.username,
        password: datasource.password,
        connectString,
        poolMin: 0,
        poolMax: 6,
        poolTimeout: 60,
        queueTimeout: 30000
      });
      const entry = { type: 'oracle', pool, oracledb };
      this.pools.set(datasource.id, entry);
      return entry;
    }

    throw new AppError(`不支持的数据源类型：${datasource.type}`, 422, 'UNSUPPORTED_DATASOURCE');
  }

  async execute(datasource, sql, values = [], options = {}) {
    const timeoutMs = normalizeTimeoutMs(options.timeoutMs, 0);
    const totalTimeoutMs = normalizeTimeoutMs(options.totalTimeoutMs, timeoutMs);
    const deadline = createQueryDeadline(timeoutMs);
    const control = { cancel: null };
    try {
      if (parseBoolean(datasource.readOnly, false) && !isSelectSql(sql)) {
        throw new AppError(
          `数据源「${datasource.name || datasource.id}」已启用只读模式，只能执行查询语句`,
          403,
          'DATASOURCE_READ_ONLY'
        );
      }
      return await runWithTimeout(
        async () => {
          const entry = await this.getPool(datasource);
          if (entry.type === 'mysql') {
            return await this.executeMysql(entry, sql, values, deadline, control);
          }
          return await this.executeOracle(entry, sql, values, options, deadline, control);
        },
        timeoutMs,
        {
          totalTimeoutMs,
          onTimeout: () => control.cancel?.()
        }
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isDriverTimeoutError(error)) throw queryTimeoutError(totalTimeoutMs || timeoutMs);
      throw new AppError(
        `数据库执行失败：${truncate(error?.message || error, 500)}`,
        502,
        'DB_EXECUTION_FAILED'
      );
    }
  }

  async executeMysql(entry, sql, values, deadline, control) {
    let connection = null;
    let destroyed = false;
    control.cancel = () => {
      if (connection) {
        destroyed = true;
        connection.destroy();
      }
    };
    try {
      connection = await entry.pool.getConnection();
      if (deadline.expired()) throw queryTimeoutError(deadline.timeoutMs);
      const queryOptions = { sql, values };
      if (deadline.timeoutMs) queryOptions.timeout = Math.max(1, deadline.remainingMs());
      const [rows] = await connection.execute(queryOptions, []);
      if (Array.isArray(rows)) {
        return { rows: jsonSafe(rows), affectedRows: 0, insertId: null };
      }
      return {
        rows: [],
        affectedRows: Number(rows.affectedRows || 0),
        insertId: rows.insertId ?? null
      };
    } catch (error) {
      if (connection && isDriverTimeoutError(error)) {
        destroyed = true;
        connection.destroy();
      }
      throw error;
    } finally {
      if (connection && !destroyed) connection.release();
    }
  }

  async executeOracle(entry, sql, values, options, deadline, control) {
    let connection = null;
    let breakPromise = null;
    let cancelled = false;
    let driverTimedOut = false;
    control.cancel = () => {
      cancelled = true;
      if (connection) {
        breakPromise = Promise.resolve(connection.breakExecution()).catch(() => {});
      }
    };
    try {
      connection = await entry.pool.getConnection();
      if (deadline.expired() || cancelled) throw queryTimeoutError(deadline.timeoutMs);
      const binds = {};
      values.forEach((value, index) => {
        binds[`p${index}`] = normalizeOracleBind(value);
      });
      if (deadline.timeoutMs) connection.callTimeout = Math.max(1, deadline.remainingMs());
      const result = await connection.execute(sql, binds, {
        outFormat: entry.oracledb.OUT_FORMAT_OBJECT,
        fetchArraySize: options.fetchArraySize || 100,
        autoCommit: true
      });
      return {
        rows: jsonSafe(result.rows || []),
        affectedRows: Number(result.rowsAffected || 0),
        insertId: null
      };
    } catch (error) {
      if (isDriverTimeoutError(error)) driverTimedOut = true;
      throw error;
    } finally {
      if (breakPromise) await breakPromise;
      if (connection) {
        await connection.close({ drop: Boolean(breakPromise || driverTimedOut) }).catch(() => {});
      }
    }
  }

  async test(datasource) {
    const startedAt = Date.now();
    if (datasource.type === 'mysql') {
      const result = await this.execute(datasource, 'SELECT VERSION() AS version', []);
      return {
        ok: true,
        type: 'mysql',
        version: result.rows[0]?.version || 'MySQL',
        latencyMs: Date.now() - startedAt
      };
    }
    const result = await this.execute(datasource, 'SELECT USER AS current_user FROM DUAL', []);
    return {
      ok: true,
      type: 'oracle',
      currentUser: result.rows[0]?.current_user || result.rows[0]?.CURRENT_USER || null,
      latencyMs: Date.now() - startedAt
    };
  }

  enableOracleThickMode(oracledb) {
    if (!this.oracleThickMode || this.oracleClientInitialized) return;
    if (oracledb.thin === false) {
      this.oracleClientInitialized = true;
      return;
    }
    try {
      oracledb.initOracleClient(
        this.oracleClientLibDir ? { libDir: this.oracleClientLibDir } : undefined
      );
      this.oracleClientInitialized = true;
    } catch (error) {
      throw new AppError(
        `Oracle Thick 模式初始化失败：${truncate(error?.message || error, 500)}`,
        503,
        'ORACLE_CLIENT_INIT_FAILED'
      );
    }
  }

  async closePool(datasourceId) {
    const entry = this.pools.get(datasourceId);
    if (!entry) return;
    this.pools.delete(datasourceId);
    try {
      if (entry.type === 'mysql') {
        await entry.pool.end();
      } else {
        await entry.pool.close(0);
      }
    } catch {
      // A stale pool should not block a data source edit.
    }
  }

  async dispose() {
    const ids = [...this.pools.keys()];
    await Promise.all(ids.map((id) => this.closePool(id)));
  }
}

async function probeModule(name) {
  try {
    await import(name);
    return true;
  } catch {
    return false;
  }
}

async function loadModule(name, dialect) {
  try {
    return await import(name);
  } catch {
    throw new AppError(
      `${dialect === 'oracle' ? 'Oracle' : 'MySQL'} 驱动未安装，请运行：${INSTALL_HINTS[dialect]}`,
      503,
      'DRIVER_MISSING',
      { install: INSTALL_HINTS[dialect] }
    );
  }
}

function normalizeOracleBind(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' && Number.isNaN(value)) return null;
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return JSON.stringify(value);
  }
  return value;
}
