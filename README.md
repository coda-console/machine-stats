# machine-stats

Coda 的「机器负载」插件：在资源页展示 CPU、内存、磁盘、网络、温度、GPU、电池与风扇的读数，每样是一个资源类型（共 10 个）。
插件的源码、测试和版本在此维护，Coda 通过固定 Git 提交的 npm 依赖安装插件，也可以从本仓库单独更新插件。

## 安装与使用

在 Coda「设置 › 插件 › 机器负载」启用。需要 Coda 6 或更新（`engines.coda`）。
插件的记录命令 `scripts/resource.mjs` 把本机的读数写成 `coda/resource@1` 记录：每个类型一条，`key` 与 `spec.type` 是类型 ID，资源页只读这些记录。
Coda 在启动、插件安装或更新、设置改动、打开资源页与点「刷新」时运行它，一次读完全部类型：CPU、磁盘读写与网络速度取两秒采样窗口的平均值，其余当场读。
没有写 `every`：插件不定时采集，也没有常驻采样；读数是上一次运行时的，页面不打开、不刷新就不更新。
资源页工具栏的「显示的资源」里每个类型一个开关，保存在所看的机器上。资源页上没有「默认不显示」的写法，没选过的类型都显示；
所以从 2.1.0 起交换空间、磁盘读写、GPU、电池、风扇这 5 个也默认显示，在这里关掉即可（此前开过、关过的选择照旧保留）。

支持依赖包插件的 Coda 版本，可在插件菜单里「检查更新」，更新或回退独立于 Coda 发版。
旧版 Coda 若尚未登记本仓库来源，会拒绝安装同名外部插件，需要先更新 Coda。

| 类型 ID | 类型 | 内容 |
| --- | --- | --- |
| `cpu` | CPU | 空闲比例 |
| `memory` | 内存 | 可用 / 总量 |
| `swap` | 交换空间 | 已用 |
| `disks` | 磁盘 | 每个卷一行：可用 / 总量 |
| `disk-io` | 磁盘读写 | 每个卷一行：读取、写入速度（所在物理磁盘的） |
| `network` | 网络 | 每个普通网卡一行：下载、上传速度（隧道、网桥等不列） |
| `temperature` | 温度 | CPU 温度 |
| `gpu` | GPU | 每个 GPU 一行：使用率、显存（或共享内存）已用、温度 |
| `battery` | 电池 | 电量、状态、功率 |
| `fans` | 风扇 | 每个风扇一行：转速 |

容量条均表示剩余量。CPU、内存、磁盘、磁盘读写与网络读不到时显示「暂不可读」；这台机器没有的传感器或部件（温度、GPU、电池、风扇、交换空间）不写这个类型的记录，
资源页与「显示的资源」里都没有它（写成空数组的话，「显示的资源」仍会列出一个没有内容的开关）。所以一台机器上的记录可以少于 10 条，如没有电池与风扇读数的台式机。
不把未知值当作零，不尝试提权。

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

`sample` 运行记录命令，打印这台机器的 `coda/resource@1` 记录（`[{ "key": …, "spec": … }]`）；它不需要运行 Coda 后端。
`scripts/collect.mjs` 负责系统采集，`scripts/metrics.mjs` 将读数转换为记录，`scripts/resource.mjs` 是清单 `contributes.records` 里的记录命令。
单元测试覆盖计数器增量、缺失读数、macOS 内存、卷发现、APFS 磁盘归属、电池功率，以及十个类型的记录；记录的校验用协议包（`@coda-console/protocol/validate`）里宿主校验记录的那一份：
协议 schema、`spec.type` 与 `key` 相同、单条不超过 64 KiB。入口测试按宿主运行记录命令的方式真实读取当前机器。
Coda 宿主的 `coda plugin check .` 查清单并运行一次记录命令。
GitHub Actions 在 macOS 与 Linux 运行这些检查。Coda 的资源页渲染、显示的资源与安装更新仍在 Coda 仓库验证。

## Coda 的依赖引用

Coda 的 `backend/package.json` 只需将本仓库作为 npm 依赖，并固定完整提交号：

```json
{
  "dependencies": {
    "machine-stats": "git+https://github.com/coda-console/machine-stats.git#<40 位提交号>"
  }
}
```

`npm ci` 获取插件与依赖；Coda 的通用插件加载器读取包里的 `contributes`，在首次遇到时默认启用，并保留用户之后的卸载选择。
Coda 仓库不保存本插件的源码、测试或专属加载逻辑。`files` 只打包运行脚本，测试与 CI 在此仓库维护。

先在本仓库修改、测试、合并，再更新 Coda 的依赖提交与 npm 锁文件。通过插件菜单单独更新时，Coda 从此公开仓库安装对应提交，并使用通用版本切换与回退机制。

插件 ID `machine-stats` 与资源类型 ID（`cpu`、`memory`、`swap`、`disks`、`disk-io`、`network`、`temperature`、`gpu`、`battery`、`fans`）保持稳定：Coda 按类型 ID 记住每台机器显示哪些。
2.0.0 之前按指标逐项选择的「显示指标」设置（`machine-stats.display`）不再读。
2.1.0 起资源不再写在清单的 `contributes.resources` 里，也没有按类型的面板命令（`stats.mjs <类型>`）；Coda 的资源页只读记录，仍写 `contributes.resources` 的插件会被判需要更新。
