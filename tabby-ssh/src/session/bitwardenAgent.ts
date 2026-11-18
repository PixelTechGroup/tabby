import * as path from 'path'
import { Socket } from 'net'

export type AgentSocketProbe = (socketPath: string) => Promise<boolean>

export type AgentSocketSource = 'configured'|'env'|'bitwarden'

export interface AgentSocketSelection {
    path: string
    source: AgentSocketSource
}

export interface AgentSocketCandidates {
    configuredPath: string
    envPath: string
    homeDir: string
    isLinux: boolean
}

/**
 * How long a probe may wait for a Unix socket to accept a connection before the
 * socket is considered unusable. Connecting to a local agent is immediate, so
 * this only matters for a socket that is wedged.
 */
export const AGENT_SOCKET_PROBE_TIMEOUT_MS = 500

/**
 * Native packages keep the socket in the home directory, sandboxed packages in
 * their own data directories. The native socket comes first: a leftover socket
 * from an old Flatpak install must never shadow the current agent.
 */
export function getBitwardenAgentSocketPaths (homeDir: string): string[] {
    return [
        path.join(homeDir, '.bitwarden-ssh-agent.sock'),
        path.join(homeDir, '.var/app/com.bitwarden.desktop/data/.bitwarden-ssh-agent.sock'),
        path.join(homeDir, 'snap/bitwarden/current/.bitwarden-ssh-agent.sock'),
    ]
}

/**
 * A socket file left behind by an agent that has exited or was uninstalled is
 * still reported by fs.stat() as a Unix socket, but nothing accepts connections
 * on it. Connecting is the only reliable liveness check: a stale file fails
 * immediately with ECONNREFUSED.
 *
 * The probe never writes to the socket - no agent requests are sent - and closes
 * the connection as soon as the outcome is known.
 */
export async function isConnectableUnixSocket (
    socketPath: string,
    timeoutMs = AGENT_SOCKET_PROBE_TIMEOUT_MS,
): Promise<boolean> {
    return new Promise<boolean>(resolve => {
        const socket = new Socket()
        let settled = false

        const finish = (result: boolean): void => {
            if (settled) {
                return
            }
            settled = true
            socket.removeAllListeners()
            socket.on('error', () => undefined)
            socket.destroy()
            resolve(result)
        }

        socket.setTimeout(timeoutMs, () => finish(false))
        socket.once('error', () => finish(false))
        socket.once('connect', () => finish(true))
        try {
            socket.connect(socketPath)
        } catch {
            finish(false)
        }
    })
}

/**
 * Liveness probe used by agent auto-detection. Abstract namespace sockets are
 * accepted without a connection attempt, preserving the existing handling for
 * environments that export `@name` style addresses.
 */
export function probeAgentSocket (socketPath: string): Promise<boolean> {
    if (socketPath.startsWith('@')) {
        return Promise.resolve(true)
    }
    return isConnectableUnixSocket(socketPath)
}

export async function detectBitwardenAgentSocket (
    homeDir: string,
    isUsable: AgentSocketProbe,
): Promise<string|null> {
    for (const socketPath of getBitwardenAgentSocketPaths(homeDir)) {
        try {
            if (await isUsable(socketPath)) {
                return socketPath
            }
        } catch {
            // This Bitwarden package type is not installed or its agent is disabled.
        }
    }
    return null
}

/**
 * Picks the agent socket to use. Nothing is cached, so an agent that is
 * restarted, enabled or moved between connections is picked up by the next
 * session.
 */
export async function selectAgentSocket (
    candidates: AgentSocketCandidates,
    isUsable: AgentSocketProbe,
): Promise<AgentSocketSelection|null> {
    if (candidates.configuredPath) {
        return {
            path: candidates.configuredPath,
            source: 'configured',
        }
    }

    // Prefer a live Bitwarden agent over whatever the session environment
    // happens to export. SSH_AUTH_SOCK being connectable only means some agent
    // is listening - on Linux desktops it is routinely gnome-keyring, gpg-agent
    // or another wrapper that answers but holds a different, and usually
    // smaller, set of identities than Bitwarden. Picking it anyway makes every
    // key that only lives in Bitwarden fail with "all keys offered were
    // rejected" while keys that happen to exist in both agents keep working,
    // which is confusing to diagnose. Bitwarden is the agent the user asked for,
    // so it wins whenever it is actually reachable.
    if (candidates.isLinux) {
        const bitwardenSocketPath = await detectBitwardenAgentSocket(candidates.homeDir, isUsable)
        if (bitwardenSocketPath) {
            return {
                path: bitwardenSocketPath,
                source: 'bitwarden',
            }
        }
    }

    if (candidates.envPath && await isUsable(candidates.envPath)) {
        return {
            path: candidates.envPath,
            source: 'env',
        }
    }

    // Fall back to the environment path even though it did not answer the probe,
    // so that the failure names the endpoint that was tried instead of claiming
    // that no agent is configured.
    if (candidates.envPath) {
        return {
            path: candidates.envPath,
            source: 'env',
        }
    }

    return null
}

/**
 * Describes an agent authentication failure for the session log. Only the
 * endpoint and the public key fingerprint are included - never key material or
 * any other secret.
 */
export function describeAgentAuthFailure (
    agent: { kind: 'unix-socket'|'named-pipe'|'pageant', path?: string },
    error: unknown,
    identityFingerprint?: string,
): string {
    const target = agent.kind === 'pageant' ? 'Pageant' : `agent at ${agent.path ?? '(unknown path)'}`
    const identity = identityFingerprint ? ` with identity ${identityFingerprint}` : ''
    return `Failed to authenticate using ${target}${identity}: ${error}`
}
