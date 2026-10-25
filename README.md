# flomo-mcp

本机 stdio MCP，给个人 flomo 用，不走官方 Max 的 OAuth。客户端在你的电脑上拉起进程，用 access token 或账密访问 flomo，凭据只留在本机。

包：[@dulk-dev/flomo-mcp](https://www.npmjs.com/package/@dulk-dev/flomo-mcp)（`0.1.0`）。需要 Node.js 22.23.4 及以上。MIT。

```text
Cursor / Claude Desktop
        │  npx -y @dulk-dev/flomo-mcp
        ▼
   本机 stdio 进程
        │  FLOMO_ACCESS_TOKEN，或账密
        │  FLOMO_DATA_DIR = 你的绝对路径
        ▼
   token.json / memos.json
```

## 接到 Cursor 或 Claude Desktop

把下面整段贴进 MCP 配置，改两处：token，以及 `FLOMO_DATA_DIR`。保存后完全退出客户端再打开（关掉窗口不够）。

| 客户端 | 配置文件 |
| --- | --- |
| Cursor，所有项目 | `~/.cursor/mcp.json` |
| Cursor，仅当前项目 | 项目里的 `.cursor/mcp.json`。同名时项目配置优先。凭据不要提交进仓库，个人使用放全局那份 |
| Claude Desktop（macOS） | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop（Windows） | `%APPDATA%\Claude\claude_desktop_config.json` |

Claude Desktop 也可以从菜单 **Settings → Developer → Edit Config** 打开。Linux 同样走这个按钮。

```json
{
  "mcpServers": {
    "flomo": {
      "command": "npx",
      "args": ["-y", "@dulk-dev/flomo-mcp"],
      "env": {
        "FLOMO_ACCESS_TOKEN": "在这里粘贴 access_token",
        "FLOMO_DATA_DIR": "/Users/you/.cache/flomo-mcp"
      }
    }
  }
}
```

`FLOMO_DATA_DIR` 要写成**你自己的绝对路径**。上面是 macOS 示例，把 `you` 换成你的用户名。Linux 一般是 `/home/你的用户名/.cache/flomo-mcp`，Windows 写成 `C:\\Users\\你的用户名\\.cache\\flomo-mcp`。

进程用 `path.resolve` 解析这个值，**不会展开 `~`**。写成 `~/.cache/flomo-mcp` 不会进家目录。Cursor 的 `mcp.json` 会先替换 `${userHome}`，所以 Cursor 里可以写成 `"${userHome}/.cache/flomo-mcp"`。Claude Desktop 不做这个替换，请写绝对路径。

不设置 `FLOMO_DATA_DIR` 时，缓存写到代码默认目录 `/workspace/cache/flomo-cache`。那是给特定环境用的，不是家目录。本机请在配置里显式写上路径。目录里会有 `token.json` 和 `memos.json`。

账密可以代替 token。整段换成：

```json
{
  "mcpServers": {
    "flomo": {
      "command": "npx",
      "args": ["-y", "@dulk-dev/flomo-mcp"],
      "env": {
        "FLOMO_ACCOUNT": "you@example.com",
        "FLOMO_PASSWORD": "your-password",
        "FLOMO_DATA_DIR": "/Users/you/.cache/flomo-mcp"
      }
    }
  }
}
```

`FLOMO_ACCOUNT` 填邮箱或手机号。token 和账密可以同时留着：有 token 就用 token；token 失效且配了账密时，进程会再登录并把当前请求重打一次。两者都空时进程拒绝启动，stderr 提示需要 token 或账密。

凭据写在 MCP 配置的 `env` 里。进程也会读启动时工作目录下的 `.env`，但客户端的工作目录经常不是你的项目目录，接到 Cursor / Claude Desktop 时以 `env` 为准。

客户端自己拉起进程。在终端执行 `npx -y @dulk-dev/flomo-mcp` 会停在 stdio 上等输入，这是正常的。图形客户端要用它自己的 PATH 找到 `node` / `npx`；只用 nvm、fnm 装在 shell 里时，客户端可能找不到，改用绝对路径或系统安装的 Node。Windows 上若报找不到 `npx`，把 `command` 改成 `cmd`，`args` 改成 `["/c", "npx", "-y", "@dulk-dev/flomo-mcp"]`。

### 登录环境异常

账密登录若返回「登录环境异常」，改传 `FLOMO_ACCESS_TOKEN`。token 从已登录的 flomo 网页里复制 `access_token`。账密可以留着，token 失效后再用账密重登。云端出口 IP 上 `login_by_email` 容易被 flomo 拒绝；本机或正常网络仍可用账密。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `FLOMO_ACCESS_TOKEN` | 有它就用 token，跳过当次账密登录。 |
| `FLOMO_ACCOUNT` / `FLOMO_PASSWORD` | 邮箱或手机号 + 密码。本机或正常网络由进程调用 `login_by_email`。 |
| `FLOMO_DATA_DIR` | `token.json` 和 `memos.json` 的目录。请写绝对路径。不设置时为 `/workspace/cache/flomo-cache`。 |
| `FLOMO_SYNC_INTERVAL_MS` | 进程内再同步的间隔，单位毫秒。不设置时为 `900000`（15 分钟）。`0` 或 `off` 关闭定时器。启动时那一轮同步仍会跑。 |

## 缓存和新鲜度

```text
进程启动
  强制一轮增量同步（最多 8 页，没翻完留下游标）
读工具（搜索、列表、统计等）
  缓存已翻完且在 15 分钟内 → 直接用
  否则再拉一轮
  工具参数 refresh=true → 强制一轮
FLOMO_SYNC_INTERVAL_MS（默认 15 分钟）
  到点再跑一轮，仍受上面的新鲜窗口约束
  设为 0 或 off → 不挂定时器（启动那一轮还在）
```

短页不当成结束。`syncComplete=false` 时统计会偏小，再 `refresh` 或等下一轮。

## 工具

共 22 个。CLI 里的四条洞察合成 `flomo_insight`，其余与 CLI 命令同名（连字符改成下划线）。

| MCP 工具 | 对应 CLI | 说明 |
| --- | --- | --- |
| `flomo_whoami` | `whoami` | 身份 + `insight_remaining` |
| `flomo_memos` | `memos` | 列表，可按 tag / pinned |
| `flomo_search` | `search` | 参数是 `keyword`（不是 `query`）；本地缓存全文，多词 AND |
| `flomo_get` | `get` | 单条，含 HTML |
| `flomo_new` | `new` | 新建 |
| `flomo_edit` | `edit` | 替换或追加，回传 `file_ids` |
| `flomo_delete` | `delete` | 进回收站 |
| `flomo_restore` | `restore` | 从回收站恢复 |
| `flomo_trash` | `trash` | 回收站列表 |
| `flomo_pin` | `pin` | 全局仅一条置顶；已有置顶时需 `force: true`，否则报错 |
| `flomo_unpin` | `unpin` | 取消置顶 |
| `flomo_tags` | `tags` | 从 memo 派生的标签树 |
| `flomo_tag_pin` | `tag-pin` | 置顶标签 |
| `flomo_tag_unpin` | `tag-unpin` | 取消置顶标签 |
| `flomo_tag_rename` | `tag-rename` | 异步批量改写，接口秒回 |
| `flomo_daily` | `daily` | 每日回顾 |
| `flomo_random` | `random` | 随机漫步 |
| `flomo_stats` | `stats` | 与网页侧栏同口径 |
| `flomo_related` | `related` | 语义相关笔记 |
| `flomo_revisions` | `revisions` | 编辑前后快照 |
| `flomo_upload` | `upload` | 参数是 `filename` 和 `data_base64`。`content` 建新 memo，或 `attach` 附到已有 memo，二选一 |
| `flomo_insight` | `insight` / `insights` / `insight-history` / `insight-templates` | 见下一节 |

## 洞察 mode

`flomo_insight` 用 `mode` 区分：

| mode | 是否耗每日额度 | 主要参数 |
| --- | --- | --- |
| `history` | 否 | `page`、`limit`、`full`、`from` / `to`、`source`、`chat_id` |
| `templates` | 否 | 无 |
| `memo` | 是 | `slug`，可选 `think` |
| `query` | 是 | `template_id`，可选 `tag` / `from` / `to` / `keyword` / `think` |
| `related` | 是 | `slug`，可选 `think` |

生成结果会进网页版洞察历史。额度看 `flomo_whoami` 的 `insight_remaining`（Pro 每日次数由 flomo 决定）。`query` 不圈日期或标签时，服务端常报「符合条件的笔记数量太少」。`related` 会先拉该笔记相关推荐前 10 条再生成。

### 归档全部洞察历史

`mode=history` 一次只返回一页。MCP 客户端大约在 40KB 截断单次工具结果，所以每页必须自己够小。

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

翻完的办法：

1. 目录：`mode=history`、`full=false`、`page=1`（默认每页 20，最多 40）。`has_more` 为真时用 `page=next_page` 再拉。
2. 全文：对每条 `chat_id` 再调 `mode=history`、`chat_id=<id>`（单条全文，不标已读）；或者 `full=true` 按 `page` 翻（默认每页 3，最多 5）。
3. `limit=100` 且 `full=true` 拿不完。超出的 `limit` 会被截到每页上限，后面的页靠 `page`。

`from` / `to` 按 `created_at` 的日期过滤。flomo 上游 `GET /memo/insight/history` 只认 `page`、`page_size`、`source`，没有日期字段；日期窗口是本进程连翻上游页再过滤。`template_id` 同样是本进程匹配 `template_id` 或 `template_name`。`source`（`memo` / `query` / `recommended`）会原样传给上游。

## 和官方 Max MCP 的差异

官方服务在 `https://flomoapp.com/mcp`，OAuth，面向 Max。公开资料里是 8 个工具：`memo_search`、`memo_create`、`memo_update`、`memo_delete`、`memo_batch_get`、`tag_tree`、`tag_rename`、`ai_search`。

这套个人 MCP 用本机环境变量里的 token 或密码。工具覆盖网页同款签名 API（置顶、回收站、每日回顾、随机、统计、历史版本、图片上传、AI 洞察 SSE）。搜索和统计在本地增量缓存上算，和网页 IndexedDB 同一套 `/memo/updated/` 游标。官方 `ai_search` 是他们的语义搜索；这里的 `flomo_insight` 打的是网页同款 `/memo/insight` SSE，吃的是 Pro 每日洞察额度。

## 从源码开发

日常使用用上面的 npx 配置。改这个仓库时：

```bash
git clone https://github.com/dulk-dev/flomo-mcp.git
cd flomo-mcp
npm install
cp .env.example .env
npm run dev
```

`npm run dev` 用 tsx 跑源码。`npm run build` 之后，`npm start` 即 `node dist/index.js`。包的 `bin` 是 `flomo-mcp`，指向构建产物。

本地构建接到客户端时，`command` 用 `node`，`args` 用该仓库里 `dist/index.js` 的绝对路径，`env` 与上文相同。`.env.example` 里的默认数据目录注释仍是 `/workspace/cache/flomo-cache`，本机开发请在 `.env` 里改成你的绝对路径。

```bash
npm test
npx tsc --noEmit
```

有 flomo 凭据时可选只读冒烟（只打 `/user/me`，不写笔记）：

```bash
npm run test:smoke
```

默认 CI 不要跑冒烟，也不要把写操作放进默认测试。

Cloudflare Worker、`wrangler`、HTTP `/mcp`、`flomo.chaochun.cc` 和 `MCP_API_KEY` 已移除。只保留本机 stdio。
