export type SyncRequestMethod = 'GET'|'POST'|'PATCH'|'DELETE'

export class SyncHostNotConfiguredError extends Error {
    constructor () {
        super('Config sync host is not configured')
        this.name = 'SyncHostNotConfiguredError'
    }
}

export interface SyncRequestLogger {
    debug: (...args: any[]) => void
    error: (...args: any[]) => void
}

export interface SyncRequestOptions {
    host: unknown
    token: unknown
    data?: any
    logger?: SyncRequestLogger
    fetchImpl?: typeof fetch
}

export function stripTrailingSlashes (host: string): string {
    return host.replace(/\/+$/, '')
}

export function normalizeSyncHost (host: unknown): string {
    if (typeof host !== 'string' || host.trim() === '') {
        throw new SyncHostNotConfiguredError()
    }

    const normalized = stripTrailingSlashes(host.trim())
    if (!/^https:\/\//i.test(normalized)) {
        throw new Error(`Config sync host must use HTTPS (got: ${normalized})`)
    }
    return normalized
}

export function resolveSyncHostLink (host: unknown): string|null {
    if (typeof host !== 'string' || host.trim() === '') {
        return null
    }

    const trimmed = host.trim()
    if (stripTrailingSlashes(trimmed).toLowerCase() === 'https://api.tabby.sh') {
        return 'https://app.tabby.sh'
    }
    return trimmed
}

export async function performSyncRequest (
    method: SyncRequestMethod,
    path: string,
    options: SyncRequestOptions,
): Promise<any> {
    const host = (() => {
        try {
            return normalizeSyncHost(options.host)
        } catch (error) {
            // A missing host is the normal state for a fresh profile and must not
            // produce an error log merely because the settings tab was opened.
            if (!(error instanceof SyncHostNotConfiguredError)) {
                options.logger?.error(error)
            }
            throw error
        }
    })()

    const url = host + path
    options.logger?.debug(`${method} ${url}`, options.data)

    try {
        const response = await (options.fetchImpl ?? fetch)(url, {
            method,
            headers: {
                Authorization: `Bearer ${String(options.token ?? '')}`,
                ...options.data !== undefined ? { 'Content-Type': 'application/json' } : {},
            },
            body: options.data !== undefined ? JSON.stringify(options.data) : undefined,
        })
        if (!response.ok) {
            throw new Error(`${method} ${url} failed: ${response.status} ${response.statusText}`)
        }
        options.logger?.debug(response)
        const text = await response.text()
        return text ? JSON.parse(text) : undefined
    } catch (error) {
        options.logger?.error(error)
        throw error
    }
}
