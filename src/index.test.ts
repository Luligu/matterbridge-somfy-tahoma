/* eslint-disable @typescript-eslint/no-unused-vars */
import { Matterbridge, MatterbridgeDevice, MatterbridgeEndpoint, PlatformConfig } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { SomfyTahomaPlatform } from './platform.js';
import initializePlugin from './index';
import { jest } from '@jest/globals';

describe('initializePlugin', () => {
  let mockMatterbridge: Matterbridge;
  let mockLog: AnsiLogger;
  let mockConfig: PlatformConfig;

  beforeEach(() => {
    mockMatterbridge = {
      matterbridgeDirectory: './jest/matterbridge',
      matterbridgePluginDirectory: './jest/plugins',
      systemInformation: { ipv4Address: undefined },
      matterbridgeVersion: '1.6.7',
      getDevices: jest.fn(() => {
        // console.log('getDevices called');
        return [];
      }),
      addBridgedDevice: jest.fn(async (pluginName: string, device: MatterbridgeDevice) => {
        // console.log('addBridgedDevice called');
      }),
      addBridgedEndpoint: jest.fn(async (pluginName: string, device: MatterbridgeEndpoint) => {
        // console.log('addBridgedEndpoint called');
        // await aggregator.add(device);
      }),
      removeBridgedDevice: jest.fn(async (pluginName: string, device: MatterbridgeDevice) => {
        // console.log('removeBridgedDevice called');
      }),
      removeBridgedEndpoint: jest.fn(async (pluginName: string, device: MatterbridgeEndpoint) => {
        // console.log('removeBridgedEndpoint called');
      }),
      removeAllBridgedDevices: jest.fn(async (pluginName: string) => {
        // console.log('removeAllBridgedDevices called');
      }),
      removeAllBridgedEndpoints: jest.fn(async (pluginName: string) => {
        // console.log('removeAllBridgedEndpoints called');
      }),
    } as unknown as Matterbridge;
    mockLog = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } as unknown as AnsiLogger;
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

  it('should return an instance of SomfyTahomaPlatform', () => {
    const result = initializePlugin(mockMatterbridge, mockLog, mockConfig);
    expect(result).toBeInstanceOf(SomfyTahomaPlatform);
  });
});
