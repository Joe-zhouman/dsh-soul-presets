/**
 * Preset default models: resolving one preset's `[Model]` table against the
 * live model registry, and installing it as the Session's own selection.
 *
 * The installation goes through the Session Controller's session-local entry
 * point (`selectForNextRequest`): it appends the durable `model/selection`
 * event the composer's model picker reads and moves the live Agent's selection,
 * which is exactly what the model picker itself does — minus persisting the
 * deployment default. `session.selectModel` is not used because it also writes
 * the profile's default model, and a preset default must not move the
 * deployment default for every other preset.
 *
 * That entry point is an internal field of the Session Controller rather than a
 * published service method. A missing one is reported once at application time
 * and leaves the session on its current model; nothing else breaks.
 * @module dsh-soul-presets/src/models
 */
import { SESSION_ID } from './selection.mjs'

/**
 * One preset's model route as the preset file declares it.
 * @typedef {object} PresetModel
 * @property {string} provider - registered provider route.
 * @property {string} model - provider-owned model id.
 * @property {string} [reasoningEffort] - adapter-owned effort, when the preset pins one.
 */

/**
 * The one-line label the UI and logs use for a model spec.
 * @param {PresetModel} spec - the declared route.
 * @returns the `provider/model` label, with the effort appended when pinned.
 */
export function modelLabel(spec) {
  const effort = spec.reasoningEffort === undefined ? '' : ` (${spec.reasoningEffort})`
  return `${spec.provider}/${spec.model}${effort}`
}

/**
 * Whether a session has neither used a model nor chosen one yet — the sessions a
 * preset default may adopt. A logged request header means the conversation
 * already ran on some model; a recorded selection means the user (or an earlier
 * preset application) already had a say. Both are left alone.
 * @param projections - the Session projection registry.
 * @param session - the Session to inspect.
 * @returns true only for a session with no model history at all.
 */
export function isFreshSession(projections, session) {
  if (session.requestHeader() !== undefined) return false
  const state = projections?.stateOf?.(session, 'modelSelection')
  return state !== undefined && state.pending === null && state.lastUsed === null
}

/**
 * Create the applier the host half and its routes share.
 * @param deps - live Agent lookup, the Session Controller, the LLM registry,
 * the Session projection registry, and a logger.
 * @returns the applier with its `apply` operation.
 */
export function createModelApplier({ agents, controller, llm, projections, log }) {
  /**
   * The Session's next selection, as the model picker would show it.
   * @param session - the Session to read.
   * @returns the selection, or null before any is recorded.
   */
  const currentOf = session => {
    const state = projections?.stateOf?.(session, 'modelSelection')
    return state === undefined ? null : state.pending ?? state.lastUsed
  }

  /**
   * Whether the recorded selection already names the resolved route. An effort
   * the preset does not pin never makes a route different.
   * @param current - the recorded selection, or null.
   * @param next - the resolved selection.
   * @returns true when applying would change nothing.
   */
  const sameRoute = (current, next) => current !== null
    && current.provider === next.provider
    && current.model === next.model
    && (next.reasoningEffort === undefined || current.reasoningEffort === next.reasoningEffort)

  return {
    /**
     * Resolve one preset's model and install it on a live Session.
     * @param sessionId - the ordinary Session to switch.
     * @param spec - the preset's declared route.
     * @param options - `force` installs even when the route is already current
     * (a fresh Session records its starting model rather than merely matching it).
     * @returns what happened: `applied`, `unchanged`, `session-not-live`, or
     * `controller-unavailable`. Throws when the registry rejects the route.
     */
    async apply(sessionId, spec, { force = false } = {}) {
      if (!SESSION_ID.test(sessionId)) return { status: 'not-an-ordinary-session' }
      const agent = agents?.get?.(sessionId)
      if (agent === undefined) return { status: 'session-not-live' }
      const resolved = await llm.resolveCallConfig({
        provider: spec.provider,
        model: spec.model,
        ...spec.reasoningEffort === undefined ? {} : { reasoningEffort: spec.reasoningEffort },
      })
      const selection = {
        provider: resolved.provider,
        model: resolved.model,
        ...resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort },
      }
      if (!force && sameRoute(currentOf(agent.session), selection)) return { status: 'unchanged', selection }
      const entry = controller?.agents
      if (typeof entry?.selectForNextRequest !== 'function') {
        log('soul-presets: the Session Controller does not expose selectForNextRequest; preset model defaults are inert')
        return { status: 'controller-unavailable' }
      }
      entry.selectForNextRequest(agent, selection)
      return { status: 'applied', selection }
    },
  }
}
