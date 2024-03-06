import { Matterbridge } from '../../matterbridge/dist/index.js';
import { AnsiLogger } from 'node-ansi-logger';
import { ExampleMatterbridgeDynamicPlatform } from './platform.js';

/**
 * This is the standard interface for MatterBridge plugins.
 * Each plugin should export a default function that follows this signature.
 *
 * @param matterbridge - An instance of MatterBridge
 */
export default function initializePlugin(matterbridge: Matterbridge, log: AnsiLogger) {
  log.info('Matterbridge dynamic platform plugin example is loading...');

  const platform = new ExampleMatterbridgeDynamicPlatform(matterbridge, log);

  log.info('Matterbridge dynamic platform plugin example initialized successfully!');
  return platform;
}
