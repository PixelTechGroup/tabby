import * as path from 'path'
import * as fs from 'fs'
import * as semver from 'semver'
import * as childProcess from 'child_process'

process.env.ARCH = ((process.env.ARCH || process.arch) === 'arm') ? 'armv7l' : (process.env.ARCH || process.arch)

import * as url from 'url'
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

const electronInfo = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../node_modules/electron/package.json')))

const versionOverride = process.env.TABBY_VERSION?.trim()
export let version

if (versionOverride) {
    if (!semver.valid(versionOverride)) {
        throw new Error(`Invalid TABBY_VERSION: ${versionOverride}`)
    }
    version = versionOverride
} else {
    const described = childProcess.execSync('git describe --tags', { encoding:'utf-8' }).substring(1).trim()

    // `git describe` appends -<commits>-g<hash> when HEAD is past the latest tag. Tags
    // themselves may contain hyphens (e.g. 1.0.238-pixeltech.0) and are releases, not nightlies.
    const pastTag = described.match(/^(.+)-\d+-g[0-9a-f]+$/)
    version = pastTag
        ? semver.inc(pastTag[1], 'prepatch').replace('-0', `-nightly.${process.env.REV ?? 0}`)
        : described
}

export const builtinPlugins = [
    'tabby-core',
    'tabby-settings',
    'tabby-terminal',
    'tabby-web',
    'tabby-community-color-schemes',
    'tabby-ssh',
    'tabby-serial',
    'tabby-telnet',
    'tabby-local',
    'tabby-electron',
    'tabby-plugin-manager',
    'tabby-linkifier',
    'tabby-auto-sudo-password',
]

export const allPackages = [
    ...builtinPlugins,
    'web',
    'tabby-web-demo',
]

export const bundledModules = [
    '@angular',
    '@ng-bootstrap',
]
export const electronVersion = electronInfo.version
