import {
  PlatformConfig,
  WindowCovering,
  WindowCoveringCluster,
  Matterbridge,
  MatterbridgeDevice,
  MatterbridgeDynamicPlatform,
  DeviceTypeDefinition,
  AtLeastOne,
  EndpointOptions,
  bridgedNode,
  powerSource,
  MatterbridgeEndpoint,
  coverDevice,
} from 'matterbridge';
import { AnsiLogger, BLUE, debugStringify, dn, rs, wr } from 'matterbridge/logger';
import { isValidNumber } from 'matterbridge/utils';
import { NodeStorageManager } from 'matterbridge/storage';

import { Action, Client, Command, Device, Execution } from 'overkiz-client';
import path from 'path';
import { CYAN, db, ign, nf, YELLOW } from 'node-ansi-logger';

type MovementDuration = Record<string, number>;
const Stopped = WindowCovering.MovementStatus.Stopped;
const Opening = WindowCovering.MovementStatus.Opening;
const Closing = WindowCovering.MovementStatus.Closing;

interface Cover {
  tahomaDevice: Device;
  bridgedDevice: MatterbridgeDevice;
  movementDuration: number;
  movementStatus: WindowCovering.MovementStatus;
  moveInterval?: NodeJS.Timeout;
  commandTimeout?: NodeJS.Timeout;
}

export class SomfyTahomaPlatform extends MatterbridgeDynamicPlatform {
  private tahomaDevices: Device[] = [];
  private bridgedDevices: MatterbridgeDevice[] = [];
  private covers = new Map<string, Cover>();

  // NodeStorageManager
  private nodeStorageManager: NodeStorageManager;

  // TaHoma
  private tahomaClient?: Client;
  private username = '';
  private password = '';
  private service = 'somfy_europe';
  private whiteList: string[] = [];
  private blackList: string[] = [];
  private movementDuration: MovementDuration = {};
  private connected = false;

  async createMutableDevice(definition: DeviceTypeDefinition | AtLeastOne<DeviceTypeDefinition>, options: EndpointOptions = {}, debug = false): Promise<MatterbridgeDevice> {
    let device: MatterbridgeDevice;
    if (this.matterbridge.edge === true) device = new MatterbridgeEndpoint(definition, options, debug) as unknown as MatterbridgeDevice;
    else device = new MatterbridgeDevice(definition, undefined, debug);
    return device;
  }

  constructor(matterbridge: Matterbridge, log: AnsiLogger, config: PlatformConfig) {
    super(matterbridge, log, config);

    // Verify that Matterbridge is the correct version
    if (this.verifyMatterbridgeVersion === undefined || typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('1.6.5')) {
      throw new Error(
        `This plugin requires Matterbridge version >= "1.6.5". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend."`,
      );
    }

    this.log.info('Initializing platform:', this.config.name);

    if (config.username) this.username = config.username as string;
    if (config.password) this.password = config.password as string;
    if (config.service) this.service = config.service as string;
    if (config.whiteList) this.whiteList = config.whiteList as string[];
    if (config.blackList) this.blackList = config.blackList as string[];
    if (config.movementDuration) this.movementDuration = config.movementDuration as MovementDuration;

    // create NodeStorageManager
    this.nodeStorageManager = new NodeStorageManager({
      dir: path.join(matterbridge.matterbridgePluginDirectory, 'matterbridge-somfy-tahoma'),
      logging: false,
    });

    if (!this.config.username || !this.config.password || !this.config.service) {
      this.log.error('No service or username or password provided for:', this.config.name);
      return;
      // throw new Error(`No service or username or password provided for ${this.config.name}`);
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

  override async onStart(reason?: string) {
    this.log.info('onStart called with reason:', reason ?? 'none');
    if (!this.tahomaClient) {
      this.log.error('TaHoma service not connected');
      return;
    }
    try {
      await this.tahomaClient.connect(this.config.username as string, this.config.password as string);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      this.log.error('Error connecting to TaHoma service:', error.response?.data);
      return;
    }
    await this.discoverDevices();
  }

  override async onConfigure() {
    this.log.info('onConfigure called');
    if (!this.tahomaClient) {
      this.log.error('TaHoma service not connected');
      return;
    }

    // Set cover to target = current position and status to stopped (current position persists in the cluster)
    for (const device of this.bridgedDevices) {
      const cover = this.covers.get(device.deviceName ?? '');
      const position = await device.getAttribute(WindowCoveringCluster.id, 'currentPositionLiftPercent100ths', device.log);
      cover?.bridgedDevice.log.info(
        `Setting ${device.deviceName} target to ${CYAN}${position / 100}%${nf} position and status to stopped. Movement duration: ${CYAN}${cover?.movementDuration}${nf}`,
      );
      await device.setWindowCoveringTargetAsCurrentAndStopped();
    }
  }

  override async onShutdown(reason?: string) {
    this.log.info('onShutdown called with reason:', reason ?? 'none');
    if (!this.tahomaClient) {
      this.log.error('TaHoma service not connected');
    } else {
      this.tahomaClient.removeAllListeners();
    }
    this.tahomaClient = undefined;
    this.covers.forEach((cover) => {
      clearInterval(cover.moveInterval);
      cover.moveInterval = undefined;
      clearTimeout(cover.commandTimeout);
      cover.commandTimeout = undefined;
    });
    this.covers.clear();
    if (this.config.unregisterOnShutdown === true) await this.unregisterAllDevices();
  }

  public validateWhiteBlackList(entityName: string) {
    if (this.whiteList.length > 0 && !this.whiteList.find((name) => name === entityName)) {
      this.log.warn(`Skipping ${dn}${entityName}${wr} because not in whitelist`);
      return false;
    }
    if (this.blackList.length > 0 && this.blackList.find((name) => name === entityName)) {
      this.log.warn(`Skipping ${dn}${entityName}${wr} because in blacklist`);
      return false;
    }
    return true;
  }

  private async discoverDevices() {
    // TaHoma
    if (!this.tahomaClient) {
      return;
    }
    let devices: Device[] = [];
    try {
      devices = await this.tahomaClient.getDevices();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      this.log.error('Error discovering TaHoma devices:', error.response?.data);
      return;
    }

    this.log.info('TaHoma', devices.length, 'devices discovered');

    for (const device of devices) {
      this.log.debug(`Device: ${BLUE}${device.label}${rs}`);
      this.log.debug(`- uniqueName ${device.uniqueName}`);
      this.log.debug(`- uiClass ${device.definition.uiClass}`);
      this.log.debug(`- serial ${device.serialNumber}`);
      this.log.debug(`- deviceURL ${device.deviceURL}`);
      this.log.debug(`- commands ${debugStringify(device.commands)}`);
      this.log.debug(`- states ${debugStringify(device.states)}`);
      // this.log.debug(`Device: ${device.label} uniqueName ${device.uniqueName} uiClass ${device.definition.uiClass} deviceURL ${device.deviceURL} serial ${device.serialNumber}`);
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
    this.log.info('TaHoma', this.tahomaDevices.length, 'screens discovered');
    for (const device of this.tahomaDevices) {
      if (!this.validateWhiteBlackList(device.label)) {
        continue;
      }
      const duration = this.movementDuration[device.label] || 30;

      this.log.debug(`Adding device: ${BLUE}${device.label}${rs}`);
      this.log.debug(`- uniqueName ${device.uniqueName}`);
      this.log.debug(`- uiClass ${device.definition?.uiClass}`);
      this.log.debug(`- serial ${device.serialNumber}`);
      this.log.debug(`- deviceURL ${device.deviceURL}`);
      this.log.debug(`- commands ${debugStringify(device.commands)}`);
      this.log.debug(`- states ${debugStringify(device.states)}`);
      this.log.debug(`- duration ${duration}`);

      const cover = await this.createMutableDevice(coverDevice, { uniqueStorageKey: device.label }, this.config.debug as boolean);
      cover.createDefaultIdentifyClusterServer();
      cover.createDefaultGroupsClusterServer();
      cover.createDefaultScenesClusterServer();
      cover.createDefaultWindowCoveringClusterServer();
      cover.addDeviceType(bridgedNode);
      cover.createDefaultBridgedDeviceBasicInformationClusterServer(device.label, device.serialNumber, 0xfff1, 'Somfy Tahoma', device.definition.uiClass);
      cover.addDeviceType(powerSource);
      cover.createDefaultPowerSourceWiredClusterServer();
      await this.registerDevice(cover);
      this.bridgedDevices.push(cover);
      this.covers.set(device.label, { tahomaDevice: device, bridgedDevice: cover, movementStatus: Stopped, movementDuration: duration });

      cover.addCommandHandler('identify', async ({ request: { identifyTime } }) => {
        this.log.info(`Command ${ign}identify${rs}${nf} called identifyTime:${identifyTime}`);
        await this.sendCommand('identify', device, true);
      });

      cover.addCommandHandler('upOrOpen', async () => {
        const cover = this.covers.get(device.label);
        if (!cover) return;
        cover.bridgedDevice.log.info(`Command ${ign}upOrOpen${rs}${nf} called for ${CYAN}${cover.tahomaDevice.label}`);
        await this.moveToPosition(cover, 0);
        /*
        clearInterval(cover.moveInterval);
        cover.movementStatus = Stopped;
        await cover.bridgedDevice.setWindowCoveringCurrentTargetStatus(0, 0, WindowCovering.MovementStatus.Stopped);
        await this.sendCommand('open', cover.tahomaDevice, true);
        */
      });

      cover.addCommandHandler('downOrClose', async () => {
        const cover = this.covers.get(device.label);
        if (!cover) return;
        cover.bridgedDevice.log.info(`Command ${ign}downOrClose${rs}${nf} called for ${CYAN}${cover.tahomaDevice.label}`);
        await this.moveToPosition(cover, 10000);
        /*
        clearInterval(cover.moveInterval);
        cover.movementStatus = Stopped;
        await cover.bridgedDevice.setWindowCoveringCurrentTargetStatus(10000, 10000, WindowCovering.MovementStatus.Stopped);
        await this.sendCommand('close', cover.tahomaDevice, true);
        */
      });

      cover.addCommandHandler('stopMotion', async () => {
        const cover = this.covers.get(device.label);
        if (!cover) return;
        cover.bridgedDevice.log.info(`Command ${ign}stopMotion${rs}${nf} called for ${CYAN}${cover.tahomaDevice.label}. Status ${cover.movementStatus}`);
        clearInterval(cover.moveInterval);
        if (cover.movementStatus !== WindowCovering.MovementStatus.Stopped) {
          await this.sendCommand('stop', cover.tahomaDevice, true);
        }
        cover.movementStatus = Stopped;
        await cover.bridgedDevice.setWindowCoveringTargetAsCurrentAndStopped();
      });

      cover.addCommandHandler('goToLiftPercentage', async ({ request: { liftPercent100thsValue } }) => {
        const cover = this.covers.get(device.label);
        if (!cover) return;
        await cover.bridgedDevice.setAttribute(WindowCoveringCluster.id, 'targetPositionLiftPercent100ths', liftPercent100thsValue, cover.bridgedDevice.log);
        if (cover.commandTimeout) clearTimeout(cover.commandTimeout);
        cover.commandTimeout = setTimeout(async () => {
          cover.commandTimeout = undefined;
          cover.bridgedDevice.log.info(`Command ${ign}goToLiftPercentage${rs}${nf} ${CYAN}${liftPercent100thsValue}${nf} called for ${CYAN}${cover.tahomaDevice.label}`);
          await this.moveToPosition(cover, liftPercent100thsValue);
        }, 1000);
      });
    }
  }

  // With Matter 0=open 10000=close
  private async moveToPosition(cover: Cover, targetPosition: number) {
    const log = cover.bridgedDevice.log;
    let currentPosition = cover.bridgedDevice.getAttribute(WindowCoveringCluster.id, 'currentPositionLiftPercent100ths', log);
    if (!isValidNumber(currentPosition, 0, 10000)) return;
    log.info(`Moving from ${currentPosition} to ${targetPosition}...`);

    // Stop movement if already moving
    if ((await cover.movementStatus) !== Stopped) {
      log.info('*Stopping current movement.');
      clearInterval(cover.moveInterval);
      await cover.bridgedDevice.setWindowCoveringTargetAsCurrentAndStopped();
      await this.sendCommand('stop', cover.tahomaDevice, true);
      cover.movementStatus = Stopped;
      return;
    }
    // Return if already at target position
    if (targetPosition === currentPosition) {
      clearInterval(cover.moveInterval);
      await cover.bridgedDevice.setWindowCoveringTargetAsCurrentAndStopped();
      cover.movementStatus = Stopped;
      log.info(`*Moving from ${currentPosition} to ${targetPosition}. No movement needed.`);
      return;
    }
    // Start movement
    const movement = targetPosition - currentPosition;
    const movementSeconds = Math.abs((movement * cover.movementDuration) / 10000);
    log.debug(`*Moving from ${currentPosition} to ${targetPosition} in ${movementSeconds} seconds. Movement requested ${movement}`);
    cover.bridgedDevice.setAttribute(WindowCoveringCluster.id, 'targetPositionLiftPercent100ths', targetPosition, log);

    await cover.bridgedDevice.setWindowCoveringStatus(targetPosition > currentPosition ? WindowCovering.MovementStatus.Closing : WindowCovering.MovementStatus.Opening);
    cover.movementStatus = targetPosition > currentPosition ? Closing : Opening;
    await this.sendCommand(targetPosition > currentPosition ? 'close' : 'open', cover.tahomaDevice, true);

    cover.moveInterval = setInterval(async () => {
      log.debug(`**Moving interval from ${currentPosition} to ${targetPosition} with movement ${movement}`);
      if (currentPosition === null) return;
      currentPosition = Math.round(currentPosition + movement / movementSeconds);
      if (Math.abs(targetPosition - currentPosition) <= 100 || (movement > 0 && currentPosition >= targetPosition) || (movement < 0 && currentPosition <= targetPosition)) {
        clearInterval(cover.moveInterval);
        await cover.bridgedDevice.setWindowCoveringCurrentTargetStatus(targetPosition, targetPosition, WindowCovering.MovementStatus.Stopped);
        cover.movementStatus = Stopped;
        if (targetPosition !== 0 && targetPosition !== 10000) await this.sendCommand('stop', cover.tahomaDevice, true);
        log.debug(`*Moving stopped at ${targetPosition}`);
      } else {
        log.debug(`*Moving from ${currentPosition} to ${targetPosition} difference ${Math.abs(targetPosition - currentPosition)}`);
        await cover.bridgedDevice.setAttribute(WindowCoveringCluster.id, 'currentPositionLiftPercent100ths', Math.max(0, Math.min(currentPosition, 10000)), log);
      }
    }, 1000);
  }

  private async sendCommand(command: string, device: Device, highPriority = false) {
    if (command === 'open' && !device.commands.includes('open') && device.commands.includes('rollOut')) command = 'rollOut';
    if (command === 'close' && !device.commands.includes('close') && device.commands.includes('rollUp')) command = 'rollUp';

    if (command === 'open' && !device.commands.includes('open') && device.commands.includes('up')) command = 'up';
    if (command === 'close' && !device.commands.includes('close') && device.commands.includes('down')) command = 'down';

    this.log.debug(`*Sending command ${YELLOW}${command}${db} highPriority ${highPriority}`);
    try {
      const _command = new Command(command);
      const _action = new Action(device.deviceURL, [_command]);
      const _execution = new Execution('Sending ' + command, _action);
      await this.tahomaClient?.execute(highPriority ? 'apply/highPriority' : 'apply', _execution);
    } catch (error) {
      this.log.error(`Error sending command: ${error instanceof Error ? error.message : error}`);
    }
  }
}
