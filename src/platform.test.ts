import { Matterbridge, PlatformConfig } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { SomfyTahomaPlatform } from './platform';
import { jest } from '@jest/globals';

describe('TestPlatform', () => {
  let mockMatterbridge: Matterbridge;
  let mockLog: AnsiLogger;
  let mockConfig: PlatformConfig;
  let testPlatform: SomfyTahomaPlatform;

  // const log = new AnsiLogger({ logName: 'shellyDeviceTest', logTimestampFormat: TimestampFormat.TIME_MILLIS, logDebug: true });

  beforeAll(() => {
    mockMatterbridge = { addBridgedDevice: jest.fn(), matterbridgeDirectory: '', matterbridgePluginDirectory: '' } as unknown as Matterbridge;
    mockLog = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } as unknown as AnsiLogger;
    mockConfig = {
      'name': 'matterbridge-test',
      'type': 'DynamicPlatform',
      'username': 'None',
      'password': 'None',
      'service': 'somfy_europe',
      'debug': false,
      'unregisterOnShutdown': false,
    } as PlatformConfig;

    // testPlatform = new SomfyTahomaPlatform(mockMatterbridge, mockLog, mockConfig);
  });

  it('should not initialize platform without username and password', () => {
    mockConfig.username = undefined;
    mockConfig.password = undefined;
    mockConfig.service = undefined;
    testPlatform = new SomfyTahomaPlatform(mockMatterbridge, mockLog, mockConfig);
    expect(mockLog.info).toHaveBeenCalledWith('Initializing platform:', mockConfig.name);
    expect(mockLog.error).toHaveBeenCalledWith('No service or username or password provided for:', mockConfig.name);
  });

  it('should initialize platform with config name', () => {
    mockConfig.username = 'None';
    mockConfig.password = 'None';
    mockConfig.service = 'somfy_europe';
    testPlatform = new SomfyTahomaPlatform(mockMatterbridge, mockLog, mockConfig);
    expect(mockLog.info).toHaveBeenCalledWith('Initializing platform:', mockConfig.name);
    expect(mockLog.info).toHaveBeenCalledWith('Finished initializing platform:', mockConfig.name);
  });

  it('should call onStart with reason', async () => {
    await testPlatform.onStart('Test reason');
    expect(mockLog.info).toHaveBeenCalledWith('onStart called with reason:', 'Test reason');
  });

  it('should call onConfigure', async () => {
    await testPlatform.onConfigure();
    expect(mockLog.info).toHaveBeenCalledWith('onConfigure called');
  });

  it('should call onShutdown with reason', async () => {
    await testPlatform.onShutdown('Test reason');
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason:', 'Test reason');
  });
});
