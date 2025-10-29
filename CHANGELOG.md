# <img src="matterbridge.svg" alt="Matterbridge Logo" width="64px" height="64px">&nbsp;&nbsp;&nbsp;Matterbridge somfy tahoma plugin changelog

# Changelog

If you like this project and find it useful, please consider giving it a star on GitHub at https://github.com/Luligu/matterbridge-somfy-tahoma and sponsoring it.

All notable changes to this project will be documented in this file.

## [1.4.0] - 2025-10-29

### Changed

- [package]: Updated dependencies.
- [package]: Bumped platform to v.1.0.0.
- [package]: Bumped package to automator v.2.0.10
- [jest]: Bumped jestHelpers to v.1.0.10.
- [package]: Require matterbridge v.3.3.0.
- [package]: Added default config.
- [platform]: Updated to new signature PlatformMatterbridge.
- [workflows]: Ignore any .md in build.yaml.
- [workflows]: Ignore any .md in codeql.yaml.
- [workflows]: Ignore any .md in codecov.yaml.
- [workflows]: Improved speed on Node CI.
- [devcontainer]: Added the plugin name to the container.
- [devcontainer]: Improved performance of first build with shallow clone.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.3.0] - 2025-07-30

### Added

- [DevContainer]: Added support for the **Matterbridge Dev Container** with an optimized named volume for `node_modules`.
- [GitHub]: Added GitHub issue templates for bug reports and feature requests.
- [ESLint]: Refactored the flat config.
- [ESLint]: Added the plugins `eslint-plugin-promise`, `eslint-plugin-jsdoc`, and `@vitest/eslint-plugin`.
- [Jest]: Refactored the flat config.
- [Vitest]: Added Vitest for TypeScript project testing. It will replace Jest, which does not work correctly with ESM module mocks.
- [JSDoc]: Added missing JSDoc comments, including `@param` and `@returns` tags.
- [CodeQL]: Added CodeQL badge in the readme.
- [Codecov]: Added Codecov badge in the readme.
- [config]: Added default config file.

### Changed

- [package]: Updated package to Automator v. 2.0.3.
- [package]: Updated dependencies.
- [storage]: Bumped `node-storage-manager` to 2.0.0.
- [logger]: Bumped `node-ansi-logger` to 3.1.1.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.2.5] - 2025-05-03

### Changed

- [package]: Requires matterbridge 3.0.0.
- [package]: Updated package.
- [package]: Updated workflows.
- [package]: Updated dependencies.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.2.4] - 2025-03-11

### Added

- [plugin]: Added the whiteList and blackList select in the frontend.
- [schema]: Added uniqueItem check in the whiteList and blackList.

### Changed

- [package]: Requires matterbridge 2.2.4.
- [package]: Updated package.
- [package]: Updated workflows.
- [package]: Updated dependencies.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.2.3] - 2025-02-02

### Changed

- [package]: Requires matterbridge 2.1.0.
- [package]: Updated package.
- [package]: Updated dependencies.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.2.2] - 2024-12-23

### Added

- [plugin]: Add the possibility to validate the screens by name, uniqueName and serialNumber.
- [platform]: Added a check for endpoint numbers changes.

### Changed

- [package]: Requires matterbridge 1.6.7.
- [package]: Updated package.
- [package]: Updated dependencies.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.2.1] - 2024-12-02

### Added

- [edge]: Verified to work with Matterbridge edge (matter.js new API).
- [plugin]: Refactor movement to support concurrent movements from all screens.
- [plugin]: Refactor movement to show the movement on the controller (if it supports that) even for close and open commands.
- [matter]: Added bridgedNode and powerSource device types to the cover.

### Changed

- [package]: Requires matterbridge 1.6.5.
- [package]: Updated dependencies.

### Fixed

- [somfy]: Fixed stop sent when the target is fully open or fully closed.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.2.0] - 2024-12-02

### Added

- [edge]: Verified to work with Matterbridge edge (matter.js new API).
- [plugin]: Refactor movement to support concurrent movements from all screens.
- [plugin]: Refactor movement to show the movement on the controller (if it supports that) even for close and open commands.
- [matter]: Added bridgedNode and powerSource device types to the cover.

### Changed

- [package]: Requires matterbridge 1.6.5.
- [package]: Updated dependencies.

### Fixed

- [somfy]: Fixed stop sent when the target is fully open or fully closed.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.1.1] - 2024-10-12

### Fixed

- [somfy]: Fixed Awning commands "rollOut" and "rollUp".

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.1.0] - 2024-10-12

### Added

- [somfy]: Blinds are now added also for their uiClass.
- [somfy]: Blinds are now added also if they support the command "open", "close" and "stop".
- [somfy]: Blinds are now added also if they support the command "rollOut", "rollUp" and "stop".
- [somfy]: Blinds are now added also if they support the command "down", "up" and "stop".

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.0.22] - 2024-10-01

### Changed

- [package]: Upgrade to new workflows.
- [package]: Updated dependencies.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.0.21] - 2024-09-23

### Changed

- [package]: Updated dependencies.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.0.20] - 2024-09-05

### Changed

- [package]: Updated dependencies.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.0.19] - 2024-08-22

### Changed

- [package]: Updated dependencies.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.0.18] - 2024-08-19

### Changed

- [package]: Updated dependencies.
- [somfy]: Added support for uniqueName = BlindRTSComponent.

### Fixed

- [package]: Fixed dependencies.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.0.17] - 2024-07-28

### Changed

- [package]: Updated dependencies.
- [logger]: Update node-ansi-logger to 2.0.6.
- [storage]: Update node-persist-manager to 1.0.8.
- [somfy]: Execute commands async.
- [somfy]: Added support for uniqueName = Shutter.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.0.16] - 2024-07-23

### Changed

- [package]: Updated dependencies.
- [somfy]: Added support for uniqueName = ExteriorVenetianBlindRTSComponent.
- [somfy]: Added support for uniqueName = ExteriorBlindRTSComponent.
- [somfy]: Execute commands async.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.0.15] - 2024-07-10

### Changed

- [package]: Updated dependencies.
- [imports]: Updated matterbridge imports.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.0.14] - 2024-07-02

### Added

- [package]: Update dependencies

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.0.13] - 2024-06-30

### Added

- [package]: Update dependencies
- [package]: Updated eslint to 9.6.0

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.0.12] - 2024-06-21

### Added

- [dependencies]: Update dependencies
- [schema]: Added plugin debug option.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.0.11] - 2024-06-19

### Added

- [dependencies]: Update dependencies
- [schema]: Added schema to the root directory of the plugin.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.0.10] - 2024-06-16

### Added

- [dependencies]: Update dependencies

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

## [1.0.9] - 2024-06-01

### Added

- [dependencies]: Update dependencies
- [matterbridge]: Adapted the code to the new start mode of Matterbridge.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="yellow-button.png" alt="Buy me a coffee" width="120">
</a>

<!-- Commented out section
## [1.1.2] - 2024-03-08

### Added

- [Feature 1]: Description of the feature.
- [Feature 2]: Description of the feature.

### Changed

- [Feature 3]: Description of the change.
- [Feature 4]: Description of the change.

### Deprecated

- [Feature 5]: Description of the deprecation.

### Removed

- [Feature 6]: Description of the removal.

### Fixed

- [Bug 1]: Description of the bug fix.
- [Bug 2]: Description of the bug fix.

### Security

- [Security 1]: Description of the security improvement.
-->
