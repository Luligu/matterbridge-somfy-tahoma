# <img src="https://matterbridge.io/assets/matterbridge.svg" alt="Matterbridge Logo" width="64px" height="64px">&nbsp;&nbsp;&nbsp;Matterbridge somfy tahoma plugin

[![npm version](https://img.shields.io/npm/v/matterbridge-somfy-tahoma.svg)](https://www.npmjs.com/package/matterbridge-somfy-tahoma)
[![npm downloads](https://img.shields.io/npm/dt/matterbridge-somfy-tahoma.svg)](https://www.npmjs.com/package/matterbridge-somfy-tahoma)
[![Docker Version](https://img.shields.io/docker/v/luligu/matterbridge/latest?label=docker%20version)](https://hub.docker.com/r/luligu/matterbridge)
[![Docker Pulls](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/Luligu/b21088ab9c9f2b119b42c33f0fef218d/raw/docker.json)](https://hub.docker.com/r/luligu/matterbridge)
![Node.js CI](https://github.com/Luligu/matterbridge-somfy-tahoma/actions/workflows/build.yml/badge.svg)
![CodeQL](https://github.com/Luligu/matterbridge-somfy-tahoma/actions/workflows/codeql.yml/badge.svg)
[![codecov](https://codecov.io/gh/Luligu/matterbridge-somfy-tahoma/branch/main/graph/badge.svg)](https://codecov.io/gh/Luligu/matterbridge-somfy-tahoma)
[![tested with Vitest](https://img.shields.io/badge/tested_with-Vitest-6E9F18.svg?logo=vitest&logoColor=white)](https://vitest.dev)
[![styled with Oxc](https://img.shields.io/badge/styled_with-Oxc-9BE4E0.svg?logo=oxc&logoColor=white)](https://oxc.rs/docs/guide/usage/formatter.html)
[![linted with Oxc](https://img.shields.io/badge/linted_with-Oxc-9BE4E0.svg?logo=oxc&logoColor=white)](https://oxc.rs/docs/guide/usage/linter.html)
[![TypeScript Native](https://img.shields.io/badge/TypeScript_Native-3178C6?logo=typescript&logoColor=white)](https://github.com/microsoft/typescript-go)
[![ESM](https://img.shields.io/badge/ESM-Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![matterbridge.io](https://img.shields.io/badge/matterbridge.io-online-brightgreen)](https://matterbridge.io)

[![powered by](https://img.shields.io/badge/powered%20by-matterbridge-blue)](https://www.npmjs.com/package/matterbridge)
[![powered by](https://img.shields.io/badge/powered%20by-matter--history-blue)](https://www.npmjs.com/package/matter-history)
[![powered by](https://img.shields.io/badge/powered%20by-node--ansi--logger-blue)](https://www.npmjs.com/package/node-ansi-logger)
[![powered by](https://img.shields.io/badge/powered%20by-node--persist--manager-blue)](https://www.npmjs.com/package/node-persist-manager)

---

This plugin allows to expose to matter the Somfy TaHoma screens.

It exposes also the stateless screens that don't show up in the TaHoma HomeKit bridge because they don't have a bidirectional radio. The plugin resolves the problem counting the time of the screen movement (see Usage section).

If you like this project and find it useful, please consider giving it a star on [GitHub](https://github.com/Luligu/matterbridge-somfy-tahoma) and sponsoring it.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="120"></a>

## Prerequisites

### Matterbridge v3.11.0

See the complete guidelines on [Matterbridge](https://matterbridge.io) for more information.

### TaHoma bridge

A working setup of any of the TaHoma bridges (like the Connectivity kit).

## How to install

Open the frontend of matterbridge, select the plugin and install it.

## How to use it

For the cloud service, configure `somfy_europe`, `somfy_australia`, or `somfy_north_america` with the username and password of your TaHoma account.

For the Local API, first enable [Developer Mode and generate a local bearer token](https://github.com/Somfy-Developer/Somfy-TaHoma-Developer-Mode). Then configure:

- `service`: `local`
- `username`: the gateway IPv4 address without `https://` or `:8443` (for example `192.168.1.54`), or its PIN (`XXXX-XXXX-XXXX`)
- `password`: the generated local bearer token, not the Somfy account password

Keep the local bearer token private. The plugin does not write credentials to its startup log.

If the whiteList is defined only the devices included are exposed to Matter.

If the blackList is defined the devices included will not be exposed to Matter.

If any device creates issues put it in the blackList.

Set each device’s full movement time in seconds under `movementDuration`, keyed by its device name. The plugin uses this time to synchronize movement and defaults to 30 seconds when no duration is configured.

Pergolas with a fabric roof (uiClass `Pergola` with the `deploy` and `undeploy` commands) are opened with `undeploy` (fabric retracted) and closed with `deploy` (fabric extended).

If a device moves in the opposite direction (open closes it and close opens it), add its name to `invertDirection`.

If `useClosure` is enabled, covers are exposed using the Matter 1.5 Closure device type instead of WindowCovering. This eases integration testing with controllers that support the newer cluster (SmartThings).

When `useClosure` is enabled, you can opt in per device to the Closure `Calibration`, `Ventilation` and `Pedestrian` optional features with `closureOptions`.

Set `closureOptions.<DEVICENAME>.signaturePosition` to override the Signature position per device (0-100, percentage closed). When omitted or invalid, Matterbridge's default applies (50% closed).

Closure movement and stop commands act on the physical cover only after Matterbridge accepts the command. Panel target positions follow the resolution applied by the server, and preset targets use Matterbridge's configured percentages.

These are example cloud config values:

```json
{
  "name": "matterbridge-somfy-tahoma",
  "type": "DynamicPlatform",
  "username": "<USERNAME>",
  "password": "<PASSWORD>",
  "service": "somfy_europe",
  "blackList": [],
  "whiteList": [],
  "movementDuration": {
    "<DEVICENAME1>": 30,
    "<DEVICENAME2>": 30
  },
  "invertDirection": [],
  "useClosure": false,
  "closureOptions": {
    "<DEVICENAME1>": {
      "calibration": false,
      "ventilation": false,
      "pedestrian": false,
      "signaturePosition": 50
    }
  }
}
```

For a local connection, only the three connection values differ:

```json
{
  "username": "192.168.1.54",
  "password": "<LOCAL_BEARER_TOKEN>",
  "service": "local"
}
```

You can edit the config file from the frontend.

You can then ask Siri

```text
Siri open the Living room blind
Siri close the Living room blind
Siri set the Living room blind to 70%
```

## Development guide

Refer to the Matterbridge [Development guide](https://matterbridge.io/README-DEV.html) for other guidelines.

## Repository toolchain

See [TOOLCHAIN.md](./TOOLCHAIN.md) for compilers, linting, formatting, testing, and editor support.

## Shared agent instructions

See [SHARED-AGENTS.md](./SHARED-AGENTS.md) for shared guidance, rules, skills, and configuration for coding agents.

See [.agents/README.md](./.agents/README.md) for the shared instructions layout and versioning.

## Shared dev container support

See [.devcontainer/README.md](./.devcontainer/README.md) for the shared development container setup and usage.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## Style guide

See [STYLEGUIDE.md](./STYLEGUIDE.md) for code style, naming, documentation, and testing conventions.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release history and notable changes.

## Issues and feature requests

Report bugs and suggest improvements on [GitHub Issues](https://github.com/Luligu/matterbridge-somfy-tahoma/issues).

## License

Licensed under the [Apache License 2.0](./LICENSE).

## Support the project

If you find this project useful, please consider giving it a star on GitHub and sponsoring it. Your support helps maintain and improve the project.

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/yellow_img.png)](https://www.buymeacoffee.com/luligugithub)
