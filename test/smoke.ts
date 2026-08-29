import 'dotenv/config';
import path from 'node:path';
import { FlomoClient } from '../src/flomo/client.js';
import { DirStore } from '../src/flomo/store.js';
import { asRecord } from '../src/flomo/memos.js';
import type { FlomoCredentials } from '../src/flomo/types.js';
import { v1 } from '../src/flomo/types.js';

const accessToken = process.env.FLOMO_ACCESS_TOKEN?.trim() ?? '';
const account = process.env.FLOMO_ACCOUNT?.trim() ?? '';
const password = process.env.FLOMO_PASSWORD ?? '';
const hasCreds = Boolean(accessToken || (account && password));

if (!hasCreds) {
  process.stderr.write('跳过只读冒烟：未设置 FLOMO_ACCESS_TOKEN 或 FLOMO_ACCOUNT/FLOMO_PASSWORD\n');
  process.exit(0);
}

const credentials: FlomoCredentials = {
  accessToken: accessToken || null,
  account: account || null,
  password: password || null,
};

const store = new DirStore(path.resolve(process.env.FLOMO_DATA_DIR?.trim() || './data'));
const client = new FlomoClient(store, credentials);
const user = asRecord(await client.apiCall('GET', v1('/user/me'), {}));
if (!user) {
  process.stderr.write('冒烟失败：/user/me 返回非对象\n');
  process.exit(1);
}
process.stderr.write(`冒烟通过：${String(user.name || user.email || user.id)}\n`);
