# flomo-mcp

个人用 flomo Streamable HTTP MCP。服务端自己拿环境变量里的账密登录、缓存 access_token，Agent 侧只配 URL 和一把 MCP 钥匙。

可在本机 Node 跑，也可部署到 Cloudflare Worker（域名 `flomo.chaochun.cc`）。token / memo 缓存走 Store：本地写目录，Worker 写 KV。

## Cloudflare Worker

```bash
npx wrangler kv namespace create flomo-mcp-cache   # 把 id 填进 wrangler.jsonc
npx wrangler secret put MCP_API_KEY
npx wrangler secret put FLOMO_ACCOUNT
npx wrangler secret put FLOMO_PASSWORD
npm run deploy
```

公开地址：`https://flomo.chaochun.cc/mcp`。不要把 flomo 密码写进仓库或 Agent 配置。

Cursor：

```json
{
  "mcpServers": {
    "flomo": {
      "url": "https://flomo.chaochun.cc/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_API_KEY>"
      }
    }
  }
}
```

## 本机 Node

Node 20+。

```bash
git clone https://github.com/dulk-dev/flomo-mcp.git
cd flomo-mcp
npm install
cp .env.example .env
```

编辑 `.env`，至少填 `MCP_API_KEY`，以及 `FLOMO_ACCOUNT` / `FLOMO_PASSWORD`（或 `FLOMO_ACCESS_TOKEN`）。

```bash
npm run build
npm start
```

开发时用 `npm run dev`（tsx 直接跑源码）。

默认监听 `http://127.0.0.1:8787/mcp`。换端口或绑到局域网：

```
PORT=8787
HOST=0.0.0.0
```

`MCP_API_KEY` 为空会直接拒绝启动。

## 环境变量

| 变量                               | 说明                                                      |
| ---------------------------------- | --------------------------------------------------------- |
| `MCP_API_KEY`                      | 必填。Agent 的 `Authorization: Bearer` 用它。空值不启动。 |
| `FLOMO_ACCOUNT` / `FLOMO_PASSWORD` | flomo 邮箱或手机号 + 密码。服务端 `login_by_email`。      |
| `FLOMO_ACCESS_TOKEN`               | 有它就跳过账密。失效后没法自动重登，除非同时配了账密。    |
| `FLOMO_DATA_DIR`                   | `token.json` 和 `memos.json` 的目录，默认 `./data`。      |
| `PORT`                             | 默认 `8787`。                                             |
| `HOST`                             | 默认 `127.0.0.1`。                                        |

token 和 memo 缓存走 Store 接口，本地实现写到 `FLOMO_DATA_DIR`，不会写死 `os.homedir()`。

登录态 401 时清缓存、用账密重登、把当前请求再打一次。不暴露 login / logout / sync-token / purge。

## Cursor HTTP MCP

```json
{
  "mcpServers": {
    "flomo": {
      "url": "http://127.0.0.1:8787/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_API_KEY>"
      }
    }
  }
}
```

钥匙用 `crypto.timingSafeEqual` 比对。没有 Bearer 或钥匙不对，HTTP 401。

## 工具对照

共 22 个。CLI 里的四条洞察合成 `flomo_insight`，其余与 CLI 命令同名（连字符改成下划线）。

| MCP 工具           | 对应 CLI                                                         | 说明                                     |
| ------------------ | ---------------------------------------------------------------- | ---------------------------------------- |
| `flomo_whoami`     | `whoami`                                                         | 身份 + `insight_remaining`               |
| `flomo_memos`      | `memos`                                                          | 列表，可按 tag / pinned                  |
| `flomo_search`     | `search`                                                         | 本地缓存全文，多词 AND                   |
| `flomo_get`        | `get`                                                            | 单条，含 HTML                            |
| `flomo_new`        | `new`                                                            | 新建                                     |
| `flomo_edit`       | `edit`                                                           | 替换或追加，回传 `file_ids`              |
| `flomo_delete`     | `delete`                                                         | 进回收站                                 |
| `flomo_restore`    | `restore`                                                        | 从回收站恢复                             |
| `flomo_trash`      | `trash`                                                          | 回收站列表                               |
| `flomo_pin`        | `pin`                                                            | 全局一条置顶，可 `force`                 |
| `flomo_unpin`      | `unpin`                                                          | 取消置顶                                 |
| `flomo_tags`       | `tags`                                                           | 从 memo 派生的标签树                     |
| `flomo_tag_pin`    | `tag-pin`                                                        | 置顶标签                                 |
| `flomo_tag_unpin`  | `tag-unpin`                                                      | 取消置顶标签                             |
| `flomo_tag_rename` | `tag-rename`                                                     | 异步批量改写，接口秒回                   |
| `flomo_daily`      | `daily`                                                          | 每日回顾                                 |
| `flomo_random`     | `random`                                                         | 随机漫步                                 |
| `flomo_stats`      | `stats`                                                          | 与网页侧栏同口径                         |
| `flomo_related`    | `related`                                                        | 语义相关笔记                             |
| `flomo_revisions`  | `revisions`                                                      | 编辑前后快照                             |
| `flomo_upload`     | `upload`                                                         | `filename` + `data_base64`，不要本机路径 |
| `flomo_insight`    | `insight` / `insights` / `insight-history` / `insight-templates` | 见下一节                                 |

## 洞察 mode

`flomo_insight` 用 `mode` 做判别：

| mode        | 是否耗每日额度 | 主要参数                                                        |
| ----------- | -------------- | --------------------------------------------------------------- |
| `history`   | 否             | `page`、`limit`、`full`、`from` / `to`、`source`、`chat_id`     |
| `templates` | 否             | 无                                                              |
| `memo`      | 是             | `slug`，可选 `think`                                            |
| `query`     | 是             | `template_id`，可选 `tag` / `from` / `to` / `keyword` / `think` |
| `related`   | 是             | `slug`，可选 `think`                                            |

生成结果会进网页版洞察历史。额度看 `flomo_whoami` 的 `insight_remaining`（Pro 每日次数由 flomo 决定）。`query` 不圈日期或标签时，服务端常报「符合条件的笔记数量太少」。`related` 会先拉该笔记相关推荐前 10 条再生成。

### 归档全部洞察历史

`mode=history` 不再一次倒出全部全文。MCP 客户端大约在 40KB 截断单次工具结果，所以每页必须自己够小。

返回值是对象，不是数组：

```json
{
  "items": [{ "title": "...", "chat_id": "...", "content": "...", "created_at": "..." }],
  "page": 1,
  "limit": 3,
  "total": 57,
  "has_more": true,
  "next_page": 2
}
```

客户端这样走完全部：

1. 目录：`mode=history` `full=false` `page=1`（默认每页 20，最多 40）。看 `has_more`，有则 `page=next_page` 再拉。
2. 全文：对每条 `chat_id` 再调 `mode=history` `chat_id=<id>`（单条全文，不标已读）；或者 `full=true` 按 `page` 翻（默认每页 3，最多 5）。
3. 不要再用 `limit=100, full=true` 指望一次拿完。这个值会被截到每页上限，后面的页靠 `page`。

`from` / `to` 按 `created_at` 的日期过滤。flomo 上游 `GET /memo/insight/history` 只认 `page`、`page_size`、`source`，没有日期字段；日期窗口是 Worker 连翻上游页再过滤。`template_id` 同样是 Worker 侧匹配 `template_id` 或 `template_name`。`source`（`memo` / `query` / `recommended`）会原样传给上游。

## 和官方 Max MCP 的差异

官方服务在 `https://flomoapp.com/mcp`，OAuth，面向 Max。公开资料里是 8 个工具：`memo_search`、`memo_create`、`memo_update`、`memo_delete`、`memo_batch_get`、`tag_tree`、`tag_rename`、`ai_search`。

这套个人 MCP 不走 OAuth，flomo 密码只在服务器环境变量里。工具覆盖网页同款签名 API（置顶、回收站、每日回顾、随机、统计、历史版本、图片上传、AI 洞察 SSE），搜索和统计在本地增量缓存上算，和网页 IndexedDB 同一套 `/memo/updated/` 游标。官方 `ai_search` 是他们的语义搜索；这里的 `flomo_insight` 打的是网页同款 `/memo/insight` SSE，吃的是 Pro 每日洞察额度。

## 测试

```bash
npm test
npx tsc --noEmit
```

有 flomo 凭据时可选只读冒烟（只打 `/user/me`，不写笔记）：

```bash
npm run test:smoke
```

默认 CI 不要跑冒烟，也不要把写操作放进默认测试。
