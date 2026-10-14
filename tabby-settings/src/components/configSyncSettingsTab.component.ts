/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, HostBinding } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent, ConfigService, PromptModalComponent, HostAppService, PlatformService, NotificationsService, TranslateService } from 'tabby-core'
import { Config, ConfigSyncService } from '../services/configSync.service'
import { ConfigSyncConnection } from '../services/configSyncConnection'
import { resolveSyncHostLink } from '../services/configSyncRequest'


/** @hidden */
@Component({
    selector: 'config-sync-settings-tab',
    templateUrl: './configSyncSettingsTab.component.pug',
})
export class ConfigSyncSettingsTabComponent extends BaseComponent {
    connection: ConfigSyncConnection<Config>

    @HostBinding('class.content-box') true

    constructor (
        public config: ConfigService,
        public platform: PlatformService,
        private configSync: ConfigSyncService,
        private hostApp: HostAppService,
        private ngbModal: NgbModal,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) {
        super()
        this.connection = new ConfigSyncConnection(configSync)
    }

    async ngOnInit () {
        await this.connection.init(
            this.config.store.configSync.host,
            this.config.store.configSync.token,
        )
    }

    async testConnection () {
        await this.connection.testConnection(
            this.config.store.configSync.host,
            this.config.store.configSync.token,
        )
    }

    async loadConfigs () {
        await this.connection.loadConfigs()
    }

    onCredentialsChanged () {
        this.connection.syncCredentials(
            this.config.store.configSync.host,
            this.config.store.configSync.token,
        )
    }

    get isInsecureHost () {
        const host = this.config.store.configSync.host
        return typeof host === 'string' && host.trim() !== '' && !/^https:\/\//i.test(host.trim())
    }

    async uploadAsNew () {
        let name = this.translate.instant('New config on {platform}', this.hostApp)
        const modal = this.ngbModal.open(PromptModalComponent)
        modal.componentInstance.prompt = this.translate.instant('Name for the new config')
        modal.componentInstance.value = name
        name = (await modal.result.catch(() => null))?.value
        if (!name) {
            return
        }
        const cfg = await this.configSync.createNewConfig(name)
        this.loadConfigs()
        this.configSync.setConfig(cfg)
        this.uploadAndSync(cfg)
    }

    async uploadAndSync (cfg: Config) {
        if (this.config.store.configSync.configID !== cfg.id) {
            if ((await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('Overwrite the config on the remote side and start syncing?'),
                buttons: [
                    this.translate.instant('Overwrite remote and sync'),
                    this.translate.instant('Cancel'),
                ],
                defaultId: 1,
                cancelId: 1,
            })).response === 1) {
                return
            }
        }
        this.configSync.setConfig(cfg)
        await this.configSync.upload()
        this.loadConfigs()
        this.notifications.info(this.translate.instant('Config uploaded'))
    }

    async downloadAndSync (cfg: Config) {
        if ((await this.platform.showMessageBox({
            type: 'warning',
            message: this.translate.instant('Overwrite the local config and start syncing?'),
            buttons: [
                this.translate.instant('Overwrite local and sync'),
                this.translate.instant('Cancel'),
            ],
            defaultId: 1,
            cancelId: 1,
        })).response === 1) {
            return
        }
        this.configSync.setConfig(cfg)
        await this.configSync.download()
        this.notifications.info(this.translate.instant('Config downloaded'))
    }

    async delete (cfg: Config) {
        if ((await this.platform.showMessageBox({
            type: 'warning',
            message: this.translate.instant('Delete the config on the remote side?'),
            buttons: [
                this.translate.instant('Delete'),
                this.translate.instant('Cancel'),
            ],
            defaultId: 1,
            cancelId: 1,
        })).response === 1) {
            return
        }
        await this.configSync.delete(cfg)
        this.loadConfigs()
        this.notifications.info(this.translate.instant('Config deleted'))
    }

    hasMatchingRemoteConfig () {
        return !!this.connection.configs?.find(c => this.isActiveConfig(c))
    }

    isActiveConfig (c: Config) {
        return c.id === this.config.store.configSync.configID
    }

    openSyncHost () {
        const link = resolveSyncHostLink(this.config.store.configSync.host)
        if (link) {
            this.platform.openExternal(link)
        }
    }

    openTabbyWebInfo () {
        this.platform.openExternal('https://github.com/Eugeny/tabby-web')
    }

}
