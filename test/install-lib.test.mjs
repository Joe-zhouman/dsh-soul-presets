import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildPresetRow,
  fromFileUrl,
  inspectProfilePatch,
  patchProfilePatch,
  toFileUrl,
} from '../scripts/install-lib.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const TEMPLATE = readFileSync(join(root, 'deploy', 'preset-qa.row.yml'), 'utf8')
const FILE_URL = 'file:///L:/dsh/.dsh-home/preset-plugins/soul-prompt.mjs'

const FRESH = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`

// The deployment's own layer, trimmed to the two rows that matter here.
const DEPLOYMENT = `# Your patch layer for this dsh profile, applied after every bundle layer:
- id: agent-team
  disabled: true

- insert:
    - id: preset-chat
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: chat
        plugins:
          - id: soul-prompt
            name: file:///L:/dsh/.dsh-home/preset-plugins/soul-prompt.mjs
            config:
              mode: append
              file: CHAT.md
              persona: |-
                You are a helpful assistant.
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
    - id: preset-qa
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: qa
        plugins:
          - id: soul-prompt
            name: file:///L:/dsh/.dsh-home/preset-plugins/soul-prompt.mjs
            config:
              mode: replace
              presets: true
              file: SOUL.md
              defaultPrompt: You are a helpful assistant.
          - id: tool-mask
            name: file:///L:/dsh/.dsh-home/preset-plugins/tool-mask.mjs
            config:
              presetId: qa
        name: 问答模式
        description: 零工具问答
        order: 1.5
`

const WITH_OTHER_ENTRIES = `- id: ui-theme
  config:
    fontSize: 16
`

/** A row whose soul-prompt plugin has no presets switch yet. */
const ROW_WITHOUT_PRESETS = `- insert:
    - id: preset-qa
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: qa
        plugins:
          - id: soul-prompt
            name: file:///L:/dsh/.dsh-home/preset-plugins/soul-prompt.mjs
            config:
              mode: replace
              defaultPrompt: You are a helpful assistant.
        name: 问答模式
`

test('路径与 file:// URL 往返：Windows 盘符、空格转义、非 URL 前缀', () => {
  const path = process.platform === 'win32'
    ? 'L:\\dsh\\.dsh-home\\my presets\\soul-prompt.mjs'
    : '/tmp/dsh/my presets/soul-prompt.mjs'
  assert.equal(fromFileUrl(toFileUrl(path)), path)
  assert.equal(fromFileUrl('dsh-soul-presets'), undefined)
  assert.equal(fromFileUrl('file:///L:/dsh/a%20b.mjs'), process.platform === 'win32' ? 'L:\\dsh\\a b.mjs' : '/L:/dsh/a b.mjs')
})

test('声明行模板：去掉注释头、替换 soul-prompt 路径、保留字段', () => {
  const row = buildPresetRow(TEMPLATE, FILE_URL).join('\n')
  assert.equal(row.startsWith('#'), false, '注释头属于文档，不进 patch')
  assert.ok(row.includes('id: preset-qa'))
  assert.ok(row.includes("name: '@deepseek-ai/dsh-agent-preset'"))
  assert.ok(row.includes(`name: ${FILE_URL}`))
  assert.ok(row.includes('presets: true'))
  assert.ok(row.includes('mode: replace'))
  assert.equal(row.includes('<you>'), false)
})

test('模板缺少占位路径或声明行时直接拒绝', () => {
  assert.throws(() => buildPresetRow('preset = 1\n', FILE_URL))
  assert.throws(() => buildPresetRow('- insert:\n    - id: preset-qa\n      name: x\n', FILE_URL))
})

test('空模板补丁：[] 换成声明行，注释保留，重复执行不再改动', () => {
  const options = { fileUrl: FILE_URL, template: TEMPLATE, fileExists: () => true }
  const first = patchProfilePatch(FRESH, options)
  assert.equal(first.changed, true)
  assert.equal(first.actions[0].kind, 'replaced-empty')
  assert.equal(first.text.includes('\n[]\n'), false, '空数组不能再留着')
  assert.ok(first.text.startsWith('# Your patch layer'))
  assert.ok(first.text.includes('id: preset-qa'))
  const state = inspectProfilePatch(first.text, { fileExists: () => true })
  assert.equal(state.ok, true)
  assert.equal(state.presetsTrue, true)

  const second = patchProfilePatch(first.text, options)
  assert.equal(second.changed, false)
  assert.equal(second.text, first.text)
  assert.deepEqual(second.actions.map(action => action.kind).sort(), ['kept-name', 'kept-presets'])
})

test('已有其它条目的补丁：声明行追加在末尾，原内容逐字保留', () => {
  const result = patchProfilePatch(WITH_OTHER_ENTRIES, {
    fileUrl: FILE_URL,
    template: TEMPLATE,
    fileExists: () => true,
  })
  assert.equal(result.changed, true)
  assert.equal(result.actions[0].kind, 'appended-row')
  assert.ok(result.text.startsWith(WITH_OTHER_ENTRIES))
  assert.ok(result.text.includes('\n- insert:\n    - id: preset-qa'))
  assert.equal(inspectProfilePatch(result.text, { fileExists: () => true }).ok, true)
})

test('已装好的部署：不动一个字节，chat 行也不受影响', () => {
  const result = patchProfilePatch(DEPLOYMENT, { fileUrl: FILE_URL, template: '', fileExists: () => true })
  assert.equal(result.changed, false)
  assert.equal(result.text, DEPLOYMENT)
  assert.ok(result.actions.some(action => action.kind === 'kept-name'))
  assert.ok(result.actions.some(action => action.kind === 'kept-presets'))
})

test('缺少 presets：插在 config 块的第一行，缩进与兄弟键一致且可重复执行', () => {
  const options = { fileUrl: FILE_URL, template: '', fileExists: () => true }
  const first = patchProfilePatch(ROW_WITHOUT_PRESETS, options)
  assert.equal(first.changed, true)
  assert.ok(first.actions.some(action => action.kind === 'added-presets'))
  assert.ok(first.text.includes('\n              presets: true\n              mode: replace\n'), '缩进取现有子键')
  assert.equal(inspectProfilePatch(first.text, { fileExists: () => true }).ok, true)

  const second = patchProfilePatch(first.text, options)
  assert.equal(second.changed, false)
  assert.equal(second.text, first.text)
})

test('presets: false 改成 true，只改这一行', () => {
  const text = ROW_WITHOUT_PRESETS.replace('              mode: replace', '              presets: false\n              mode: replace')
  const result = patchProfilePatch(text, { fileUrl: FILE_URL, template: '', fileExists: () => true })
  assert.equal(result.changed, true)
  assert.ok(result.actions.some(action => action.kind === 'enabled-presets'))
  assert.equal(result.text.includes('presets: false'), false)
  assert.equal(result.text.split('\n').length, text.split('\n').length)
})

test('name 指向的文件不存在时改成本机路径；仍存在的其它路径保留', () => {
  const stale = ROW_WITHOUT_PRESETS.replace('file:///L:/dsh/.dsh-home/preset-plugins/soul-prompt.mjs', 'file:///L:/gone/soul-prompt.mjs')
  const fixed = patchProfilePatch(stale, {
    fileUrl: FILE_URL,
    template: '',
    fileExists: candidate => !candidate.includes('gone'),
  })
  assert.equal(fixed.changed, true)
  assert.ok(fixed.actions.some(action => action.kind === 'fixed-name'))
  assert.ok(fixed.text.includes(FILE_URL))

  const elsewhere = ROW_WITHOUT_PRESETS.replace('file:///L:/dsh/.dsh-home/preset-plugins/soul-prompt.mjs', 'file:///L:/opt/dsh/preset-plugins/soul-prompt.mjs')
  const kept = patchProfilePatch(elsewhere, { fileUrl: FILE_URL, template: '', fileExists: () => true })
  assert.ok(kept.actions.some(action => action.kind === 'kept-name'))
  assert.ok(kept.text.includes('file:///L:/opt/dsh/preset-plugins/soul-prompt.mjs'))
})

test('config 写在一行时拒绝改动，原文原样返回', () => {
  const flow = ROW_WITHOUT_PRESETS.replace('            config:\n              mode: replace\n              defaultPrompt: You are a helpful assistant.', '            config: { mode: replace }')
  const result = patchProfilePatch(flow, { fileUrl: FILE_URL, template: '', fileExists: () => true })
  assert.equal(result.changed, false)
  assert.equal(result.text, flow)
  assert.match(result.manual ?? '', /一行里/u)
})

test('重复的 preset-qa 行：停下并保持原文', () => {
  const duplicated = `${DEPLOYMENT}\n- insert:\n    - id: preset-qa\n      name: '@deepseek-ai/dsh-agent-preset'\n`
  const result = patchProfilePatch(duplicated, { fileUrl: FILE_URL, template: '', fileExists: () => true })
  assert.equal(result.changed, false)
  assert.equal(result.text, duplicated)
  assert.match(result.manual ?? '', /2 个/u)
})

test('CRLF 补丁保持 CRLF', () => {
  const crlf = FRESH.replaceAll('\n', '\r\n')
  const result = patchProfilePatch(crlf, { fileUrl: FILE_URL, template: TEMPLATE, fileExists: () => true })
  assert.equal(result.changed, true)
  assert.match(result.text, /\r\n/u)
  assert.equal(/(?<!\r)\n/u.test(result.text), false, '不能混入裸 LF')
})

test('检查器：没有声明行、name 不是 file URL、缺 presets 各有原因', () => {
  assert.equal(inspectProfilePatch(FRESH).ok, false)
  assert.match(inspectProfilePatch(FRESH).problem ?? '', /没有 preset-qa/u)

  const bare = ROW_WITHOUT_PRESETS.replace(/name: file:\/\/\/\S+/u, 'name: dsh-soul-prompt')
  assert.match(inspectProfilePatch(bare).problem ?? '', /不是 file:\/\/ URL/u)

  assert.match(inspectProfilePatch(ROW_WITHOUT_PRESETS).problem ?? '', /presets: true/u)
})

test('检查器报告 name 指向的文件是否还在', () => {
  const state = inspectProfilePatch(DEPLOYMENT, { fileExists: () => false })
  assert.equal(state.nameFile, 'L:\\dsh\\.dsh-home\\preset-plugins\\soul-prompt.mjs')
  assert.equal(state.nameExists, false)
  assert.equal(state.ok, true, '文件暂时缺失不影响行本身是否完整')
})
