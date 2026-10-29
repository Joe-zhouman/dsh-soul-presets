/**
 * The trust rule for this plugin's own routes.
 *
 * The shared `webServer` applies no authentication of its own: the process
 * token and `dsh-auth-*` cookie fence lives in the browser-auth layer, which
 * covers `GET /` and the `/api` channel only. A plugin route is therefore
 * outside the fence and must decide for itself.
 *
 * The deciding check is the Host header, not `Sec-Fetch-Site`: under DNS
 * rebinding the attacker's page resolves to a loopback address, so the browser
 * reports a same-origin request and that header arrives normally. This mirrors
 * the rule the harness uses for `/api` (client-connection's isTrustedApiRequest)
 * with its non-loopback authority branch dropped — this deployment binds
 * loopback only, and no seam exposes a trusted-host list to a plugin.
 * @module dsh-soul-presets/src/guard
 */

/** Loopback authorities, with an optional port. */
const LOOPBACK = /^(?:127(?:\.\d{1,3}){3}|localhost|\[::1\]|::1)(?::\d{1,5})?$/i

/**
 * Whether every octet of a dotted-quad Host name is in range. The shape regex
 * admits 1-3 digits per octet, so `127.999.999.999` would otherwise pass; the
 * header is client-supplied even though a browser cannot forge it.
 * @param host - the Host header value.
 * @returns true for a non-dotted-quad authority or one with in-range octets.
 */
function octetsInRange(host) {
  const name = host.split(':')[0] ?? ''
  const parts = name.split('.')
  if (parts.length !== 4) return true
  return parts.every(part => Number(part) <= 255)
}

/**
 * Whether one request may reach this plugin's routes.
 * @param headers - the request headers (`host` and optional `origin`).
 * @returns true only for a loopback Host whose Origin, when present, matches it.
 */
export function isTrustedLocalRequest(headers) {
  const host = headers.host
  if (typeof host !== 'string' || !LOOPBACK.test(host) || !octetsInRange(host)) return false
  const origin = headers.origin
  if (origin === undefined) return true
  if (typeof origin !== 'string') return false
  try {
    return new URL(origin).host === host
  } catch {
    // An Origin that is not a URL ("null" from a sandboxed frame, a malformed
    // header) is an opaque origin and is refused.
    return false
  }
}
