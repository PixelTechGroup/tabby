# Changelog

All notable changes to PixelTech Tabby are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases are
versioned as `<upstream version>-pixeltech.<n>`, where the first part is the
upstream [Tabby](https://github.com/Eugeny/tabby) release the build is based on.

## [Unreleased]

### Added

- `TABBY_VERSION` environment variable overrides the version computed from
  `git describe` when building packages (must be valid semver).

### Changed

- Rebranded packaging metadata: app ID is now `com.pixeltechgroup.tabby`, and
  the package author, repository and license copyright name PixelTech Group
  (the original Tabby copyright notice is retained).
- Update checks and auto-update now use this repository's GitHub Releases
  instead of upstream Tabby's.
- Release builds publish to GitHub Releases only. The upstream Keygen publish,
  packagecloud upload and Sentry symbol upload were removed from the build
  scripts and CI.

- In-app links (Help menu, start page, Settings, bug report, release notes) now
  point to this repository. The upstream Discord and translation-site links were
  removed from Settings.

### Removed (privacy)

- **Analytics.** The launch/install analytics, which sent an install ID,
  platform, OS release and version to upstream Tabby's Mixpanel project (on by
  default), are removed along with the settings toggles and the `mixpanel`
  dependency.
- **Crash reporting.** The Sentry crash reporter, which sent crash reports to
  upstream Tabby's Sentry account, is removed entirely, along with its
  `@sentry/*` dependencies.

### Fixed

- **Update check with no published release.** "Check for updates" no longer
  hangs (button stuck disabled and spinning) when the repository has no release
  yet or GitHub returns an error; it now reports no update and logs the reason.
- **Bitwarden SSH agent detection for sandboxed installs on Linux.** The
  Flatpak (`~/.var/app/com.bitwarden.desktop/data/`) and Snap
  (`~/snap/bitwarden/current/`) socket locations are now checked in addition to
  `~/.bitwarden-ssh-agent.sock`.
- Release builds from tags containing a hyphen, such as `v1.0.238-pixeltech.0`,
  were versioned as `1.0.239-nightly.N`. Only builds past a tag are now treated
  as nightlies.

### Removed

- Translation strings for the removed analytics and "Help translate" UI, and
  the upstream all-contributors config.
- Upstream-only files: funding config, API docs site and its deploy workflow,
  Snap packaging, `.vscode` launch config and `.well-known`.

## [1.0.238-pixeltech.0] - 2026-10-14

First PixelTech release, based on upstream Tabby v1.0.238.

### Added

- **Self-hosted config sync.** Config sync can now target any compatible sync
  server, such as a self-hosted Tabby Sync instance, instead of only Tabby Web.
  - The host field is now **Sync server URL** and the token field is now
    **Authentication token**.
  - The server URL must use HTTPS. Plain `http://` URLs are rejected both in the
    settings UI (inline error) and in the request layer, so a token is never sent
    over an unencrypted connection.
  - The host is validated when you leave the field, not on every keystroke, and
    changing the URL or token re-tests the connection.
  - Trailing slashes in the server URL are normalised.
  - A missing host (the normal state of a fresh profile) no longer writes an
    error to the log just because the settings tab was opened.
- **SSH agent socket path** setting (SSH settings, non-Windows). Overrides
  automatic agent detection with a specific Unix socket.
- **Bitwarden SSH agent detection on Linux.** If no socket path is configured,
  `~/.bitwarden-ssh-agent.sock` is used when it exists.
- `yarn run test:config-sync` test suite for the sync connection and request
  logic, run in CI alongside the existing `test:ssh-term`.

### Changed

- Config sync connection and request handling moved out of the Angular service
  into small, separately testable modules (`configSyncConnection.ts`,
  `configSyncRequest.ts`).
- Agent socket resolution order on Linux/macOS is now: configured path, then the
  Bitwarden agent socket (Linux), then `SSH_AUTH_SOCK`.

### Fixed

- **Linux: punctuation dropped in the terminal.** Deferring punctuation keys to
  the input method was applied on every Linux desktop, which swallowed those
  keys entirely under IBus and other IMEs that emit no later commit event. It is
  now only enabled when Fcitx is detected (`GTK_IM_MODULE`, `QT_IM_MODULE` or
  `XMODIFIERS`).
- **Linux: SSH agent authentication used the wrong agent.** Desktop sessions
  could inherit a stale or unrelated `SSH_AUTH_SOCK` (and GUI launchers
  sometimes did not inherit it at all), causing agent auth to fail even with a
  working agent running. See the resolution order above.

### Upstream

Merged upstream Tabby up to v1.0.238. Notable upstream changes included:

- Fixes for several resource leaks: closed tabs and sessions leaking terminal
  and PTY IPC listeners, and unbounded output buffering for tabs that were never
  focused.
- SSH: agent forwarding, blank passwords in profile and keychain auth, chained
  public-key + keyboard-interactive auth, a fix for sessions not ending when the
  remote shell exits, and PuTTY `.ppk` keys passed to WinSCP unconverted.
- Terminal: custom labels for split panes, MRU tab switching, a hotkey to toggle
  Option/Meta on macOS, Windows 11 Acrylic window support, Windows TUI mouse
  scrolling, and hotkeys no longer firing twice per keystroke.
- Dependency bumps.

See the [upstream releases](https://github.com/Eugeny/tabby/releases) for the
full list.

[1.0.238-pixeltech.0]: https://github.com/PixelTechGroup/tabby/releases/tag/v1.0.238-pixeltech.0
