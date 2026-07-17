/**
 * @file vitest/module.test.ts
 * @description This file contains the tests for the SomfyTahomaPlatform class.
 * @author Luca Liguori
 */

const NAME = 'SomfyTahomaPlatform';
const MATTER_PORT = 6000;

// Warning: the tests in this file are supposed to run sequentially.

import { promises as fs } from 'node:fs';

import type { PlatformMatterbridge } from 'matterbridge';
import { BLUE, CYAN, ign, LogLevel, nf, rs, YELLOW } from 'matterbridge/logger';
import { WindowCovering } from 'matterbridge/matter/clusters';
import { wait } from 'matterbridge/utils';
import { flushAsync, log, loggerLogSpy, setDebug, setupTest } from 'matterbridge/vitest-utils';
import {
  addMatterbridge,
  aggregator,
  createServerNode,
  createTestEnvironment,
  destroyTestEnvironment,
  getMatterbridge,
  startServerNode,
  stopServerNode,
} from 'matterbridge/vitest-utils/matter';
import { Client, Device, type State } from 'overkiz-client';

import initializePlugin, { SomfyTahomaPlatform, type SomfyTahomaPlatformConfig, WC_PERCENT100THS_MAX_CLOSED, WC_PERCENT100THS_MIN_OPEN } from '../src/module.js';

// Spy on the Client.connect method
const clientConnectSpy = vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
const clientGetDevicesSpy = vi.spyOn(Client.prototype, 'getDevices').mockResolvedValue([]);
const clientExecuteSpy = vi.spyOn(Client.prototype, 'execute').mockImplementation(() => {});

// Setup the test environment
await setupTest(NAME, false);

describe('SomfyTahomaPlatform', () => {
  let matterbridge: PlatformMatterbridge;
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

  const createMockDevice = ({
    label = 'Device1',
    uniqueName = 'Blind',
    uiClass = 'Screen',
    commands = ['open', 'close', 'stop'],
  }: {
    label?: string;
    uniqueName?: string;
    uiClass?: string;
    commands?: string[];
  }): Device => {
    const device = new Device();
    device.deviceURL = 'url';
    device.label = label;
    device.controllableName = `io:${uniqueName}`;
    device.definition = {
      type: '',
      widgetName: '',
      uiClass,
      commands: commands.map((commandName) => ({ commandName, nparams: 0 })),
    };
    device.states = [];
    return device;
  };

  const mockDevices = [createMockDevice({})];

  const setMockDevice = ({
    label = 'Device1',
    uniqueName = 'Blind',
    uiClass = 'Screen',
    commands = ['open', 'close', 'stop'],
  }: {
    label?: string;
    uniqueName?: string;
    uiClass?: string;
    commands?: string[];
  }): void => {
    mockDevices[0] = createMockDevice({ label, uniqueName, uiClass, commands });
  };

  beforeAll(async () => {
    // Create Matterbridge environment
    await createTestEnvironment();
    await createServerNode(MATTER_PORT);
    await startServerNode();
    matterbridge = getMatterbridge();
  });

  beforeEach(() => {
    // Reset the mock calls before each test
    vi.clearAllMocks();
    setMockDevice({});
  });

  afterEach(async () => {
    // Clear debug
    await setDebug(false);
  });

  afterAll(async () => {
    // Destroy Matterbridge environment
    await stopServerNode();
    await destroyTestEnvironment();

    // Restore all mocks
    vi.restoreAllMocks();
  });

  it('should return an instance of SomfyTahomaPlatform', async () => {
    const result = initializePlugin(matterbridge, log, config);
    expect(result).toBeInstanceOf(SomfyTahomaPlatform);
    await result.onShutdown();
  });

  it('should not initialize platform without username and password', async () => {
    config.username = '';
    config.password = '';
    config.service = '';
    somfyPlatform = new SomfyTahomaPlatform(matterbridge, log, config);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'Initializing platform:', config.name);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.ERROR, 'No service or username or password provided for:', config.name);
    await somfyPlatform.onShutdown();
  });

  it('should initialize platform with config name', () => {
    config.username = 'None';
    config.password = 'None';
    config.service = 'somfy_europe';
    somfyPlatform = new SomfyTahomaPlatform(matterbridge, log, config);
    addMatterbridge(somfyPlatform);
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
    expect(() => new SomfyTahomaPlatform({ ...matterbridge, matterbridgeVersion: '3.8.0' }, log, config)).toThrow('This plugin requires Matterbridge version >= "3.9.0".');
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
    const errorMessage = 'Error writing file';
    vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error(errorMessage));
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
    clientGetDevicesSpy.mockResolvedValueOnce(mockDevices);
    await somfyPlatform.discoverDevices();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma devices`);
    expect(somfyPlatform.tahomaDevices).toHaveLength(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma screens`);
    expect(somfyPlatform.getDevices()).toHaveLength(0);
    expect(somfyPlatform.covers.size).toBe(0);
    somfyPlatform.config.blackList = [];
    somfyPlatform.tahomaDevices = [];
    somfyPlatform.covers.clear();
  });

  it('should discover devices with uniqueName Blind', async () => {
    setMockDevice({ label: 'Device1', uniqueName: 'Blind' });
    clientGetDevicesSpy.mockResolvedValueOnce(mockDevices);
    await somfyPlatform.discoverDevices();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma devices`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `- added with uniqueName`);
    expect(somfyPlatform.tahomaDevices).toHaveLength(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma screens`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Adding device: ${BLUE}${mockDevices[0].label}${rs}`);
    expect(somfyPlatform.getDevices()).toHaveLength(1);
    expect(somfyPlatform.covers.size).toBe(1);
    somfyPlatform.tahomaDevices = [];
    somfyPlatform.covers.clear();
    await somfyPlatform.unregisterAllDevices();
    expect(aggregator.parts.size).toBe(0);
    await flushAsync();
  });

  it('should discover devices with uiClass Screen', async () => {
    setMockDevice({ label: 'Device1', uniqueName: 'xxx', uiClass: 'Screen' });
    clientGetDevicesSpy.mockResolvedValueOnce(mockDevices);
    await somfyPlatform.discoverDevices();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma devices`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `- added with uiClass`);
    expect(somfyPlatform.tahomaDevices).toHaveLength(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma screens`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Adding device: ${BLUE}${mockDevices[0].label}${rs}`);
    expect(somfyPlatform.getDevices()).toHaveLength(1);
    expect(somfyPlatform.covers.size).toBe(1);
    somfyPlatform.tahomaDevices = [];
    somfyPlatform.covers.clear();
    await somfyPlatform.unregisterAllDevices();
    expect(aggregator.parts.size).toBe(0);
    await flushAsync();
  });

  it('should add a rechargeable battery cover and handle device state updates', async () => {
    setMockDevice({ label: 'Device1', uniqueName: 'Blind' });
    mockDevices[0].states = [{ name: 'core:BatteryDiscreteLevelState', type: 3, value: 'normal' } satisfies State];
    clientGetDevicesSpy.mockResolvedValueOnce(mockDevices);
    await somfyPlatform.discoverDevices();
    expect(somfyPlatform.getDevices()).toHaveLength(1);
    expect(somfyPlatform.covers.size).toBe(1);

    // Trigger the per-device 'states' listener registered in discoverDevices
    mockDevices[0].emit('states', mockDevices[0].states);

    somfyPlatform.tahomaDevices = [];
    somfyPlatform.covers.clear();
    await somfyPlatform.unregisterAllDevices();
    expect(aggregator.parts.size).toBe(0);
    await flushAsync();
  });

  it('should discover devices with command "open", "close" and "stop"', async () => {
    setMockDevice({ label: 'Device1', uniqueName: 'xxx', uiClass: 'xxx', commands: ['open', 'close', 'stop'] });
    clientGetDevicesSpy.mockResolvedValueOnce(mockDevices);
    await somfyPlatform.discoverDevices();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma devices`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `- added with commands "open", "close" and "stop"`);
    expect(somfyPlatform.tahomaDevices).toHaveLength(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma screens`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Adding device: ${BLUE}${mockDevices[0].label}${rs}`);
    expect(somfyPlatform.getDevices()).toHaveLength(1);
    expect(somfyPlatform.covers.size).toBe(1);

    await somfyPlatform.sendCommand('identify', mockDevices[0]);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Sending command ${YELLOW}identify${nf} highPriority false`);
    await somfyPlatform.sendCommand('open', mockDevices[0]);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Sending command ${YELLOW}open${nf} highPriority false`);
    await somfyPlatform.sendCommand('stop', mockDevices[0]);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Sending command ${YELLOW}stop${nf} highPriority false`);
    await somfyPlatform.sendCommand('close', mockDevices[0]);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Sending command ${YELLOW}close${nf} highPriority false`);

    clientExecuteSpy.mockImplementationOnce(() => {
      throw new Error('Error executing command');
    });
    await somfyPlatform.sendCommand('close', mockDevices[0]);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.ERROR, expect.stringContaining(`Error sending command`));

    const device = somfyPlatform.covers.get('Device1')?.bridgedDevice;
    expect(device).toBeDefined();
    if (!device) return;
    await device.setWindowCoveringCurrentTargetStatus(WC_PERCENT100THS_MIN_OPEN, WC_PERCENT100THS_MIN_OPEN, WindowCovering.MovementStatus.Stopped);

    vi.clearAllMocks();
    await device.executeCommandHandler('Identify.identify', { identifyTime: 1 }, 'identify', (device.state as any).identify, device);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}identify${rs}${nf} called identifyTime:1`);

    vi.clearAllMocks();
    await device.executeCommandHandler('WindowCovering.downOrClose', {}, 'windowCovering', (device.state as any).windowCovering, device);
    await wait(3000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}downOrClose${rs}${nf} called for ${CYAN}${mockDevices[0].label}`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from ${WC_PERCENT100THS_MIN_OPEN} to ${WC_PERCENT100THS_MAX_CLOSED}...`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Moving stopped at ${WC_PERCENT100THS_MAX_CLOSED}`);
    expect(device.getAttribute(WindowCovering.id, 'currentPositionLiftPercent100ths')).toBe(WC_PERCENT100THS_MAX_CLOSED);

    vi.clearAllMocks();
    await device.executeCommandHandler('WindowCovering.upOrOpen', {}, 'windowCovering', (device.state as any).windowCovering, device);
    await wait(3000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}upOrOpen${rs}${nf} called for ${CYAN}${mockDevices[0].label}`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from ${WC_PERCENT100THS_MAX_CLOSED} to ${WC_PERCENT100THS_MIN_OPEN}...`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Moving stopped at ${WC_PERCENT100THS_MIN_OPEN}`);
    expect(device.getAttribute(WindowCovering.id, 'currentPositionLiftPercent100ths')).toBe(WC_PERCENT100THS_MIN_OPEN);

    vi.clearAllMocks();
    await device.executeCommandHandler('WindowCovering.upOrOpen', {}, 'windowCovering', (device.state as any).windowCovering, device);
    await wait(3000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}upOrOpen${rs}${nf} called for ${CYAN}${mockDevices[0].label}`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from ${WC_PERCENT100THS_MIN_OPEN} to ${WC_PERCENT100THS_MIN_OPEN}...`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from ${WC_PERCENT100THS_MIN_OPEN} to ${WC_PERCENT100THS_MIN_OPEN}. No movement needed.`);
    expect(device.getAttribute(WindowCovering.id, 'currentPositionLiftPercent100ths')).toBe(WC_PERCENT100THS_MIN_OPEN);

    vi.clearAllMocks();
    await device.executeCommandHandler('WindowCovering.goToLiftPercentage', { liftPercent100thsValue: 5000 }, 'windowCovering', (device.state as any).windowCovering, device);
    await wait(3000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}goToLiftPercentage${rs}${nf} ${CYAN}5000${nf} called for ${CYAN}${mockDevices[0].label}`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from ${WC_PERCENT100THS_MIN_OPEN} to 5000...`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Moving stopped at 5000`);
    expect(device.getAttribute(WindowCovering.id, 'currentPositionLiftPercent100ths')).toBe(5000);

    vi.clearAllMocks();
    await device.executeCommandHandler('WindowCovering.goToLiftPercentage', { liftPercent100thsValue: 10000 }, 'windowCovering', (device.state as any).windowCovering, device);
    await wait(3000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Command ${ign}goToLiftPercentage${rs}${nf} ${CYAN}10000${nf} called for ${CYAN}${mockDevices[0].label}`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from 5000 to ${WC_PERCENT100THS_MAX_CLOSED}...`);

    vi.clearAllMocks();
    await device.executeCommandHandler('WindowCovering.downOrClose', {}, 'windowCovering', (device.state as any).windowCovering, device);
    await wait(1000);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from ${WC_PERCENT100THS_MAX_CLOSED} to ${WC_PERCENT100THS_MAX_CLOSED}...`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Moving from ${WC_PERCENT100THS_MAX_CLOSED} to ${WC_PERCENT100THS_MAX_CLOSED}. No movement needed.`);

    vi.clearAllMocks();
    await device.executeCommandHandler('WindowCovering.downOrClose', {}, 'windowCovering', (device.state as any).windowCovering, device);
    await wait(1000);
    expect(device.getAttribute(WindowCovering.id, 'currentPositionLiftPercent100ths')).toBe(WC_PERCENT100THS_MAX_CLOSED);

    await device.executeCommandHandler('WindowCovering.upOrOpen', {}, 'windowCovering', (device.state as any).windowCovering, device);
    await device.executeCommandHandler('WindowCovering.stopMotion', {}, 'windowCovering', {} as any, device);
    await device.executeCommandHandler('WindowCovering.downOrClose', {}, 'windowCovering', (device.state as any).windowCovering, device);
    await device.executeCommandHandler('WindowCovering.upOrOpen', {}, 'windowCovering', (device.state as any).windowCovering, device);
    await device.executeCommandHandler('WindowCovering.stopMotion', {}, 'windowCovering', {} as any, device);

    somfyPlatform.tahomaDevices = [];
    somfyPlatform.covers.clear();
    await somfyPlatform.unregisterAllDevices();
    expect(aggregator.parts.size).toBe(0);
    await flushAsync();
  }, 120000);

  it('should discover devices with command "rollOut", "rollUp" and "stop"', async () => {
    await setDebug(false);
    setMockDevice({ label: 'Device1', uniqueName: 'xxx', uiClass: 'xxx', commands: ['rollOut', 'rollUp', 'stop'] });
    clientGetDevicesSpy.mockResolvedValueOnce(mockDevices);
    await somfyPlatform.discoverDevices();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma devices`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `- added with commands "rollOut", "rollUp" and "stop"`);
    expect(somfyPlatform.tahomaDevices).toHaveLength(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma screens`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Adding device: ${BLUE}${mockDevices[0].label}${rs}`);
    expect(somfyPlatform.getDevices()).toHaveLength(1);
    expect(somfyPlatform.covers.size).toBe(1);
    await somfyPlatform.sendCommand('identify', mockDevices[0]);
    await somfyPlatform.sendCommand('open', mockDevices[0]);
    await somfyPlatform.sendCommand('stop', mockDevices[0]);
    await somfyPlatform.sendCommand('close', mockDevices[0]);
    somfyPlatform.tahomaDevices = [];
    somfyPlatform.covers.clear();
    await somfyPlatform.unregisterAllDevices();
    expect(aggregator.parts.size).toBe(0);
    await flushAsync();
  });

  it('should discover devices with command "down", "up" and "stop"', async () => {
    setMockDevice({ label: 'Device1', uniqueName: 'xxx', uiClass: 'xxx', commands: ['down', 'up', 'stop'] });
    clientGetDevicesSpy.mockResolvedValueOnce(mockDevices);
    await somfyPlatform.discoverDevices();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma devices`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `- added with commands "down", "up" and "stop"`);
    expect(somfyPlatform.tahomaDevices).toHaveLength(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, `Discovered 1 TaHoma screens`);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.DEBUG, `Adding device: ${BLUE}${mockDevices[0].label}${rs}`);
    expect(somfyPlatform.getDevices()).toHaveLength(1);
    expect(somfyPlatform.covers.size).toBe(1);
    await somfyPlatform.sendCommand('identify', mockDevices[0]);
    await somfyPlatform.sendCommand('open', mockDevices[0]);
    await somfyPlatform.sendCommand('stop', mockDevices[0]);
    await somfyPlatform.sendCommand('close', mockDevices[0]);
    expect(somfyPlatform.size()).toBe(1);
    expect(aggregator.parts.size).toBe(1);
    // We keep this device to be used in the next tests
  });

  it('should stop current movement in moveToPosition when already moving', async () => {
    const cover = somfyPlatform.covers.get('Device1');
    expect(cover).toBeDefined();
    if (!cover) return;

    await cover.bridgedDevice.setWindowCoveringCurrentTargetStatus(5000, 5000, WindowCovering.MovementStatus.Stopped);
    cover.movementStatus = WindowCovering.MovementStatus.Opening;
    cover.moveInterval = setInterval(() => {
      // noop
    }, 1000);

    await somfyPlatform.moveToPosition(cover, 8000);

    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'Stopping current movement.');
    expect(clientExecuteSpy).toHaveBeenCalledWith('apply/highPriority', expect.anything());
    expect(cover.movementStatus).toBe(WindowCovering.MovementStatus.Stopped);
    expect(cover.moveInterval).toBeUndefined();
  });

  it('should send stop on stopMotion when movementStatus is not stopped', async () => {
    const cover = somfyPlatform.covers.get('Device1');
    expect(cover).toBeDefined();
    if (!cover) return;
    const device = cover.bridgedDevice;

    await cover.bridgedDevice.setWindowCoveringCurrentTargetStatus(5000, 5000, WindowCovering.MovementStatus.Stopped);
    cover.movementStatus = WindowCovering.MovementStatus.Opening;
    cover.moveInterval = setInterval(() => {
      // noop
    }, 1000);

    await device.executeCommandHandler('WindowCovering.stopMotion', {}, 'windowCovering', {} as any, device);

    expect(clientExecuteSpy).toHaveBeenCalledWith('apply/highPriority', expect.anything());
    expect(cover.movementStatus).toBe(WindowCovering.MovementStatus.Stopped);
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
  });

  it('should call onShutdown with reason and call unregisterAll', async () => {
    const client = somfyPlatform.tahomaClient;
    somfyPlatform.tahomaClient = undefined;
    somfyPlatform.name = config.name;
    config.unregisterOnShutdown = true;
    await somfyPlatform.onShutdown();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'onShutdown called with reason:', 'none');
    expect(somfyPlatform.tahomaClient).toBeUndefined();
    somfyPlatform.tahomaClient = client;
    config.unregisterOnShutdown = false;
    expect(somfyPlatform.size()).toBe(0);
    expect(aggregator.parts.size).toBe(0);
  });

  it('should call onShutdown with reason and log error', async () => {
    await somfyPlatform.onShutdown('Test reason');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'onShutdown called with reason:', 'Test reason');
  });
});
