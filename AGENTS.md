# machine-stats

- 此仓库是 Coda「机器负载」插件的源码。插件 ID `machine-stats`、面板 ID `load`、设置名 `machine-stats.display` 与指标 ID 是已有用户的持久化契约。
- 入口只依赖插件自己的文件、Node 内置模块与 `package.json` 声明的依赖，不引用 Coda 后端。
- `npm ci --ignore-scripts` 安装，`npm test` 验证；提交依赖变更时一起更新 `package-lock.json`。
- 采集失败保留不可读状态，不把缺少传感器当作零。采集只在请求时执行，不启动常驻采样循环。
- 用功能分支与中文 PR 交付。合并后在 Coda 仓库同步固定提交，见 README。
