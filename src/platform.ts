import path from 'node:path';
import { promises as fs } from 'node:fs';

import { PlatformConfig, Matterbridge, MatterbridgeDynamicPlatform, bridgedNode, powerSource, MatterbridgeEndpoint, coverDevice } from 'matterbridge';
import { AnsiLogger, BLUE, debugStringify, rs, CYAN, ign, nf, YELLOW } from 'matterbridge/logger';
import { NodeStorageManager } from 'matterbridge/storage';
import { isValidNumber, isValidString } from 'matterbridge/utils';
import { WindowCovering } from 'matterbridge/matter/clusters';
import { Action, Client, Command, Device, Execution } from 'overkiz-client';

type MovementDuration = Record<string, number>;
const Stopped = WindowCovering.MovementStatus.Stopped;
const Opening = WindowCovering.MovementStatus.Opening;
const Closing = WindowCovering.MovementStatus.Closing;

interface Cover {
  tahomaDevice: Device;
  bridgedDevice: MatterbridgeEndpoint;
  movementDuration: number;
  movementStatus: WindowCovering.MovementStatus;
  moveInterval?: NodeJS.Timeout;
  commandTimeout?: NodeJS.Timeout;
}

export class SomfyTahomaPlatform extends MatterbridgeDynamicPlatform {
  private tahomaDevices: Device[] = [];
  private bridgedDevices: MatterbridgeEndpoint[] = [];
  covers = new Map<string, Cover>();

  // NodeStorageManager
  private nodeStorageManager: NodeStorageManager;

  // TaHoma
  private tahomaClient?: Client;
  private movementDuration: MovementDuration = {};
  private connected = false;

  constructor(matterbridge: Matterbridge, log: AnsiLogger, config: PlatformConfig) {
    super(matterbridge, log, config);

    // Verify that Matterbridge is the correct version
    if (this.verifyMatterbridgeVersion === undefined || typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.0.0')) {
      throw new Error(
        `This plugin requires Matterbridge version >= "3.0.0". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend."`,
      );
    }

    this.log.info('Initializing platform:', this.config.name);

    if (config.movementDuration) this.movementDuration = config.movementDuration as MovementDuration;

    // create NodeStorageManager
    this.nodeStorageManager = new NodeStorageManager({
      dir: path.join(matterbridge.matterbridgePluginDirectory, 'matterbridge-somfy-tahoma'),
      logging: false,
    });

    if (!isValidString(this.config.username) || !isValidString(this.config.password) || !isValidString(this.config.service)) {
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
      this.log.error('TaHoma service not created');
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
    await super.onConfigure();
    this.log.info('onConfigure called');
    if (!this.tahomaClient) {
      this.log.error('TaHoma service not created');
      return;
    }

    // Set cover to target = current position and status to stopped (current position persists in the cluster)
    for (const device of this.bridgedDevices) {
      const cover = this.covers.get(device.deviceName ?? '');
      const position = await device.getAttribute(WindowCovering.Cluster.id, 'currentPositionLiftPercent100ths', device.log);
      cover?.bridgedDevice.log.info(
        `Setting ${device.deviceName} target to ${CYAN}${position / 100}%${nf} position and status to stopped. Movement duration: ${CYAN}${cover?.movementDuration}${nf}`,
      );
      await device.setWindowCoveringTargetAsCurrentAndStopped();
    }
  }

  override async onShutdown(reason?: string) {
    await super.onShutdown(reason);
    this.log.info('onShutdown called with reason:', reason ?? 'none');
    if (!this.tahomaClient) {
      this.log.error('TaHoma service not created');
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

  private async discoverDevices() {
    // TaHoma
    if (!this.tahomaClient) {
      this.log.error('TaHoma service not created');
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

    this.log.info(`Discovered ${devices.length} TaHoma devices`);

    // Create the plugin directory inside the Matterbridge plugin directory
    await fs.mkdir(path.join(this.matterbridge.matterbridgePluginDirectory, 'matterbridge-somfy-tahoma'), { recursive: true });

    // Write the discovered devices to a file
    const fileName = path.join(this.matterbridge.matterbridgePluginDirectory, 'matterbridge-somfy-tahoma', 'devices.json');
    fs.writeFile(fileName, JSON.stringify(devices, null, 2))
      .then(() => {
        this.log.debug(`Devices successfully written to ${fileName}`);
        return;
      })
      .catch((error) => {
        this.log.error(`Error writing devices to ${fileName}:`, error);
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

      const cover = new MatterbridgeEndpoint([coverDevice, bridgedNode, powerSource], { uniqueStorageKey: device.label }, this.config.debug as boolean);
      cover.createDefaultIdentifyClusterServer();
      cover.createDefaultGroupsClusterServer();
      // cover.createDefaultScenesClusterServer();
      cover.createDefaultWindowCoveringClusterServer();
      cover.createDefaultBridgedDeviceBasicInformationClusterServer(device.label, device.serialNumber, 0xfff1, 'Somfy Tahoma', device.definition.uiClass);
      cover.createDefaultPowerSourceWiredClusterServer();
      await this.registerDevice(cover);
      this.bridgedDevices.push(cover);
      this.covers.set(device.label, { tahomaDevice: device, bridgedDevice: cover, movementStatus: Stopped, movementDuration: duration });

      cover.addCommandHandler('identify', async ({ request: { identifyTime } }) => {
        const cover = this.covers.get(device.label);
        if (!cover) return;
        cover.bridgedDevice.log.info(`Command ${ign}identify${rs}${nf} called identifyTime:${identifyTime}`);
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
        await cover.bridgedDevice.setAttribute(WindowCovering.Cluster.id, 'targetPositionLiftPercent100ths', liftPercent100thsValue, cover.bridgedDevice.log);
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
    let currentPosition = cover.bridgedDevice.getAttribute(WindowCovering.Cluster.id, 'currentPositionLiftPercent100ths', log);
    if (!isValidNumber(currentPosition, 0, 10000)) return;
    log.info(`Moving from ${currentPosition} to ${targetPosition}...`);

    // Stop movement if already moving
    if ((await cover.movementStatus) !== Stopped) {
      log.info('Stopping current movement.');
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
      log.info(`Moving from ${currentPosition} to ${targetPosition}. No movement needed.`);
      return;
    }
    // Start movement
    const movement = targetPosition - currentPosition;
    const movementSeconds = Math.abs((movement * cover.movementDuration) / 10000);
    log.debug(`Moving from ${currentPosition} to ${targetPosition} in ${movementSeconds} seconds. Movement requested ${movement}`);
    cover.bridgedDevice.setAttribute(WindowCovering.Cluster.id, 'targetPositionLiftPercent100ths', targetPosition, log);

    await cover.bridgedDevice.setWindowCoveringStatus(targetPosition > currentPosition ? WindowCovering.MovementStatus.Closing : WindowCovering.MovementStatus.Opening);
    cover.movementStatus = targetPosition > currentPosition ? Closing : Opening;
    await this.sendCommand(targetPosition > currentPosition ? 'close' : 'open', cover.tahomaDevice, true);

    cover.moveInterval = setInterval(async () => {
      log.debug(`Moving interval from ${currentPosition} to ${targetPosition} with movement ${movement}`);
      if (currentPosition === null) return;
      currentPosition = Math.round(currentPosition + movement / movementSeconds);
      if (Math.abs(targetPosition - currentPosition) <= 100 || (movement > 0 && currentPosition >= targetPosition) || (movement < 0 && currentPosition <= targetPosition)) {
        clearInterval(cover.moveInterval);
        await cover.bridgedDevice.setWindowCoveringCurrentTargetStatus(targetPosition, targetPosition, WindowCovering.MovementStatus.Stopped);
        cover.movementStatus = Stopped;
        if (targetPosition !== 0 && targetPosition !== 10000) await this.sendCommand('stop', cover.tahomaDevice, true);
        log.debug(`Moving stopped at ${targetPosition}`);
      } else {
        log.debug(`Moving from ${currentPosition} to ${targetPosition} difference ${Math.abs(targetPosition - currentPosition)}`);
        await cover.bridgedDevice.setAttribute(WindowCovering.Cluster.id, 'currentPositionLiftPercent100ths', Math.max(0, Math.min(currentPosition, 10000)), log);
      }
    }, 1000);
  }

  private async sendCommand(command: string, device: Device, highPriority = false) {
    if (command === 'open' && !device.commands.includes('open') && device.commands.includes('rollOut')) command = 'rollOut';
    if (command === 'close' && !device.commands.includes('close') && device.commands.includes('rollUp')) command = 'rollUp';

    if (command === 'open' && !device.commands.includes('open') && device.commands.includes('up')) command = 'up';
    if (command === 'close' && !device.commands.includes('close') && device.commands.includes('down')) command = 'down';

    this.log.info(`Sending command ${YELLOW}${command}${nf} highPriority ${highPriority}`);
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
