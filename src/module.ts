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

import {
  bridgedNode,
  getSemtag,
  MatterbridgeDynamicPlatform,
  MatterbridgeEndpoint,
  type PlatformConfig,
  type PlatformMatterbridge,
  powerSource,
  windowCovering,
} from 'matterbridge';
import { Closure } from 'matterbridge/devices';
import { type AnsiLogger, BLUE, CYAN, debugStringify, ign, nf, rs, stringify, YELLOW } from 'matterbridge/logger';
import { ClosureCoveringTag, ClosurePanelTag, ClosureTag } from 'matterbridge/matter';
import { ClosureControl, ClosureDimension, Identify, WindowCovering } from 'matterbridge/matter/clusters';
import { type Semtag, ThreeLevelAuto } from 'matterbridge/matter/types';
import { inspectError, isValidNumber, isValidString } from 'matterbridge/utils';
import { Action, Client, Command, type Device, Execution, type State } from 'overkiz-client';

export type MovementDuration = Record<string, number>;
export type ClosureOptions = Record<string, { calibration?: boolean; ventilation?: boolean; pedestrian?: boolean; signaturePosition?: number }>;
export const PERCENT100THS_MIN_OPEN = 0;
export const PERCENT100THS_MAX_CLOSED = 10000;

/**
 * Runtime state for a single platform cover:
 * - tahomaDevice: The underlying TaHoma device this cover was discovered from.
 * - bridgedDevice: The Matter endpoint exposing the cover: a WindowCovering device, or a Closure device when `useClosure` is enabled.
 * - liftPanel: The Closure Lift/Tilt panel child endpoint. Only set when the cover is exposed with `useClosure` enabled.
 * - movementDuration: Full open-to-close movement time in seconds, used to simulate intermediate positions (see moveToPosition).
 * - movementStatus: Internal bookkeeping only: never written directly to the Closure cluster, which uses its own `mainState` attribute (see setCoverMoving/setCoverStoppedAt).
 * - moveInterval: Timer driving the simulated movement towards the target position, running while the cover is opening/closing.
 * - commandTimeout: Debounce timer coalescing rapid successive move commands before a single TaHoma command is sent.
 */
export interface Cover {
  /** The underlying TaHoma device this cover was discovered from. */
  tahomaDevice: Device;
  /** The Matter endpoint exposing the cover: a WindowCovering device, or a Closure device when `useClosure` is enabled. */
  bridgedDevice: MatterbridgeEndpoint;
  /** The Closure Lift/Tilt panel child endpoint. Only set when the cover is exposed with `useClosure` enabled. */
  liftPanel?: MatterbridgeEndpoint;
  /** Full open-to-close movement time in seconds, used to simulate intermediate positions (see moveToPosition). */
  movementDuration: number;
  // Internal bookkeeping only: never written directly to the Closure cluster, which uses its own `mainState` attribute (see setCoverMoving/setCoverStoppedAt).
  movementStatus: WindowCovering.MovementStatus;
  /** Timer driving the simulated movement towards the target position, running while the cover is opening/closing. */
  moveInterval?: NodeJS.Timeout;
  /** Debounce timer coalescing rapid successive move commands before a single TaHoma command is sent. */
  commandTimeout?: NodeJS.Timeout;
}

export type SomfyTahomaPlatformConfig = PlatformConfig & {
  /** TaHoma account username. */
  username: string;
  /** TaHoma account password. */
  password: string;
  /** TaHoma cloud service to connect to (e.g. `somfy_europe`). */
  service: string;
  /** Only devices whose name, uniqueName, or serial number is in this list are exposed. Empty means no restriction. */
  whiteList: string[];
  /** Devices whose name, uniqueName, or serial number is in this list are never exposed. */
  blackList: string[];
  /** Full open-to-close movement time in seconds, per device name. Devices not listed default to 30 seconds. */
  movementDuration: MovementDuration;
  /** Expose covers using the Matter 1.5 Closure device type instead of WindowCovering. Requires a matterbridge build with Closure support. Default: false. */
  useClosure?: boolean;
  /**
   * Per-device opt-in for the Closure Calibration, Ventilation and Pedestrian optional features, and per-device
   * override of the Signature position (0-100, percentage closed; see getSignaturePosition and DEFAULT_SIGNATURE_POSITION).
   * Only applies when useClosure is enabled. Default: false/undefined for all devices, features, and overrides.
   */
  closureOptions?: ClosureOptions;
};

/**
 * Maps a discovered TaHoma device's uiClass to the closest ClosureCoveringTag semantic tag, used to disambiguate
 * the Closure endpoint (Application Cluster Specification § 24, ClosureCoveringTag namespace).
 *
 * @param {Device} tahomaDevice - The discovered TaHoma device.
 * @returns {Semtag} The semantic tag describing the covering type: Venetian, Awning, Blind, or Shutter (the fallback for Shutter, RollerShutter, and any other supported uiClass).
 */
function getCoveringTag(tahomaDevice: Device): Semtag {
  const uiClass = tahomaDevice.definition.uiClass;
  if (uiClass === 'VenetianBlind' || uiClass === 'ExteriorVenetianBlind') return ClosureCoveringTag.Venetian;
  if (uiClass === 'Awning' || uiClass === 'Pergola') return ClosureCoveringTag.Awning;
  if (uiClass === 'Screen' || uiClass === 'ExteriorScreen') return ClosureCoveringTag.Blind;
  return ClosureCoveringTag.Shutter; // Shutter, RollerShutter and any other supported uiClass
}

/** Default Signature position (90% closed / 10% open), used when no per-device `signaturePosition` override is configured. See getSignaturePosition. */
const DEFAULT_SIGNATURE_POSITION = 9000;

/**
 * Resolves the Signature position to move to for a ClosureControl.TargetPosition.MoveToSignaturePosition request.
 * Neither TaHoma nor the Matter spec exposes this position (Application Cluster Specification § 5.4.6.1.1: it is
 * manufacturer- or installer-defined), so it defaults to DEFAULT_SIGNATURE_POSITION (90% closed / 10% open), which
 * matches both of the spec's own examples once expressed in the same "percentage closed" convention: a Window
 * cracked open 10% for ventilation, and a Roller Shutter closed while keeping a gap between the slats.
 * Overridable per device via the `signaturePosition` closureOptions.
 *
 * @param {number} [signaturePosition] - The per-device `closureOptions[label].signaturePosition` override, 0 (fully open) to 100 (fully closed), if configured.
 * @returns {number} The Signature position, 0 (fully open) to 10000 (fully closed).
 */
function getSignaturePosition(signaturePosition?: number): number {
  return isValidNumber(signaturePosition, 0, 100) ? signaturePosition * 100 : DEFAULT_SIGNATURE_POSITION;
}

/**
 * Resolves the coarse ClosureControl.CurrentPosition enum matching a Lift/Tilt panel percent position.
 *
 * @param {number} percent - The panel position, 0 (fully open) to 10000 (fully closed).
 * @returns {ClosureControl.CurrentPosition} The coarse overall current position.
 */
function getClosureOverallPositionFromPercent(percent: number): ClosureControl.CurrentPosition {
  if (percent <= PERCENT100THS_MIN_OPEN) return ClosureControl.CurrentPosition.FullyOpened;
  if (percent >= PERCENT100THS_MAX_CLOSED) return ClosureControl.CurrentPosition.FullyClosed;
  return ClosureControl.CurrentPosition.PartiallyOpened;
}

/**
 * Reads the current Lift/Tilt position from the cover's underlying cluster, whichever device type (WindowCovering
 * or Closure, see the `useClosure` config option) is currently in use.
 *
 * @param {Cover} cover - The cover to read from.
 * @returns {number | null | undefined} The current position, 0 (fully open) to 10000 (fully closed), or null/undefined if not yet known.
 */
function getCoverPosition(cover: Cover): number | null | undefined {
  const log = cover.bridgedDevice.log;
  return cover.liftPanel
    ? cover.liftPanel.getAttribute(ClosureDimension, 'currentState', log)?.position
    : cover.bridgedDevice.getAttribute(WindowCovering, 'currentPositionLiftPercent100ths', log);
}

/**
 * Parks the cover at the given position and marks it stopped, on whichever cluster (WindowCovering or Closure) is
 * currently in use. Updates `cover.movementStatus`.
 *
 * @param {Cover} cover - The cover to update.
 * @param {number} position - The reached position, 0 (fully open) to 10000 (fully closed).
 * @param {ClosureControl.CurrentPosition} [overallPosition] - Overrides the coarse ClosureControl.CurrentPosition reported for this position, e.g. OpenedAtSignature for a Signature move whose percent would otherwise map to PartiallyOpened/FullyOpened/FullyClosed. Defaults to the coarse mapping derived from `position`.
 * @returns {Promise<void>}
 */
async function setCoverStoppedAt(cover: Cover, position: number, overallPosition?: ClosureControl.CurrentPosition): Promise<void> {
  const log = cover.bridgedDevice.log;
  if (cover.liftPanel) {
    const currentState = cover.liftPanel.getAttribute(ClosureDimension, 'currentState', log);
    await cover.liftPanel.setAttribute(ClosureDimension, 'currentState', { position, latch: currentState?.latch, speed: currentState?.speed }, log);
    const targetState = cover.liftPanel.getAttribute(ClosureDimension, 'targetState', log);
    await cover.liftPanel.setAttribute(ClosureDimension, 'targetState', { position, latch: targetState?.latch, speed: targetState?.speed }, log);

    const overallCurrentState = cover.bridgedDevice.getAttribute(ClosureControl, 'overallCurrentState', log);
    const overallTargetState = cover.bridgedDevice.getAttribute(ClosureControl, 'overallTargetState', log);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- cover.liftPanel is only set when bridgedDevice is a Closure (see discoverDevices)
    await (cover.bridgedDevice as Closure).setState(
      {
        position: overallPosition ?? getClosureOverallPositionFromPercent(position),
        latch: overallCurrentState?.latch,
        speed: overallCurrentState?.speed,
        secureState: overallCurrentState?.secureState ?? null,
      },
      overallTargetState ?? { position: ClosureControl.TargetPosition.MoveToFullyClosed, latch: true, speed: ThreeLevelAuto.Auto },
      ClosureControl.MainState.Stopped,
    );
  } else {
    await cover.bridgedDevice.setWindowCoveringCurrentTargetStatus(position, position, WindowCovering.MovementStatus.Stopped);
  }
  cover.movementStatus = WindowCovering.MovementStatus.Stopped;
}

/**
 * Marks the cover stopped without touching its current/target position attributes, on whichever cluster
 * (WindowCovering or Closure) is currently in use. Use this instead of `setCoverStoppedAt` when the current
 * position is not known (null/undefined), so the movement status still leaves the "moving" state. Updates
 * `cover.movementStatus`.
 *
 * @param {Cover} cover - The cover to update.
 * @returns {Promise<void>}
 */
async function setCoverStopped(cover: Cover): Promise<void> {
  const log = cover.bridgedDevice.log;
  if (cover.liftPanel) {
    await cover.bridgedDevice.setAttribute(ClosureControl, 'mainState', ClosureControl.MainState.Stopped, log);
  } else {
    await cover.bridgedDevice.setWindowCoveringStatus(WindowCovering.MovementStatus.Stopped);
  }
  cover.movementStatus = WindowCovering.MovementStatus.Stopped;
}

/**
 * Marks the cover as moving towards a target position, on whichever cluster (WindowCovering or Closure) is
 * currently in use. Updates `cover.movementStatus`.
 *
 * @param {Cover} cover - The cover to update.
 * @param {number} targetPosition - The requested target position, 0 (fully open) to 10000 (fully closed).
 * @param {boolean} closing - Whether the cover is moving towards fully closed (true) or fully open (false).
 * @returns {Promise<void>}
 */
async function setCoverMoving(cover: Cover, targetPosition: number, closing: boolean): Promise<void> {
  const log = cover.bridgedDevice.log;
  if (cover.liftPanel) {
    const targetState = cover.liftPanel.getAttribute(ClosureDimension, 'targetState', log);
    await cover.liftPanel.setAttribute(ClosureDimension, 'targetState', { position: targetPosition, latch: targetState?.latch, speed: targetState?.speed }, log);
    await cover.bridgedDevice.setAttribute(ClosureControl, 'mainState', ClosureControl.MainState.Moving, log);
  } else {
    await cover.bridgedDevice.setAttribute(WindowCovering, 'targetPositionLiftPercent100ths', targetPosition, log);
    await cover.bridgedDevice.setWindowCoveringStatus(closing ? WindowCovering.MovementStatus.Closing : WindowCovering.MovementStatus.Opening);
  }
  cover.movementStatus = closing ? WindowCovering.MovementStatus.Closing : WindowCovering.MovementStatus.Opening;
}

/**
 * Updates the live "current position" attribute while the cover is simulating movement, on whichever cluster
 * (WindowCovering or Closure) is currently in use.
 *
 * @param {Cover} cover - The cover to update.
 * @param {number} position - The intermediate position reached so far, 0 (fully open) to 10000 (fully closed). Clamped to that range before being applied.
 * @returns {Promise<void>}
 */
async function setCoverCurrentPosition(cover: Cover, position: number): Promise<void> {
  const log = cover.bridgedDevice.log;
  const clamped = Math.max(PERCENT100THS_MIN_OPEN, Math.min(position, PERCENT100THS_MAX_CLOSED));
  if (cover.liftPanel) {
    const currentState = cover.liftPanel.getAttribute(ClosureDimension, 'currentState', log);
    await cover.liftPanel.setAttribute(ClosureDimension, 'currentState', { position: clamped, latch: currentState?.latch, speed: currentState?.speed }, log);
  } else {
    await cover.bridgedDevice.setAttribute(WindowCovering, 'currentPositionLiftPercent100ths', clamped, log);
  }
}

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
  /** TaHoma devices discovered that match a supported cover type, populated by discoverDevices. */
  tahomaDevices: Device[] = [];
  /** Runtime state for each registered cover, keyed by TaHoma device label. */
  covers = new Map<string, Cover>();

  /** TaHoma client instance used to communicate with the TaHoma service. */
  tahomaClient?: Client;
  /** Indicates whether the platform is currently connected to the TaHoma service. */
  connected = false;

  constructor(
    matterbridge: PlatformMatterbridge,
    log: AnsiLogger,
    override config: SomfyTahomaPlatformConfig,
  ) {
    super(matterbridge, log, config);

    // Verify that Matterbridge is the correct version.
    if (typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.10.7')) {
      throw new Error(
        `This plugin requires Matterbridge version >= "3.10.7". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend.`,
      );
    }

    this.log.info('Initializing platform:', this.config.name);

    // This section ensures that all optional configuration parameters have default values.
    config.blackList ??= [];
    config.whiteList ??= [];
    config.movementDuration ??= {};
    config.useClosure ??= false;
    config.closureOptions ??= {};
    config.debug ??= false;
    config.unregisterOnShutdown ??= false;

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
      const position = getCoverPosition(cover);
      cover.bridgedDevice.log.info(
        `Setting ${cover.tahomaDevice.label} target to ${CYAN}${isValidNumber(position, PERCENT100THS_MIN_OPEN, PERCENT100THS_MAX_CLOSED) ? position / 100 : 'unknown'} %${nf} position and status to stopped. Movement duration: ${CYAN}${cover.movementDuration}${nf}`,
      );
      if (isValidNumber(position, PERCENT100THS_MIN_OPEN, PERCENT100THS_MAX_CLOSED)) await setCoverStoppedAt(cover, position);
      else await setCoverStopped(cover);
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
      const duration = this.config.movementDuration[device.label] || 30;

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

      let cover: MatterbridgeEndpoint;
      let liftPanel: MatterbridgeEndpoint | undefined;
      if (this.config.useClosure) {
        // Window openers (e.g. Velux roof windows) are a Closure in their own right (ClosureTag.Window), not a covering,
        // so the ClosureCoveringTag material subtype only applies to actual coverings (blinds, shutters, awnings, ...).
        const isWindow = device.definition.uiClass === 'Window';
        const closureCover = new Closure(device.label, device.serialNumber, {
          powerSourceType: device.states.find((s) => s.name === 'core:BatteryDiscreteLevelState') ? 'Rechargeable' : 'Wired',
          tagList: isWindow ? [getSemtag(ClosureTag.Window)] : [getSemtag(ClosureTag.Covering), getSemtag(getCoveringTag(device))],
          calibration: this.config.closureOptions?.[device.label]?.calibration,
          ventilation: this.config.closureOptions?.[device.label]?.ventilation,
          pedestrian: this.config.closureOptions?.[device.label]?.pedestrian,
        });
        closureCover.createDefaultBasicInformationClusterServer(device.label, device.serialNumber, 0xfff1, 'Somfy Tahoma', 0x8000, device.definition.uiClass);
        // Window openers open by rotating on a hinge, not by translating up/down like a shutter or blind, so their
        // panel must advertise the Rotation feature (ClosureDimension.Feature.Rotation) via a 'tilt' panel tagged
        // ClosurePanelTag.Tilt instead of a 'lift'/ClosurePanelTag.Lift (Translation) panel.
        liftPanel = isWindow ? closureCover.addPanel('Tilt', [getSemtag(ClosurePanelTag.Tilt)], 'tilt') : closureCover.addPanel('Lift', [getSemtag(ClosurePanelTag.Lift)], 'lift');
        closureCover.addRequiredClusters();
        cover = closureCover;
      } else {
        cover = new MatterbridgeEndpoint([windowCovering, bridgedNode, powerSource], { id: device.label }, this.config.debug);
        cover.createDefaultIdentifyClusterServer(1, Identify.IdentifyType.Actuator);
        cover.createDefaultWindowCoveringClusterServer();
        cover.createDefaultBridgedDeviceBasicInformationClusterServer(device.label, device.serialNumber, 0xfff1, 'Somfy Tahoma', device.definition.uiClass);
        if (device.states.find((s) => s.name === 'core:BatteryDiscreteLevelState')) cover.createDefaultPowerSourceRechargeableBatteryClusterServer();
        else cover.createDefaultPowerSourceWiredClusterServer();
        cover.addRequiredClusters();
      }
      await this.registerDevice(cover);
      this.covers.set(device.label, { tahomaDevice: device, bridgedDevice: cover, liftPanel, movementStatus: WindowCovering.MovementStatus.Stopped, movementDuration: duration });

      cover.addCommandHandler('Identify.identify', async ({ request: { identifyTime } }) => {
        const cover = this.covers.get(device.label);
        if (!cover) return;
        cover.bridgedDevice.log.info(`Command ${ign}identify${rs}${nf} called identifyTime:${identifyTime}`);
        await this.sendCommand('identify', device, true);
      });

      if (liftPanel) {
        cover.addCommandHandler('ClosureControl.moveTo', ({ request: { position } }) => {
          const cover = this.covers.get(device.label);
          if (!cover) return;
          const targetPosition =
            position === ClosureControl.TargetPosition.MoveToFullyOpen
              ? PERCENT100THS_MIN_OPEN
              : position === ClosureControl.TargetPosition.MoveToFullyClosed
                ? PERCENT100THS_MAX_CLOSED
                : position === ClosureControl.TargetPosition.MoveToSignaturePosition
                  ? getSignaturePosition(this.config.closureOptions?.[cover.tahomaDevice.label]?.signaturePosition)
                  : undefined;
          if (targetPosition === undefined) {
            cover.bridgedDevice.log.warn(`Command moveTo called with unsupported position:${position}`);
            return;
          }
          const overallPosition = position === ClosureControl.TargetPosition.MoveToSignaturePosition ? ClosureControl.CurrentPosition.OpenedAtSignature : undefined;
          if (cover.commandTimeout) clearTimeout(cover.commandTimeout);
          // oxlint-disable-next-line typescript/no-misused-promises
          cover.commandTimeout = setTimeout(async () => {
            cover.commandTimeout = undefined;
            cover.bridgedDevice.log.info(`Command ${ign}moveTo${rs}${nf} ${CYAN}${targetPosition}${nf} called for ${CYAN}${cover.tahomaDevice.label}`);
            await this.moveToPosition(cover, targetPosition, overallPosition);
          }, 500);
        });

        cover.addCommandHandler('ClosureControl.stop', async () => {
          const cover = this.covers.get(device.label);
          if (!cover) return;
          cover.bridgedDevice.log.info(`Command ${ign}stop${rs}${nf} called for ${CYAN}${cover.tahomaDevice.label}. Status ${cover.movementStatus}`);
          if (cover.commandTimeout) clearTimeout(cover.commandTimeout);
          cover.commandTimeout = undefined;
          clearInterval(cover.moveInterval);
          cover.moveInterval = undefined;
          if (cover.movementStatus !== WindowCovering.MovementStatus.Stopped) {
            await this.sendCommand('stop', cover.tahomaDevice, true);
          }
          const position = getCoverPosition(cover);
          if (isValidNumber(position, PERCENT100THS_MIN_OPEN, PERCENT100THS_MAX_CLOSED)) await setCoverStoppedAt(cover, position);
          else await setCoverStopped(cover);
        });

        liftPanel.addCommandHandler('ClosureDimension.setTarget', ({ request: { position } }) => {
          const cover = this.covers.get(device.label);
          if (!cover) return;
          if (!isValidNumber(position, PERCENT100THS_MIN_OPEN, PERCENT100THS_MAX_CLOSED)) {
            cover.bridgedDevice.log.warn(`Command setTarget called with unsupported position:${position}`);
            return;
          }
          if (cover.commandTimeout) clearTimeout(cover.commandTimeout);
          // oxlint-disable-next-line typescript/no-misused-promises
          cover.commandTimeout = setTimeout(async () => {
            cover.commandTimeout = undefined;
            cover.bridgedDevice.log.info(`Command ${ign}setTarget${rs}${nf} ${CYAN}${position}${nf} called for ${CYAN}${cover.tahomaDevice.label}`);
            await this.moveToPosition(cover, position);
          }, 500);
        });
      } else {
        cover.addCommandHandler('WindowCovering.upOrOpen', () => {
          const cover = this.covers.get(device.label);
          if (!cover) return;
          if (cover.commandTimeout) clearTimeout(cover.commandTimeout);
          // oxlint-disable-next-line typescript/no-misused-promises
          cover.commandTimeout = setTimeout(async () => {
            cover.commandTimeout = undefined;
            cover.bridgedDevice.log.info(`Command ${ign}upOrOpen${rs}${nf} called for ${CYAN}${cover.tahomaDevice.label}`);
            await this.moveToPosition(cover, PERCENT100THS_MIN_OPEN);
          }, 500);
        });

        cover.addCommandHandler('WindowCovering.downOrClose', () => {
          const cover = this.covers.get(device.label);
          if (!cover) return;
          if (cover.commandTimeout) clearTimeout(cover.commandTimeout);
          // oxlint-disable-next-line typescript/no-misused-promises
          cover.commandTimeout = setTimeout(async () => {
            cover.commandTimeout = undefined;
            cover.bridgedDevice.log.info(`Command ${ign}downOrClose${rs}${nf} called for ${CYAN}${cover.tahomaDevice.label}`);
            await this.moveToPosition(cover, PERCENT100THS_MAX_CLOSED);
          }, 500);
        });

        cover.addCommandHandler('WindowCovering.goToLiftPercentage', ({ request: { liftPercent100thsValue } }) => {
          const cover = this.covers.get(device.label);
          if (!cover) return;
          if (cover.commandTimeout) clearTimeout(cover.commandTimeout);
          // oxlint-disable-next-line typescript/no-misused-promises
          cover.commandTimeout = setTimeout(async () => {
            cover.commandTimeout = undefined;
            cover.bridgedDevice.log.info(`Command ${ign}goToLiftPercentage${rs}${nf} ${CYAN}${liftPercent100thsValue}${nf} called for ${CYAN}${cover.tahomaDevice.label}`);
            await this.moveToPosition(cover, liftPercent100thsValue);
          }, 500);
        });

        cover.addCommandHandler('WindowCovering.stopMotion', async ({ attributes }) => {
          attributes.targetPositionLiftPercent100ths = attributes.currentPositionLiftPercent100ths;
          attributes.operationalStatus = {
            global: WindowCovering.MovementStatus.Stopped,
            lift: WindowCovering.MovementStatus.Stopped,
            tilt: WindowCovering.MovementStatus.Stopped,
          };
          const cover = this.covers.get(device.label);
          if (!cover) return;
          cover.bridgedDevice.log.info(`Command ${ign}stopMotion${rs}${nf} called for ${CYAN}${cover.tahomaDevice.label}. Status ${cover.movementStatus}`);
          clearInterval(cover.moveInterval);
          if (cover.movementStatus !== WindowCovering.MovementStatus.Stopped) {
            await this.sendCommand('stop', cover.tahomaDevice, true);
          }
          cover.movementStatus = WindowCovering.MovementStatus.Stopped;
        });
      }
    }
  }

  // With Matter 0=open 10000=close. Cluster-agnostic: reads/writes go through getCoverPosition/setCoverStoppedAt/
  // setCoverMoving/setCoverCurrentPosition, which branch on cover.liftPanel to target either the WindowCovering
  // cluster or the Closure/ClosureDimension clusters (see the useClosure config option).
  async moveToPosition(cover: Cover, targetPosition: number, overallPosition?: ClosureControl.CurrentPosition): Promise<void> {
    const log = cover.bridgedDevice.log;
    const position = getCoverPosition(cover);
    if (!isValidNumber(position, PERCENT100THS_MIN_OPEN, PERCENT100THS_MAX_CLOSED)) return;
    let currentPosition = position;
    log.info(`Moving from ${currentPosition} to ${targetPosition}...`);

    // Stop movement if already moving
    if (cover.movementStatus !== WindowCovering.MovementStatus.Stopped) {
      log.info('Stopping current movement.');
      clearInterval(cover.moveInterval);
      cover.moveInterval = undefined;
      await setCoverStoppedAt(cover, currentPosition);
      await this.sendCommand('stop', cover.tahomaDevice, true);
      return;
    }
    // Return if already at target position
    if (targetPosition === currentPosition) {
      clearInterval(cover.moveInterval);
      cover.moveInterval = undefined;
      await setCoverStoppedAt(cover, currentPosition, overallPosition);
      log.info(`Moving from ${currentPosition} to ${targetPosition}. No movement needed.`);
      return;
    }
    // Start movement
    const movement = targetPosition - currentPosition;
    const movementSeconds = Math.abs((movement * cover.movementDuration) / 10000);
    log.debug(`Moving from ${currentPosition} to ${targetPosition} in ${movementSeconds} seconds. Movement requested ${movement}`);
    await setCoverMoving(cover, targetPosition, targetPosition > currentPosition);
    await this.sendCommand(targetPosition > currentPosition ? 'close' : 'open', cover.tahomaDevice, true);

    // oxlint-disable-next-line typescript/no-misused-promises
    cover.moveInterval = setInterval(async () => {
      log.debug(`Moving interval from ${currentPosition} to ${targetPosition} with movement ${movement}`);
      currentPosition = Math.round(currentPosition + movement / movementSeconds);
      if (Math.abs(targetPosition - currentPosition) <= 100 || (movement > 0 && currentPosition >= targetPosition) || (movement < 0 && currentPosition <= targetPosition)) {
        clearInterval(cover.moveInterval);
        await setCoverStoppedAt(cover, targetPosition, overallPosition);
        if (targetPosition !== PERCENT100THS_MIN_OPEN && targetPosition !== PERCENT100THS_MAX_CLOSED) await this.sendCommand('stop', cover.tahomaDevice, true);
        log.debug(`Moving stopped at ${targetPosition}`);
      } else {
        log.debug(`Moving from ${currentPosition} to ${targetPosition} difference ${Math.abs(targetPosition - currentPosition)}`);
        await setCoverCurrentPosition(cover, currentPosition);
      }
    }, 1000);
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
