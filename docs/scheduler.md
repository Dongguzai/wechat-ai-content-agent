# Scheduler

v0.6.0 使用系统 cron 做每日自动运行。它只会创建微信公众号草稿箱草稿，不会发布，不会群发；最终发布必须人工登录微信公众号后台确认。

## 安装每日 8 点任务

```bash
pnpm scheduler:install
```

安装的 cron 块如下：

```cron
# wechat-ai-content-agent daily auto start
0 8 * * * cd /Users/Shared/AgentWork/公众号AI内容生产与草稿发布Agent/wechat-ai-content-agent && pnpm run:daily:auto >> logs/daily-auto.log 2>&1
# wechat-ai-content-agent daily auto end
```

`scheduler:install` 会保留用户其他 cron，只替换当前项目标记块。

## 查看定时任务

```bash
pnpm scheduler:show
```

该命令只显示当前项目相关 cron。

## 取消定时任务

```bash
pnpm scheduler:uninstall
```

该命令只移除 `# wechat-ai-content-agent daily auto start` 到 `# wechat-ai-content-agent daily auto end` 之间的项目 cron，不影响用户其他 cron。

## 手动运行

```bash
pnpm run:daily:auto
```

如果同一天已经创建过真实草稿，默认会被 same-day lock 阻断。只有人工明确需要重复创建草稿时，才手动执行：

```bash
pnpm run:daily:auto -- --force
```

系统不会自动添加 `--force`。

## 查看日志和报告

```bash
tail -f logs/daily-auto.log
```

每次运行会生成：

- `outputs/daily-auto-result.json`
- `outputs/daily-auto-report.md`
- `logs/daily-auto.log`
- `runs/yyyy-mm-dd-HHmmss/run-report.md`

失败时先查看：

```bash
cat outputs/daily-auto-report.md
tail -n 120 logs/daily-auto.log
```

## 生产模式要求

`pnpm run:daily:auto` 会在运行前检查：

- `REAL_PRODUCTION_MODE=true`
- `SEARCH_ENABLE_REAL_API=true`
- `COVER_ENABLE_REAL_API=true`
- `WECHAT_API_ENABLE_REAL_DRAFT=true`
- `WECHAT_DRAFT_ALLOW_REAL_API=true`
- `APIMART_API_KEY` 存在
- `APIMART_IMAGE_API_URL` 存在
- `WECHAT_APP_ID` 存在
- `WECHAT_APP_SECRET` 存在

`REAL_PRODUCTION_MODE=true` 时，mock news、mock search、mock cover 和 fallback mock 都不能进入真实草稿创建链路。

## 失败通知

默认关闭：

```bash
NOTIFY_ENABLE=false
NOTIFY_METHOD=console
NOTIFY_WEBHOOK_URL=
NOTIFY_EMAIL_TO=
NOTIFY_ON_SUCCESS=false
NOTIFY_ON_FAILURE=true
```

开启 console 通知：

```bash
NOTIFY_ENABLE=true
NOTIFY_METHOD=console
NOTIFY_ON_FAILURE=true
```

开启 webhook 失败通知：

```bash
NOTIFY_ENABLE=true
NOTIFY_METHOD=webhook
NOTIFY_WEBHOOK_URL=https://example.com/webhook
NOTIFY_ON_FAILURE=true
NOTIFY_ON_SUCCESS=false
```

webhook 会 POST 脱敏 JSON，包含 `status`、`title`、`message`、`selectedTitle`、`draftMediaId`、`reportPath`、`requiresHumanConfirmation` 和 `generatedAt`。通知内容不会写入 AppSecret、access token 或 APIMart key。webhook 失败只记录 warning，不会回滚已经完成的草稿创建逻辑。

## 安全边界

- 只允许创建公众号草稿。
- 禁止发布。
- 禁止群发。
- 禁止调用 publish、freepublish、mass、sendall。
- 最终发布仍然必须人工进入公众号后台确认。
- 同日真实草稿锁默认生效。
- 不允许自动 `--force`。
