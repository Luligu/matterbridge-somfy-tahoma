/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ClusterServerObj,
  coverDevice,
  Identify,
  IdentifyCluster,
  Matterbridge,
  MatterbridgeDevice,
  MatterbridgeEndpoint,
  PlatformConfig,
  WindowCovering,
  WindowCoveringCluster,
} from 'matterbridge';
import { AnsiLogger, BLUE, CYAN, dn, ign, LogLevel, nf, rs, wr, YELLOW } from 'matterbridge/logger';
import { wait } from 'matterbridge/utils';
import { SomfyTahomaPlatform } from './platform';

import { jest } from '@jest/globals';
import { Client, Device } from 'overkiz-client';
import { promises as fs } from 'fs';
import path from 'path';

async function invokeCommands(cluster: ClusterServerObj, data?: Record<string, boolean | number | bigint | string | object | null | undefined>): Promise<void> {
  const commands = (cluster as any).commands as object;
  for (const [key, value] of Object.entries(commands)) {
    if (typeof value.handler === 'function') await value.handler(data ?? {});
  }
}

async function invokeCommand(cluster: ClusterServerObj, command: string, data?: Record<string, boolean | number | bigint | string | object | null | undefined>): Promise<void> {
  const commands = (cluster as any).commands as object;
  for (const [key, value] of Object.entries(commands)) {
    if (key === command && typeof value.handler === 'function') await value.handler(data ?? {});
  }
}

describe('TestPlatform', () => {
  let mockMatterbridge: Matterbridge;
  let mockLog: AnsiLogger;
  let mockConfig: PlatformConfig;
  let somfyPlatform: SomfyTahomaPlatform;

  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let loggerLogSpy: jest.SpiedFunction<(level: LogLevel, message: string, ...parameters: any[]) => void>;

  let clientConnectSpy: jest.SpiedFunction<(user: string, password: string) => Promise<void>>;
  let clientGetDevicesSpy: jest.SpiedFunction<() => Promise<Device[]>>;
  let clientExecuteSpy: jest.SpiedFunction<(oid: any, execution: any) => Promise<any>>;

  const mockDevices = [
    {
      deviceURL: 'url',
      label: 'Device1',
      uniqueName: 'Blind',
      serialNumber: '123456789',
      definition: { uiClass: 'Screen' },
      states: [],
      commands: ['open', 'close', 'stop'],
    } as unknown as Device,
  ];

  beforeAll(() => {
    // Spy on and mock the AnsiLogger.log method
    loggerLogSpy = jest.spyOn(AnsiLogger.prototype, 'log').mockImplementation((level: string, message: string, ...parameters: any[]) => {
      // console.error(`Mocked AnsiLogger.log: ${level} - ${message}`, ...parameters);
    });

    // Spy on the Client.connect method
    clientConnectSpy = jest.spyOn(Client.prototype, 'connect').mockImplementation((user: string, password: string) => {
      // console.error(`Mocked Client.connect(${user}, ${password})`);
      return Promise.resolve();
    });
    clientGetDevicesSpy = jest.spyOn(Client.prototype, 'getDevices').mockImplementation(() => {
      // console.error(`Mocked Client.getDevices()`);
      return Promise.resolve([]);
    });
    clientExecuteSpy = jest.spyOn(Client.prototype, 'execute').mockImplementation((oid: any, execution: any) => {
      // console.error(`Mocked Client.execute(${oid}, ${execution})`);
      return Promise.resolve();
    });

    mockMatterbridge = {
      matterbridgeDirectory: '',
      matterbridgePluginDirectory: 'temp',
      systemInformation: { ipv4Address: undefined },
      matterbridgeVersion: '1.6.5',
      edge: false,
      addBridgedDevice: jest.fn(async (pluginName: string, device: MatterbridgeDevice) => {
        // console.error('addBridgedDevice called');
      }),
      addBridgedEndpoint: jest.fn(async (pluginName: string, device: MatterbridgeEndpoint) => {
        device.number = 100;
        // console.error('addBridgedEndpoint called');
      }),
      removeBridgedDevice: jest.fn(async (pluginName: string, device: MatterbridgeDevice) => {
        // console.error('removeBridgedDevice called');
      }),
      removeBridgedEndpoint: jest.fn(async (pluginName: string, device: MatterbridgeEndpoint) => {
        // console.error('removeBridgedEndpoint called');
      }),
      removeAllBridgedDevices: jest.fn(async (pluginName: string) => {
        // console.error('removeAllBridgedDevices called');
      }),
      removeAllBridgedEndpoints: jest.fn(async (pluginName: string) => {
        // console.error('removeAllBridgedEndpoints called');
      }),
    } as unknown as Matterbridge;
    mockLog = {
      fatal: jest.fn((message: string, ...parameters: any[]) => {
        // console.error('mockLog.fatal', message, ...parameters);
      }),
      error: jest.fn((message: string, ...parameters: any[]) => {
        // console.error('mockLog.error', message, ...parameters);
      }),
      warn: jest.fn((message: string, ...parameters: any[]) => {
        // console.error('mockLog.warn', message, ...parameters);
      }),
      notice: jest.fn((message: string, ...parameters: any[]) => {
        // console.error('mockLog.notice', message, ...parameters);
      }),
      info: jest.fn((message: string, ...parameters: any[]) => {
        // console.error('mockLog.info', message, ...parameters);
      }),
      debug: jest.fn((message: string, ...parameters: any[]) => {
        // console.error('mockLog.debug', message, ...parameters);
      }),
    } as unknown as AnsiLogger;
    mockConfig = {
      'name': 'matterbridge-somfy-tahoma',
      'type': 'DynamicPlatform',
      'username': 'None',
      'password': 'None',
      'service': 'somfy_europe',
      'movementDuration': {
        'Device1': 5,
      },
      'blackList': [],
      'whiteList': [],
      'debug': false,
      'unregisterOnShutdown': false,
    } as PlatformConfig;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should not initialize platform without username and password', () => {
    mockConfig.username = undefined;
    mockConfig.password = undefined;
    mockConfig.service = undefined;
    somfyPlatform = new SomfyTahomaPlatform(mockMatterbridge, mockLog, mockConfig);
    expect(mockLog.info).toHaveBeenCalledWith('Initializing platform:', mockConfig.name);
    expect(mockLog.error).toHaveBeenCalledWith('No service or username or password provided for:', mockConfig.name);
  });

  it('should initialize platform with config name', () => {
    mockConfig.username = 'None';
    mockConfig.password = 'None';
    mockConfig.service = 'somfy_europe';
    somfyPlatform = new SomfyTahomaPlatform(mockMatterbridge, mockLog, mockConfig);
    expect(mockLog.info).toHaveBeenCalledWith('Initializing platform:', mockConfig.name);
    expect(mockLog.info).toHaveBeenCalledWith('Finished initializing platform:', mockConfig.name);
    expect(mockLog.info).toHaveBeenCalledWith('Starting client Tahoma service somfy_europe with user None password: None');
  });

  it('should receive tahomaClient events', () => {
    (somfyPlatform as any).tahomaClient?.emit('connect');
    (somfyPlatform as any).tahomaClient?.emit('disconnect');
    expect(mockLog.info).toHaveBeenCalledWith('TaHoma service connected');
    expect(mockLog.warn).toHaveBeenCalledWith('TaHoma service disconnected');
  });

  it('should create a mutableDevice', async () => {
    expect(await somfyPlatform.createMutableDevice(coverDevice)).toBeDefined();
    expect(await somfyPlatform.createMutableDevice(coverDevice)).toBeInstanceOf(MatterbridgeDevice);
    mockMatterbridge.edge = true;
    expect(await somfyPlatform.createMutableDevice(coverDevice)).toBeDefined();
    expect(await somfyPlatform.createMutableDevice(coverDevice)).toBeInstanceOf(MatterbridgeEndpoint);
    mockMatterbridge.edge = false;
  });

  it('should return false and log a warning if entity is not in the whitelist', () => {
    (somfyPlatform as any).whiteList = ['entity1', 'entity2'];
    (somfyPlatform as any).blackList = [];

    const result = (somfyPlatform as any).validateWhiteBlackList('entity3');

    expect(result).toBe(false);
    expect(mockLog.warn).toHaveBeenCalledWith(`Skipping ${dn}entity3${wr} because not in whitelist`);
  });

  it('should return false and log a warning if entity is in the blacklist', () => {
    (somfyPlatform as any).whiteList = [];
    (somfyPlatform as any).blackList = ['entity3'];

    const result = (somfyPlatform as any).validateWhiteBlackList('entity3');

    expect(result).toBe(false);
    expect(mockLog.warn).toHaveBeenCalledWith(`Skipping ${dn}entity3${wr} because in blacklist`);
  });

  it('should return true if entity is in the whitelist', () => {
    (somfyPlatform as any).whiteList = ['entity3'];
    (somfyPlatform as any).blackList = [];

    const result = (somfyPlatform as any).validateWhiteBlackList('entity3');

    expect(result).toBe(true);
    expect(mockLog.warn).not.toHaveBeenCalled();
  });

  it('should return true if entity is not in the blacklist and whitelist is empty', () => {
    (somfyPlatform as any).whiteList = [];
    (somfyPlatform as any).blackList = [];

    const result = (somfyPlatform as any).validateWhiteBlackList('entity3');

    expect(result).toBe(true);
    expect(mockLog.warn).not.toHaveBeenCalled();
  });

  it('should return true if both whitelist and blacklist are empty', () => {
    (somfyPlatform as any).whiteList = [];
    (somfyPlatform as any).blackList = [];

    const result = (somfyPlatform as any).validateWhiteBlackList('entity3');

    expect(result).toBe(true);
    expect(mockLog.warn).not.toHaveBeenCalled();
  });

  it('should validate version', () => {
    mockMatterbridge.matterbridgeVersion = '1.5.4';
    expect(somfyPlatform.verifyMatterbridgeVersion('1.5.3')).toBe(true);
    expect(somfyPlatform.verifyMatterbridgeVersion('1.5.4')).toBe(true);
    expect(somfyPlatform.verifyMatterbridgeVersion('2.0.0')).toBe(false);
  });

  it('should validate version beta', () => {
    mockMatterbridge.matterbridgeVersion = '1.5.4-dev.1';
    expect(somfyPlatform.verifyMatterbridgeVersion('1.5.3')).toBe(true);
    expect(somfyPlatform.verifyMatterbridgeVersion('1.5.4')).toBe(true);
    expect(somfyPlatform.verifyMatterbridgeVersion('2.0.0')).toBe(false);
    mockMatterbridge.matterbridgeVersion = '1.5.5';
  });

  it('should throw because of version', () => {
    mockMatterbridge.matterbridgeVersion = '1.5.4';
    expect(() => new SomfyTahomaPlatform(mockMatterbridge, mockLog, mockConfig)).toThrow();
    mockMatterbridge.matterbridgeVersion = '1.6.5';
  });

  it('should call onStart with reason', async () => {
    await somfyPlatform.onStart('Test reason');
    expect(mockLog.info).toHaveBeenCalledWith('onStart called with reason:', 'Test reason');
    expect(clientConnectSpy).toHaveBeenCalledWith('None', 'None');
  });

  it('should call onStart with reason and log error', async () => {
    const client = (somfyPlatform as any).tahomaClient;
    (somfyPlatform as any).tahomaClient = undefined;
    await somfyPlatform.onStart('Test reason');
    expect(mockLog.error).toHaveBeenCalledWith('TaHoma service not created');
    expect(clientConnectSpy).not.toHaveBeenCalledWith('None', 'None');
    (somfyPlatform as any).tahomaClient = client;
  });

  it('should call onStart with reason and log error if connect throws', async () => {
    clientConnectSpy.mockImplementationOnce(() => {
      throw new Error('Error connecting to TaHoma service');
    });
    await somfyPlatform.onStart('Test reason');
    expect(mockLog.info).toHaveBeenCalledWith('onStart called with reason:', 'Test reason');
    expect(mockLog.error).not.toHaveBeenCalledWith('TaHoma service not created');
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('Error connecting to TaHoma service'), undefined);
    expect(clientConnectSpy).toHaveBeenCalledWith('None', 'None');
  });

  it('should discover devices and log error', async () => {
    const client = (somfyPlatform as any).tahomaClient;
    (somfyPlatform as any).tahomaClient = undefined;
    await (somfyPlatform as any).discoverDevices();
    expect(mockLog.error).toHaveBeenCalledWith('TaHoma service not created');
    (somfyPlatform as any).tahomaClient = client;
  });

  it('should log an error if writeFile fails', async () => {
    const fileName = path.join(mockMatterbridge.matterbridgePluginDirectory, 'matterbridge-somfy-tahoma', 'devices.json');
    const errorMessage = 'Error writing file';
    jest.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error(errorMessage));
    await (somfyPlatform as any).discoverDevices();
    await wait(2000);
    expect(mockLog.error).toHaveBeenCalled();
  });

  it('should discover devices and log error if getDevices throws', async () => {
    clientGetDevicesSpy.mockImplementationOnce(() => {
      throw new Error('Error getting devices from TaHoma service');
    });
    await (somfyPlatform as any).discoverDevices();
    expect(mockLog.error).toHaveBeenCalledWith('Error discovering TaHoma devices:', undefined);
  });

  it('should discover devices and not add if in black list', async () => {
    (somfyPlatform as any).blackList = ['Device1'];
    clientGetDevicesSpy.mockImplementationOnce(() => {
      return Promise.resolve(mockDevices);
    });
    await (somfyPlatform as any).discoverDevices();
    expect(mockLog.info).toHaveBeenCalledWith(`Discovered 1 TaHoma devices`);
    expect((somfyPlatform as any).tahomaDevices).toHaveLength(1);
    expect(mockLog.info).toHaveBeenCalledWith(`Discovered 1 TaHoma screens`);
    expect((somfyPlatform as any).bridgedDevices).toHaveLength(0);
    expect((somfyPlatform as any).covers.size).toBe(0);
    (somfyPlatform as any).blackList = [];
    (somfyPlatform as any).tahomaDevices = [];
    (somfyPlatform as any).bridgedDevices = [];
    (somfyPlatform as any).covers.clear();
  });

  it('should discover devices with uniqueName Blind', async () => {
    (mockDevices[0] as any).uniqueName = 'Blind';
    clientGetDevicesSpy.mockImplementationOnce(() => {
      return Promise.resolve(mockDevices);
    });
    await (somfyPlatform as any).discoverDevices();
    expect(mockLog.info).toHaveBeenCalledWith(`Discovered 1 TaHoma devices`);
    expect(mockLog.debug).toHaveBeenCalledWith(`- added with uniqueName`);
    expect((somfyPlatform as any).tahomaDevices).toHaveLength(1);
    expect(mockLog.info).toHaveBeenCalledWith(`Discovered 1 TaHoma screens`);
    expect(mockLog.debug).toHaveBeenCalledWith(`Adding device: ${BLUE}${mockDevices[0].label}${rs}`);
    expect((somfyPlatform as any).bridgedDevices).toHaveLength(1);
    expect((somfyPlatform as any).covers.size).toBe(1);
    (somfyPlatform as any).tahomaDevices = [];
    (somfyPlatform as any).bridgedDevices = [];
    (somfyPlatform as any).covers.clear();
  });

  it('should discover devices with uiClass Screen', async () => {
    (mockDevices[0] as any).uniqueName = 'xxx';
    mockDevices[0].definition.uiClass = 'Screen';
    clientGetDevicesSpy.mockImplementationOnce(() => {
      return Promise.resolve(mockDevices);
    });
    await (somfyPlatform as any).discoverDevices();
    expect(mockLog.info).toHaveBeenCalledWith(`Discovered 1 TaHoma devices`);
    expect(mockLog.debug).toHaveBeenCalledWith(`- added with uiClass`);
    expect((somfyPlatform as any).tahomaDevices).toHaveLength(1);
    expect(mockLog.info).toHaveBeenCalledWith(`Discovered 1 TaHoma screens`);
    expect(mockLog.debug).toHaveBeenCalledWith(`Adding device: ${BLUE}${mockDevices[0].label}${rs}`);
    expect((somfyPlatform as any).bridgedDevices).toHaveLength(1);
    expect((somfyPlatform as any).covers.size).toBe(1);
    (somfyPlatform as any).tahomaDevices = [];
    (somfyPlatform as any).bridgedDevices = [];
    (somfyPlatform as any).covers.clear();
  });

  it('should discover devices with command "open", "close" and "stop"', async () => {
    (mockDevices[0] as any).uniqueName = 'xxx';
    mockDevices[0].definition.uiClass = 'xxx';
    clientGetDevicesSpy.mockImplementationOnce(() => {
      return Promise.resolve(mockDevices);
    });
    await (somfyPlatform as any).discoverDevices();
    expect(mockLog.info).toHaveBeenCalledWith(`Discovered 1 TaHoma devices`);
    expect(mockLog.debug).toHaveBeenCalledWith(`- added with commands "open", "close" and "stop"`);
    expect((somfyPlatform as any).tahomaDevices).toHaveLength(1);
    expect(mockLog.info).toHaveBeenCalledWith(`Discovered 1 TaHoma screens`);
    expect(mockLog.debug).toHaveBeenCalledWith(`Adding device: ${BLUE}${mockDevices[0].label}${rs}`);
    expect((somfyPlatform as any).bridgedDevices).toHaveLength(1);
    expect((somfyPlatform as any).covers.size).toBe(1);

    (somfyPlatform as any).sendCommand('identify', mockDevices[0]);
    expect(mockLog.info).toHaveBeenCalledWith(`Sending command ${YELLOW}identify${nf} highPriority false`);
    (somfyPlatform as any).sendCommand('open', mockDevices[0]);
    expect(mockLog.info).toHaveBeenCalledWith(`Sending command ${YELLOW}open${nf} highPriority false`);
    (somfyPlatform as any).sendCommand('stop', mockDevices[0]);
    expect(mockLog.info).toHaveBeenCalledWith(`Sending command ${YELLOW}stop${nf} highPriority false`);
    (somfyPlatform as any).sendCommand('close', mockDevices[0]);
    expect(mockLog.info).toHaveBeenCalledWith(`Sending command ${YELLOW}close${nf} highPriority false`);

    clientExecuteSpy.mockImplementationOnce(() => {
      throw new Error('Error executing command');
    });
    (somfyPlatform as any).sendCommand('close', mockDevices[0]);
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining(`Error sending command`));

    const identify = somfyPlatform.covers.get('Device1')?.bridgedDevice.getClusterServer(Identify.Complete);
    expect(identify).toBeDefined();
    if (!identify) return;
    await invokeCommands(identify as unknown as ClusterServerObj);

    jest.clearAllMocks();

    const windowsCovering = somfyPlatform.covers.get('Device1')?.bridgedDevice.getClusterServer(WindowCovering.Complete);
    expect(windowsCovering).toBeDefined();
    if (!windowsCovering) return;
    somfyPlatform.covers.get('Device1')?.bridgedDevice.setWindowCoveringCurrentTargetStatus(0, 0, WindowCovering.MovementStatus.Stopped);

    // With Matter 0=open 10000=close

    jest.clearAllMocks();
    await invokeCommand(windowsCovering as unknown as ClusterServerObj, 'downOrClose');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}downOrClose${rs}${nf} called for ${CYAN}${mockDevices[0].label}`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from 0 to 10000...`);
    await wait(6000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Moving stopped at 10000`);
    expect(somfyPlatform.covers.get('Device1')?.bridgedDevice.getAttribute(WindowCoveringCluster.id, 'currentPositionLiftPercent100ths')).toBe(10000);

    jest.clearAllMocks();
    await invokeCommand(windowsCovering as unknown as ClusterServerObj, 'upOrOpen');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}upOrOpen${rs}${nf} called for ${CYAN}${mockDevices[0].label}`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from 10000 to 0...`);
    await wait(6000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Moving stopped at 0`);
    expect(somfyPlatform.covers.get('Device1')?.bridgedDevice.getAttribute(WindowCoveringCluster.id, 'currentPositionLiftPercent100ths')).toBe(0);

    jest.clearAllMocks();
    await invokeCommand(windowsCovering as unknown as ClusterServerObj, 'upOrOpen');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}upOrOpen${rs}${nf} called for ${CYAN}${mockDevices[0].label}`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from 0 to 0...`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from 0 to 0. No movement needed.`);
    expect(somfyPlatform.covers.get('Device1')?.bridgedDevice.getAttribute(WindowCoveringCluster.id, 'currentPositionLiftPercent100ths')).toBe(0);

    jest.clearAllMocks();
    await invokeCommand(windowsCovering as unknown as ClusterServerObj, 'goToLiftPercentage', { liftPercent100thsValue: 5000 });
    await wait(1000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}goToLiftPercentage${rs}${nf} ${CYAN}5000${nf} called for ${CYAN}${mockDevices[0].label}`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from 0 to 5000...`);
    await wait(4000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Moving stopped at 5000`);
    expect(somfyPlatform.covers.get('Device1')?.bridgedDevice.getAttribute(WindowCoveringCluster.id, 'currentPositionLiftPercent100ths')).toBe(5000);

    jest.clearAllMocks();
    await invokeCommand(windowsCovering as unknown as ClusterServerObj, 'goToLiftPercentage', { liftPercent100thsValue: 10000 });
    await wait(1000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}goToLiftPercentage${rs}${nf} ${CYAN}10000${nf} called for ${CYAN}${mockDevices[0].label}`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from 5000 to 10000...`);
    await invokeCommand(windowsCovering as unknown as ClusterServerObj, 'downOrClose');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Stopping current movement.`);
    await invokeCommand(windowsCovering as unknown as ClusterServerObj, 'downOrClose');
    await wait(5000);
    expect(somfyPlatform.covers.get('Device1')?.bridgedDevice.getAttribute(WindowCoveringCluster.id, 'currentPositionLiftPercent100ths')).toBe(10000);

    await invokeCommand(windowsCovering as unknown as ClusterServerObj, 'upOrOpen');
    await wait(1000);
    await invokeCommand(windowsCovering as unknown as ClusterServerObj, 'stopMotion');
    await wait(1000);
    await invokeCommand(windowsCovering as unknown as ClusterServerObj, 'downOrClose');
    await wait(1000);
    await invokeCommand(windowsCovering as unknown as ClusterServerObj, 'upOrOpen');
    await invokeCommand(windowsCovering as unknown as ClusterServerObj, 'stopMotion');

    (somfyPlatform as any).tahomaDevices = [];
    (somfyPlatform as any).bridgedDevices = [];
    (somfyPlatform as any).covers.clear();
  }, 120000);

  it('should discover devices with command "rollOut", "rollUp" and "stop"', async () => {
    (mockDevices[0] as any).uniqueName = 'xxx';
    mockDevices[0].definition.uiClass = 'xxx';
    (mockDevices[0] as any).commands = ['rollOut', 'rollUp', 'stop'];
    clientGetDevicesSpy.mockImplementationOnce(() => {
      return Promise.resolve(mockDevices);
    });
    await (somfyPlatform as any).discoverDevices();
    expect(mockLog.info).toHaveBeenCalledWith(`Discovered 1 TaHoma devices`);
    expect(mockLog.debug).toHaveBeenCalledWith(`- added with commands "rollOut", "rollUp" and "stop"`);
    expect((somfyPlatform as any).tahomaDevices).toHaveLength(1);
    expect(mockLog.info).toHaveBeenCalledWith(`Discovered 1 TaHoma screens`);
    expect(mockLog.debug).toHaveBeenCalledWith(`Adding device: ${BLUE}${mockDevices[0].label}${rs}`);
    expect((somfyPlatform as any).bridgedDevices).toHaveLength(1);
    expect((somfyPlatform as any).covers.size).toBe(1);
    (somfyPlatform as any).sendCommand('identify', mockDevices[0]);
    (somfyPlatform as any).sendCommand('open', mockDevices[0]);
    (somfyPlatform as any).sendCommand('stop', mockDevices[0]);
    (somfyPlatform as any).sendCommand('close', mockDevices[0]);
    (somfyPlatform as any).tahomaDevices = [];
    (somfyPlatform as any).bridgedDevices = [];
    (somfyPlatform as any).covers.clear();
  });

  it('should discover devices with command "down", "up" and "stop"', async () => {
    (mockDevices[0] as any).uniqueName = 'xxx';
    mockDevices[0].definition.uiClass = 'xxx';
    (mockDevices[0] as any).commands = ['down', 'up', 'stop'];
    clientGetDevicesSpy.mockImplementationOnce(() => {
      return Promise.resolve(mockDevices);
    });
    await (somfyPlatform as any).discoverDevices();
    expect(mockLog.info).toHaveBeenCalledWith(`Discovered 1 TaHoma devices`);
    expect(mockLog.debug).toHaveBeenCalledWith(`- added with commands "down", "up" and "stop"`);
    expect((somfyPlatform as any).tahomaDevices).toHaveLength(1);
    expect(mockLog.info).toHaveBeenCalledWith(`Discovered 1 TaHoma screens`);
    expect(mockLog.debug).toHaveBeenCalledWith(`Adding device: ${BLUE}${mockDevices[0].label}${rs}`);
    expect((somfyPlatform as any).bridgedDevices).toHaveLength(1);
    expect((somfyPlatform as any).covers.size).toBe(1);
    (somfyPlatform as any).sendCommand('identify', mockDevices[0]);
    (somfyPlatform as any).sendCommand('open', mockDevices[0]);
    (somfyPlatform as any).sendCommand('stop', mockDevices[0]);
    (somfyPlatform as any).sendCommand('close', mockDevices[0]);
  });

  it('should call onConfigure', async () => {
    await somfyPlatform.onConfigure();
    expect(mockLog.info).toHaveBeenCalledWith('onConfigure called');
  });

  it('should call onConfigure and log error', async () => {
    const client = (somfyPlatform as any).tahomaClient;
    (somfyPlatform as any).tahomaClient = undefined;
    await somfyPlatform.onConfigure();
    expect(mockLog.info).toHaveBeenCalledWith('onConfigure called');
    expect(mockLog.error).toHaveBeenCalledWith('TaHoma service not created');
    (somfyPlatform as any).tahomaClient = client;
  });

  it('should call onShutdown with reason', async () => {
    const client = (somfyPlatform as any).tahomaClient;
    (somfyPlatform as any).tahomaClient = undefined;
    await somfyPlatform.onShutdown('Test reason');
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason:', 'Test reason');
    expect((somfyPlatform as any).tahomaClient).toBeUndefined();
    (somfyPlatform as any).tahomaClient = client;
  });

  it('should call onShutdown with reason and call unregisterAll', async () => {
    const client = (somfyPlatform as any).tahomaClient;
    (somfyPlatform as any).tahomaClient = undefined;
    somfyPlatform.name = mockConfig.name as string;
    mockConfig.unregisterOnShutdown = true;
    await somfyPlatform.onShutdown('Test reason');
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason:', 'Test reason');
    expect(mockMatterbridge.removeAllBridgedDevices).toHaveBeenCalledWith(mockConfig.name);
    expect((somfyPlatform as any).tahomaClient).toBeUndefined();
    (somfyPlatform as any).tahomaClient = client;
    mockConfig.unregisterOnShutdown = false;
  });

  it('should call onShutdown with reason and log error', async () => {
    await somfyPlatform.onShutdown('Test reason');
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason:', 'Test reason');
  });
});
