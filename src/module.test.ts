/* eslint-disable no-console */

const MATTER_PORT = 6000;
const NAME = 'Platform';
const HOMEDIR = path.join('jest', NAME);

process.argv = ['node', 'platform.test.js', '-novirtual', '-frontend', '0', '-homedir', HOMEDIR, '-port', MATTER_PORT.toString()];

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { jest } from '@jest/globals';
import { Client, Device } from 'overkiz-client';
import { BLUE, CYAN, ign, LogLevel, nf, rs, YELLOW } from 'matterbridge/logger';
import { wait } from 'matterbridge/utils';
import { WindowCovering, WindowCoveringCluster } from 'matterbridge/matter/clusters';
import {
  addBridgedEndpointSpy,
  addMatterbridgePlatform,
  createMatterbridgeEnvironment,
  destroyMatterbridgeEnvironment,
  log,
  loggerLogSpy,
  matterbridge,
  aggregator,
  setupTest,
  startMatterbridgeEnvironment,
  stopMatterbridgeEnvironment,
  removeAllBridgedEndpointsSpy,
  flushAsync,
} from 'matterbridge/jestutils';

import initializePlugin, { SomfyTahomaPlatform, SomfyTahomaPlatformConfig } from './module.js';

// Spy on the Client.connect method
const clientConnectSpy = jest.spyOn(Client.prototype, 'connect').mockImplementation((user: string, password: string) => {
  // console.error(`Mocked Client.connect(${user}, ${password})`);
  return Promise.resolve();
});
const clientGetDevicesSpy = jest.spyOn(Client.prototype, 'getDevices').mockImplementation(() => {
  // console.error(`Mocked Client.getDevices()`);
  return Promise.resolve([]);
});
const clientExecuteSpy = jest.spyOn(Client.prototype, 'execute').mockImplementation((oid: any, execution: any) => {
  // console.error(`Mocked Client.execute(${oid}, ${execution})`);
  return Promise.resolve();
});

// Setup the test environment
await setupTest(NAME, false);

describe('TestPlatform', () => {
  let somfyPlatform: SomfyTahomaPlatform;

  const config: SomfyTahomaPlatformConfig = {
    name: 'matterbridge-somfy-tahoma',
    type: 'DynamicPlatform',
    version: '1.4.0',
    username: 'None',
    password: 'None',
    service: 'somfy_europe',
    movementDuration: {
      Device1: 2,
    },
    blackList: [],
    whiteList: [],
    debug: false,
    unregisterOnShutdown: false,
  };

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

  beforeAll(async () => {
    // Create Matterbridge environment
    await createMatterbridgeEnvironment(NAME);
    await startMatterbridgeEnvironment(MATTER_PORT);
  });

  beforeEach(async () => {
    // Reset the mock calls before each test
    jest.clearAllMocks();
  });

  afterEach(async () => {});

  afterAll(async () => {
    // Destroy Matterbridge environment
    await stopMatterbridgeEnvironment();
    await destroyMatterbridgeEnvironment();

    // Restore all mocks
    jest.restoreAllMocks();
  });

  it('should return an instance of SomfyTahomaPlatform', async () => {
    const result = initializePlugin(matterbridge, log, config);
    expect(result).toBeInstanceOf(SomfyTahomaPlatform);
    await result.onShutdown();
  });

  it('should not initialize platform without username and password', () => {
    config.username = '';
    config.password = '';
    config.service = '';
    somfyPlatform = new SomfyTahomaPlatform(matterbridge, log, config);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'Initializing platform:', config.name);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.ERROR, 'No service or username or password provided for:', config.name);
  });

  it('should initialize platform with config name', () => {
    config.username = 'None';
    config.password = 'None';
    config.service = 'somfy_europe';
    somfyPlatform = new SomfyTahomaPlatform(matterbridge, log, config);
    addMatterbridgePlatform(somfyPlatform);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'Initializing platform:', config.name);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'Finished initializing platform:', config.name);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'Starting client Tahoma service somfy_europe with user None password: None');
  });

  it('should receive tahomaClient events', () => {
    somfyPlatform.tahomaClient?.emit('connect');
    somfyPlatform.tahomaClient?.emit('disconnect');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'TaHoma service connected');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.WARN, 'TaHoma service disconnected');
  });

  it('should throw because of version', () => {
    matterbridge.matterbridgeVersion = '1.5.4';
    expect(() => new SomfyTahomaPlatform(matterbridge, log, config)).toThrow();
    matterbridge.matterbridgeVersion = '3.4.0';
  });

  it('should call onStart with reason', async () => {
    await somfyPlatform.onStart('Test reason');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'onStart called with reason:', 'Test reason');
    expect(clientConnectSpy).toHaveBeenCalledWith('None', 'None');
  });

  it('should call onStart with reason and log error', async () => {
    const client = somfyPlatform.tahomaClient;
    somfyPlatform.tahomaClient = undefined;
    await somfyPlatform.onStart();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.ERROR, 'TaHoma service not created');
    expect(clientConnectSpy).not.toHaveBeenCalledWith('None', 'None');
    somfyPlatform.tahomaClient = client;
  });

  it('should call onStart with reason and log error if connect throws', async () => {
    clientConnectSpy.mockImplementationOnce(() => {
      throw new Error('Error connecting to TaHoma service');
    });
    await somfyPlatform.onStart('Test reason');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'onStart called with reason:', 'Test reason');
    expect(loggerLogSpy).not.toHaveBeenCalledWith(LogLevel.ERROR, 'TaHoma service not created');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.ERROR, expect.stringContaining('Error connecting to TaHoma service'));
    expect(clientConnectSpy).toHaveBeenCalledWith('None', 'None');
  });

  it('should discover devices and log error', async () => {
    const client = somfyPlatform.tahomaClient;
    somfyPlatform.tahomaClient = undefined;
    await somfyPlatform.discoverDevices();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.ERROR, 'TaHoma service not created');
    somfyPlatform.tahomaClient = client;
  });

  it('should log an error if writeFile fails', async () => {
    const fileName = path.join(matterbridge.matterbridgePluginDirectory, 'matterbridge-somfy-tahoma', 'devices.json');
    const errorMessage = 'Error writing file';
    jest.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error(errorMessage));
    await somfyPlatform.discoverDevices();
    await wait(1000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.ERROR, expect.anything());
  });

  it('should discover devices and log error if getDevices throws', async () => {
    clientGetDevicesSpy.mockImplementationOnce(() => {
      throw new Error('Error getting devices from TaHoma service');
    });
    await somfyPlatform.discoverDevices();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.ERROR, expect.stringContaining('Error discovering TaHoma devices'));
  });

  it('should discover devices and not add if in black list', async () => {
    somfyPlatform.config.blackList = ['Device1'];
    clientGetDevicesSpy.mockImplementationOnce(() => {
      return Promise.resolve(mockDevices);
    });
    await somfyPlatform.discoverDevices();
    expect(addBridgedEndpointSpy).toHaveBeenCalledTimes(0);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma devices`);
    expect(somfyPlatform.tahomaDevices).toHaveLength(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma screens`);
    expect(somfyPlatform.bridgedDevices).toHaveLength(0);
    expect(somfyPlatform.covers.size).toBe(0);
    somfyPlatform.config.blackList = [];
    somfyPlatform.tahomaDevices = [];
    somfyPlatform.bridgedDevices = [];
    somfyPlatform.covers.clear();
  });

  it('should discover devices with uniqueName Blind', async () => {
    (mockDevices[0] as any).label = 'Device1';
    (mockDevices[0] as any).uniqueName = 'Blind';
    clientGetDevicesSpy.mockImplementationOnce(() => {
      return Promise.resolve(mockDevices);
    });
    await somfyPlatform.discoverDevices();
    expect(addBridgedEndpointSpy).toHaveBeenCalledTimes(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma devices`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `- added with uniqueName`);
    expect(somfyPlatform.tahomaDevices).toHaveLength(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma screens`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Adding device: ${BLUE}${mockDevices[0].label}${rs}`);
    expect(somfyPlatform.bridgedDevices).toHaveLength(1);
    expect(somfyPlatform.covers.size).toBe(1);
    console.log('Deleting device');
    somfyPlatform.tahomaDevices = [];
    somfyPlatform.bridgedDevices = [];
    somfyPlatform.covers.clear();
    await somfyPlatform.unregisterAllDevices();
    matterbridge.devices.clear();
    expect(aggregator.parts.size).toBe(0);
    expect(matterbridge.devices.size).toBe(0);
    await flushAsync();
  });

  it('should discover devices with uiClass Screen', async () => {
    (mockDevices[0] as any).label = 'Device1';
    (mockDevices[0] as any).uniqueName = 'xxx';
    mockDevices[0].definition.uiClass = 'Screen';
    clientGetDevicesSpy.mockImplementationOnce(() => {
      return Promise.resolve(mockDevices);
    });
    await somfyPlatform.discoverDevices();
    expect(addBridgedEndpointSpy).toHaveBeenCalledTimes(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma devices`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `- added with uiClass`);
    expect(somfyPlatform.tahomaDevices).toHaveLength(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma screens`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Adding device: ${BLUE}${mockDevices[0].label}${rs}`);
    expect(somfyPlatform.bridgedDevices).toHaveLength(1);
    expect(somfyPlatform.covers.size).toBe(1);
    console.log('Deleting device');
    somfyPlatform.tahomaDevices = [];
    somfyPlatform.bridgedDevices = [];
    somfyPlatform.covers.clear();
    await somfyPlatform.unregisterAllDevices();
    matterbridge.devices.clear();
    expect(aggregator.parts.size).toBe(0);
    expect(matterbridge.devices.size).toBe(0);
    await flushAsync();
  });

  it('should discover devices with command "open", "close" and "stop"', async () => {
    (mockDevices[0] as any).label = 'Device1';
    (mockDevices[0] as any).uniqueName = 'xxx';
    mockDevices[0].definition.uiClass = 'xxx';
    clientGetDevicesSpy.mockImplementationOnce(() => {
      return Promise.resolve(mockDevices);
    });
    await somfyPlatform.discoverDevices();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma devices`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `- added with commands "open", "close" and "stop"`);
    expect(somfyPlatform.tahomaDevices).toHaveLength(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma screens`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Adding device: ${BLUE}${mockDevices[0].label}${rs}`);
    expect(somfyPlatform.bridgedDevices).toHaveLength(1);
    expect(somfyPlatform.covers.size).toBe(1);

    somfyPlatform.sendCommand('identify', mockDevices[0]);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Sending command ${YELLOW}identify${nf} highPriority false`);
    somfyPlatform.sendCommand('open', mockDevices[0]);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Sending command ${YELLOW}open${nf} highPriority false`);
    somfyPlatform.sendCommand('stop', mockDevices[0]);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Sending command ${YELLOW}stop${nf} highPriority false`);
    somfyPlatform.sendCommand('close', mockDevices[0]);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Sending command ${YELLOW}close${nf} highPriority false`);

    clientExecuteSpy.mockImplementationOnce(() => {
      throw new Error('Error executing command');
    });
    somfyPlatform.sendCommand('close', mockDevices[0]);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.ERROR, expect.stringContaining(`Error sending command`));

    const device = somfyPlatform.covers.get('Device1')?.bridgedDevice;
    expect(device).toBeDefined();
    if (!device) return;
    await device.executeCommandHandler('identify', { identifyTime: 1 });
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}identify${rs}${nf} called identifyTime:1`);

    await device.setWindowCoveringCurrentTargetStatus(0, 0, WindowCovering.MovementStatus.Stopped);

    // With Matter 0=open 10000=close

    jest.clearAllMocks();
    await device.executeCommandHandler('downOrClose');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}downOrClose${rs}${nf} called for ${CYAN}${mockDevices[0].label}`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from 0 to 10000...`);
    await wait(3000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Moving stopped at 10000`);
    expect(device.getAttribute(WindowCoveringCluster.id, 'currentPositionLiftPercent100ths')).toBe(10000);

    jest.clearAllMocks();
    await device.executeCommandHandler('upOrOpen');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}upOrOpen${rs}${nf} called for ${CYAN}${mockDevices[0].label}`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from 10000 to 0...`);
    await wait(3000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Moving stopped at 0`);
    expect(device.getAttribute(WindowCoveringCluster.id, 'currentPositionLiftPercent100ths')).toBe(0);

    jest.clearAllMocks();
    await device.executeCommandHandler('upOrOpen');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}upOrOpen${rs}${nf} called for ${CYAN}${mockDevices[0].label}`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from 0 to 0...`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from 0 to 0. No movement needed.`);
    expect(device.getAttribute(WindowCoveringCluster.id, 'currentPositionLiftPercent100ths')).toBe(0);

    jest.clearAllMocks();
    await device.executeCommandHandler('goToLiftPercentage', { liftPercent100thsValue: 5000 });
    await wait(1000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}goToLiftPercentage${rs}${nf} ${CYAN}5000${nf} called for ${CYAN}${mockDevices[0].label}`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from 0 to 5000...`);
    await wait(2000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Moving stopped at 5000`);
    expect(device.getAttribute(WindowCoveringCluster.id, 'currentPositionLiftPercent100ths')).toBe(5000);

    jest.clearAllMocks();
    await device.executeCommandHandler('goToLiftPercentage', { liftPercent100thsValue: 10000 });
    await wait(1000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}goToLiftPercentage${rs}${nf} ${CYAN}10000${nf} called for ${CYAN}${mockDevices[0].label}`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from 5000 to 10000...`);
    await device.executeCommandHandler('downOrClose');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Stopping current movement.`);
    await device.executeCommandHandler('downOrClose');
    await wait(3000);
    expect(device.getAttribute(WindowCoveringCluster.id, 'currentPositionLiftPercent100ths')).toBe(10000);

    await device.executeCommandHandler('upOrOpen');
    await device.executeCommandHandler('stopMotion');
    await device.executeCommandHandler('downOrClose');
    await device.executeCommandHandler('upOrOpen');
    await device.executeCommandHandler('stopMotion');

    somfyPlatform.tahomaDevices = [];
    somfyPlatform.bridgedDevices = [];
    somfyPlatform.covers.clear();
    await somfyPlatform.unregisterAllDevices();
    matterbridge.devices.clear();
    expect(aggregator.parts.size).toBe(0);
    expect(matterbridge.devices.size).toBe(0);
    await flushAsync();
  }, 120000);

  it('should discover devices with command "rollOut", "rollUp" and "stop"', async () => {
    (mockDevices[0] as any).label = 'Device1';
    (mockDevices[0] as any).uniqueName = 'xxx';
    (mockDevices[0] as any).definition.uiClass = 'xxx';
    (mockDevices[0] as any).commands = ['rollOut', 'rollUp', 'stop'];
    clientGetDevicesSpy.mockImplementationOnce(() => {
      return Promise.resolve(mockDevices);
    });
    await somfyPlatform.discoverDevices();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma devices`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `- added with commands "rollOut", "rollUp" and "stop"`);
    expect(somfyPlatform.tahomaDevices).toHaveLength(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma screens`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Adding device: ${BLUE}${mockDevices[0].label}${rs}`);
    expect(somfyPlatform.bridgedDevices).toHaveLength(1);
    expect(somfyPlatform.covers.size).toBe(1);
    somfyPlatform.sendCommand('identify', mockDevices[0]);
    somfyPlatform.sendCommand('open', mockDevices[0]);
    somfyPlatform.sendCommand('stop', mockDevices[0]);
    somfyPlatform.sendCommand('close', mockDevices[0]);
    somfyPlatform.tahomaDevices = [];
    somfyPlatform.bridgedDevices = [];
    somfyPlatform.covers.clear();
    await somfyPlatform.unregisterAllDevices();
    matterbridge.devices.clear();
    expect(aggregator.parts.size).toBe(0);
    expect(matterbridge.devices.size).toBe(0);
    await flushAsync();
  });

  it('should discover devices with command "down", "up" and "stop"', async () => {
    (mockDevices[0] as any).label = 'Device1';
    (mockDevices[0] as any).uniqueName = 'xxx';
    (mockDevices[0] as any).definition.uiClass = 'xxx';
    (mockDevices[0] as any).commands = ['down', 'up', 'stop'];
    clientGetDevicesSpy.mockImplementationOnce(() => {
      return Promise.resolve(mockDevices);
    });
    await somfyPlatform.discoverDevices();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma devices`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `- added with commands "down", "up" and "stop"`);
    expect(somfyPlatform.tahomaDevices).toHaveLength(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma screens`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Adding device: ${BLUE}${mockDevices[0].label}${rs}`);
    expect(somfyPlatform.bridgedDevices).toHaveLength(1);
    expect(somfyPlatform.covers.size).toBe(1);
    somfyPlatform.sendCommand('identify', mockDevices[0]);
    somfyPlatform.sendCommand('open', mockDevices[0]);
    somfyPlatform.sendCommand('stop', mockDevices[0]);
    somfyPlatform.sendCommand('close', mockDevices[0]);
    expect(somfyPlatform.size()).toBe(1);
    expect(aggregator.parts.size).toBe(1);
    expect(matterbridge.devices.size).toBe(1);
    // We keep this device to be used in the next tests
  });

  it('should call onConfigure', async () => {
    await somfyPlatform.onConfigure();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'onConfigure called');
  });

  it('should call onConfigure and log error', async () => {
    const client = somfyPlatform.tahomaClient;
    somfyPlatform.tahomaClient = undefined;
    await somfyPlatform.onConfigure();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'onConfigure called');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.ERROR, 'TaHoma service not created');
    somfyPlatform.tahomaClient = client;
  });

  it('should call onShutdown with reason', async () => {
    expect(aggregator.parts.size).toBe(1);
    const client = somfyPlatform.tahomaClient;
    somfyPlatform.tahomaClient = undefined;
    await somfyPlatform.onShutdown('Test reason');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'onShutdown called with reason:', 'Test reason');
    somfyPlatform.tahomaClient = client;
    expect(somfyPlatform.size()).toBe(0); // destroy called from onShutdown
    expect(aggregator.parts.size).toBe(1);
    expect(matterbridge.devices.size).toBe(1);
    expect(removeAllBridgedEndpointsSpy).toHaveBeenCalledTimes(0);
  });

  it('should call onShutdown with reason and call unregisterAll', async () => {
    const client = somfyPlatform.tahomaClient;
    somfyPlatform.tahomaClient = undefined;
    somfyPlatform.name = config.name as string;
    config.unregisterOnShutdown = true;
    await somfyPlatform.onShutdown();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'onShutdown called with reason:', 'none');
    expect(removeAllBridgedEndpointsSpy).toHaveBeenCalledWith(config.name, 0);
    expect(somfyPlatform.tahomaClient).toBeUndefined();
    somfyPlatform.tahomaClient = client;
    config.unregisterOnShutdown = false;
    expect(somfyPlatform.size()).toBe(0);
    expect(aggregator.parts.size).toBe(0);
    expect(matterbridge.devices.size).toBe(0);
  });

  it('should call onShutdown with reason and log error', async () => {
    await somfyPlatform.onShutdown('Test reason');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'onShutdown called with reason:', 'Test reason');
  });
});
