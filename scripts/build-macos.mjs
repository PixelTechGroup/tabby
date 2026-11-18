#!/usr/bin/env node
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import { build as builder } from 'electron-builder'
import * as vars from './vars.mjs'

process.env.ARCH = process.env.ARCH || process.arch

if (process.env.GITHUB_HEAD_REF) {
    delete process.env.CSC_LINK
    delete process.env.CSC_KEY_PASSWORD
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
}

builder({
    dir: true,
    mac: ['dmg', 'zip'],
    x64: process.env.ARCH === 'x86_64',
    arm64: process.env.ARCH === 'arm64',
    config: {
        extraMetadata: {
            version: vars.version,
        },
        forceCodeSigning: !!process.env.CSC_LINK,
        mac: {
            identity: !process.env.CI || process.env.CSC_LINK ? undefined : null,
            notarize: false,
        },
        npmRebuild: process.env.ARCH !== 'arm64',
        publish: [{
            provider: 'github',
            owner: 'PixelTechGroup',
            repo: 'tabby',
            channel: `latest-${process.env.ARCH}`,
        }],
    },
    publish: 'never',
}).catch(e => {
    console.error(e)
    process.exit(1)
})
