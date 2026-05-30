# Release Checklist

每次发版前按顺序检查。任一步失败，都先修复再继续；不要绕过安全检查。

## 必跑命令

```bash
pnpm typecheck
pnpm test
pnpm dry-run
pnpm wechat:draft:dry-run
pnpm preflight:final
```

## 产物检查

- `outputs/article-review.json` 中 `passed=true`。
- `outputs/cover-review.json` 中 `passed=true`。
- `outputs/wechat-layout.json` 中 `allowedNextStage=true`。
- `outputs/wechat-api-preflight.json` 中 `passed=true` 且为 dry-run。
- `outputs/final-preflight.json` 中 `passed=true`。
- `runs/yyyy-mm-dd-HHmmss/run-manifest.json` 已生成。

## 安全检查

- 没有新增 publish、freepublish、mass、sendall 调用路径。
- 没有新增自动发布、群发、确认发送、立即发送逻辑。
- 没有把 `.env`、AppSecret、access token、cookie、登录态或 `outputs/`、`runs/` 业务产物加入提交。
- 真实草稿写入仍只允许官方草稿箱 API，最终发布必须人工完成。
