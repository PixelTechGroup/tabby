import * as path from 'path'

export type AgentSocketProbe = (socketPath: string) => Promise<boolean>

export function getBitwardenAgentSocketPaths (homeDir: string): string[] {
    return [
        path.join(homeDir, '.var/app/com.bitwarden.desktop/data/.bitwarden-ssh-agent.sock'),
        path.join(homeDir, 'snap/bitwarden/current/.bitwarden-ssh-agent.sock'),
        path.join(homeDir, '.bitwarden-ssh-agent.sock'),
    ]
}

export async function detectBitwardenAgentSocket (
    homeDir: string,
    isSocket: AgentSocketProbe,
): Promise<string|null> {
    for (const socketPath of getBitwardenAgentSocketPaths(homeDir)) {
        try {
            if (await isSocket(socketPath)) {
                return socketPath
            }
        } catch {
            // This Bitwarden package type is not installed or its agent is disabled.
        }
    }
    return null
}
