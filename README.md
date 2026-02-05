# <img src="https://matterbridge.io/assets/matterbridge.svg" alt="Matterbridge Logo" width="64px" height="64px">&nbsp;&nbsp;&nbsp;Matterbridge somfy tahoma plugin

[![npm version](https://img.shields.io/npm/v/matterbridge-somfy-tahoma.svg)](https://www.npmjs.com/package/matterbridge-somfy-tahoma)
[![npm downloads](https://img.shields.io/npm/dt/matterbridge-somfy-tahoma.svg)](https://www.npmjs.com/package/matterbridge-somfy-tahoma)
[![Docker Version](https://img.shields.io/docker/v/luligu/matterbridge/latest?label=docker%20version)](https://hub.docker.com/r/luligu/matterbridge)
[![Docker Pulls](https://img.shields.io/docker/pulls/luligu/matterbridge?label=docker%20pulls)](https://hub.docker.com/r/luligu/matterbridge)
![Node.js CI](https://github.com/Luligu/matterbridge-somfy-tahoma/actions/workflows/build.yml/badge.svg)
![CodeQL](https://github.com/Luligu/matterbridge-somfy-tahoma/actions/workflows/codeql.yml/badge.svg)
[![codecov](https://codecov.io/gh/Luligu/matterbridge-somfy-tahoma/branch/main/graph/badge.svg)](https://codecov.io/gh/Luligu/matterbridge-somfy-tahoma)
[![styled with prettier](https://img.shields.io/badge/styled_with-Prettier-f8bc45.svg?logo=prettier)](https://github.com/prettier/prettier)
[![linted with eslint](https://img.shields.io/badge/linted_with-ES_Lint-4B32C3.svg?logo=eslint)](https://github.com/eslint/eslint)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![ESM](https://img.shields.io/badge/ESM-Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org/api/esm.html)
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

### Matterbridge

Follow these steps to install or update Matterbridge if it is not already installed and up to date:

on Windows:

```
npm install -g matterbridge --omit=dev
```

on Linux (if may need the necessary permissions):

```
sudo npm install -g matterbridge --omit=dev
```

See the complete guidelines on [Matterbridge](https://github.com/Luligu/matterbridge/blob/main/README.md) for more information.

### TaHoma bridge

A working setup of any of the TaHoma bridges (like the Connectivity kit).

## How to install

Open the frontend of matterbridge, select the plugin and install it.

## How to install from the command line

On windows:

```
cd $HOME\Matterbridge
npm install -g matterbridge-somfy-tahoma --omit=dev
matterbridge -add matterbridge-somfy-tahoma
```

On linux:

```
cd ~/Matterbridge
sudo npm install -g matterbridge-somfy-tahoma --omit=dev
matterbridge -add matterbridge-somfy-tahoma
```

Then start Matterbridge

```
matterbridge
```

## How to use it

You need to configure the service ("somfy_europe", "somfy_australia" or "somfy_north_america"), username and password of your Tahoma account.

If the whiteList is defined only the devices included are exposed to Matter.

If the blackList is defined the devices included will not be exposed to Matter.

If any device creates issues put it in the blackList.

Set for each device the full movement time (the plugin will use that time to syncronize the movement).

These are the config values:

```
{
  "name": "matterbridge-somfy-tahoma",
  "type": "DynamicPlatform",
  "username": "<USERNAME>",
  "password": "<PASSWORD>",
  "service": "somfy_europe",
  "blackList": [],
  "whiteList": [],
  "duration": {
    "<DEVICENAME1>": 30,
    "<DEVICENAME2>": 30
  }
}
```

You can edit the config file from the frontend (best option) or

On windows:

```
cd $HOME\.matterbridge
notepad matterbridge-somfy-tahoma.config.json
```

On linux:

```
cd ~/.matterbridge
nano matterbridge-somfy-tahoma.config.json
```

- You can then ask Siri

```
Siri open the Living room blind
Siri close the Living room blind
Siri set the Living room blind to 70%
```
