import fs from 'node:fs/promises';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { AppError } from '../errors.js';

const ALGORITHM = 'aes-256-gcm';

export class SecretBox {
  constructor(key) {
    this.key = key;
  }

  static async create({ keyFile, secret = '' }) {
    if (secret) {
      return new SecretBox(createHash('sha256').update(secret).digest());
    }
    const key = await readOrCreateKey(keyFile);
    return new SecretBox(key);
  }

  encrypt(plainText) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(String(plainText ?? ''), 'utf8'),
      cipher.final()
    ]);
    return {
      v: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: ciphertext.toString('base64')
    };
  }

  decrypt(payload) {
    if (!payload || payload.v !== 1) {
      throw new AppError('数据源密码格式无效', 500, 'SECRET_FORMAT_INVALID');
    }
    try {
      const iv = Buffer.from(payload.iv, 'base64');
      const tag = Buffer.from(payload.tag, 'base64');
      const data = Buffer.from(payload.data, 'base64');
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
      throw new AppError(
        '数据源密码无法解密，请重新编辑数据源并保存密码',
        500,
        'SECRET_DECRYPT_FAILED'
      );
    }
  }
}

async function readOrCreateKey(keyFile) {
  await fs.mkdir(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  try {
    const raw = await fs.readFile(keyFile);
    if (raw.length !== 32) {
      throw new AppError('密钥文件长度无效，请备份后删除以重新生成', 500, 'SECRET_KEY_INVALID');
    }
    await fs.chmod(keyFile, 0o600).catch(() => {});
    return raw;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const key = randomBytes(32);
  try {
    await fs.writeFile(keyFile, key, { mode: 0o600, flag: 'wx' });
    return key;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const raw = await fs.readFile(keyFile);
    if (raw.length !== 32) {
      throw new AppError('密钥文件长度无效，请检查 SECRET_FILE 配置', 500, 'SECRET_KEY_INVALID');
    }
    return raw;
  }
}
