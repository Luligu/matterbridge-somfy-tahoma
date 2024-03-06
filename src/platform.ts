import '@project-chip/matter-node.js';
import { OnOffCluster, WindowCovering, WindowCoveringCluster } from '@project-chip/matter-node.js/cluster';
import { DeviceTypes } from '@project-chip/matter-node.js/device';

import { Matterbridge, MatterbridgeDevice, MatterbridgeDynamicPlatform } from 'matterbridge';
import { AnsiLogger } from 'node-ansi-logger';

export class ExampleMatterbridgeDynamicPlatform extends MatterbridgeDynamicPlatform {
  constructor(matterbridge: Matterbridge, log: AnsiLogger) {
    super(matterbridge, log);
  }

  override async onStart(reason?: string) {
    this.log.info('onStart called with reason:', reason ?? 'none');

    const cover = new MatterbridgeDevice(DeviceTypes.WINDOW_COVERING);
    cover.createDefaultIdentifyClusterServer();
    cover.createDefaultGroupsClusterServer();
    cover.createDefaultScenesClusterServer();
    cover.createDefaultBridgedDeviceBasicInformationClusterServer('Bridged device 1', '0x01020564', 0xfff1, 'Luligu', 'Dynamic device 1');
    cover.createDefaultPowerSourceRechargableBatteryClusterServer(86);
    cover.createDefaultWindowCoveringClusterServer();
    await this.registerDevice(cover);

    setInterval(
      () => {
        const coverCluster = cover.getClusterServer(WindowCoveringCluster.with(WindowCovering.Feature.Lift, WindowCovering.Feature.PositionAwareLift));
        if (coverCluster && coverCluster.getCurrentPositionLiftPercent100thsAttribute) {
          let position = coverCluster.getCurrentPositionLiftPercent100thsAttribute();
          if (position === null) return;
          position = position >= 9000 ? 0 : position + 1000;
          coverCluster.setTargetPositionLiftPercent100thsAttribute(position);
          coverCluster.setCurrentPositionLiftPercent100thsAttribute(position);
          coverCluster.setOperationalStatusAttribute({
            global: WindowCovering.MovementStatus.Stopped,
            lift: WindowCovering.MovementStatus.Stopped,
            tilt: WindowCovering.MovementStatus.Stopped,
          });
          this.log.info(`Set PositionLiftPercent100ths to ${position}`);
        }
      },
      60 * 1000 + 500,
    );

    cover.addCommandHandler('identify', async ({ request: { identifyTime } }) => {
      this.log.info(`Command identify called identifyTime:${identifyTime}`);
    });
    cover.addCommandHandler('goToLiftPercentage', async ({ request: { liftPercent100thsValue } }) => {
      this.log.info(`Command goToLiftPercentage called liftPercent100thsValue:${liftPercent100thsValue}`);
    });

    const light = new MatterbridgeDevice(DeviceTypes.ON_OFF_LIGHT);
    light.createDefaultIdentifyClusterServer();
    light.createDefaultGroupsClusterServer();
    light.createDefaultScenesClusterServer();
    light.createDefaultBridgedDeviceBasicInformationClusterServer('Bridged device 2', '0x23480564', 0xfff1, 'Luligu', 'Dynamic device 2');
    light.createDefaultPowerSourceReplaceableBatteryClusterServer(70);
    light.createDefaultOnOffClusterServer();
    this.registerDevice(light);

    setInterval(
      () => {
        const lightCluster = light.getClusterServer(OnOffCluster);
        if (lightCluster) {
          const status = lightCluster.getOnOffAttribute();
          lightCluster.setOnOffAttribute(!status);
          this.log.info(`Set onOff to ${!status}`);
        }
      },
      60 * 1000 + 200,
    );

    light.addCommandHandler('identify', async ({ request: { identifyTime } }) => {
      this.log.info(`Command identify called identifyTime:${identifyTime}`);
    });
    light.addCommandHandler('on', async () => {
      this.log.info('Command on called');
    });
    light.addCommandHandler('off', async () => {
      this.log.info('Command off called');
    });
  }

  override async onShutdown(reason?: string) {
    this.log.info('onShutdown called with reason:', reason ?? 'none');
  }
}
