/**
 * The template a new preset is created from. Its prompt bodies use TOML's
 * multi-line literal form, so whatever is written inside — quotes, braces,
 * JSON, `{{` — needs no escaping and cannot collide with the file's syntax.
 * @module dsh-soul-presets/src/template
 */

/**
 * Render the starting text for a new preset.
 * @param id - the preset id, used as the starting display name.
 * @returns TOML text that parses and validates.
 */
export function presetTemplate(id) {
  return `preset = ${JSON.stringify(id)}
description = "一句话说明这套预设是做什么的"
hint = "给用户的提示：这套预设该问什么"

# 可选：这套预设的默认模型。新会话启动、或会话切到本预设时生效；
# 改这里不会动已经在跑的会话。去掉注释即启用，provider 与 model 必须同时写。
# [Model]
# provider = "paratera"
# model = "AZ-GPT-5.6-Luna"
# reasoningEffort = "high"

[Prompt]
System = '''
你是……
'''
User = '''
示例提问（与下面一段必须同时填写，示例块才会生效）
'''
Assistant = '''
示例回答
'''
`
}
