import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SecretBox } from '../server/security/secret-box.js';

test('SecretBox encrypts and decrypts values with a generated key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-magic-secret-'));
  const keyFile = path.join(dir, 'key.bin');
  const box = await SecretBox.create({ keyFile });
  const encrypted = box.encrypt('db-password');
  assert.notEqual(encrypted.data, 'db-password');
  assert.equal(box.decrypt(encrypted), 'db-password');
  const stat = await fs.stat(keyFile);
  assert.equal(stat.mode & 0o777, 0o600);
  await fs.rm(dir, { recursive: true, force: true });
});

test('SecretBox refuses ciphertext from another key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-magic-secret-'));
  const first = await SecretBox.create({ keyFile: path.join(dir, 'first.bin') });
  const second = await SecretBox.create({ keyFile: path.join(dir, 'second.bin') });
  const encrypted = first.encrypt('secret');
  assert.throws(() => second.decrypt(encrypted), /无法解密/);
  await fs.rm(dir, { recursive: true, force: true });
});
