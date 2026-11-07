import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectBitwardenAgentSocket, getBitwardenAgentSocketPaths } from '../src/session/bitwardenAgent.ts'

describe('Bitwarden SSH agent discovery', () => {
    it('checks Flatpak, Snap, and native sockets in preference order', () => {
        assert.deepEqual(getBitwardenAgentSocketPaths('/home/tester'), [
            '/home/tester/.var/app/com.bitwarden.desktop/data/.bitwarden-ssh-agent.sock',
            '/home/tester/snap/bitwarden/current/.bitwarden-ssh-agent.sock',
            '/home/tester/.bitwarden-ssh-agent.sock',
        ])
    })

    it('prefers a Flatpak socket when a native socket is also present', async () => {
        const checkedPaths: string[] = []
        const detectedPath = await detectBitwardenAgentSocket('/home/tester', async socketPath => {
            checkedPaths.push(socketPath)
            return socketPath.endsWith('.bitwarden-ssh-agent.sock')
        })

        assert.equal(detectedPath, '/home/tester/.var/app/com.bitwarden.desktop/data/.bitwarden-ssh-agent.sock')
        assert.deepEqual(checkedPaths, [detectedPath])
    })

    it('falls through missing package sockets and returns the native socket', async () => {
        const detectedPath = await detectBitwardenAgentSocket('/home/tester', async socketPath => {
            if (socketPath.includes('/.var/app/')) {
                throw new Error('missing')
            }
            return socketPath === '/home/tester/.bitwarden-ssh-agent.sock'
        })

        assert.equal(detectedPath, '/home/tester/.bitwarden-ssh-agent.sock')
    })
})
