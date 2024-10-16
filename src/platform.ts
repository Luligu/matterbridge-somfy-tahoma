import { DeviceTypes, PlatformConfig, WindowCovering, WindowCoveringCluster, Matterbridge, MatterbridgeDevice, MatterbridgeDynamicPlatform } from 'matterbridge';
import { AnsiLogger, BLUE, debugStringify, dn, rs, wr } from 'matterbridge/logger';
import { NodeStorageManager } from 'matterbridge/storage';

import { Action, Client, Command, Device, Execution } from 'overkiz-client';
import path from 'path';

type MovementDuration = Record<string, number>;

export class SomfyTahomaPlatform extends MatterbridgeDynamicPlatform {
  private tahomaDevices: Device[] = [];
  private bridgedDevices: MatterbridgeDevice[] = [];
  moveInterval: NodeJS.Timeout | undefined = undefined;

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

  constructor(matterbridge: Matterbridge, log: AnsiLogger, config: PlatformConfig) {
    super(matterbridge, log, config);

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

    // Set cover to target = current position and status to stopped (current position is persisted in the cluster)
    for (const device of this.bridgedDevices) device.setWindowCoveringTargetAsCurrentAndStopped();
  }

  override async onShutdown(reason?: string) {
    this.log.info('onShutdown called with reason:', reason ?? 'none');
    if (!this.tahomaClient) {
      this.log.error('TaHoma service not connected');
    } else {
      this.tahomaClient.removeAllListeners();
    }
    this.tahomaClient = undefined;
    clearInterval(this.moveInterval);
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

      const cover = new MatterbridgeDevice(DeviceTypes.WINDOW_COVERING, undefined, this.config.debug as boolean);
      cover.createDefaultIdentifyClusterServer();
      cover.createDefaultGroupsClusterServer();
      cover.createDefaultScenesClusterServer();
      cover.createDefaultBridgedDeviceBasicInformationClusterServer(device.label, device.serialNumber, 0xfff1, 'Somfy Tahoma', device.definition.uiClass);
      cover.createDefaultPowerSourceWiredClusterServer();
      cover.createDefaultWindowCoveringClusterServer();
      await this.registerDevice(cover);
      this.bridgedDevices.push(cover);

      cover.addCommandHandler('identify', async ({ request: { identifyTime } }) => {
        this.log.info(`Command identify called identifyTime:${identifyTime}`);
        await this.sendCommand('identify', device, true);
      });

      cover.addCommandHandler('goToLiftPercentage', async ({ request: { liftPercent100thsValue } }) => {
        this.log.info(`Command goToLiftPercentage called liftPercent100thsValue:${liftPercent100thsValue}`);
        await this.moveToPosition(cover, device, liftPercent100thsValue, duration);
      });

      cover.addCommandHandler('upOrOpen', async () => {
        this.log.info('Command upOrOpen called');
        await this.sendCommand('open', device, true);
        clearInterval(this.moveInterval);
        cover.setWindowCoveringCurrentTargetStatus(0, 0, WindowCovering.MovementStatus.Stopped);
        // await this.moveToPosition(cover, device, 0, duration);
      });

      cover.addCommandHandler('downOrClose', async () => {
        this.log.info('Command downOrClose called');
        await this.sendCommand('close', device, true);
        clearInterval(this.moveInterval);
        cover.setWindowCoveringCurrentTargetStatus(10000, 10000, WindowCovering.MovementStatus.Stopped);
        // await this.moveToPosition(cover, device, 10000, duration);
      });

      cover.addCommandHandler('stopMotion', async () => {
        this.log.info('Command stopMotion called');
        clearInterval(this.moveInterval);
        cover.setWindowCoveringTargetAsCurrentAndStopped();
      });
    }
  }

  // With Matter 0=open 10000=close
  private async moveToPosition(cover: MatterbridgeDevice, tahomaDevice: Device, targetPosition: number, fullMovementSeconds = 30) {
    const windowCovering = cover.getClusterServer(WindowCoveringCluster.with(WindowCovering.Feature.Lift, WindowCovering.Feature.PositionAwareLift));
    if (!windowCovering) return;

    // Stop movement if already moving
    if (cover.getWindowCoveringStatus() !== WindowCovering.MovementStatus.Stopped) {
      this.log.info('*Stopping movement.');
      clearInterval(this.moveInterval);
      cover.setWindowCoveringTargetAsCurrentAndStopped();
      await this.sendCommand('stop', tahomaDevice, true);
      return;
    }
    // Return if already at target position
    let currentPosition = windowCovering.getCurrentPositionLiftPercent100thsAttribute();
    if (currentPosition === null) return;
    if (targetPosition === currentPosition) {
      clearInterval(this.moveInterval);
      cover.setWindowCoveringTargetAsCurrentAndStopped();
      this.log.info(`*Moving from ${currentPosition} to ${targetPosition}. No movement needed.`);
      // await this.sendCommand('stop', tahomaDevice, true);
      return;
    }
    // Start movement
    const movement = targetPosition - currentPosition;
    const movementSeconds = Math.abs((movement * fullMovementSeconds) / 10000);
    this.log.info(`*Moving from ${currentPosition} to ${targetPosition} in ${movementSeconds} seconds. Movement requested ${movement}`);
    windowCovering.setTargetPositionLiftPercent100thsAttribute(targetPosition);
    cover.setWindowCoveringStatus(targetPosition > currentPosition ? WindowCovering.MovementStatus.Closing : WindowCovering.MovementStatus.Opening);
    await this.sendCommand(targetPosition > currentPosition ? 'close' : 'open', tahomaDevice, true);

    this.moveInterval = setInterval(async () => {
      // this.log.info(`**Moving interval from ${currentPosition} to ${targetPosition}`);
      if (currentPosition === null) return;
      currentPosition = Math.round(currentPosition + movement / movementSeconds);
      if (Math.abs(targetPosition - currentPosition) <= 100 || (movement > 0 && currentPosition >= targetPosition) || (movement < 0 && currentPosition <= targetPosition)) {
        clearInterval(this.moveInterval);
        cover.setWindowCoveringCurrentTargetStatus(targetPosition, targetPosition, WindowCovering.MovementStatus.Stopped);
        await this.sendCommand('stop', tahomaDevice, true);
        this.log.info(`*Moving stopped at ${targetPosition}`);
      } else {
        this.log.info(`*Moving from ${currentPosition} to ${targetPosition} difference ${Math.abs(targetPosition - currentPosition)}`);
        windowCovering.setCurrentPositionLiftPercent100thsAttribute(Math.max(0, Math.min(currentPosition, 10000)));
      }
    }, 1000);
  }

  private async sendCommand(command: string, device: Device, highPriority = false) {
    if (command === 'open' && !device.commands.includes('open') && device.commands.includes('rollOut')) command = 'rollOut';
    if (command === 'close' && !device.commands.includes('close') && device.commands.includes('rollUp')) command = 'rollUp';

    if (command === 'open' && !device.commands.includes('open') && device.commands.includes('up')) command = 'up';
    if (command === 'close' && !device.commands.includes('close') && device.commands.includes('down')) command = 'down';

    this.log.debug(`*Sending command ${command} highPriority ${highPriority}`);
    try {
      const _command = new Command(command);
      const _action = new Action(device.deviceURL, [_command]);
      const _execution = new Execution('Sending ' + command, _action);
      await this.tahomaClient?.execute(highPriority ? 'apply/highPriority' : 'apply', _execution);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      this.log.error('Error sending command');
    }
  }
}
