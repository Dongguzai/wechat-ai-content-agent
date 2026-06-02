# Scheduler

v0.6.0 默认使用“半自动编辑台模式”。推荐的系统 cron 每天早上 7 点只生成编辑简报，不写文章、不生成封面、不写入公众号草稿、不调用微信真实 API、不发布、不群发。

## 安装 7 点编辑简报任务

```bash
pnpm scheduler:install-brief
```

安装的 cron 块如下：

```cron
# wechat-ai-content-agent editorial brief start
0 7 * * * cd /Users/Shared/AgentWork/公众号AI内容生产与草稿发布Agent/wechat-ai-content-agent && pnpm run:daily -- --until brief >> logs/editorial-brief.log 2>&1
# wechat-ai-content-agent editorial brief end
```

该任务只会生成：

- `outputs/editorial-brief.md`
- `outputs/editorial-brief.json`
- `outputs/daily-report.md`
- `logs/editorial-brief.log`

下一步必须由人工查看简报，编辑 `inputs/editorial-approval.json`，再手动运行：

```bash
pnpm run:daily -- --from article
```

## 查看定时任务

```bash
pnpm scheduler:show
```

该命令显示当前项目相关 cron，包括 7 点编辑简报和保留的 8 点 daily:auto。

## 取消 7 点编辑简报任务

```bash
pnpm scheduler:uninstall-brief
```

该命令只移除 `# wechat-ai-content-agent editorial brief start` 到 `# wechat-ai-content-agent editorial brief end` 之间的 cron，不影响用户其他 cron。

## 保留的 8 点 daily:auto

仍保留旧命令：

```bash
pnpm scheduler:install
pnpm scheduler:uninstall
```

安装的 cron 块如下：

```cron
# wechat-ai-content-agent daily auto start
0 8 * * * cd /Users/Shared/AgentWork/公众号AI内容生产与草稿发布Agent/wechat-ai-content-agent && pnpm run:daily:auto >> logs/daily-auto.log 2>&1
# wechat-ai-content-agent daily auto end
```

默认不建议启用 8 点 daily:auto。若用户明确选择启用，它仍必须遵守草稿箱边界：只允许 draft/add，不允许 publish、freepublish、mass、sendall；最终发布必须人工完成。

## 安全边界

- 7 点 brief cron 不写文章。
- 7 点 brief cron 不生成封面。
- 7 点 brief cron 不写入公众号草稿。
- 7 点 brief cron 不调用微信真实 API。
- 系统不会自动发布。
- 系统不会自动群发。
- 没有人工确认选题，不会写文章。
- 最终发布仍然必须人工进入公众号后台确认。
