/**
 * @file src/module.ts
 * @description This file contains the class SomfyTahomaPlatform.
 * @author Luca Liguori
 * @created 2024-03-06
 * @version 1.7.0
 * @license Apache-2.0
 *
 * Copyright 2025, 2026, 2027 Luca Liguori.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getSemtag, MatterbridgeDynamicPlatform, type MatterbridgeEndpoint, type PlatformConfig, type PlatformMatterbridge } from 'matterbridge';
import { Closure } from 'matterbridge/devices';
import { type AnsiLogger, BLUE, CYAN, debugStringify, ign, nf, rs, stringify, YELLOW } from 'matterbridge/logger';
import { ClosureCoveringTag, ClosurePanelTag, ClosureTag } from 'matterbridge/matter';
import { ClosureControl, ClosureDimension } from 'matterbridge/matter/clusters';
import { inspectError, isValidNumber, isValidString } from 'matterbridge/utils';
import { Action, Client, Command, type Device, Execution, type State } from 'overkiz-client';

export type MovementDuration = Record<string, number>;
export const WC_PERCENT100THS_MIN_OPEN = 0;
export const WC_PERCENT100THS_MAX_CLOSED = 10000;

interface Cover {
  tahomaDevice: Device;
  bridgedDevice: Closure;
  liftPanel: MatterbridgeEndpoint;
  movementDuration: number;
  movementStatus: ClosureControl.MainState;
  moveInterval?: NodeJS.Timeout;
  commandTimeout?: NodeJS.Timeout;
}

/**
 * Maps a discovered TaHoma device's uiClass to the closest ClosureCoveringTag semantic tag, used to disambiguate
 * the Closure endpoint (Application Cluster Specification § 24, ClosureCoveringTag namespace).
 *
 * @param {Device} device - The discovered TaHoma device.
 * @returns {typeof ClosureCoveringTag.Shutter} The semantic tag describing the covering type.
 */
function getCoveringTag(device: Device): typeof ClosureCoveringTag.Shutter {
  const uiClass = device.definition.uiClass;
  if (uiClass === 'VenetianBlind' || uiClass === 'ExteriorVenetianBlind') return ClosureCoveringTag.Venetian;
  if (uiClass === 'Awning' || uiClass === 'Pergola') return ClosureCoveringTag.Awning;
  if (uiClass === 'Screen' || uiClass === 'ExteriorScreen') return ClosureCoveringTag.Blind;
  return ClosureCoveringTag.Shutter; // Shutter, RollerShutter and any other supported uiClass
}

/**
 * Resolves the coarse ClosureControl.CurrentPosition enum matching a Lift panel percent position.
 *
 * @param {number} percent - The Lift panel position, 0 (fully open) to 10000 (fully closed).
 * @returns {ClosureControl.CurrentPosition} The coarse overall current position.
 */
function closureOverallPositionFromPercent(percent: number): ClosureControl.CurrentPosition {
  if (percent <= WC_PERCENT100THS_MIN_OPEN) return ClosureControl.CurrentPosition.FullyOpened;
  if (percent >= WC_PERCENT100THS_MAX_CLOSED) return ClosureControl.CurrentPosition.FullyClosed;
  return ClosureControl.CurrentPosition.PartiallyOpened;
}

export type SomfyTahomaPlatformConfig = PlatformConfig & {
  username: string;
  password: string;
  service: string;
  whiteList: string[];
  blackList: string[];
  movementDuration: MovementDuration;
};

/**
 * This is the standard interface for Matterbridge plugins.
 * Each plugin should export a default function that follows this signature.
 *
 * @param {PlatformMatterbridge} matterbridge - An instance of MatterBridge. This is the main interface for interacting with the MatterBridge system.
 * @param {AnsiLogger} log - An instance of AnsiLogger. This is used for logging messages in a format that can be displayed with ANSI color codes.
 * @param {PlatformConfig} config - The platform configuration.
 * @returns {SomfyTahomaPlatform} - An instance of the SomfyTahomaPlatform. This is the main interface for interacting with the Somfy Tahoma system.
 */
export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: SomfyTahomaPlatformConfig): SomfyTahomaPlatform {
  return new SomfyTahomaPlatform(matterbridge, log, config);
}

export class SomfyTahomaPlatform extends MatterbridgeDynamicPlatform {
  tahomaDevices: Device[] = [];
  covers = new Map<string, Cover>();

  // TaHoma
  tahomaClient?: Client;
  movementDuration: MovementDuration = {};
  connected = false;

  constructor(
    matterbridge: PlatformMatterbridge,
    log: AnsiLogger,
    override config: SomfyTahomaPlatformConfig,
  ) {
    super(matterbridge, log, config);

    // Verify that Matterbridge is the correct version
    if (typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.9.0')) {
      throw new Error(
        `This plugin requires Matterbridge version >= "3.9.0". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend.`,
      );
    }

    this.log.info('Initializing platform:', this.config.name);

    if (config.movementDuration) this.movementDuration = config.movementDuration;

    if (!isValidString(this.config.username, 1) || !isValidString(this.config.password, 1) || !isValidString(this.config.service, 1)) {
      this.log.error('No service or username or password provided for:', this.config.name);
      return;
    }
    this.log.info('Finished initializing platform:', this.config.name);

    // create TaHoma client
    this.log.info(`Starting client Tahoma service ${this.config.service} with user ${this.config.username} password: ${this.config.password}`);
    this.tahomaClient = new Client(this.log, {
      service: this.config.service,
      user: this.config.username,
      password: this.config.password,
    });

    this.tahomaClient.on('connect', () => {
      this.log.info('TaHoma service connected');
      this.connected = true;
    });

    this.tahomaClient.on('disconnect', () => {
      this.log.warn('TaHoma service disconnected');
      this.connected = false;
    });
  }

  override async onStart(reason?: string): Promise<void> {
    await this.ready;

    this.log.info('onStart called with reason:', reason ?? 'none');
    if (!this.tahomaClient) {
      this.log.error('TaHoma service not created');
      return;
    }
    try {
      await this.tahomaClient.connect(this.config.username, this.config.password);
    } catch (error) {
      inspectError(this.log, 'Error connecting to TaHoma service', error);
      return;
    }
    await this.discoverDevices();
  }

  override async onConfigure(): Promise<void> {
    await super.onConfigure();
    this.log.info('onConfigure called');
    if (!this.tahomaClient) {
      this.log.error('TaHoma service not created');
      return;
    }

    // Set cover to target = current position and status to stopped (current position persists in the cluster)
    for (const cover of this.covers.values()) {
      const position = cover.liftPanel.getAttribute(ClosureDimension, 'currentState', cover.bridgedDevice.log)?.position;
      cover.bridgedDevice.log.info(
        `Setting ${cover.tahomaDevice.label} target to ${CYAN}${isValidNumber(position, 0, 10000) ? position / 100 : 'unknown'} %${nf} position and status to stopped. Movement duration: ${CYAN}${cover.movementDuration}${nf}`,
      );
      if (isValidNumber(position, 0, 10000)) await this.setCoverStoppedAt(cover, position);
    }
  }

  override async onShutdown(reason?: string): Promise<void> {
    await super.onShutdown(reason);
    this.log.info('onShutdown called with reason:', reason ?? 'none');
    if (this.tahomaClient) {
      this.tahomaClient.removeAllListeners();
    } else {
      this.log.error('TaHoma service not created');
    }
    this.tahomaClient = undefined;
    this.covers.forEach((cover) => {
      clearInterval(cover.moveInterval);
      cover.moveInterval = undefined;
      clearTimeout(cover.commandTimeout);
      cover.commandTimeout = undefined;
    });
    this.covers.clear();
    if (this.config.unregisterOnShutdown) await this.unregisterAllDevices();
  }

  async discoverDevices(): Promise<void> {
    // TaHoma
    if (!this.tahomaClient) {
      this.log.error('TaHoma service not created');
      return;
    }
    let devices: Device[];
    try {
      devices = await this.tahomaClient.getDevices();
    } catch (error) {
      inspectError(this.log, 'Error discovering TaHoma devices', error);
      return;
    }

    this.log.info(`Discovered ${devices.length} TaHoma devices`);

    // Create the plugin directory inside the Matterbridge plugin directory
    await fs.mkdir(path.join(this.matterbridge.matterbridgePluginDirectory, 'matterbridge-somfy-tahoma'), { recursive: true });

    // Write the discovered devices to a file
    const fileName = path.join(this.matterbridge.matterbridgePluginDirectory, 'matterbridge-somfy-tahoma', 'devices.json');
    fs.writeFile(fileName, stringify(devices, false, 0, 0, 0, 0, 0, 0, '"', '"', 2))
      .then(() => {
        this.log.debug(`Devices successfully written to ${fileName}`);
        return;
      })
      .catch((error: unknown) => {
        inspectError(this.log, `Error writing devices to ${fileName}`, error);
      });

    for (const device of devices) {
      this.log.debug(`Device: ${BLUE}${device.label}${rs}`);
      this.log.debug(`- uniqueName ${device.uniqueName}`);
      this.log.debug(`- uiClass ${device.definition.uiClass}`);
      this.log.debug(`- serial ${device.serialNumber}`);
      this.log.debug(`- deviceURL ${device.deviceURL}`);
      this.log.debug(`- commands ${debugStringify(device.commands)}`);
      this.log.debug(`- states ${debugStringify(device.states)}`);
      const supportedUniqueNames = [
        'Blind',
        'BlindRTSComponent',
        'ExteriorBlindRTSComponent',
        'ExteriorVenetianBlindRTSComponent',
        'Shutter',
        'RollerShutterRTSComponent',
        'HorizontalAwningRTSComponent',
        'PergolaHorizontalUnoIOComponent',
        'Awning',
        'TiltOnlyVenetianBlindRTSComponent',
      ];
      const supportedUiClasses = ['Screen', 'ExteriorScreen', 'Shutter', 'RollerShutter', 'VenetianBlind', 'ExteriorVenetianBlind', 'Awning', 'Pergola'];

      if (supportedUniqueNames.includes(device.uniqueName)) {
        this.tahomaDevices.push(device);
        this.log.debug(`- added with uniqueName`);
      } else if (supportedUiClasses.includes(device.definition.uiClass)) {
        this.tahomaDevices.push(device);
        this.log.debug(`- added with uiClass`);
      } else if (device.commands.includes('open') && device.commands.includes('close') && device.commands.includes('stop')) {
        this.tahomaDevices.push(device);
        this.log.debug(`- added with commands "open", "close" and "stop"`);
      } else if (device.commands.includes('rollOut') && device.commands.includes('rollUp') && device.commands.includes('stop')) {
        this.tahomaDevices.push(device);
        this.log.debug(`- added with commands "rollOut", "rollUp" and "stop"`);
      } else if (device.commands.includes('down') && device.commands.includes('up') && device.commands.includes('stop')) {
        this.tahomaDevices.push(device);
        this.log.debug(`- added with commands "down", "up" and "stop"`);
      }
    }
    this.log.info(`Discovered ${this.tahomaDevices.length} TaHoma screens`);
    for (const device of this.tahomaDevices) {
      if (!this.validateDevice([device.label, device.uniqueName, device.serialNumber])) {
        continue;
      }
      this.setSelectDevice(device.serialNumber, device.label);
      const duration = this.movementDuration[device.label] || 30;

      this.log.debug(`Adding device: ${BLUE}${device.label}${rs}`);
      this.log.debug(`- uniqueName ${device.uniqueName}`);
      this.log.debug(`- uiClass ${device.definition.uiClass}`);
      this.log.debug(`- serial ${device.serialNumber}`);
      this.log.debug(`- deviceURL ${device.deviceURL}`);
      this.log.debug(`- commands ${debugStringify(device.commands)}`);
      this.log.debug(`- states ${debugStringify(device.states)}`);
      this.log.debug(`- duration ${duration}`);

      // Listen for state changes on the device and log them
      device.on('states', (changedStates: State[]) => {
        // v8 ignore next -- This is for debugging purposes and is not critical to cover in tests
        this.log.debug(`***Tahoma update for ${device.label}: ${debugStringify(changedStates)}`);
      });

      const cover = new Closure(device.label, device.serialNumber, {
        tagList: [getSemtag(ClosureTag.Covering), getSemtag(getCoveringTag(device))],
      });
      cover.createDefaultBasicInformationClusterServer(device.label, device.serialNumber, 0xfff1, 'Somfy Tahoma', 0x8000, device.definition.uiClass);
      const liftPanel = cover.addPanel('Lift', [getSemtag(ClosurePanelTag.Lift)], 'lift');
      cover.addRequiredClusterServers();
      await this.registerDevice(cover);
      this.covers.set(device.label, { tahomaDevice: device, bridgedDevice: cover, liftPanel, movementStatus: ClosureControl.MainState.Stopped, movementDuration: duration });

      cover.addCommandHandler('Identify.identify', async ({ request: { identifyTime } }) => {
        const cover = this.covers.get(device.label);
        if (!cover) return;
        cover.bridgedDevice.log.info(`Command ${ign}identify${rs}${nf} called identifyTime:${identifyTime}`);
        await this.sendCommand('identify', device, true);
      });

      cover.addCommandHandler('ClosureControl.moveTo', ({ request: { position } }) => {
        const cover = this.covers.get(device.label);
        if (!cover) return;
        const targetPosition =
          position === ClosureControl.TargetPosition.MoveToFullyOpen
            ? WC_PERCENT100THS_MIN_OPEN
            : position === ClosureControl.TargetPosition.MoveToFullyClosed
              ? WC_PERCENT100THS_MAX_CLOSED
              : undefined;
        if (targetPosition === undefined) {
          cover.bridgedDevice.log.warn(`Command moveTo called with unsupported position:${position}`);
          return;
        }
        if (cover.commandTimeout) clearTimeout(cover.commandTimeout);
        // oxlint-disable-next-line typescript/no-misused-promises
        cover.commandTimeout = setTimeout(async () => {
          cover.commandTimeout = undefined;
          cover.bridgedDevice.log.info(`Command ${ign}moveTo${rs}${nf} ${CYAN}${targetPosition}${nf} called for ${CYAN}${cover.tahomaDevice.label}`);
          await this.moveToPosition(cover, targetPosition);
        }, 500);
      });

      cover.addCommandHandler('ClosureControl.stop', async () => {
        const cover = this.covers.get(device.label);
        if (!cover) return;
        cover.bridgedDevice.log.info(`Command ${ign}stop${rs}${nf} called for ${CYAN}${cover.tahomaDevice.label}. Status ${cover.movementStatus}`);
        clearInterval(cover.moveInterval);
        cover.moveInterval = undefined;
        if (cover.movementStatus !== ClosureControl.MainState.Stopped) {
          await this.sendCommand('stop', cover.tahomaDevice, true);
        }
        const position = cover.liftPanel.getAttribute(ClosureDimension, 'currentState', cover.bridgedDevice.log)?.position;
        if (isValidNumber(position, 0, 10000)) await this.setCoverStoppedAt(cover, position);
      });

      liftPanel.addCommandHandler('ClosureDimension.setTarget', ({ request: { position } }) => {
        const cover = this.covers.get(device.label);
        if (!cover || position === undefined || position === null) return;
        if (cover.commandTimeout) clearTimeout(cover.commandTimeout);
        // oxlint-disable-next-line typescript/no-misused-promises
        cover.commandTimeout = setTimeout(async () => {
          cover.commandTimeout = undefined;
          cover.bridgedDevice.log.info(`Command ${ign}setTarget${rs}${nf} ${CYAN}${position}${nf} called for ${CYAN}${cover.tahomaDevice.label}`);
          await this.moveToPosition(cover, position);
        }, 500);
      });
    }
  }

  // With Matter 0=open 10000=close
  async moveToPosition(cover: Cover, targetPosition: number): Promise<void> {
    const log = cover.bridgedDevice.log;
    const position = cover.liftPanel.getAttribute(ClosureDimension, 'currentState', log)?.position;
    if (!isValidNumber(position, 0, 10000)) return;
    let currentPosition = position;
    log.info(`Moving from ${currentPosition} to ${targetPosition}...`);

    // Stop movement if already moving
    if (cover.movementStatus !== ClosureControl.MainState.Stopped) {
      log.info('Stopping current movement.');
      clearInterval(cover.moveInterval);
      cover.moveInterval = undefined;
      await this.setCoverStoppedAt(cover, currentPosition);
      await this.sendCommand('stop', cover.tahomaDevice, true);
      return;
    }
    // Return if already at target position
    if (targetPosition === currentPosition) {
      clearInterval(cover.moveInterval);
      cover.moveInterval = undefined;
      await this.setCoverStoppedAt(cover, currentPosition);
      log.info(`Moving from ${currentPosition} to ${targetPosition}. No movement needed.`);
      return;
    }
    // Start movement
    const movement = targetPosition - currentPosition;
    const movementSeconds = Math.abs((movement * cover.movementDuration) / 10000);
    log.debug(`Moving from ${currentPosition} to ${targetPosition} in ${movementSeconds} seconds. Movement requested ${movement}`);
    const targetState = cover.liftPanel.getAttribute(ClosureDimension, 'targetState', log);
    await cover.liftPanel.setAttribute(ClosureDimension, 'targetState', { position: targetPosition, latch: targetState?.latch, speed: targetState?.speed }, log);
    await cover.bridgedDevice.setAttribute(ClosureControl, 'mainState', ClosureControl.MainState.Moving, log);
    cover.movementStatus = ClosureControl.MainState.Moving;
    await this.sendCommand(targetPosition > currentPosition ? 'close' : 'open', cover.tahomaDevice, true);

    // oxlint-disable-next-line typescript/no-misused-promises
    cover.moveInterval = setInterval(async () => {
      log.debug(`Moving interval from ${currentPosition} to ${targetPosition} with movement ${movement}`);
      if (currentPosition === null) return;
      currentPosition = Math.round(currentPosition + movement / movementSeconds);
      if (Math.abs(targetPosition - currentPosition) <= 100 || (movement > 0 && currentPosition >= targetPosition) || (movement < 0 && currentPosition <= targetPosition)) {
        clearInterval(cover.moveInterval);
        await this.setCoverStoppedAt(cover, targetPosition);
        if (targetPosition !== WC_PERCENT100THS_MIN_OPEN && targetPosition !== WC_PERCENT100THS_MAX_CLOSED) await this.sendCommand('stop', cover.tahomaDevice, true);
        log.debug(`Moving stopped at ${targetPosition}`);
      } else {
        log.debug(`Moving from ${currentPosition} to ${targetPosition} difference ${Math.abs(targetPosition - currentPosition)}`);
        const currentState = cover.liftPanel.getAttribute(ClosureDimension, 'currentState', log);
        await cover.liftPanel.setAttribute(
          ClosureDimension,
          'currentState',
          { position: Math.max(WC_PERCENT100THS_MIN_OPEN, Math.min(currentPosition, WC_PERCENT100THS_MAX_CLOSED)), latch: currentState?.latch, speed: currentState?.speed },
          log,
        );
      }
    }, 1000);
  }

  /**
   * Stops a cover at the given Lift position: syncs the Lift panel's ClosureDimension currentState/targetState and
   * rolls the reached position back up into the parent Closure's ClosureControl overallCurrentState and mainState.
   *
   * @param {Cover} cover - The cover to update.
   * @param {number} position - The reached position, 0 (fully open) to 10000 (fully closed).
   * @returns {Promise<void>}
   */
  async setCoverStoppedAt(cover: Cover, position: number): Promise<void> {
    const log = cover.bridgedDevice.log;
    const currentState = cover.liftPanel.getAttribute(ClosureDimension, 'currentState', log);
    await cover.liftPanel.setAttribute(ClosureDimension, 'currentState', { position, latch: currentState?.latch, speed: currentState?.speed }, log);
    const targetState = cover.liftPanel.getAttribute(ClosureDimension, 'targetState', log);
    await cover.liftPanel.setAttribute(ClosureDimension, 'targetState', { position, latch: targetState?.latch, speed: targetState?.speed }, log);

    const overallCurrentState = cover.bridgedDevice.getAttribute(ClosureControl, 'overallCurrentState', log);
    await cover.bridgedDevice.setAttribute(
      ClosureControl.id,
      'overallCurrentState',
      {
        position: closureOverallPositionFromPercent(position),
        latch: overallCurrentState?.latch,
        speed: overallCurrentState?.speed,
        secureState: overallCurrentState?.secureState ?? null,
      },
      log,
    );
    await cover.bridgedDevice.setAttribute(ClosureControl, 'mainState', ClosureControl.MainState.Stopped, log);
    cover.movementStatus = ClosureControl.MainState.Stopped;
  }

  async sendCommand(command: string, device: Device, highPriority = false): Promise<void> {
    let resolvedCommand = command;
    if (resolvedCommand === 'open' && !device.commands.includes('open') && device.commands.includes('rollOut')) resolvedCommand = 'rollOut';
    if (resolvedCommand === 'close' && !device.commands.includes('close') && device.commands.includes('rollUp')) resolvedCommand = 'rollUp';

    if (resolvedCommand === 'open' && !device.commands.includes('open') && device.commands.includes('up')) resolvedCommand = 'up';
    if (resolvedCommand === 'close' && !device.commands.includes('close') && device.commands.includes('down')) resolvedCommand = 'down';

    this.log.info(`Sending command ${YELLOW}${resolvedCommand}${nf} highPriority ${highPriority}`);
    try {
      const newCommand = new Command(resolvedCommand);
      const newAction = new Action(device.deviceURL, [newCommand]);
      const newExecution = new Execution('Sending ' + resolvedCommand, newAction);
      await this.tahomaClient?.execute(highPriority ? 'apply/highPriority' : 'apply', newExecution);
    } catch (error) {
      inspectError(this.log, `Error sending command ${resolvedCommand} to ${device.label}`, error);
    }
  }
}
