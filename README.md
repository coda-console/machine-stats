# machine-stats

Coda 的「机器负载」插件：在资源页展示 CPU、内存、磁盘、网络、温度、GPU、电池与风扇指标。
插件的源码、测试和版本在此维护，Coda 随包带固定提交的只读副本，也可以从本仓库单独更新插件。

## 安装与使用

在 Coda「设置 › 插件 › 机器负载」启用；打开资源页或刷新时采样，CPU、磁盘与网络速度取两秒采样窗口的平均值。
在面板「··· › 插件设置」逐项选择显示指标；磁盘和网卡分别选择，设置保存在所看机器上。

支持本仓库来源的 Coda 版本，可在插件菜单里「检查更新」，更新或回退独立于 Coda 发版。
旧版 Coda 若尚未登记本仓库来源，会拒绝安装同名外部插件，需要先更新 Coda。

默认显示 CPU 空闲、内存可用、各卷剩余空间、普通网卡上传下载速度与 CPU 温度。
容量条均表示剩余量。缺少传感器或系统未提供权限时显示「暂不可读」，不把未知值当作零，不尝试提权。

- macOS：内存按活动监视器的已使用内存口径计算；磁盘略过系统辅助卷与模拟器镜像，读写速度属于所在物理磁盘。
- Linux：内存可用读取 `MemAvailable`，传感器与风扇读取系统暴露的接口。
- GPU、电池、温度与风扇取决于系统和硬件支持；macOS 未暴露的温度、风扇读数不会额外探测。

## 开发与验证

需要 Node.js 24 或更新版本。

```sh
npm ci --ignore-scripts
npm test
npm run sample
```

`sample` 输出 Coda 面板的 `{ "items": [...] }` JSON；它不需要运行 Coda 后端。
`scripts/collect.mjs` 负责系统采集，`scripts/metrics.mjs` 将读数转换为面板条目，`scripts/stats.mjs` 是面板命令入口。
单元测试覆盖计数器增量、缺失读数、macOS 内存、卷发现、APFS 磁盘归属和电池功率；入口测试真实读取当前机器。
GitHub Actions 在 macOS 与 Linux 运行这些检查。Coda 的面板渲染、显示设置与安装更新仍在 Coda 仓库验证。

## 同步到 Coda

先在本仓库修改、验证并合并，再在 Coda 仓库运行：

```sh
node scripts/sync-plugins.mjs update <提交> --repo git@github-personal:coda-console/machine-stats.git
node scripts/sync-plugins.mjs check
```

有本机克隆时加 `--from <克隆路径>`。Coda 锁文件逐插件记录来源、提交与目录；本插件的来源目录是仓库根。
依赖或清单变化后，在 Coda 的 `backend/` 更新 npm 锁文件，一起提交副本与来源记录。
插件 ID `machine-stats`、面板 ID `load`、设置名 `machine-stats.display` 与已有指标 ID 保持稳定，以保留用户选择。

源码最初取自私有仓库 [coda-console/coda 的固定提交](https://github.com/coda-console/coda/tree/4dd6bd64aec05ef0619c2536718d35c5127792da/backend/src/resources/plugins/machine-stats)。
