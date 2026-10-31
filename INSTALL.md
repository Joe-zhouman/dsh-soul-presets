# dsh-soul-presets 一键安装指南

本仓库带一个安装脚本，把 [README](README.md)「在别人的部署上安装」里的手工四步做成一条幂等命令：装插件包、放 `soul-prompt.mjs`、写 `preset-qa` 声明行、自检。重复执行不会产生第二份改动；覆盖任何已有文件之前都会先备份。

适用 dsh `0.1.7` 及以上（`0.1.6` 及更早的 `.agent-presets` 写法不再被读取，见 README「生效所需的三处改动」）。

## 前提

| 项 | 要求 |
|---|---|
| dsh | `0.1.7+`；`0.1.6` 用 `deploy/preset.yml` + `deploy/agent.cordis.yml`，不走本脚本 |
| Node | 与运行 dsh 的一致，`^22.19.0 \|\| >=24.0.0`。低于 22.19 时 dsh CLI 会静默退出，脚本会拒绝继续 |
| pnpm | 在 `PATH` 上（`dsh plugin` 转发给 pnpm） |
| 目录 | `DSH_HOME` 已确定。默认 `~/.dsh`；本机部署是 `L:\dsh\.dsh-home` |
| 网络 | git 安装源需要能访问 `github.com`；从本检出安装（`file:`）不需要 |

> [!IMPORTANT]
> `DSH_HOME` 弄错是本插件最常见的「装了但什么都没出现」：dsh 会退到 `%USERPROFILE%\.dsh` 并在那里新建一个 profile，而正在跑的服务读的是另一个目录。脚本打印 `DSH_HOME` 及其来源，装之前看一眼。

## 一键安装

Windows 双击 `install.cmd`，或从仓库根目录：

```powershell
node scripts\install.mjs
```

本机这种源码检出 + 便携 Node 的部署（脚本自动找到 `L:\dsh\apps\cli\lib\bin.js`）：

```powershell
& 'D:\softwares\node-v24.21.0-win-x64\node.exe' scripts\install.mjs --home 'L:\dsh\.dsh-home'
```

macOS / Linux：

```sh
./install.sh
```

典型输出（本机部署）：

```text
dsh-soul-presets 安装 → profile "web"
  DSH_HOME  L:\dsh\.dsh-home  （来源：--home）
  profile   L:\dsh\.dsh-home\profiles\web
  CLI       node L:\dsh\apps\cli\lib\bin.js

1/4 安装插件包（file:L:/dsh/.local-deploy/soul-presets-plugin）
     依赖  file:L:/dsh/.local-deploy/soul-presets-plugin
     bundle 已进入 dsh.profile.bundles
2/4 复制 soul-prompt.mjs
     源   L:\dsh\.local-deploy\soul-presets-plugin\deploy\soul-prompt.mjs
     目标 L:\dsh\.dsh-home\preset-plugins\soul-prompt.mjs
     内容一致，未改动
3/4 写 preset-qa 声明行
     把补丁里的空数组 [] 换成了 preset-qa 声明行
     已写入 L:\dsh\.dsh-home\profiles\web\cordis.patch.yml（旧文件已备份）
     配置自检通过（dsh --dump-config）
4/4 收尾
     插件包     file:L:/dsh/.local-deploy/soul-presets-plugin
     提示词入口 L:\dsh\.dsh-home\preset-plugins\soul-prompt.mjs
     声明行     cordis.patch.yml → file:///L:/dsh/.dsh-home/preset-plugins/soul-prompt.mjs
```

装完**重启**才生效：Web 服务用它平时的 stop/start 脚本；桌面端完全退出再打开应用。重启用意是让 profile 重新读 `dsh.profile.bundles`——插件包本身不会热加载。

## 脚本做了什么

```timeline
### 安装流程
- 安装插件包
  调用 `dsh plugin --profile <名字> add <安装源>`。这一步同时把包写进 profile 的 `dependencies` 与 `dsh.profile.bundles`；后者决定插件会不会被加载，缺了它脚本会直接失败而不是假装成功。
- 复制 soul-prompt.mjs
  从本检出（或已安装包副本）取 `deploy/soul-prompt.mjs`，放到 `$DSH_HOME/preset-plugins/`。内容一致（忽略 CRLF）就跳过；不同则先备份成 `.bak-<时间戳>` 再覆盖。这份文件带 `interpolate: false`，缺了它，提示词里任何 `{{名字}}` 都会让整轮组装报错。
- 写 preset-qa 声明行
  只改 profile 的 `cordis.patch.yml`，三种情况分别处理：没有该行就把 `deploy/preset-qa.row.yml` 追加进去（profile 模板里的空数组 `[]` 会被替换）；已有该行但缺 `presets: true` 就补在 `config` 块第一行；`name` 指向的 `file://` 已经不存在就改成本机路径。**`preset-chat` 行不动**，已有行里的其它插件（`tool-mask`、`qa-history` 等）原样保留。
- 自检
  用 `dsh --profile <名字> --dump-config` 组合一次配置：改之前能组合、改之后不能，或组合结果里没有 `preset-qa`，脚本会把补丁还原成改前字节并报错。自检命令本身跑不起来时只警告，不冒充通过。
```

每个被改动的文件都先留一份 `cordis.patch.yml.bak-<时间戳>` / `soul-prompt.mjs.bak-<时间戳>`，回滚就是把它放回去。

## 参数

| 参数 | 作用 |
|---|---|
| `--profile <名字>` | 装到哪个 profile，默认 `web` |
| `--home <目录>` | 指定 `DSH_HOME`，优先于环境变量；默认 `$DSH_HOME`，都没有则 `~/.dsh` |
| `--source <安装源>` | 默认：本检出用 `file:<本仓库>`，否则 `github:Joe-zhouman/dsh-soul-presets` |
| `--dsh <路径>` | dsh CLI 入口；默认先找 `PATH` 上的 `dsh`，再找工作目录上方的 dsh 检出 |
| `--skip-plugin-install` | 跳过第 1 步：桌面端在应用里装好包后这样跑 |
| `--refresh` | 先 `remove` 再 `add`。改过源码、重建过 `lib/` 后用它刷新 `file:` 安装副本 |
| `--keep-soul-prompt` | 不覆盖已存在的 `soul-prompt.mjs`（默认覆盖并备份） |
| `--dry-run` | 只打印计划，不写任何文件 |
| `--check` | 只体检：包、bundle、`soul-prompt.mjs`、声明行各查一项，不写文件 |
| `--no-verify` | 跳过安装后的组合自检（不跑 `--dump-config`） |
| `--print-row` | 打印要写进 `cordis.patch.yml` 的声明行，便于手工合并 |

## 三种部署场景

````stack
1.1.[#f5f7fa]
  **CLI / Web 部署：一条命令**

  `node scripts/install.mjs --profile web` 就够了。脚本自己找 dsh CLI。找不到时用 `--dsh` 指定；也可以先手动装包，再加 `--skip-plugin-install` 只跑后两步。
1.2.[#f5f7fa]
  **桌面端：先装包，再跑后三步**

  桌面应用独占 `desktop` profile，CLI 会拒绝。先在应用里「设置 → 插件 → 添加插件」填 `https://github.com/Joe-zhouman/dsh-soul-presets.git` 并启用，然后：

  ```powershell
  node scripts\install.mjs --profile desktop --skip-plugin-install
  ```

  装完完全退出应用再打开。桌面端读的是 `%USERPROFILE%\.dsh`（除非设置了 `DSH_HOME`），脚本按同一规则解析。
1.3.[#f5f7fa]
  **已有自定义 preset-qa 行**

  不覆盖。脚本只在你的 `soul-prompt` 插件 `config` 里补 `presets: true`，其余字段和插件列表保持原样；`config:` 写成单行（flow）时它不猜，会停下来让你手动合并——先用 `--print-row` 拿到声明行。
````

## 安装后验证

```todo
### 检查清单
- [ ] 重启服务或应用（Web：stop/start 脚本；桌面端：完全退出再打开）
- [ ] 设置页出现「预设提示词」分区，列表里有预设（空目录会自动种入随包的 35 个示例）
- [ ] 问答模式的 composer 左侧出现预设 chip，输入框上方显示「预设：名字」
- [ ] 选中一个预设后提问，回答按该预设作答（下一轮生效，不需要重开会话）
```

命令行确认（端口换成启动日志里那个）：

```powershell
Invoke-RestMethod http://127.0.0.1:3080/plugins/soul-preset/roster | ConvertTo-Json -Depth 4
```

返回里的 `presets` 数组就是当前目录内容，`active` 是全局默认；带 `?session=<id>` 时 `active` 回显该会话的生效值。路由只认回环 Host，用机器名或非回环地址访问会 403。

## 升级、重建与重装

`file:` 依赖按 spec 判等，改了源码重建 `lib/` 之后，直接 `add` 只会报 `Already up to date`，副本停在旧字节。用 `--refresh`：

```powershell
node scripts\install.mjs --refresh --home 'L:\dsh\.dsh-home'
```

手工等价物：

```powershell
pnpm dsh plugin --profile web remove dsh-soul-presets
pnpm dsh plugin --profile web add "file:L:/dsh/.local-deploy/soul-presets-plugin"
```

已经打开的页面不会自动拿到新客户端 bundle，刷新页面才会。

## 卸载

```powershell
dsh plugin --profile web remove dsh-soul-presets
# 源码检出里等价于：pnpm dsh plugin --profile web remove dsh-soul-presets
```

之后问答模式退回只读 `SOUL.md`（`presets: true` 拿不到服务时按文件读），不需要动其它两处。要彻底清干净：

1. 删 `$DSH_HOME/preset-plugins/soul-prompt.mjs`（`chat` 行若还在用它，别删）；
2. 删 profile 补丁里的 `preset-qa` 行（或整个 `- insert:` 块里你加的部分）；
3. 预设文件在 `$DSH_HOME/soul-presets/*.toml`，脚本不碰，要不要留你自己定。

## 故障排查

| 症状 | 原因 | 处理 |
|---|---|---|
| 设置页没有「预设提示词」 | 包没装、没进 `dsh.profile.bundles`，或没重启 | 跑 `--check`；缺什么它指什么 |
| 问答模式没有 chip | 当前会话不是问答模式；或 `preset-qa` 行缺 `presets: true` | 切换模式；重跑安装脚本 |
| 一轮提问报 `{{...}}` 相关错误 | `soul-prompt.mjs` 是旧版，缺 `interpolate: false` | 重跑脚本（会备份后覆盖） |
| 装了但服务行为没变 | `DSH_HOME` 装错了，插件进的是另一个 home | 看脚本打印的 home；用 `--home` 重装 |
| `pnpm was not found` | `PATH` 上没有 pnpm | 装 pnpm，或先手动装包再 `--skip-plugin-install` |
| git 安装失败 | 目标机访问不了 github.com | 改用 `file:` 源，或在应用面板装包 |
| `profile "desktop" is managed exclusively…` | 桌面 profile 由应用独占 | 先应用内装包，再 `--skip-plugin-install` |
| 命令返回 0 但什么都没装 | Node 低于 22.19，CLI 静默退出 | 换成运行 dsh 的那份 Node（`DSH_NODE` 或直接用它跑脚本） |
| 组合失败并回滚 | 改出来的补丁 dsh 解析不了 | 看报错；`cordis.patch.yml.bak-*` 是改前原文 |

`--check` 的判定口径就是「包在依赖里、包在 `dsh.profile.bundles` 里、`soul-prompt.mjs` 在、它带 `interpolate: false`、`preset-qa` 行完整」，五项全过退出码才是 0。

## 边界与回滚

脚本只写三个地方，都在 `DSH_HOME` 或 profile 里：

```tree
- profiles/
  - <profile>/
    - package.json        由 dsh plugin（pnpm）改：依赖与 dsh.profile.bundles
    - pnpm-lock.yaml      同上
    - cordis.patch.yml    脚本改：preset-qa 声明行；改前备份为 .bak-<时间戳>
- preset-plugins/
  - soul-prompt.mjs       脚本写：覆盖前备份为 .bak-<时间戳>
```

不读凭据、不写会话日志、不发起网络请求（除了 git 安装源由 pnpm 自己访问）。回滚＝把 `.bak-<时间戳>` 放回去，再重启。
