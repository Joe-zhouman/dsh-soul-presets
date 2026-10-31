#!/usr/bin/env node
/**
 * One-click installer for `dsh-soul-presets`.
 *
 * Four steps, each safe to repeat:
 *   1. install the plugin package into a dsh profile (`dsh plugin … add`), which
 *      also puts it into `dsh.profile.bundles`;
 *   2. copy `deploy/soul-prompt.mjs` to `$DSH_HOME/preset-plugins/`, backing up a
 *      different existing copy;
 *   3. make sure the profile's `cordis.patch.yml` declares the `preset-qa` row
 *      and that its `soul-prompt` plugin carries `presets: true`;
 *   4. verify the patched profile still composes (`dsh --profile … --dump-config`)
 *      and roll the patch back if it does not.
 *
 * The desktop Electron application owns its `desktop` profile and refuses the
 * CLI, so there step 1 happens in the app's plugin panel and this script runs
 * with `--skip-plugin-install` for steps 2–4.
 *
 * Usage: `node scripts/install.mjs [options]`, or `install.cmd` on Windows.
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPresetRow, inspectProfilePatch, patchProfilePatch, ROW_ID, toFileUrl } from './install-lib.mjs'

/** Package name in the profile manifest and `dsh.profile.bundles`. */
const PACKAGE_NAME = 'dsh-soul-presets'
/** Default source for installs that do not run from a checkout. */
const GIT_SOURCE = 'github:Joe-zhouman/dsh-soul-presets'
/** This installer's own directory and the repository root above it. */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
/** Presets live here, one `.toml` per preset. */
const PRESETS_DIR = 'soul-presets'
/** `soul-prompt.mjs` and friends live here under the harness home. */
const PRESET_PLUGINS_DIR = 'preset-plugins'
/** Profile file the installer edits. */
const PATCH_FILENAME = 'cordis.patch.yml'

/**
 * Parse the command line. No dependency on a parser: the surface is small and
 * `--flag=value` and `--flag value` both work.
 * @param {string[]} argv - Arguments after the script path.
 * @returns {Record<string, unknown>} Normalized options.
 */
function parseArgs(argv) {
  const options = {
    profile: 'web',
    home: undefined,
    source: undefined,
    dsh: undefined,
    skipPlugin: false,
    refresh: false,
    keepSoulPrompt: false,
    dryRun: false,
    check: false,
    verify: true,
    printRow: false,
    help: false,
  }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    const equals = argument.startsWith('--') ? argument.indexOf('=') : -1
    const name = equals > 0 ? argument.slice(0, equals) : argument
    const inline = equals > 0 ? argument.slice(equals + 1) : undefined
    const value = () => {
      if (inline !== undefined) return inline
      const next = argv[++index]
      if (next === undefined) fail(`${name} 缺少取值`)
      return next
    }
    switch (name) {
      case '--profile': options.profile = value(); break
      case '--home': options.home = value(); break
      case '--source': options.source = value(); break
      case '--dsh': options.dsh = value(); break
      case '--skip-plugin-install': options.skipPlugin = true; break
      case '--refresh': options.refresh = true; break
      case '--keep-soul-prompt': options.keepSoulPrompt = true; break
      case '--dry-run': options.dryRun = true; break
      case '--check': options.check = true; break
      case '--no-verify': options.verify = false; break
      case '--print-row': options.printRow = true; break
      case '-h':
      case '--help': options.help = true; break
      default: fail(`未知参数 ${argument}（用 --help 查看用法）`)
    }
  }
  if (options.profile === '') fail('--profile 不能为空')
  return options
}

/** Print usage and exit. */
function printHelp() {
  process.stdout.write(`dsh-soul-presets 一键安装

用法
  node scripts/install.mjs [选项]

选项
  --profile <名字>          装到哪个 profile（默认 web）
  --home <目录>             DSH_HOME（默认取 $DSH_HOME，否则 ~/.dsh）
  --source <安装源>         默认：本检出用 file:<本仓库>，否则 ${GIT_SOURCE}
  --dsh <路径>              dsh CLI 入口（默认自动找 PATH 上的 dsh 或本机 dsh 检出）
  --skip-plugin-install    跳过第 1 步（桌面端在应用里装包后这样跑）
  --refresh                先 remove 再 add，刷新 file: 安装副本
  --keep-soul-prompt       不覆盖已存在的 soul-prompt.mjs
  --dry-run                只打印计划，不写任何文件
  --check                  只检查当前状态，不安装、不写文件
  --no-verify              跳过安装后的配置自检（dsh --dump-config）
  --print-row              打印要写进 cordis.patch.yml 的声明行后退出
  -h, --help               显示本帮助

示例
  node scripts/install.mjs
  node scripts/install.mjs --home L:/dsh/.dsh-home
  node scripts/install.mjs --profile desktop --skip-plugin-install
`)
}

/**
 * Print one progress line under the current step.
 * @param {string} text - Message.
 */
function detail(text) {
  process.stdout.write(`     ${text}\n`)
}

/**
 * Print a step heading.
 * @param {string} index - Step number as text, or a short label.
 * @param {string} title - Step title.
 */
function step(index, title) {
  process.stdout.write(`\n${index} ${title}\n`)
}

/**
 * Print a warning line.
 * @param {string} text - Message.
 */
function warn(text) {
  process.stderr.write(`     ! ${text}\n`)
}

/**
 * Abort with a nonzero exit and a one-line reason.
 * @param {string} message - Reason, in the user's language.
 * @returns {never} Never returns.
 */
function fail(message) {
  process.stderr.write(`\ndsh-soul-presets: ${message}\n`)
  process.exit(1)
}

/**
 * Read JSON, or undefined when the file is absent or unreadable.
 * @param {string} path - File path.
 * @returns {any} Parsed value.
 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Resolve the harness home exactly like dsh does, reporting where it came from.
 * @param {string | undefined} explicit - `--home`.
 * @returns {{ home: string, source: string }} Absolute home and its provenance.
 */
function resolveHome(explicit) {
  if (explicit !== undefined) return { home: resolve(explicit), source: '--home' }
  const fromEnv = process.env.DSH_HOME?.trim()
  if (fromEnv !== undefined && fromEnv !== '') return { home: resolve(fromEnv), source: 'DSH_HOME' }
  return { home: join(homedir(), '.dsh'), source: '默认 ~/.dsh' }
}

/**
 * The checkout this script belongs to, when the script lives in one.
 * @returns {string | undefined} Repository root of `dsh-soul-presets`.
 */
function findCheckout() {
  const manifest = readJson(join(REPO_ROOT, 'package.json'))
  return manifest?.name === PACKAGE_NAME ? REPO_ROOT : undefined
}

/**
 * Walk up from a directory looking for a dsh source checkout with a built CLI.
 * @param {string} start - Directory to start from.
 * @returns {{ kind: 'node', path: string, label: string } | undefined} CLI.
 */
function findDshCheckout(start) {
  let directory = resolve(start)
  for (;;) {
    const manifest = readJson(join(directory, 'package.json'))
    if (manifest?.name === '@deepseek-ai/dsh-root') {
      const entry = join(directory, 'apps', 'cli', 'lib', 'bin.js')
      if (existsSync(entry)) return { kind: 'node', path: entry, label: `node ${entry}` }
    }
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

/**
 * Find an executable on PATH the way the shell would.
 * @param {string} name - Command name without extension.
 * @returns {string | undefined} Absolute path.
 */
function findOnPath(name) {
  const directories = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')
  const extensions = process.platform === 'win32' ? ['exe', 'cmd', 'bat', ''] : ['']
  for (const directory of directories) {
    if (directory.trim() === '') continue
    for (const extension of extensions) {
      const candidate = join(directory, extension === '' ? name : `${name}.${extension}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Turn a CLI path into the invocation shape the spawn helpers understand.
 * @param {string} path - Absolute path to a `.js`, `.cmd`, or executable.
 * @returns {{ kind: 'node' | 'cmd' | 'direct', path: string, label: string }} CLI.
 */
function describeCliPath(path) {
  const lower = path.toLowerCase()
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return { kind: 'node', path, label: `node ${path}` }
  }
  if (lower.endsWith('.cmd') || lower.endsWith('.bat')) return { kind: 'cmd', path, label: path }
  return { kind: 'direct', path, label: path }
}

/**
 * Resolve which dsh CLI installs the package.
 *
 * `--dsh` wins, then `DSH_CLI`, then a `dsh` on PATH, then a source checkout
 * found upward from the working directory and from this repository (that is
 * the shape of the deployment this plugin is developed in).
 * @param {{ dsh?: string }} options - Parsed options.
 * @returns {{ kind: 'node' | 'cmd' | 'direct', path: string, label: string } | undefined} CLI.
 */
function resolveDshCli(options) {
  const explicit = options.dsh ?? process.env.DSH_CLI
  if (explicit !== undefined && explicit.trim() !== '') {
    if (existsSync(resolve(explicit))) return describeCliPath(resolve(explicit))
    const onPath = findOnPath(explicit)
    if (onPath !== undefined) return describeCliPath(onPath)
    fail(`找不到 dsh CLI：${explicit}`)
  }
  const onPath = findOnPath('dsh')
  if (onPath !== undefined) return describeCliPath(onPath)
  const fromCwd = findDshCheckout(process.cwd())
  if (fromCwd !== undefined) return fromCwd
  return findDshCheckout(REPO_ROOT)
}

/**
 * Whether this Node satisfies dsh's `^22.19.0 || >=24.0.0` engine floor.
 * Below it the CLI exits 0 while doing nothing, so the installer refuses the
 * checkout route rather than report a silent no-op as success.
 * @returns {boolean} True when supported.
 */
function nodeVersionSupported() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  return major >= 24 || (major === 22 && minor >= 19)
}

/**
 * Quote one token for `cmd.exe /c` when it contains characters the shell treats
 * specially.
 * @param {string} text - Token.
 * @returns {string} Token safe for a single command line.
 */
function quoteForCmd(text) {
  return /[\s"&|<>^]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * Map a CLI plus arguments to a spawnable command line.
 * @param {{ kind: 'node' | 'cmd' | 'direct', path: string }} cli - Resolved CLI.
 * @param {string[]} args - Arguments after the CLI.
 * @returns {{ command: string, args: string[] }} Spawn shape.
 */
function invocationFor(cli, args) {
  if (cli.kind === 'node') return { command: process.execPath, args: [cli.path, ...args] }
  if (cli.kind === 'cmd') {
    const line = [quoteForCmd(cli.path), ...args.map(quoteForCmd)].join(' ')
    return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', line] }
  }
  return { command: cli.path, args }
}

/**
 * Run the CLI with inherited stdio so package-manager progress stays visible.
 * @param {{ kind: 'node' | 'cmd' | 'direct', path: string }} cli - Resolved CLI.
 * @param {string[]} args - CLI arguments.
 * @param {string} home - Value for `DSH_HOME`.
 * @returns {number} Exit code.
 */
function runCli(cli, args, home) {
  const invocation = invocationFor(cli, args)
  const result = spawnSync(invocation.command, invocation.args, {
    stdio: 'inherit',
    env: { ...process.env, DSH_HOME: home },
  })
  if (result.error !== undefined) fail(`无法启动 ${cli.label}：${String(result.error)}`)
  return result.status ?? 1
}

/**
 * Run the CLI with captured output, for the compose self-check.
 * @param {{ kind: 'node' | 'cmd' | 'direct', path: string }} cli - Resolved CLI.
 * @param {string[]} args - CLI arguments.
 * @param {string} home - Value for `DSH_HOME`.
 * @returns {{ ok: boolean, output: string, error?: string }} Exit status, both
 *   streams, and the spawn error when the command could not run at all.
 */
function captureCli(cli, args, home) {
  const invocation = invocationFor(cli, args)
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
    env: { ...process.env, DSH_HOME: home },
  })
  return {
    ok: result.error === undefined && result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error === undefined ? '' : `\n${String(result.error)}`}`,
    error: result.error === undefined ? undefined : String(result.error),
  }
}

/**
 * Read the profile manifest state the installer cares about.
 * @param {string} profileDir - Profile directory.
 * @returns {{ dependency?: string, bundles: string[], hasBundle: boolean }} State.
 */
function installedState(profileDir) {
  const manifest = readJson(join(profileDir, 'package.json'))
  const bundles = manifest?.dsh?.profile?.bundles ?? []
  return {
    dependency: manifest?.dependencies?.[PACKAGE_NAME],
    bundles,
    hasBundle: bundles.includes(PACKAGE_NAME),
  }
}

/**
 * Resolve a file inside the checkout first or the installed package first.
 * @param {string | undefined} checkout - This repository, when present.
 * @param {string} profileDir - Profile directory.
 * @param {string} relative - Path inside the package.
 * @param {boolean} checkoutFirst - Whether the checkout is expected to be authoritative.
 * @returns {string | undefined} Existing path.
 */
function resolvePackageFile(checkout, profileDir, relative, checkoutFirst) {
  const installed = join(profileDir, 'node_modules', PACKAGE_NAME, relative)
  const checked = checkout === undefined ? [] : [join(checkout, relative)]
  const candidates = checkoutFirst ? [...checked, installed] : [installed, ...checked]
  return candidates.find(candidate => existsSync(candidate))
}

/**
 * Compare two text files ignoring line endings: a CRLF copy and an LF copy of
 * the same module are the same module.
 * @param {string} left - First file.
 * @param {string} right - Second file.
 * @returns {boolean} True when equal after EOL normalization.
 */
function sameText(left, right) {
  try {
    const normalize = text => text.replace(/\r\n/g, '\n')
    return normalize(readFileSync(left, 'utf8')) === normalize(readFileSync(right, 'utf8'))
  } catch {
    return false
  }
}

/**
 * Copy `soul-prompt.mjs` into `$DSH_HOME/preset-plugins/`, backing up a
 * different existing copy so the previous version stays recoverable.
 * @param {{
 *   source: string, destination: string, keep: boolean, dryRun: boolean
 * }} options - Source file, target file, and the two switches.
 * @returns {'copied' | 'unchanged' | 'kept'} What happened.
 */
function installSoulPrompt({ source, destination, keep, dryRun }) {
  const exists = existsSync(destination)
  if (exists && sameText(source, destination)) return 'unchanged'
  if (exists && keep) return 'kept'
  if (!dryRun) {
    mkdirSync(dirname(destination), { recursive: true })
    if (exists) {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
      copyFileSync(destination, `${destination}.bak-${stamp}`)
    }
    copyFileSync(source, destination)
  }
  return 'copied'
}

/**
 * Edit the profile patch, with a backup and a compose self-check around it.
 *
 * The pre-edit compose result is the baseline: a profile that already fails to
 * compose is reported but never blamed on this edit. When the baseline passed
 * and the edited profile does not — or when the composed tree no longer carries
 * `preset-qa` — the original bytes (or the absence of the file) are restored.
 * @param {{
 *   patchPath: string, fileUrl: string, template: string,
 *   dryRun: boolean, verify: boolean, cli?: object, home: string, profile: string
 * }} options - Everything the edit and the verification need.
 * @returns {{ changed: boolean, actions: {kind: string, detail: string}[], state: object }} Result.
 */
function applyPatch(options) {
  const { patchPath, fileUrl, template, dryRun, verify } = options
  const before = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : undefined
  const text = before ?? '# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries (id-targeted config\n# overrides, disables, and insert lists; `!!js` expressions allowed).\n[]\n'
  const result = patchProfilePatch(text, {
    fileUrl,
    template,
    fileExists: candidate => existsSync(candidate),
  })
  const state = inspectProfilePatch(result.text, { fileExists: candidate => existsSync(candidate) })
  if (result.manual !== undefined) return { changed: false, actions: [], state, manual: result.manual }
  if (!result.changed) return { changed: false, actions: result.actions, state }
  if (dryRun) return { changed: true, actions: result.actions, state, dryRun: true }

  let canVerify = verify && options.cli !== undefined
  const dumpArgs = ['--profile', options.profile, '--dump-config']
  let baselineOk = true
  if (canVerify && before !== undefined) {
    const baseline = captureCli(options.cli, dumpArgs, options.home)
    if (baseline.error !== undefined) {
      warn(`无法运行 dsh --dump-config（${baseline.error}），跳过组合校验`)
      canVerify = false
    } else if (!baseline.ok) {
      baselineOk = false
      warn('改动前这份 profile 就组合不起来（见下方输出），因此不再以组合结果回滚；建议先修好它')
      process.stderr.write(`${tail(baseline.output)}\n`)
    }
  }

  const restore = () => {
    if (before === undefined) rmSync(patchPath, { force: true })
    else writeFileSync(patchPath, before)
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  if (before !== undefined) copyFileSync(patchPath, `${patchPath}.bak-${stamp}`)
  mkdirSync(dirname(patchPath), { recursive: true })
  writeFileSync(patchPath, result.text)

  let verified = false
  if (canVerify) {
    const composed = captureCli(options.cli, dumpArgs, options.home)
    const carriesRow = composed.output.includes(ROW_ID)
    if (baselineOk && (!composed.ok || !carriesRow)) {
      restore()
      fail(`改完补丁后 profile 组合失败，已还原 ${PATCH_FILENAME}：\n${tail(composed.output)}`)
    }
    verified = composed.ok && carriesRow
    if (!baselineOk && verified) detail('顺带修好了 profile 组合（改动前是坏的）')
  }
  return { changed: true, actions: result.actions, state, verified }
}

/**
 * The last lines of a command's output, for a failure message.
 * @param {string} text - Captured output.
 * @returns {string} At most 20 lines.
 */
function tail(text) {
  const lines = text.trimEnd().split('\n')
  return lines.slice(Math.max(0, lines.length - 20)).join('\n')
}

/**
 * Print what `--check` decided, one line per criterion.
 * @param {{ home: string, profile: string, profileDir: string, patchPath: string }} target
 *   Resolved locations.
 * @returns {number} 0 when every criterion passes.
 */
function checkState(target) {
  const { home, profile, profileDir, patchPath } = target
  const installed = installedState(profileDir)
  const soulPrompt = join(home, PRESET_PLUGINS_DIR, 'soul-prompt.mjs')
  const patchText = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : undefined
  const patchState = patchText === undefined
    ? { ok: false, problem: '补丁文件不存在' }
    : inspectProfilePatch(patchText, { fileExists: candidate => existsSync(candidate) })
  const presetsDir = join(home, PRESETS_DIR)
  const presets = existsSync(presetsDir)
    ? readdirSync(presetsDir).filter(name => name.endsWith('.toml')).length
    : 0
  const checks = [
    ['插件包已安装', installed.dependency !== undefined, installed.dependency ?? '未在 profile 的 dependencies 里'],
    ['插件是 profile bundle', installed.hasBundle, installed.hasBundle ? '在 dsh.profile.bundles 里' : '未在 dsh.profile.bundles 里'],
    ['soul-prompt.mjs 已就位', existsSync(soulPrompt), soulPrompt],
    ['soul-prompt.mjs 含 interpolate: false', existsSync(soulPrompt) && readFileSync(soulPrompt, 'utf8').includes('interpolate: false'), '缺少会让 {{...}} 提示词报错'],
    ['preset-qa 行完整', patchState.ok === true, patchState.problem ?? patchState.name ?? ''],
  ]
  process.stdout.write(`\nDSH_HOME  ${home}\nprofile   ${profile}\n目录      ${profileDir}\n补丁      ${patchPath}\n\n`)
  for (const [label, ok, note] of checks) {
    process.stdout.write(`  ${ok ? '✓' : '✗'} ${label}${note === undefined || note === '' ? '' : ` — ${note}`}\n`)
  }
  process.stdout.write(`\n预设文件  ${presets} 个（${presetsDir}）\n`)
  const failures = checks.filter(([, ok]) => !ok).length
  if (failures === 0) {
    process.stdout.write('\n状态正常。若界面里还没有，确认服务/应用是在安装后重启过的。\n')
  } else {
    process.stdout.write(`\n${failures} 项未通过；跑一次 node scripts/install.mjs 会补齐。\n`)
  }
  return failures === 0 ? 0 : 1
}

/**
 * Installer entry point.
 * @returns {number} Process exit code.
 */
function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return 0
  }

  const checkout = findCheckout()
  const { home, source: homeSource } = resolveHome(options.home)
  const profile = String(options.profile)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(profile)) fail(`profile 名字不合法：${profile}`)
  const profileDir = join(home, 'profiles', profile)
  const patchPath = join(profileDir, PATCH_FILENAME)
  const sourceSpec = options.source ?? (checkout === undefined ? GIT_SOURCE : `file:${checkout.replaceAll('\\', '/')}`)
  // Resolved lazily: a standalone copy of this script installing from git only
  // gets the package copy after step 1, so looking before that would find nothing.
  const findSoulPrompt = () => resolvePackageFile(
    checkout,
    profileDir,
    join('deploy', 'soul-prompt.mjs'),
    sourceSpec.startsWith('file:'),
  )
  const findRowTemplate = () => resolvePackageFile(checkout, profileDir, join('deploy', 'preset-qa.row.yml'), true)

  if (options.printRow) {
    const rowTemplatePath = findRowTemplate()
    if (rowTemplatePath === undefined) fail('找不到 deploy/preset-qa.row.yml（请在仓库检出里运行，或先安装插件包）')
    const row = buildPresetRow(readFileSync(rowTemplatePath, 'utf8'), toFileUrl(join(home, PRESET_PLUGINS_DIR, 'soul-prompt.mjs')))
    process.stdout.write(`${row.join('\n')}\n`)
    return 0
  }

  if (options.check) {
    return checkState({ home, profile, profileDir, patchPath, checkout })
  }

  const dryRun = options.dryRun === true
  process.stdout.write(`dsh-soul-presets 安装 → profile "${profile}"${dryRun ? '（演练，不写文件）' : ''}\n`)
  process.stdout.write(`  DSH_HOME  ${home}  （来源：${homeSource}）\n`)
  process.stdout.write(`  profile   ${profileDir}\n`)
  if (homeSource === '默认 ~/.dsh' && !existsSync(profileDir)) {
    warn('没有设置 DSH_HOME，用的是默认 ~/.dsh；若服务读的是别的 home，请加 --home <目录>')
  }

  if (profile === 'desktop' && options.skipPlugin === false) {
    fail('desktop profile 由桌面应用独占，CLI 装不了包。请先在应用里「设置 → 插件 → 添加插件」装包，再用 --skip-plugin-install 重跑。')
  }

  let cli
  let state = installedState(profileDir)
  if (options.skipPlugin === false) {
    cli = resolveDshCli(options)
    if (cli === undefined) {
      fail('找不到 dsh CLI。请在设置页手动装包，或加 --dsh <路径>；也可以加 --skip-plugin-install 只做后两步。')
    }
    if (cli.kind === 'node' && !nodeVersionSupported()) {
      fail(`当前 Node ${process.versions.node} 低于 dsh 要求（^22.19.0 || >=24.0.0），CLI 会静默退出。请用运行 dsh 的那份 Node 重跑本脚本：\n  & "<node 路径>" "${join(REPO_ROOT, 'scripts', 'install.mjs')}"\nWindows 的 install.cmd 可以先 set DSH_NODE=<node 路径>。`)
    }
    process.stdout.write(`  CLI       ${cli.label}\n`)

    step('1/4', `安装插件包（${sourceSpec}）`)
    if (options.refresh === true && state.dependency !== undefined) {
      detail('--refresh：先移除旧副本，再重新链接')
      if (!dryRun) {
        const code = runCli(cli, ['plugin', '--profile', profile, 'remove', PACKAGE_NAME], home)
        if (code !== 0) fail('移除旧副本失败；修好 pnpm 报错后重试')
        state = installedState(profileDir)
      }
    }
    if (dryRun) {
      detail(`将运行：${cli.label} plugin --profile ${profile} add ${sourceSpec}`)
    } else {
      const code = runCli(cli, ['plugin', '--profile', profile, 'add', sourceSpec], home)
      if (code !== 0) fail('安装失败；把上面的 pnpm 输出发出来即可定位')
      state = installedState(profileDir)
      if (state.dependency === undefined) {
        fail(`命令返回 0，但 profile 的 dependencies 里没有 ${PACKAGE_NAME}。常见原因是 Node 低于 22.19（CLI 静默退出），请换成运行 dsh 的那份 Node 重试。`)
      }
      detail(`依赖  ${state.dependency}`)
      detail(`bundle ${state.hasBundle ? '已进入 dsh.profile.bundles' : '未进入 dsh.profile.bundles（重跑或手动补）'}`)
      if (!state.hasBundle) fail(`${PACKAGE_NAME} 没进 dsh.profile.bundles，插件不会被加载`)
    }
  } else {
    step('1/4', '跳过插件包安装（--skip-plugin-install）')
    if (!existsSync(profileDir)) {
      fail(`profile 目录不存在：${profileDir}\n桌面端请先启动一次应用并在「设置 → 插件」里装好插件包；Web 端去掉 --skip-plugin-install。`)
    }
    detail(state.dependency === undefined
      ? `提示：profile 里还没有 ${PACKAGE_NAME}，请确认已在应用里装好`
      : `已安装：${state.dependency}${state.hasBundle ? '，且在 bundles 里' : '，但不在 bundles 里'}`)
  }

  step('2/4', '复制 soul-prompt.mjs')
  const soulPromptSource = findSoulPrompt()
  if (soulPromptSource === undefined) {
    fail('找不到 deploy/soul-prompt.mjs：请在仓库检出里运行，或先安装插件包后重试')
  }
  const soulPromptTarget = join(home, PRESET_PLUGINS_DIR, 'soul-prompt.mjs')
  const copyResult = installSoulPrompt({
    source: soulPromptSource,
    destination: soulPromptTarget,
    keep: options.keepSoulPrompt === true,
    dryRun,
  })
  detail(`源   ${soulPromptSource}`)
  detail(`目标 ${soulPromptTarget}`)
  if (copyResult === 'unchanged') detail('内容一致，未改动')
  if (copyResult === 'kept') warn('已存在不同内容的副本，按 --keep-soul-prompt 保留（确认它含 interpolate: false）')
  if (copyResult === 'copied') detail(dryRun ? '将写入并备份旧副本' : '已写入（旧副本已备份为 .bak-<时间戳>）')
  if (copyResult !== 'unchanged' && !dryRun) {
    const text = readFileSync(soulPromptTarget, 'utf8')
    if (!text.includes('interpolate: false')) warn('这份 soul-prompt.mjs 没有 interpolate: false，{{...}} 提示词会让整轮组装报错')
  }

  step('3/4', '写 preset-qa 声明行')
  const existingPatch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  const needsRow = !/^\s*-\s+id:\s*preset-qa\s*$/mu.test(existingPatch)
  const rowTemplatePath = findRowTemplate()
  if (needsRow && rowTemplatePath === undefined) {
    fail('找不到 deploy/preset-qa.row.yml，无法生成声明行；请在仓库检出里运行，或先安装插件包')
  }
  const template = rowTemplatePath === undefined ? '' : readFileSync(rowTemplatePath, 'utf8')
  const patchResult = applyPatch({
    patchPath,
    fileUrl: toFileUrl(soulPromptTarget),
    template,
    dryRun,
    verify: options.verify === true,
    cli,
    home,
    profile,
  })
  if (patchResult.manual !== undefined) {
    fail(`${patchResult.manual}\n\n可先用 --print-row 打印声明行，按提示手动合并后重跑。`)
  }
  if (patchResult.changed === false) {
    detail('已是目标状态，未改动')
  } else {
    for (const action of patchResult.actions) detail(action.detail)
    detail(dryRun ? `将写入 ${patchPath}（先备份）` : `已写入 ${patchPath}（旧文件已备份）`)
  }
  if (patchResult.verified === true) {
    detail('配置自检通过（dsh --dump-config）')
  }

  step('4/4', '收尾')
  const final = installedState(profileDir)
  if (!options.skipPlugin && !dryRun && final.dependency === undefined) fail('最终检查：插件包仍未安装')
  detail(`插件包     ${final.dependency ?? '（本次跳过安装）'}`)
  detail(`提示词入口 ${soulPromptTarget}`)
  detail(`声明行     ${PATCH_FILENAME} → ${patchResult.state.name ?? 'preset-qa'}`)
  process.stdout.write(`
重启后生效：桌面端完全退出再打开应用；Web 服务用它平时的 stop/start 脚本重启。

确认：设置 → 预设提示词 应列出 ${PRESETS_DIR}/ 下的预设（空目录会种入随包的 35 个示例）。
命令行：Invoke-RestMethod http://127.0.0.1:<端口>/plugins/soul-preset/roster
状态自检：node ${join('scripts', 'install.mjs')} --check
`)
  return 0
}

try {
  process.exit(main())
} catch (error) {
  process.stderr.write(`\ndsh-soul-presets: 安装中断：${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
