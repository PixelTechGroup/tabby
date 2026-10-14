import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import pug from 'pug'
import {
    normalizeSyncHost,
    performSyncRequest,
    resolveSyncHostLink,
    stripTrailingSlashes,
    SyncHostNotConfiguredError,
} from '../src/services/configSyncRequest.ts'
import {
    ConfigSyncConnection,
    hasSyncCredentials,
} from '../src/services/configSyncConnection.ts'

const templateURL = new URL('../src/components/configSyncSettingsTab.component.pug', import.meta.url)
const workflowURL = new URL('../../.github/workflows/build.yml', import.meta.url)
const packageURL = new URL('../../package.json', import.meta.url)

function createLogger () {
    const debug: any[][] = []
    const error: any[][] = []
    return {
        debug,
        error,
        logger: {
            debug: (...args: any[]) => debug.push(args),
            error: (...args: any[]) => error.push(args),
        },
    }
}

describe('sync host validation', () => {
    it('rejects missing and blank hosts with the dedicated error', () => {
        for (const host of [null, undefined, '', '   ']) {
            assert.throws(() => normalizeSyncHost(host), SyncHostNotConfiguredError)
        }
    })

    it('rejects plaintext HTTP', () => {
        assert.throws(
            () => normalizeSyncHost('http://sync.example.com'),
            /Config sync host must use HTTPS \(got: http:\/\/sync\.example\.com\)/,
        )
    })

    it('trims an HTTPS host and removes a trailing slash', () => {
        assert.equal(normalizeSyncHost('  https://sync.example.com/  '), 'https://sync.example.com')
    })

    it('removes every trailing slash without altering a path suffix', () => {
        assert.equal(stripTrailingSlashes('https://sync.example.com/path///'), 'https://sync.example.com/path')
        assert.equal(normalizeSyncHost('https://sync.example.com///'), 'https://sync.example.com')
    })

    it('requires non-whitespace host and token values', () => {
        assert.equal(hasSyncCredentials('https://sync.example.com', 'token'), true)
        assert.equal(hasSyncCredentials('   ', 'token'), false)
        assert.equal(hasSyncCredentials('https://sync.example.com', '\n\t'), false)
    })
})

describe('sync host links', () => {
    it('maps the hosted API to the hosted web application', () => {
        assert.equal(resolveSyncHostLink('https://api.tabby.sh'), 'https://app.tabby.sh')
    })

    it('maps any hosted API trailing-slash variant', () => {
        assert.equal(resolveSyncHostLink('https://api.tabby.sh/'), 'https://app.tabby.sh')
        assert.equal(resolveSyncHostLink('https://api.tabby.sh///'), 'https://app.tabby.sh')
    })

    it('passes a self-hosted URL through after trimming whitespace', () => {
        assert.equal(resolveSyncHostLink('  https://sync.example.com/path/  '), 'https://sync.example.com/path/')
    })

    it('returns null for an empty or missing host', () => {
        assert.equal(resolveSyncHostLink(null), null)
        assert.equal(resolveSyncHostLink('   '), null)
    })
})

describe('sync requests', () => {
    it('does not fetch or log an error when the host is missing', async () => {
        let fetches = 0
        const { logger, error } = createLogger()
        await assert.rejects(
            performSyncRequest('GET', '/api/1/user', {
                host: null,
                token: null,
                logger,
                fetchImpl: async () => {
                    fetches++
                    return new Response('{}')
                },
            }),
            SyncHostNotConfiguredError,
        )
        assert.equal(fetches, 0)
        assert.equal(error.length, 0)
    })

    it('does not fetch an insecure host', async () => {
        let fetches = 0
        await assert.rejects(
            performSyncRequest('GET', '/api/1/user', {
                host: 'http://sync.example.com',
                token: 'token',
                fetchImpl: async () => {
                    fetches++
                    return new Response('{}')
                },
            }),
            /must use HTTPS/,
        )
        assert.equal(fetches, 0)
    })

    it('normalizes the URL and sends bearer authentication', async () => {
        let requestedURL = ''
        let authorization = ''
        const result = await performSyncRequest('GET', '/api/1/user', {
            host: 'https://sync.example.com/',
            token: 'secret-token',
            fetchImpl: async (input, init) => {
                requestedURL = String(input)
                authorization = new Headers(init?.headers).get('Authorization') ?? ''
                return new Response('{"id": 1}', { status: 200 })
            },
        })
        assert.equal(requestedURL, 'https://sync.example.com/api/1/user')
        assert.equal(authorization, 'Bearer secret-token')
        assert.deepEqual(result, { id: 1 })
    })

    it('preserves the existing non-success error format', async () => {
        await assert.rejects(
            performSyncRequest('GET', '/api/1/user', {
                host: 'https://sync.example.com',
                token: 'token',
                fetchImpl: async () => new Response('', { status: 401, statusText: 'Unauthorized' }),
            }),
            /GET https:\/\/sync\.example\.com\/api\/1\/user failed: 401 Unauthorized/,
        )
    })

    it('accepts a successful empty response body', async () => {
        const result = await performSyncRequest('DELETE', '/api/1/configs/1', {
            host: 'https://sync.example.com',
            token: 'token',
            fetchImpl: async () => new Response(null, { status: 204 }),
        })
        assert.equal(result, undefined)
    })

    it('serializes POST data as JSON', async () => {
        let body: BodyInit|null|undefined
        let contentType = ''
        let authorization = ''
        await performSyncRequest('POST', '/api/1/configs', {
            host: 'https://sync.example.com',
            token: 'token',
            data: { name: 'Laptop' },
            fetchImpl: async (_input, init) => {
                body = init?.body
                const headers = new Headers(init?.headers)
                contentType = headers.get('Content-Type') ?? ''
                authorization = headers.get('Authorization') ?? ''
                return new Response('{"id": 2}', { status: 200 })
            },
        })
        assert.equal(body, JSON.stringify({ name: 'Laptop' }))
        assert.equal(contentType, 'application/json')
        assert.equal(authorization, 'Bearer token')
    })
})

describe('connection state', () => {
    function createConnection (failure: Error|null = null) {
        const calls: string[] = []
        const connection = new ConfigSyncConnection({
            getUser: async () => {
                calls.push('getUser')
                if (failure) {
                    throw failure
                }
                return { id: 1 }
            },
            getConfigs: async () => {
                calls.push('getConfigs')
                return [{ id: 2 }]
            },
        })
        return { calls, connection }
    }

    it('quietly initializes without complete credentials', async () => {
        const { calls, connection } = createConnection()
        await connection.init(null, null)
        assert.deepEqual(calls, [])
        assert.equal(connection.connectionSuccessful, null)
    })

    it('tests the user before loading configurations', async () => {
        const { calls, connection } = createConnection()
        await connection.testConnection('https://sync.example.com', 'token')
        assert.deepEqual(calls, ['getUser', 'getConfigs'])
        assert.equal(connection.connectionSuccessful, true)
        assert.deepEqual(connection.configs, [{ id: 2 }])
    })

    it('does not load configurations after a failed user request', async () => {
        const failure = new Error('401')
        const { calls, connection } = createConnection(failure)
        await connection.testConnection('https://sync.example.com', 'token')
        assert.deepEqual(calls, ['getUser'])
        assert.equal(connection.connectionSuccessful, false)
        assert.equal(connection.connectionError, failure)
        assert.equal(connection.configs, null)
    })

    it('does not load configurations before a successful connection', async () => {
        const { calls, connection } = createConnection()
        await connection.loadConfigs()
        assert.deepEqual(calls, [])
        assert.equal(connection.configs, null)
    })

    it('clears successful state when the host is removed without networking', async () => {
        const { calls, connection } = createConnection()
        await connection.testConnection('https://sync.example.com', 'token')
        const priorCalls = [...calls]
        connection.syncCredentials('', 'token')
        assert.deepEqual(calls, priorCalls)
        assert.equal(connection.connectionSuccessful, null)
        assert.equal(connection.configs, null)
    })

    it('clears state when the token is removed or a test is retried incomplete', async () => {
        const { calls, connection } = createConnection()
        await connection.testConnection('https://sync.example.com', 'token')
        const priorCalls = [...calls]
        connection.syncCredentials('https://sync.example.com', '   ')
        await connection.testConnection('https://sync.example.com', '   ')
        assert.deepEqual(calls, priorCalls)
        assert.equal(connection.connectionSuccessful, null)
        assert.equal(connection.connectionError, null)
    })
})

describe('settings UI and CI wiring', () => {
    it('contains the explicit URL label, HTTPS guidance, and blur-save bindings', async () => {
        const source = await readFile(templateURL, 'utf8')
        assert.match(source, /\.title\(translate\) Sync server URL/)
        assert.match(source, /placeholder='https:\/\/sync\.example\.com'/)
        assert.match(source, /Must use HTTPS\./)
        assert.match(source, /\*ngIf='isInsecureHost'/)
        assert.match(source, /\[ngModelOptions\]="\{updateOn: 'blur'\}"/)
        assert.match(source, /#hostInput/)
        assert.match(source, /hostInput\.blur\(\)/)
    })

    it('uses self-hosted wording and compiles as Pug', async () => {
        const source = await readFile(templateURL, 'utf8')
        assert.doesNotMatch(source, /requires an instance of the Tabby Web service/)
        assert.match(source, /self-hosted Tabby Sync server/)
        assert.doesNotThrow(() => pug.compile(source, { filename: templateURL.pathname }))
    })

    it('runs the focused suite from package scripts and CI', async () => {
        const pkg = JSON.parse(await readFile(packageURL, 'utf8'))
        const workflow = await readFile(workflowURL, 'utf8')
        assert.match(pkg.scripts['test:config-sync'], /--experimental-transform-types/)
        assert.match(workflow, /yarn run test:config-sync/)
    })
})
