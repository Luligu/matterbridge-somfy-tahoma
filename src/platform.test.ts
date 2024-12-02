/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { coverDevice, Matterbridge, MatterbridgeDevice, MatterbridgeEndpoint, PlatformConfig } from 'matterbridge';
import { AnsiLogger, dn, LogLevel, wr } from 'matterbridge/logger';
import { SomfyTahomaPlatform } from './platform';

import { jest } from '@jest/globals';
import { Client, Device } from 'overkiz-client';

describe('TestPlatform', () => {
  let mockMatterbridge: Matterbridge;
  let mockLog: AnsiLogger;
  let mockConfig: PlatformConfig;
  let somfyPlatform: SomfyTahomaPlatform;

  let clientConnectSpy: jest.SpiedFunction<(user: string, password: string) => Promise<void>>;
  let clientGetDevicesSpy: jest.SpiedFunction<(user: string, password: string) => Promise<Device[]>>;
  let clientExecuteSpy: jest.SpiedFunction<(oid: any, execution: any) => Promise<any>>;

  beforeAll(() => {
    // Spy on the Client.connect method
    clientConnectSpy = jest.spyOn(Client.prototype, 'connect').mockImplementation((user: string, password: string) => {
      console.error(`Mocked Client.connect(${user}, ${password})`);
      return Promise.resolve();
    });
    clientGetDevicesSpy = jest.spyOn(Client.prototype, 'getDevices').mockImplementation(() => {
      console.error(`Mocked Client.getDevices()`);
      return Promise.resolve([]);
    });
    clientExecuteSpy = jest.spyOn(Client.prototype, 'execute').mockImplementation((oid: any, execution: any) => {
      console.error(`Mocked Client.execute(${oid}, ${execution})`);
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
        console.error('mockLog.fatal', message, ...parameters);
      }),
      error: jest.fn((message: string, ...parameters: any[]) => {
        console.error('mockLog.error', message, ...parameters);
      }),
      warn: jest.fn((message: string, ...parameters: any[]) => {
        console.error('mockLog.warn', message, ...parameters);
      }),
      notice: jest.fn((message: string, ...parameters: any[]) => {
        console.error('mockLog.notice', message, ...parameters);
      }),
      info: jest.fn((message: string, ...parameters: any[]) => {
        console.error('mockLog.info', message, ...parameters);
      }),
      debug: jest.fn((message: string, ...parameters: any[]) => {
        console.error('mockLog.debug', message, ...parameters);
      }),
    } as unknown as AnsiLogger;
    mockConfig = {
      'name': 'matterbridge-somfy-tahoma',
      'type': 'DynamicPlatform',
      'username': 'None',
      'password': 'None',
      'service': 'somfy_europe',
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
