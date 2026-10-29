# 预设提示词插件（dsh-soul-presets）维护指南

本仓库是 `dsh-soul-presets` 插件的源码仓库，README 兼作维护手册。它只描述插件本身、预设文件格式、拼装规则、路由与启停／移除步骤；部署环境（Node 路径、计划任务、凭据解析）见部署机的 `.local-deploy/deployment.md`，设计理由见 `.local-deploy/specs/soul-presets.md`（均在 dsh 检出内，不随本仓库）。

## 包位置与名称

| 项 | 值 |
|---|---|
| 包名 | `dsh-soul-presets` |
| 版本 | `0.1.7`（`private`，不发布） |
| 部署机工作副本 | `L:\dsh\.local-deploy\soul-presets-plugin\`（即本仓库的检出） |
| 类型 | host + client bundle（`dsh.client.platform: web`，自带 `dsh.bundle.patch`） |
| 安装 spec | `file:L:/dsh/.local-deploy/soul-presets-plugin` |
| 宿主半区入口 | `lib/index.js`（预构建产物随仓库提交，安装后不读 `src/`；在 dsh 检出内 `pnpm run build` 重建，改完 `src/` 要把新的 `lib/` 一并提交） |
| 浏览器半区入口 | `lib/client.js`（预构建产物，随仓库提交） |
| 配置位置（0.1.7 起） | `L:\dsh\.dsh-home\profiles\web\cordis.patch.yml` 里 `local-soul-presets` 条目的 `config.active`；0.1.6 及更早是 `settings.yaml` 的 `soul-preset` 命名空间 |

它是 dsh 仓库的**仓库外插件**：不改 `packages/` 或其他已跟踪源码，只作为一个 profile bundle 挂到 `web` profile。构建依赖 dsh 检出（tsdown 与 schemastery 取自 `../../`，见 `package.json` 的 scripts 与 devDependencies），因此在本仓库独立检出里直接 `pnpm run build` 不可用——工作副本必须位于 dsh 检出内。功能生效还需要另外两处改动（见文末"生效所需的三处改动"）。

## 在别人的部署上安装

`lib/` 预构建产物随仓库提交、包内无 prepare 脚本，所以从 git 安装不需要本地构建（包没有构建脚本也就不会触发 pnpm 的 allowBuilds 拦截）。前置：`DSH_HOME` 存在（默认 `~/.dsh`），机器能访问 github.com（git 安装源直连，不经 registry）。

**桌面端（安装版 Electron）**：

1. 设置 → 插件 → 添加插件，填 git 地址 `https://github.com/Joe-zhouman/dsh-soul-presets.git`，装完点「立即启用」。CLI 拒绝 desktop profile，应用内面板是桌面端唯一的安装入口。
2. 把 `deploy/soul-prompt.mjs` 复制到 `%USERPROFILE%\.dsh\preset-plugins\`（即 `$DSH_HOME/preset-plugins/`）。
3. 把 `deploy/preset-qa.row.yml` 的内容追加到 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 末尾，并把其中 `file:///` 路径改成你机器上 soul-prompt.mjs 的绝对路径（文件头有说明）。
4. 完全退出并重开桌面应用（profile 补丁在启动时加载）。

**web 部署**：同样三步，第 1 步换成 `dsh plugin --profile web add "github:Joe-zhouman/dsh-soul-presets"`（或完整 git URL `git+https://github.com/Joe-zhouman/dsh-soul-presets.git`），第 3 步的补丁文件是 `$DSH_HOME/profiles/web/cordis.patch.yml`，第 4 步改为重启 web 服务。

装好后在设置页「预设提示词」分区新建／删除预设，或把 `.toml` 直接放进 `$DSH_HOME/soul-presets/`；问答模式 composer 的 chip 切换当前预设，下一轮提问生效，无需重开会话。全新部署的目录里没有任何 `.toml` 时，启动即自动种入随包的 35 个示例预设（见下节）——开箱就是一份能用的菜单。

注意三条：

- **0.1.7 起预设是 profile 里的声明行**，`$DSH_HOME/.agent-presets/` 目录不再被读取；`deploy/preset.yml` 与 `deploy/agent.cordis.yml` 只服务于 ≤0.1.6 的旧部署。已有自己的 `qa` 预设的部署不要整个覆盖：只在你现有 preset-qa 行的 `soul-prompt` 插件 `config` 里加 `presets: true`，其余不动。
- git 安装源要求目标机器能访问 github.com。`soul-prompt.mjs` 同时也在本机服务 `chat` 行（`mode: append` + persona + CHAT.md），把它放进 preset-plugins 不影响没有 chat 行的部署。
- 插件的客户端半区声明 `dsh.client.platform: web`——这是 GUI 客户端（含桌面渲染器）的唯一合法值，桌面端同样加载，不需要 asar 级改动。

## 随包示例预设（0.1.7）

包里带 35 个通用工具型示例预设（`presets/` 目录：翻译、润色、学术互译、文献格式转换、Excel／SQL／正则／commit 生成、概念讲解、思维导图、技术路线图等）。安装后，**预设目录里没有任何 `.toml` 时启动自动种入**。规则与边界：

- 判据是「目录里没有 `.toml`」，不是「目录不存在」——升级到一个已被旧版本建出空目录的部署同样种入。
- 只在启动时执行一次；**从不覆盖、从不删除**。种入的文件就是普通预设，可改可删，走同一套界面与路由。
- 代价是「删光全部预设再重启会重新种入」；想保持空目录，留一个自己的 `.toml` 即可。
- 人设类等私人预设不随包，各部署自备。

## 预设目录与文件格式

预设放在 `$DSH_HOME/soul-presets/`（本机 `L:\dsh\.dsh-home\soul-presets\`），**一预设一文件**，扩展名 `.toml`，文件名（去掉扩展名）就是预设 id，必须匹配 `^[a-z0-9][a-z0-9-]*$`。这个 id 会作为路径段参与新建／删除，所以这条规则是防越界边界，不是风格要求；不匹配的文件在列表里直接不出现（子目录、非 `.toml`、非法 id 一律跳过）。

```toml
preset = "翻译助手"
description = "中英互译，保留术语、格式与代码块，不解释、不寒暄。"
hint = "把要翻译的段落贴进来；需要指定方向时在开头写「译成英文」或「译成中文」。"

[Model]
provider = "paratera"
model = "AZ-GPT-5.6-Luna"
reasoningEffort = "high"

[Prompt]
System = '''
你是翻译引擎……
'''
User = '''
Translate: the harness keeps the tree clean
'''
Assistant = '''
这套 harness 保持工作树干净
'''
```

字段语义：

| 字段 | 必填 | 作用 |
|---|---|---|
| `preset` | 是 | 显示名。缺它或不是非空字符串即坏预设。 |
| `description` | 否 | 切换列表里的一句话简介。**只进界面**。 |
| `hint` | 否 | 给用户的一句"该问什么"。**只进界面**。 |
| `[Model] provider` | 与 `model` 成对 | 注册的 provider 路由。出现 `[Model]` 表时必填。 |
| `[Model] model` | 与 `provider` 成对 | provider 下的模型 id。 |
| `[Model] reasoningEffort` | 否 | 推理强度；不写则跟随模型／provider 的默认。 |
| `[Prompt] System` | 三选一 | 系统提示词。 |
| `[Prompt] User` | 三选一 | 示例块的用户半边。 |
| `[Prompt] Assistant` | 三选一 | 示例块的助手半边。 |

`System`／`User`／`Assistant` 至少要有一项非空，否则该文件是坏预设。`[Model]` 可以整张表不写；写了就必须同时给 `provider` 与 `model`（只写一半是坏预设），否则它什么都不做。`[Model]` 的生效时机见下文「默认模型」。

**提示词一律用 `'''` 多行字面量。** TOML 的字面量不做任何转义处理，所以提示词里写引号、花括号、JSON、`{{` 都不需要转义，也不会与文件语法相撞——这正是选 TOML 而不是 YAML／JSON 的原因。

## 拼装规则（确切字节）

选中的预设按固定顺序拼成系统提示词：

```
<Prompt.System 原文（两端空白去掉）>
===
<example>
<user>
<Prompt.User 原文>
</user>
<assistant>
<Prompt.Assistant 原文>
</assistant>
</example>
<空行>
<工作区 SOUL.md 原文（两端空白去掉）>
```

- `===` 与每个标签各占一行，内容不缩进——这是用户给定的格式，不要"美化"它。
- **`User` 与 `Assistant` 必须同时填写**，示例块才会出现；只填一边则整段 `<example>` 不出现（只留 System）。
- 工作区 `SOUL.md` 存在且非空时以空行追加在最后；缺文件、trim 后为空、或超过该行的 `maxBytes`（默认 64 KiB）时**跳过追加**，不报错——与改动前的静默降级一致。
- 单个预设的拼接结果上限同样是 64 KiB，超限的预设是坏预设。
- `description` 与 `hint` **永不进入模型可见内容**。
- 没有选中预设、或选中的 id 已失效时，退回改动前的行为：工作区 `SOUL.md` 单独生效，没有则用该行的 `defaultPrompt`。

## 切换与它写在哪里

选择是两层的：**会话覆盖 → 全局默认 → defaultPrompt**。composer 的 chip 走 `POST /plugins/soul-preset/select`（body 是 `{session, id}`；只带 `session` 或 `id` 为空即清除覆盖、回到跟随默认），把该会话的选择写进 `$DSH_HOME/soul-presets/.selections.json`——插入序对象，上限 500 条、最旧先掉；原地改选不挪位，先选的会话保资历，上限掉的是最旧的**选择**而不是最旧的重新确认。roster 读取时顺手清掉指向已不存在预设的行。设置页的表单写的是全局默认：`local-soul-presets` 条目配置的 `active`（空串表示未选），落盘位置是 profile 补丁文件，走设置表单的 RPC，**在 `/api` 的浏览器信任围栏之内**；Loader 把新值提交进运行中的配置引用并发 `loader/volatile-update`，插件的缓存随之刷新，不需要重挂载。`select` 在围栏之外，带与 roster 相同的回环 Host／Origin 守卫（见下节）。

裁决发生在 Host（`effective(sessionId)`）：会话覆盖指向可用预设就用它，覆盖悬空（预设已删或损坏）时降级到全局默认，**绝不落到「未选」**；`soul-prompt.mjs` 把 `agent.session.header.id` 递进服务按会话解析。roster 路由带 `?session=<id>` 时回显该会话的生效值并带 `overridden` 标记（区分「自己选的」与「跟随默认」）。浏览器半区为此读两个视图：chip 与 dock 用带 session 参数、且记住最近一次会话的视图（会话无关的刷新不至于把 chip 突然换回默认视图），设置页用默认视图；动作失败写两个视图。有覆盖时切换菜单顶部多一行「跟随默认」；生效值来自默认时 chip 显示「默认 · 名字」、dock 显示「预设（默认）：名字」。会话 id 的 wire 校验是 `^session-[A-Za-z0-9-]{1,64}$`（真实形状 `session-<uuid>`，测试里是 `session-<n>`）。

因为系统提示词是每次组装重读的（`soul-prompt.mjs` 的 `mode: replace` 语义），**切换与改文件都在下一轮提问生效，不需要重开会话，也不需要重启服务**。实测：新建一个 `.toml` 后直接读 roster 路由即可看到它，无需重启。

## 默认模型（0.1.6）

`[Model]` 给预设带一个默认模型。它只在两个时点生效，与提示词「改了下一轮就变」的规则刻意不同：

| 时点 | 行为 |
|---|---|
| 新会话建立（新窗口、新对话、首次发消息前的空白会话被恢复） | 会话日志里还没有 `request/header`、也没有任何 `model/selection` 时，装上该预设的模型；这一条会作为会话自己的选择写进日志（`model/selection`），composer 的模型选择器随即显示它 |
| 在会话里切换预设（chip 选一行，或「跟随默认」） | 立刻把该会话切到目标预设的模型；目标预设没写 `[Model]` 时保持当前模型不动 |

以下情况**不**生效：编辑预设文件、改设置页的全局默认、重开一个已经跑过的会话。已经在跑的会话不会被文件改动或默认变化重新路由——「只在新窗口加载或者切换预设时生效」就是这条边界。恢复一个曾经发过消息的会话时，它的模型来自日志里的 `request/header`，与预设无关。

它**不写部署默认模型**。dsh 自己的模型选择器（`session.selectModel`）会把选择同时存成 `agent-default-model`，而预设默认模型只用 Session Controller 的会话内入口（`selectForNextRequest`）——追加 `model/selection` 并移动该 Agent 的实时选择，效果与在选择器里点一下相同，除了不动 profile 里的默认值。这个入口是 Session Controller 的内部字段而不是公开服务方法；dsh 若改了实现，插件会在应用时记一条「preset model defaults are inert」并保持会话原模型，其余功能不受影响。

两条失败语义：

- 新会话：模型无法解析（provider／模型不存在、effort 不被支持）时**不阻止会话建立**，会话沿部署默认模型启动，日志里记一条带预设 id 与 `provider/model` 的警告。
- 切换预设：预设本身照常切过去（提示词已经生效），`select` 路由在成功响应里附带 `modelError`；界面显示「预设已切换，但模型没有切换：原因」。

同一路由重复施加不会追加事件：切换时若会话的目标选择已经是该 route（预设没指定 effort 时只看 provider/model），视为已生效。子代理会话（裸 UUID，不是 `session-` 形状）不参与本机制，它们有自己的模型策略。预设行上的 `[Model]` 会显示在切换列表和设置页的「模型：provider/model (effort)」一行。

## `$` 手势已移除（0.1.5）

0.1.3 引入的 `$id` 手势（任意模式把预设注入当轮对话）与 0.1.4 的 `$` 触发菜单在 0.1.5 整体移除：实际使用频率不高，而完整体验依赖对 dsh 检出的四处未提交补丁（`ui-input-trigger` 的 `TriggerChar` 封闭联合、`ui-conversation` 镜像类型、`ui-primitives` 的 `projectUserText` token 识别、`ui-chat` 的气泡投影）与桌面端 app.asar 字节补丁，随版本更新的维护成本大于价值。预设回到唯一入口：问答模式的系统提示词（每会话覆盖或全局默认，见上节）。

升级注意两条：profile 补丁里若写过 `config.expand` 要删掉（字段已不在 schema 里）；旧会话日志中已存在的 `soul-preset-expansion` 注入消息按通用用户消息回放（`MessageSourceMap` 对未知 kind 约定 fall through），不需要迁移。

## 四条路由与它们的守卫

| 路由 | 方法 | 作用 |
|---|---|---|
| `/plugins/soul-preset/roster` | GET | 返回预设列表（含 `name`／`description`／`hint`／`model`／坏预设原因）、`active` 与目录路径；带 `?session=<id>` 时 `active` 回显该会话的生效值并附 `overridden` 标记。代码里这份列表叫 `roster`，沿用仓库 `agent-presets` 的既有叫法，不是另一个概念 |
| `/plugins/soul-preset/select` | POST | 写一个会话的选择覆盖（body `{session, id}`），`id` 缺省或为空即清除、回到跟随默认；幂等，重复选择或为从未选过的会话清除都是成功。目标预设写了 `[Model]` 时顺带把该会话切到它的模型，成功响应因此可能带 `model` 或 `modelError`（见「默认模型」） |
| `/plugins/soul-preset/presets` | POST | 按固定模板创建 `<id>.toml`；id 已存在返回 409 |
| `/plugins/soul-preset/presets` | DELETE | 删除指定 `<id>.toml`；不在则 404 |
| `/plugins/soul-preset/reveal` | POST | 打开预设目录，或回显路径供复制 |

**创建与删除共用一条路由、按方法分派，id 放在 JSON body 里。** `webServer` 对重复的 `(kind, path)` 注册直接抛错，而抛错会杀掉 host fiber、让问答模式静默退回只读 `SOUL.md`——两条 exact 路由必然撞车。合并成一条既消除撞车，也省掉从 URL 里解析 id。

**为什么写路由必须自带守卫。** 共享的 `webServer` 服务自身不含鉴权：进程 token 与 `dsh-auth-*` cookie 的围栏在 browser-auth 层，只管 `GET /` 与 `/api` 通道。插件自己注册的路由在围栏之外，必须自己判断。判据是 **Host 必须是回环地址**（`127.0.0.0/8`、`localhost`、`[::1]`，可带端口），且 `Origin` 存在时其主机必须等于 Host。

只查 `Sec-Fetch-Site: same-origin` 不够：DNS rebinding 场景下，攻击者页面所在主机名解析到 `127.0.0.1`，浏览器认为请求同源，那个头会照常出现；而 Host 头此时是攻击者的域名，所以按 Host 判定能挡住。本部署只绑回环，所以守卫收敛为"只认回环"，不维护受信列表。实测：`curl -H "Host: evil.example:3080" .../roster` 返回 403，且不产生任何磁盘写入。

**它比"回环"更严一点，这是刻意的 fail-closed**：只认规范写法（`127.0.0.0/8` 四段且每段 0–255、`localhost`、`[::1]`、`::1`，可带端口），所以 `127.1` 这类合法简写与十进制／十六进制 IP 写法会被拒。启动脚本打印的是 `127.0.0.1`，正常路径不受影响；若有人用 `http://127.1:3080` 打开界面，本插件的路由会 403（界面显示失败）。

## 坏预设的语义

TOML 语法错误、必填字段缺失、字段类型不对、拼接超限的预设**留在列表里并标注原因**（`broken` 字段）、但不可切换。隐藏它会让目录占着那个 id，却既看不见也删不掉。其余预设不受影响。

## 生效所需的三处改动

功能不是只装一个包就完事，三处都要在：

1. 本插件包（host + client 两个产物）。
2. `.dsh-home/preset-plugins/soul-prompt.mjs`：section 的函数文本在 `config.presets` 为真时优先向 `soulPresets` 服务要文本；并在同一个注册对象上声明 `interpolate: false`。
3. qa 预设行里 `soul-prompt` 插件的 `config` 带 `presets: true`（0.1.7 起是 profile 补丁里的 preset-qa 声明行，见 `deploy/preset-qa.row.yml`；0.1.6 及更早是 `.agent-presets/qa/agent.cordis.yml` 的 `soul-prompt` 行）。**不要**给 `chat` 行加这一项。

两处细节值得单独记住：

- **`interpolate: false` 不是可选项。** system-prompt 默认会对 section 文本做变量插值，遇到未注册的 `{{名字}}` **直接抛错**，畸形引用同样抛错。预设里放的是用户写的任意提示词，模板式示例很常见，所以必须按字面量处理。顺带说明：这个选项同时消掉了改动前的一个隐患——原来 `SOUL.md` 里只要出现 `{{某名}}`，整个回合的组装就会抛错。
- **`presets` 是显式开关，不是按 `mode` 推断。** 同一个 `soul-prompt.mjs` 也服务 `chat` 行（`mode: append` + persona + `CHAT.md`），按 `mode` 推断会把行能力绑到一个语义无关的字段上；显式开关让"chat 不受影响"成为构造性质。

## 安装、重建与移除

安装（幂等）：

```bash
cd /l/dsh
export PATH="/d/softwares/node-v24.21.0-win-x64:/l/dsh/node_modules/.bin:$PATH"
export DSH_HOME='L:\dsh\.dsh-home'
pnpm dsh plugin --profile web add "file:L:/dsh/.local-deploy/soul-presets-plugin"
```

**`DSH_HOME` 不能漏。** 漏了它 `dsh` 会退到 `C:\Users\<你>\.dsh` 并**在那里新建一个 profile**——插件装到了别处，而正在运行的服务读的是 `.dsh-home`，表现为"装了但什么都没出现"。

改完源码重建后要刷新安装副本：`file:` 依赖按 spec 判等，源目录内容变了它仍报 `Already up to date`，副本会停在旧字节。**必须先 `remove` 再 `add`**：

```bash
pnpm dsh plugin --profile web remove dsh-soul-presets
pnpm dsh plugin --profile web add "file:L:/dsh/.local-deploy/soul-presets-plugin"
```

构建：`cd .local-deploy/soul-presets-plugin && pnpm run build`（两个 pass：host ESM + client CJS factory）。客户端产物由 client-hmr 以 stat 轮询推送新 rev，重新安装会重新分配一次初始 rev，所以**已打开的页面不会自动拿到新 bundle，需要刷新页面**。

移除：`pnpm dsh plugin --profile web remove dsh-soul-presets`。移除后问答模式退回只读 `SOUL.md`（因为 `presets: true` 时拿不到服务就退回读文件），不需要改另外两处。

启停服务用 `L:\dsh\.local-deploy\start-web.cmd` / `stop-web.cmd`；调试才用前台版本。浏览器报"拒绝连接"时先确认 `netstat -ano | findstr 127.0.0.1:3080` 有 `LISTENING`。

## 数据、隐私与凭据

- 插件**不读凭据**：不读 `.credentials.yaml`、不读 API key。
- **没有任何对外网络请求**；`fetch` 只打同源的两条路由。
- 预设内容是用户自己的提示词，保存在 `$DSH_HOME/soul-presets/*.toml`，不进会话日志、不上传遥测。
- 唯一新增的写盘面是"按固定模板新建一个 `.toml`"与"删除一个 id 对应的文件"，都带回环 Host 守卫，不接受任意路径与任意内容。

## 界面：三处各用什么渲染

| 位置 | 渲染 | 样式来源 |
|---|---|---|
| composer 的 chip | 仅当前会话处于问答模式时渲染：自绘 `<button>`，外面套共用 `Menu` | `.dsh-sp-chip`，尺寸与 token 照抄紧邻的访问模式触发器（28px 高、24px 圆角、13/20 中等、次级文字色、悬停底） |
| 切换列表 | 共用 `Menu`（`side: 'top'` + `portal`） | 菜单卡片自带：20px 圆角、4px 内边距、10px 圆角的行、悬停底、选中行的勾、`max-height: calc(100vh - 24px)` 与 `.viewport` 的 `overflow-y: auto` |
| 输入框上方提示行 | 仅当前会话处于问答模式时渲染名称、hint 和错误；工作区／模式行在它上面 | 插件 dock 去掉额外的底部内边距，保留外壳的行间距 |
| 设置页管理面板 | 列表 + 共用 `Button` | 插件样式表里的 `[data-dsh-soul-preset-*]` 规则，行样式跟 app 的设置行一致（13/20 标题、12/18 说明、8px 圆角行） |

显隐依据是会话列表中当前会话的 `projectionValues.agentPreset === 'qa'`，不是全局预设提示词的 `active` 值；未选模式或没有会话时均不显示。这两个会话插槽直接取得外壳提供的 `sessionId` 与 `useSessions`，空白会话切换模式时会重绘。设置页管理始终保留，非问答模式下其错误信息仍可在设置页查看。

三条要记住的：

- **列表超过 320px 就在卡片里滚动**，滚动条与滚动体都来自共用菜单（`.viewport` 的 `overflow-y: auto`，滚动条取 l2 token）。共用卡片自身的上限接近全屏，12 个预设还够不到、会整条展开盖住页面；chip 传给 `Menu` 的 `listClassName: 'dsh-sp-menu-cap'` 是原语为 portaled 列表留的唯一样式挂钩，样式表用它把卡片压到 `min(320px, <视口适配上限>)`——短窗口时仍取更小的视口适配值，不改共用组件本身。列表朝上展开并挂到 `body`（与访问模式一致）。
- **`lib/client.js` 从模块表取 `@deepseek-ai/dsh-client-ui-primitives`**（外壳自带的平台模块，不需要额外安装），`tsdown.config.mjs` 的 `MODULE_TABLE_KEYS` 因此多了一项；它必须保持 `require`，被内联就会带上 `react-dom` 并丢掉"与访问模式同一个菜单"这件事。
- **样式表是一份注入的 `<style>`**（`src/client-styles.mjs`），不是 CSS module：本包的 tsdown 配置没有样式管线，而模块系统本来就认插件注入的标签——`data-plugin` 是移除键（`removeOwnedStyles`），`data-plugin-css` 是同一张表的去重键。类名带 `dsh-sp-` 前缀（它们活在页面的全局样式表里），值一律用 `--dsw-*` token，明暗主题都跟着走。设置页那一节也不再自带 `<h2>`：外壳用注册时的 `label` 渲染左侧导航项，原先那个标题是重复的。

浏览器探针：chip 仍是 `[data-dsh-soul-preset-chip]`，行内文本是 `[data-dsh-soul-preset-name|description|hint|model]`；**`[data-dsh-soul-preset-menu]` 没有了**，列表 DOM 现在归共用菜单所有，打开时用 `[role="menu"]` 定位（同一时刻页面里只有它一个）。设置页新增 `[data-dsh-soul-preset-row-text|row-desc|row-model|select|actions|confirm|cancel|remove|new|reveal|reload|toolbar]`，`root`／`broken`／`error` 不变。

## 测试

```bash
cd /l/dsh/.local-deploy/soul-presets-plugin
export PATH="/d/softwares/node-v24.21.0-win-x64:$PATH"
pnpm test
```

145 个用例，覆盖：拼装字节与尺寸上限、TOML 解析与坏预设分类（含 `[Model]` 的完整／半写／类型错误）、逐文件 mtime 快照（含原地改写）、settings schema 与校验、模板可反解、回环 Host／Origin 守卫（含点分四段的越界段）、四条路由的方法分派与拒绝路径（含删除时 ENOENT 与其他失败的区分）、roster 解码与名称／简介／hint／模型映射、每会话选择（select 与重置路由、覆盖→默认→defaultPrompt 的裁决链、`.selections.json` 的持久化、500 条上限与陈旧行清理）、默认模型（新会话仅在有模型历史前施加、已有请求头／已选模型时不动、子代理 id 形状排除、不可路由时新会话照常建立且切换仍成功、`modelError` 在界面可见）、随包示例预设（种入判据与幂等、不覆盖已有、单个失败留日志其余照种、产物从 lib/../presets 解析后空目录部署即得 35 行且全部可解析）、客户端动作发出的真实请求与失败可见性、并发刷新只读一次、改动与在途刷新并发时会补读一次、动作成功但随后读取失败时读取失败仍可见、删除时 ENOENT 与 EPERM 的不同响应、订阅者抛错不会把共享 store 卡死，以及**构建产物本身**——`test/build.test.mjs` 会先跑一次真实构建，再导入 `lib/index.js`、用模块表加载器执行 `lib/client.js`、驱动它自己的 `apply()` 注册三个界面，并用录制的 React 真正调用 dock 与设置页组件，断言失败提示确实被渲染出来（删掉那两个错误元素会让测试变红）。另有 `test/soul-prompt-row.test.mjs` 覆盖部署侧的 `soul-prompt.mjs`（开关、服务缺席与返回 null 的回退、append 模式、`interpolate: false`），以及 `test/reveal.test.mjs` 覆盖目录 opener 的平台与失败路径。`test/build.test.mjs` 还把**构建后的宿主入口**放回同一套假 ctx 里跑一遍（不只对导出名做断言），并用带钩子状态的渲染器真的点一次 chip 的预设行、点一次删除再确认，断言选择写入与 DELETE 各发生一次。`test/soul-prompt-row.test.mjs` 另有两例固定两种快照语义：`append` 对同一 agent 只取一次（长对话的系统提示词必须字节稳定），`replace` 每次重读（一问一答没有前缀要保护）。**本插件不进 dsh 仓库的测试脚手架，也不改动它。**

界面改版后又加了三类：**产物只向模块表要两个平台模块**（`react` 与 `@deepseek-ai/dsh-client-ui-primitives` 都必须以 `require("…")` 出现，而不是被内联——内联会捎上 `react-dom`，而加载器遇到模块表答不上来的 specifier 会让整份用例失败）；**样式表按插件标记注入且只有一份**（用假 document 断言 `data-plugin`／`data-plugin-css` 与重复激活不插第二份，并断言表里带 chip 与列表行的规则）；**chip 交给共用菜单的正是切换列表**（断言 `side`／`portal`／`selectedId`／行文本与「空目录给一行说明而不是空菜单」，点行仍写入选择）。测试替身 `test/support/fake-ui-primitives.mjs` 把共用菜单按元素层渲染出来——录制版 React 不会调用嵌套函数组件，需要展开的地方由 `expand()` 显式调用。

本次另有产物级断言：非问答模式、未选模式和模式切换时，提示行与可聚焦的切换按钮一起消失；问答模式下菜单和提示行恢复，样式表不再给提示行叠加 8px 底部内边距。

## 验收记录（2026-09-22）

逐条对照 `specs/soul-presets.md` 的 Acceptance：

| # | 结论 | 证据 |
|---|---|---|
| 1 | 通过 | 放入 `translate.toml` 后直接 `GET /plugins/soul-preset/roster` 返回该预设的 `name`／`description`／`hint`，未重启服务 |
| 2 | 通过 | 真实会话里逐字核对过：选中「翻译助手」后提问，该会话的 `system/message`（turn 1，1612 字符）就是预设 System + `===`/`<example>` 段 + 空行 + 工作区 `SOUL.md`，与规格的拼装规则逐字一致；模型回答是纯译文、无寒暄，符合预设要求 |
| 3 | 通过 | `test/assemble.test.mjs` 断言确切字节；单边为空则不出现示例段 |
| 4 | 通过 | 探针输出的拼装文本里不含 `description` 与 `hint` |
| 5 | 通过 | 真实界面里切换后，chip 立刻显示新预设名、输入框上方那行显示「预设：翻译助手 · <hint>」，紧接着的提问就用了新预设（见第 2 条的会话证据），无需刷新、无需重开会话 |
| 6 | 通过 | `test/assemble.test.mjs`：`Fill {{name}} literally.` 逐字保留 |
| 7 | 通过 | `test/presets-store.test.mjs` 的原地改写用例（mtime 推到未来）+ 上面第 1 条的实测 |
| 8 | 通过 | `test/routes.test.mjs`：201／409／400／413；界面里点「新建」按模板建出文件并出现在列表（见下节） |
| 9 | 通过 | 删除与越界拒绝有单元测试；二次确认在真实界面里走过（点「删除」出现「确认删除／取消」，确认后该行消失且文件真的从磁盘消失，见下节） |
| 10 | 通过 | `test/guard.test.mjs` + 实测：`Host: evil.example:3080` → 403、`Host: 127.999.999.999:3080` → 403（越界段不再放行）、回环 Host → 200，且被拒请求不写盘 |
| 11 | 通过 | `test/presets-parse.test.mjs`、`test/presets-store.test.mjs` |
| 12 | 通过 | 单元测试 + 探针：`active` 悬空或为空时返回 `SOUL.md` 单独内容 |
| 13 | 部分验证 | `presets: true` 只加在 qa 行（已核对 yaml 解析结果）；chat 行未跑过实测 |
| 14 | 通过 | `pnpm test` 96/96（含构建产物、产物交互、界面渲染、失败时序、部署侧行与 opener 的行为用例） |
| 15 | 通过 | `test/client-state.test.mjs`、`test/client-seats.test.mjs` |
| 16 | 通过 | chip 与切换列表在真实界面里可见可用：列表逐行显示名字／简介／hint，选中后 chip 与 dock 同步更新，会话里模型确实按预设作答。设置页的管理面板同样在界面里走过一遍（见下节） |
| 17 | 通过 | 每步都核对 `git status --porcelain`，只有两个既有未跟踪项 |

**两处固有局限（不改变上面的判定，记录以备后来者）**：验收 6 的 `{{...}}` 字面保留有单元断言，也在 section 上声明了 `interpolate: false`，但没有跑过真实的 system-prompt 插值路径——要跑它需要一次真实会话。验收 7 的逐文件 mtime + size 判据在"同一时间片内改写且大小不变"的情况下存在理论盲区：这是 stat 型判据的固有性质，覆盖它需要控制 mtime 的亚刻度，超出本插件测试的范围。两条都不构成未验证的规格要求，判定仍为通过。

**第 2 条已按原步骤补完**（2026-09-22）：在真实界面里选中预设、发一问，然后按下面的 zstd 切帧脚本读该会话的 `session.v3.jsonl.zstd` 核对系统提示词。

**一条实测观察**：拼装顺序是预设在前、工作区 `SOUL.md` 追加在后，所以工作区里那份很长的提示词（本机 `L:dshSOUL.md` 是一份公文写作 prompt）会跟在预设之后一起进系统提示词。实测中模型仍按预设的「只输出译文」作答，但两者语义相冲时工作区那份的位置更靠后；若想让预设压过工作区文件，把 `soul-prompt.mjs` 里两段的拼接顺序反过来即可。

**界面改版在真实浏览器里验收（2026-09-22 第二轮）**：用内置浏览器打开 `127.0.0.1:3080`（重新 `remove`+`add` 后按 `stop-web.cmd` 的做法重启过服务，页面刷新后生效），逐项确认——`style[data-plugin-css="dsh-soul-presets/client-styles.css"]` 恰好一份；chip 的计算样式是 28px 高、24px 圆角、13px、次级文字色，与紧邻的访问模式触发器同族；切换列表 20px 圆角、每行两行文字（名字 + 简介 · hint）、选中行带勾；放入 14 个临时预设后列表 696px 高、内容 784px，`scrollTop` 能从 0 滚到 96，滚动条占 8px 布局宽且取到 l2 滚动条 token；设置页「预设提示词」分区渲染出目录路径、14 行（名字 + 简介 + 删除）与工具栏三颗按钮，且不再有自带标题；点「删除」出现红色「确认删除」与「取消」，确认后该行消失、列表变 13 行、`tmp-probe-01.toml` 真的从磁盘消失；点「新建」按模板建出 `probe-ui-new.toml`（内容就是模板）、列表随即多出该行且带模板简介，再走一次删除把它清掉、文件消失；最后点「重新载入」，列表回到 1 行、当前项带 `aria-current="true"`、无错误提示。临时文件已全部删除，目录只剩 `translate.toml`，`active` 未变。
**三条限制**：本机内置浏览器送不进 Playwright 定位点击，上述点击走的是页面内 DOM `.click()`（React 的 `onClick` 照常触发，能证明组件接线，不证明指针命中），真实指针路径本轮没重跑——上一轮验收 5／16 已经走过真实交互，本轮只动样式；**内置浏览器还会吞掉 `window.prompt`**（第一次点「新建」既没有对话框也没有新行，说明原件返回了 null），所以新建那一轮把 `window.prompt` 临时替换成记录器再点，验证的是「按钮 → prompt 文案 → 创建路由 → 列表刷新」这条接线，原生对话框本身没看到；「打开预设目录」本轮没点（它会弹出资源管理器窗口），它仍只有单元测试覆盖。

**一处只在真实浏览器里暴露的缺陷（已修）**：客户端 `inject` 少了 `remote`。cordis 的服务访问器对**未声明服务是抛错**的，所以 `ctx.remote?.$on?.(…)` 的可选链救不了它——插件在浏览器里激活失败（`web boot: 1 entry did not activate`），而当时 94 个用例全绿，因为测试替身是普通对象、没有这层守卫。修法是补上声明；同时把测试替身改成 Proxy，未声明服务的读取按 cordis 的方式抛错（把缺陷放回去会让 21 个用例变红，已验证）。教训：本部署的验收必须包含一次真实浏览器加载，机械检查（产物被引用、被服务）证明不了激活成功。
**未验证（经验空缺，不是通过项）**：逐字拼装正确，不等于模型真能分清"要求"与"示例"。示例块对输出格式的实际约束力是模型行为，本轮没有可机械验证的断言。若实测发现约束力不足，改法是调整示例块措辞；改用真实 assistant 回合这条路已在规格里论证过为何不做。
