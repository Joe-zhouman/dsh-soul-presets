/**
 * The plugin's four same-origin routes. Handlers are built from injected
 * dependencies so tests drive them without a socket, and every one of them runs
 * the loopback guard first.
 *
 * Create and delete share one route: `webServer` throws on a duplicate
 * (kind, path), and a throw there kills the host fiber, so two exact routes on
 * the same path would take the whole preset down. The method picks the action
 * and the id travels in the JSON body for both.
 * @module dsh-soul-presets/src/routes
 */
import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isTrustedLocalRequest } from './guard.mjs'
import { modelLabel } from './models.mjs'
import { PRESET_ID } from './presets.mjs'
import { SESSION_ID } from './selection.mjs'
import { presetTemplate } from './template.mjs'

/** Largest request body accepted, in bytes. */
const MAX_BODY_BYTES = 4096

/**
 * Answer one request with JSON.
 * @param res - the response.
 * @param status - the HTTP status.
 * @param payload - the JSON payload.
 */
function send(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

/**
 * One error's message.
 * @param error - the thrown value.
 * @returns the message text.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read a bounded request body.
 * @param req - the request.
 * @returns the text, or null when the body exceeds the ceiling.
 */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Read and validate the `id` field of a request body.
 * @param req - the request.
 * @returns the id, or a status describing why it was refused.
 */
async function readId(req) {
  const body = await readBody(req)
  if (body === null) return { status: 413 }
  let parsed
  try {
    parsed = JSON.parse(body === '' ? '{}' : body)
  } catch {
    // A body that is not JSON is the caller's mistake, so it becomes the 400
    // result rather than an error this handler reports.
    return { status: 400 }
  }
  // Valid JSON is not necessarily an object: `null`, a string, a number, or an
  // array would otherwise be read for `.id` and throw.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 400 }
  const id = parsed.id
  if (typeof id !== 'string' || !PRESET_ID.test(id)) return { status: 400 }
  return { id }
}

/**
 * Read and validate a selection body: `{session, id}` sets one session's
 * override, `{session}` (or an empty/absent id) clears it back to the default.
 * @param req - the request.
 * @returns the session and the preset id (null for the reset), or a status.
 */
async function readSelection(req) {
  const body = await readBody(req)
  if (body === null) return { status: 413 }
  let parsed
  try {
    parsed = JSON.parse(body === '' ? '{}' : body)
  } catch {
    return { status: 400 }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 400 }
  const session = parsed.session
  if (typeof session !== 'string' || !SESSION_ID.test(session)) return { status: 400 }
  const raw = parsed.id
  if (raw === undefined || raw === null || raw === '') return { session, id: null }
  if (typeof raw !== 'string' || !PRESET_ID.test(raw)) return { status: 400 }
  return { session, id: raw }
}

/**
 * The validated `session` query parameter of a request URL, when it carries one.
 * A GET read stays lenient: absent or malformed simply means the default view.
 * @param url - the request's URL.
 * @returns the session id, or null.
 */
function sessionParam(url) {
  if (typeof url !== 'string' || url === '') return null
  let parsed
  try {
    parsed = new URL(url, 'http://localhost')
  } catch {
    return null
  }
  const value = parsed.searchParams.get('session')
  return value !== null && SESSION_ID.test(value) ? value : null
}

/**
 * Build the route table.
 * @param deps - root directory, preset store, per-session selection store,
 * global-default reader, effective-selection resolver, preset-model applier,
 * reveal action, logger, and (for tests) the unlink implementation.
 * @returns route entries carrying an `id` for tests plus the webserver's fields.
 */
export function createRoutes(deps) {
  const { root, store, active, selection, effective, applyModel, reveal, log, unlink = unlinkSync, write = writeFileSync } = deps

  const guarded = handler => async (req, res) => {
    if (!isTrustedLocalRequest(req.headers)) {
      log('soul-presets: refused a request whose Host is not loopback')
      send(res, 403, { error: 'this route is reachable from loopback only' })
      return
    }
    await handler(req, res)
  }

  return [
    {
      id: 'roster',
      kind: 'exact',
      path: '/plugins/soul-preset/roster',
      handler: guarded((req, res) => {
        if (req.method !== 'GET') {
          send(res, 405, { error: 'use GET' })
          return
        }
        const session = sessionParam(req.url)
        const echo = session === null ? active() : effective(session)
        send(res, 200, { ...store.roster(echo), root, overridden: session !== null && selection.has(session) })
      }),
    },
    {
      id: 'select',
      kind: 'exact',
      path: '/plugins/soul-preset/select',
      handler: guarded(async (req, res) => {
        if (req.method !== 'POST') {
          send(res, 405, { error: 'use POST' })
          return
        }
        const request = await readSelection(req)
        if (request.session === undefined) {
          send(res, request.status, { error: 'body must be {session, id?} with ids matching their rules' })
          return
        }
        // Shape-valid and idempotent by construction: a repeated selection, or
        // a reset for a session that never chose, is the same success.
        selection.set(request.session, request.id)
        const target = effective(request.session)
        // A preset that names a model re-routes the session now. The preset
        // switch itself already succeeded, so an unusable route is reported
        // beside the success instead of turning it into a failure: the prompt
        // is in force either way.
        let model
        let modelError
        const spec = store.model(target)
        if (spec !== undefined) {
          try {
            const outcome = await applyModel(request.session, spec)
            if (outcome.selection !== undefined) model = outcome.selection
          } catch (error) {
            modelError = messageOf(error)
            log(`soul-presets: preset "${String(target)}" model ${modelLabel(spec)} is unusable: ${modelError}`)
          }
        }
        send(res, 200, {
          active: target,
          overridden: selection.has(request.session),
          ...model === undefined ? {} : { model },
          ...modelError === undefined ? {} : { modelError },
        })
      }),
    },
    {
      id: 'presets',
      kind: 'exact',
      path: '/plugins/soul-preset/presets',
      handler: guarded(async (req, res) => {
        if (req.method === 'POST') {
          const request = await readId(req)
          if (request.id === undefined) {
            send(res, request.status, { error: 'id must match ^[a-z0-9][a-z0-9-]*$' })
            return
          }
          try {
            write(join(root, `${request.id}.toml`), presetTemplate(request.id), { flag: 'wx' })
          } catch (error) {
            // An existing file is the caller's 409. Anything else is ours: log
            // it while keeping the client-facing message generic.
            const exists = error instanceof Error && 'code' in error && error.code === 'EEXIST'
            if (!exists) log(`soul-presets: creating "${request.id}" failed: ${messageOf(error)}`)
            send(res, exists ? 409 : 500, {
              error: exists ? `preset "${request.id}" already exists` : 'could not create the preset',
            })
            return
          }
          send(res, 201, { id: request.id })
          return
        }
        if (req.method === 'DELETE') {
          const request = await readId(req)
          if (request.id === undefined) {
            send(res, request.status, { error: 'id must match ^[a-z0-9][a-z0-9-]*$' })
            return
          }
          try {
            unlink(join(root, `${request.id}.toml`))
          } catch (error) {
            // Only a missing file is the caller's 404. A permission or I/O
            // failure is ours, and reporting it as "not there" would hide it.
            const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT'
            if (!missing) log(`soul-presets: deleting "${request.id}" failed: ${messageOf(error)}`)
            send(res, missing ? 404 : 500, {
              error: missing ? `preset "${request.id}" is not there` : 'could not delete the preset',
            })
            return
          }
          send(res, 200, { id: request.id })
          return
        }
        send(res, 405, { error: 'use POST to create or DELETE to remove' })
      }),
    },
    {
      id: 'reveal',
      kind: 'exact',
      path: '/plugins/soul-preset/reveal',
      handler: guarded(async (req, res) => {
        if (req.method !== 'POST') {
          send(res, 405, { error: 'use POST' })
          return
        }
        const outcome = await reveal(root)
        send(res, 200, { opened: outcome.opened === true, path: root })
      }),
    },
  ]
}
