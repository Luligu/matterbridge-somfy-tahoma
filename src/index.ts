import { Matterbridge } from 'matterbridge';
import { AnsiLogger } from 'node-ansi-logger';
import { SomfyTahomaPlatform } from './platform.js';

/**
 * This is the standard interface for MatterBridge plugins.
 * Each plugin should export a default function that follows this signature.
 *
 * @param {Matterbridge} matterbridge - An instance of MatterBridge. This is the main interface for interacting with the MatterBridge system.
 * @param {AnsiLogger} log - An instance of AnsiLogger. This is used for logging messages in a format that can be displayed with ANSI color codes.
 * @returns {SomfyTahomaPlatform} - An instance of the SomfyTahomaPlatform. This is the main interface for interacting with the Somfy Tahoma system.
 *
 */
export default function initializePlugin(matterbridge: Matterbridge, log: AnsiLogger): SomfyTahomaPlatform {
  return new SomfyTahomaPlatform(matterbridge, log);
}
