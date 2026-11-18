import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import {
    AGENT_SOCKET_PROBE_TIMEOUT_MS,
    describeAgentAuthFailure,
    detectBitwardenAgentSocket,
    getBitwardenAgentSocketPaths,
    isConnectableUnixSocket,
    probeAgentSocket,
    selectAgentSocket,
} from '../src/session/bitwardenAgent.ts'

const HOME = '/home/tester'
const NATIVE_SOCKET = '/home/tester/.bitwarden-ssh-agent.sock'
const FLATPAK_SOCKET = '/home/tester/.var/app/com.bitwarden.desktop/data/.bitwarden-ssh-agent.sock'
const SNAP_SOCKET = '/home/tester/snap/bitwarden/current/.bitwarden-ssh-agent.sock'
const ENV_SOCKET = '/run/user/1000/keyring/ssh'

type Probe = (socketPath: string) => Promise<boolean>

function candidates (overrides: Partial<{
    configuredPath: string,
    envPath: string,
    homeDir: string,
    isLinux: boolean,
}> = {}) {
    return {
        configuredPath: '',
        envPath: '',
        homeDir: HOME,
        isLinux: true,
        ...overrides,
    }
}

function missing (): Error {
    return Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
}

const linuxOnly = process.platform === 'linux' ? {} : { skip: 'requires Linux Unix sockets' }

function makeTempDir (): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'tabby-agent-'))
}

interface AgentServer {
    server: net.Server
    sockets: Set<net.Socket>
}

async function listenOn (
    socketPath: string,
    onConnection?: (socket: net.Socket) => void,
): Promise<AgentServer> {
    const sockets = new Set<net.Socket>()
    const server = net.createServer(socket => {
        sockets.add(socket)
        socket.once('close', () => sockets.delete(socket))
        onConnection?.(socket)
    })
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(socketPath, () => resolve())
    })
    return { server, sockets }
}

async function closeServer (agentServer: AgentServer): Promise<void> {
    for (const socket of agentServer.sockets) {
        socket.destroy()
    }
    await new Promise<void>(resolve => agentServer.server.close(() => resolve()))
}

describe('Bitwarden SSH agent discovery', () => {
    it('checks the native socket before the sandboxed package sockets', () => {
        assert.deepEqual(getBitwardenAgentSocketPaths(HOME), [
            NATIVE_SOCKET,
            FLATPAK_SOCKET,
            SNAP_SOCKET,
        ])
    })

    it('returns the live native socket and stops probing', async () => {
        const probed: string[] = []
        const detected = await detectBitwardenAgentSocket(HOME, async socketPath => {
            probed.push(socketPath)
            if (socketPath === NATIVE_SOCKET) {
                return true
            }
            throw missing()
        })

        assert.equal(detected, NATIVE_SOCKET)
        assert.deepEqual(probed, [NATIVE_SOCKET])
    })

    it('falls through a stale Flatpak socket to the live Snap socket', async () => {
        const probed: string[] = []
        const detected = await detectBitwardenAgentSocket(HOME, async socketPath => {
            probed.push(socketPath)
            if (socketPath === FLATPAK_SOCKET) {
                return false // The Flatpak socket file exists but its listener is gone.
            }
            if (socketPath === SNAP_SOCKET) {
                return true
            }
            throw missing() // The native package is not installed.
        })

        assert.equal(detected, SNAP_SOCKET)
        assert.deepEqual(probed, [NATIVE_SOCKET, FLATPAK_SOCKET, SNAP_SOCKET])
    })

    it('returns null when the only Bitwarden socket file is stale', async () => {
        const probed: string[] = []
        const detected = await detectBitwardenAgentSocket(HOME, async socketPath => {
            probed.push(socketPath)
            return false // every socket file exists, nothing answers
        })

        assert.equal(detected, null)
        assert.deepEqual(probed, [NATIVE_SOCKET, FLATPAK_SOCKET, SNAP_SOCKET])
    })

    it('continues past sockets that do not exist', async () => {
        const detected = await detectBitwardenAgentSocket(HOME, async socketPath => {
            if (socketPath === SNAP_SOCKET) {
                return true
            }
            throw missing()
        })

        assert.equal(detected, SNAP_SOCKET)
    })
})

describe('SSH agent socket selection', () => {
    it('uses an explicitly configured path without probing anything', async () => {
        const probed: string[] = []
        const selected = await selectAgentSocket(
            candidates({ configuredPath: '/custom/agent.sock', envPath: ENV_SOCKET }),
            async socketPath => {
                probed.push(socketPath)
                return true
            },
        )

        assert.deepEqual(selected, {
            path: '/custom/agent.sock',
            source: 'configured',
        })
        assert.deepEqual(probed, [])
    })

    it('prefers a live Bitwarden agent over a working SSH_AUTH_SOCK', async () => {
        // SSH_AUTH_SOCK being connectable only means some agent is listening -
        // it is routinely gnome-keyring or another wrapper holding a different,
        // usually smaller, set of identities than Bitwarden. Bitwarden must win
        // whenever it is actually reachable, and env is never even probed.
        const probed: string[] = []
        const selected = await selectAgentSocket(candidates({ envPath: ENV_SOCKET }), async socketPath => {
            probed.push(socketPath)
            return socketPath === ENV_SOCKET || socketPath === NATIVE_SOCKET
        })

        assert.deepEqual(selected, {
            path: NATIVE_SOCKET,
            source: 'bitwarden',
        })
        assert.deepEqual(probed, [NATIVE_SOCKET])
    })

    it('falls back to Bitwarden when SSH_AUTH_SOCK is stale', async () => {
        const selected = await selectAgentSocket(candidates({ envPath: ENV_SOCKET }), async socketPath => {
            return socketPath === NATIVE_SOCKET
        })

        assert.deepEqual(selected, {
            path: NATIVE_SOCKET,
            source: 'bitwarden',
        })
    })

    it('uses a live Bitwarden agent when SSH_AUTH_SOCK is not set', async () => {
        const selected = await selectAgentSocket(candidates(), async socketPath => {
            return socketPath === NATIVE_SOCKET
        })

        assert.deepEqual(selected, {
            path: NATIVE_SOCKET,
            source: 'bitwarden',
        })
    })

    it('returns null when there is no agent at all', async () => {
        const selected = await selectAgentSocket(candidates(), async socketPath => {
            if (socketPath.startsWith(HOME)) {
                throw missing()
            }
            return false
        })

        assert.equal(selected, null)
    })

    it('keeps the stale SSH_AUTH_SOCK path so the failure names it', async () => {
        const selected = await selectAgentSocket(candidates({ envPath: ENV_SOCKET }), async socketPath => {
            if (socketPath.startsWith(HOME)) {
                throw missing()
            }
            return false
        })

        assert.deepEqual(selected, {
            path: ENV_SOCKET,
            source: 'env',
        })
    })

    it('does not auto-detect Bitwarden off Linux', async () => {
        const selected = await selectAgentSocket(candidates({ isLinux: false }), async socketPath => {
            return socketPath === NATIVE_SOCKET
        })

        assert.equal(selected, null)
    })

    it('does not cache the selection between connections', async () => {
        let bitwardenIsUsable = false
        const probe: Probe = async socketPath => {
            if (socketPath === NATIVE_SOCKET) {
                return bitwardenIsUsable
            }
            return socketPath === ENV_SOCKET
        }

        assert.deepEqual(await selectAgentSocket(candidates({ envPath: ENV_SOCKET }), probe), {
            path: ENV_SOCKET,
            source: 'env',
        })

        // Bitwarden starts up - the next connection must prefer it over the
        // environment socket that was already working, not keep using env.
        bitwardenIsUsable = true

        assert.deepEqual(await selectAgentSocket(candidates({ envPath: ENV_SOCKET }), probe), {
            path: NATIVE_SOCKET,
            source: 'bitwarden',
        })
    })
})

async function makeStaleSocket (socketPath: string): Promise<void> {
    const boundPath = `${socketPath}.bound`
    const agentServer = await listenOn(boundPath)
    try {
        // Keep the socket file after closing the listener, which is the state a
        // crashed or uninstalled agent leaves behind.
        fs.renameSync(boundPath, socketPath)
    } finally {
        await closeServer(agentServer)
    }
}

describe('Agent socket selection with the real probe', { timeout: 10_000 }, () => {
    it('selects a live environment socket without sending agent requests', linuxOnly, async () => {
        const dir = makeTempDir()
        try {
            const envPath = path.join(dir, 'env.sock')
            let receivedBytes = 0
            const agentServer = await listenOn(envPath, socket => {
                socket.on('data', chunk => {
                    receivedBytes += chunk.length
                })
            })
            try {
                const selected = await selectAgentSocket(
                    candidates({ envPath, homeDir: path.join(dir, 'home') }),
                    probeAgentSocket,
                )

                assert.deepEqual(selected, { path: envPath, source: 'env' })
                await new Promise(resolve => setTimeout(resolve, 50))
                assert.equal(receivedBytes, 0)
            } finally {
                await closeServer(agentServer)
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('falls back from a stale environment socket to a live native Bitwarden socket', linuxOnly, async () => {
        const dir = makeTempDir()
        try {
            const homeDir = path.join(dir, 'home')
            fs.mkdirSync(homeDir)
            const envPath = path.join(dir, 'env.sock')
            const nativePath = path.join(homeDir, '.bitwarden-ssh-agent.sock')

            await makeStaleSocket(envPath)
            const agentServer = await listenOn(nativePath)
            try {
                assert.deepEqual(
                    await selectAgentSocket(candidates({ envPath, homeDir }), probeAgentSocket),
                    { path: nativePath, source: 'bitwarden' },
                )
            } finally {
                await closeServer(agentServer)
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('skips a stale Flatpak socket in favor of a live Snap socket', linuxOnly, async () => {
        const dir = makeTempDir()
        try {
            const homeDir = path.join(dir, 'home')
            const flatpakDir = path.join(homeDir, '.var/app/com.bitwarden.desktop/data')
            const snapDir = path.join(homeDir, 'snap/bitwarden/current')
            fs.mkdirSync(flatpakDir, { recursive: true })
            fs.mkdirSync(snapDir, { recursive: true })

            const flatpakPath = path.join(flatpakDir, '.bitwarden-ssh-agent.sock')
            const snapPath = path.join(snapDir, '.bitwarden-ssh-agent.sock')

            await makeStaleSocket(flatpakPath)
            const agentServer = await listenOn(snapPath)
            try {
                assert.deepEqual(
                    await selectAgentSocket(candidates({ homeDir }), probeAgentSocket),
                    { path: snapPath, source: 'bitwarden' },
                )
            } finally {
                await closeServer(agentServer)
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('uses the live environment socket off Linux', linuxOnly, async () => {
        const dir = makeTempDir()
        try {
            const envPath = path.join(dir, 'env.sock')
            const nativePath = path.join(dir, '.bitwarden-ssh-agent.sock')
            const envServer = await listenOn(envPath)
            try {
                const nativeServer = await listenOn(nativePath)
                try {
                    assert.deepEqual(
                        await selectAgentSocket(candidates({ envPath, homeDir: dir, isLinux: false }), probeAgentSocket),
                        { path: envPath, source: 'env' },
                    )
                } finally {
                    await closeServer(nativeServer)
                }
            } finally {
                await closeServer(envServer)
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('retains the unusable environment socket instead of detecting Bitwarden off Linux', linuxOnly, async () => {
        const dir = makeTempDir()
        try {
            const nativePath = path.join(dir, '.bitwarden-ssh-agent.sock')
            const envPath = path.join(dir, 'missing.sock')
            const agentServer = await listenOn(nativePath)
            try {
                assert.deepEqual(
                    await selectAgentSocket(
                        candidates({ envPath, homeDir: dir, isLinux: false }),
                        probeAgentSocket,
                    ),
                    { path: envPath, source: 'env' },
                )
            } finally {
                await closeServer(agentServer)
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('passes abstract environment sockets through without probing them', async () => {
        assert.equal(await probeAgentSocket('@tabby-review-missing-agent'), true)

        assert.deepEqual(
            await selectAgentSocket(
                candidates({ envPath: '@tabby-review-missing-agent', isLinux: false }),
                probeAgentSocket,
            ),
            { path: '@tabby-review-missing-agent', source: 'env' },
        )
    })
})

describe('Agent authentication failure reporting', () => {
    it('names the Unix socket, the identity and the underlying error', () => {
        const message = describeAgentAuthFailure(
            { kind: 'unix-socket', path: NATIVE_SOCKET },
            new Error('IO(Os { code: 111, kind: ConnectionRefused })'),
            'SHA256:abc123',
        )

        assert.equal(
            message,
            `Failed to authenticate using agent at ${NATIVE_SOCKET} with identity SHA256:abc123: ` +
            'Error: IO(Os { code: 111, kind: ConnectionRefused })',
        )
    })

    it('names a named pipe without inventing an identity', () => {
        const message = describeAgentAuthFailure(
            { kind: 'named-pipe', path: '\\\\.\\pipe\\openssh-ssh-agent' },
            new Error('EPIPE'),
        )

        assert.equal(message, 'Failed to authenticate using agent at \\\\.\\pipe\\openssh-ssh-agent: Error: EPIPE')
    })

    it('describes Pageant without a socket path', () => {
        const message = describeAgentAuthFailure({ kind: 'pageant' }, new Error('Pageant not running'))

        assert.equal(message, 'Failed to authenticate using Pageant: Error: Pageant not running')
    })
})

describe('Unix socket probing', { timeout: 10_000 }, () => {
    it('bounds the wait for a wedged socket', async t => {
        assert.ok(AGENT_SOCKET_PROBE_TIMEOUT_MS > 0)
        assert.ok(AGENT_SOCKET_PROBE_TIMEOUT_MS <= 2000)

        const timeoutMs = 25
        const deadlineMs = 1000
        const captured: { socket?: net.Socket } = {}
        const probeListeners: ((...args: any[]) => void)[] = []
        const timeoutEvents: string[] = []

        // Keep the real Socket.setTimeout() and timeout event, but suppress the
        // connection so that neither connect nor error can settle the probe.
        t.mock.method(net.Socket.prototype, 'connect', function (this: net.Socket) {
            captured.socket = this
            for (const event of ['connect', 'error', 'timeout']) {
                probeListeners.push(...this.listeners(event))
            }
            const emit = this.emit.bind(this)
            t.mock.method(this, 'emit', function (this: net.Socket, event: string, ...args: any[]) {
                if (event === 'timeout') {
                    timeoutEvents.push(event)
                }
                return emit(event, ...args)
            })
            return this
        })

        // Socket timeouts are unref'd. Without a real connection handle Node 22
        // can exit before they fire; the test-runner timeout is also unref'd.
        // This finite failure deadline supplies the missing reference and fails
        // explicitly if the production timeout never settles. It is not a sleep.
        let deadline: ReturnType<typeof setTimeout>|undefined = undefined
        const failureDeadline = new Promise<never>((resolve, reject) => {
            deadline = setTimeout(() => reject(new Error(`socket probe did not settle within ${deadlineMs}ms`)), deadlineMs)
        })

        try {
            const startedAt = performance.now()
            const usable = await Promise.race([
                isConnectableUnixSocket('/tmp/never-connects.sock', timeoutMs),
                failureDeadline,
            ])
            const elapsed = performance.now() - startedAt

            assert.equal(usable, false)
            assert.ok(elapsed >= timeoutMs - 5, `probe returned after ${elapsed}ms, before its timeout`)
            assert.ok(elapsed < deadlineMs, `probe took ${elapsed}ms`)
            assert.deepEqual(timeoutEvents, ['timeout'])
            const socket = captured.socket
            assert.ok(socket)
            assert.equal(socket.destroyed, true)
            assert.equal(socket.listenerCount('connect'), 0)
            assert.equal(socket.listenerCount('timeout'), 0)
            // Production deliberately leaves one no-op error handler to absorb
            // late errors after destruction, but none of the probe callbacks.
            assert.equal(socket.listenerCount('error'), 1)
            for (const event of socket.eventNames()) {
                assert.ok(socket.listeners(event).every(listener => !probeListeners.includes(listener)))
            }
        } finally {
            clearTimeout(deadline)
            captured.socket?.destroy()
        }
    })

    it('accepts a live agent socket without sending agent requests', linuxOnly, async () => {
        const dir = makeTempDir()
        try {
            const socketPath = path.join(dir, 'agent.sock')
            let receivedBytes = 0
            const agentServer = await listenOn(socketPath, socket => {
                socket.on('data', chunk => {
                    receivedBytes += chunk.length
                })
            })
            try {
                assert.equal(await isConnectableUnixSocket(socketPath), true)

                // Give a stray write time to arrive before asserting that none was sent.
                await new Promise(resolve => setTimeout(resolve, 50))
                assert.equal(receivedBytes, 0)
            } finally {
                await closeServer(agentServer)
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('rejects an existing socket file whose listener is gone', linuxOnly, async () => {
        const dir = makeTempDir()
        try {
            const stalePath = path.join(dir, 'stale.sock')
            await makeStaleSocket(stalePath)

            // The old fs.stat().isSocket() check accepted this file.
            assert.equal(fs.statSync(stalePath).isSocket(), true)
            assert.equal(await isConnectableUnixSocket(stalePath), false)
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('rejects missing paths and regular files', linuxOnly, async () => {
        const dir = makeTempDir()
        try {
            const missingPath = path.join(dir, 'missing.sock')
            const regularPath = path.join(dir, 'not-a-socket')
            fs.writeFileSync(regularPath, '')

            assert.equal(await isConnectableUnixSocket(missingPath), false)
            assert.equal(await isConnectableUnixSocket(regularPath), false)
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
})
