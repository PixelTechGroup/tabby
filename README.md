# PixelTech Tabby

A maintained fork of [Tabby](https://github.com/Eugeny/tabby), the highly configurable terminal emulator, SSH and serial client for Windows, macOS and Linux, with **config sync to your own self-hosted sync server** and fixes for several Linux issues.

<p align="center">
  <a href="https://github.com/PixelTechGroup/tabby/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/PixelTechGroup/tabby?include_prereleases&style=for-the-badge&logo=github"></a> &nbsp;
  <a href="https://github.com/PixelTechGroup/tabby/blob/master/LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/PixelTechGroup/tabby?style=for-the-badge"></a>
</p>

> **Status:** based on upstream Tabby **v1.0.238**. Releases are versioned `<upstream version>-pixeltech.<n>`, for example `1.0.238-pixeltech.0`. See the [changelog](CHANGELOG.md).

---

# Contents <!-- omit in toc -->

- [How this fork differs from upstream](#how-this-fork-differs-from-upstream)
- [Downloads](#downloads)
- [Self-hosted config sync](#self-hosted-config-sync)
- [SSH agent handling](#ssh-agent-handling)
- [Features inherited from Tabby](#features-inherited-from-tabby)
- [Building and testing](#building-and-testing)
- [Staying in sync with upstream](#staying-in-sync-with-upstream)
- [Credits and license](#credits-and-license)

# How this fork differs from upstream

| Area | Upstream Tabby | PixelTech Tabby |
| --- | --- | --- |
| Config sync | Tabby Web only | Any compatible sync server, including a self-hosted Tabby Sync instance |
| Sync transport | Server URL accepted as entered | **HTTPS enforced**: `http://` URLs are rejected, so the auth token is never sent in the clear |
| SSH agent socket | `SSH_AUTH_SOCK` only | Optional **agent socket path** setting, plus automatic **Bitwarden SSH agent** detection on Linux |
| Linux input (IBus etc.) | Punctuation keys are deferred to the input method on all Linux desktops, which drops them where no IME commit follows | Deferral applies **only when Fcitx is detected** |
| Analytics | On by default, sent to upstream's Mixpanel | **Removed entirely** |
| Crash reporting | Reports sent to upstream's Sentry account | **Removed entirely** |
| Tests | `test:ssh-term` | adds `test:config-sync`, both run in CI |

Everything else tracks upstream. Upstream is merged regularly, so you also get its fixes and features.

See the [changelog](CHANGELOG.md) for the full list.

# Downloads

* [Latest release](https://github.com/PixelTechGroup/tabby/releases/latest)
* [All releases](https://github.com/PixelTechGroup/tabby/releases)

Only the builds published on this repository's releases page are PixelTech Tabby. Upstream's package repositories, auto-update channel and nightly builds ship upstream Tabby and will not include this fork's changes.

# Self-hosted config sync

Sync your settings, profiles and encrypted vault between machines using a server you control.

1. Open **Settings → Config sync**.
2. Enter your **Sync server URL**, for example `https://sync.example.com`.
3. Paste the **Authentication token** issued by your sync server.
4. Pick the config to use, or create a new one.

Notes:

* The URL **must use HTTPS**. A plain `http://` URL shows an error in the settings and is refused by the request layer.
* The URL is checked when you leave the field, and changing the URL or token re-tests the connection automatically.
* The server must implement the Tabby Web config API. Tabby Web itself still works, as does any compatible server.
* Secrets in your config stay protected by Tabby's encrypted vault, as upstream.

# SSH agent handling

Agent authentication resolves the agent socket in this order:

1. **SSH agent socket path**, set in **Settings → SSH** (macOS and Linux). Leave empty for auto-detect.
2. The `SSH_AUTH_SOCK` environment variable, when that socket accepts connections.
3. On Linux, the **Bitwarden SSH agent**, when its agent is running. The native `~/.bitwarden-ssh-agent.sock` is checked first, then the Flatpak and Snap install locations.
4. The original `SSH_AUTH_SOCK` when it did not accept a connection, if there is no working alternative. This is kept only so agent authentication failures name the endpoint that was tried; it is never preferred over a live agent.

A socket file left behind by an agent that has exited is ignored, so a stale `SSH_AUTH_SOCK` or an old Bitwarden install cannot shadow a working agent. Detection also covers GUI launchers that do not pass `SSH_AUTH_SOCK` on at all. Probing only checks that a socket accepts a connection: it sends no agent requests and does not prove that authentication will succeed, which the SSH handshake still decides. When auto-detection selects a Bitwarden agent, the session log reports the socket path that was used.

# Features inherited from Tabby

* Integrated SSH and Telnet client and connection manager
* Integrated serial terminal
* Theming and color schemes
* Fully configurable shortcuts and multi-chord shortcuts
* Split panes, tabs on any side of the window, and a dockable "Quake console" window
* Remembers your tabs
* PowerShell (and PS Core), WSL, Git-Bash, Cygwin, MSYS2, Cmder and CMD support
* Direct file transfer from/to SSH sessions via Zmodem
* Full Unicode support including double-width characters
* X11 and port forwarding, automatic jump host management, agent forwarding (incl. Pageant and Windows native OpenSSH Agent), login scripts
* Font ligatures, bracketed paste, multiline paste warnings, optional PuTTY-style RMB paste and copy-on-select
* Integrated encrypted container for SSH secrets and configuration
* Plugin and theme support, installable from the Settings view

Tabby is an alternative to Windows' standard terminal, PuTTY, macOS Terminal.app and iTerm. It is not a new shell and it is not lightweight. If RAM usage matters, consider [Alacritty](https://github.com/alacritty/alacritty).

**Portable mode** (Windows): create a `data` folder next to `Tabby.exe`.

# Building and testing

See [HACKING.md](HACKING.md) for the project layout and build instructions.

```bash
yarn
yarn run build
yarn run start
```

Focused tests run without building the app:

```bash
yarn run test:ssh-term     # Node.js 22.6+
yarn run test:config-sync  # Node.js 22.7+
```

# Staying in sync with upstream

This fork periodically merges [Eugeny/tabby](https://github.com/Eugeny/tabby) `master`. Changes specific to this fork are kept small and isolated, mainly in `tabby-settings` (config sync), `tabby-ssh` (agent handling) and `tabby-terminal` (Linux input), to keep those merges simple.

Issues and pull requests are welcome. For bugs that also reproduce on upstream Tabby, consider reporting them there too.

# Credits and license

PixelTech Tabby is a fork of [Tabby](https://github.com/Eugeny/tabby) by Eugene Pankov and its many [contributors](https://github.com/Eugeny/tabby/graphs/contributors), whose work makes up nearly all of this project. Thank you.

Released under the [MIT License](LICENSE). The original copyright notice is retained as the license requires.
