export function hasSyncCredentials (host: unknown, token: unknown): boolean {
    return typeof host === 'string' && host.trim() !== '' &&
        typeof token === 'string' && token.trim() !== ''
}

export interface ConfigSyncAPI<TConfig> {
    getUser: () => Promise<any>
    getConfigs: () => Promise<TConfig[]>
}

export class ConfigSyncConnection<TConfig> {
    connectionSuccessful: boolean|null = null
    connectionError: Error|null = null
    configs: TConfig[]|null = null

    constructor (private api: ConfigSyncAPI<TConfig>) { }

    reset (): void {
        this.connectionSuccessful = null
        this.connectionError = null
        this.configs = null
    }

    syncCredentials (host: unknown, token: unknown): void {
        if (!hasSyncCredentials(host, token)) {
            this.reset()
        }
    }

    async init (host: unknown, token: unknown): Promise<void> {
        await this.testConnection(host, token)
    }

    async testConnection (host: unknown, token: unknown): Promise<void> {
        if (!hasSyncCredentials(host, token)) {
            this.reset()
            return
        }

        this.reset()
        try {
            await this.api.getUser()
            this.connectionSuccessful = true
            await this.loadConfigs()
        } catch (error) {
            this.connectionSuccessful = false
            this.connectionError = error instanceof Error ? error : new Error(String(error))
            this.configs = null
        }
    }

    async loadConfigs (): Promise<void> {
        if (this.connectionSuccessful !== true) {
            return
        }
        this.configs = await this.api.getConfigs()
    }
}
