import { DeviceTypes, WindowCovering, WindowCoveringCluster, logEndpoint } from 'matterbridge';
import { Matterbridge, MatterbridgeDevice, MatterbridgeDynamicPlatform } from 'matterbridge';
import { AnsiLogger } from 'node-ansi-logger';

export class SomfyTahomaPlatform extends MatterbridgeDynamicPlatform {
  cover: MatterbridgeDevice | undefined = undefined;

  constructor(matterbridge: Matterbridge, log: AnsiLogger) {
    super(matterbridge, log);
  }

  override async onStart(reason?: string) {
    this.log.info('onStart called with reason:', reason ?? 'none');

    this.cover = new MatterbridgeDevice(DeviceTypes.WINDOW_COVERING);
    this.cover.createDefaultIdentifyClusterServer();
    this.cover.createDefaultGroupsClusterServer();
    this.cover.createDefaultScenesClusterServer();
    this.cover.createDefaultBridgedDeviceBasicInformationClusterServer('Blind 1', '0x01020599', 0xfff1, 'Luligu', 'Dynamic blind 1');
    this.cover.createDefaultPowerSourceRechargableBatteryClusterServer(86);
    this.cover.createDefaultWindowCoveringClusterServer(0);

    await this.registerDevice(this.cover);

    /*
    setInterval(
      () => {
        const coverCluster = cover.getClusterServer(WindowCoveringCluster.with(WindowCovering.Feature.Lift, WindowCovering.Feature.PositionAwareLift));
        if (coverCluster && coverCluster.getCurrentPositionLiftPercent100thsAttribute) {
          let position = coverCluster.getCurrentPositionLiftPercent100thsAttribute();
          if (position === null) return;
          position = position >= 9000 ? 0 : position + 1000;
          coverCluster.setTargetPositionLiftPercent100thsAttribute(position);
          coverCluster.setCurrentPositionLiftPercent100thsAttribute(position);
          this.setStatus(cover, WindowCovering.MovementStatus.Stopped);
          this.log.info(`Set PositionLiftPercent100ths to ${position}`);
        }
      },
      60 * 1000 + 500,
    );
    */

    this.cover.addCommandHandler('identify', async ({ request: { identifyTime } }) => {
      this.log.info(`Command identify called identifyTime:${identifyTime}`);
      if (this.cover) logEndpoint(this.cover);
    });

    this.cover.addCommandHandler('goToLiftPercentage', async ({ request: { liftPercent100thsValue } }) => {
      this.log.info(`Command goToLiftPercentage called liftPercent100thsValue:${liftPercent100thsValue}`);
      if (this.cover) this.moveToPosition(this.cover, liftPercent100thsValue);
    });
  }

  override async onConfigure() {
    this.log.debug('onConfigure called');
    if (!this.cover) return;
    const windowCovering = this.cover.getClusterServer(WindowCoveringCluster.with(WindowCovering.Feature.Lift, WindowCovering.Feature.PositionAwareLift));
    if (!windowCovering) return;
    const currentPosition = windowCovering.getCurrentPositionLiftPercent100thsAttribute();
    const targetPosition = windowCovering.getTargetPositionLiftPercent100thsAttribute();
    if (currentPosition === null || targetPosition === null) return;
    this.log.debug('**onConfigure called setting currentPosition', currentPosition, targetPosition);
    windowCovering.setTargetPositionLiftPercent100thsAttribute(currentPosition);
  }

  override async onShutdown(reason?: string) {
    this.log.info('onShutdown called with reason:', reason ?? 'none');
  }

  setStatus(cover: MatterbridgeDevice, status: WindowCovering.MovementStatus) {
    const windowCovering = cover.getClusterServer(WindowCoveringCluster.with(WindowCovering.Feature.Lift, WindowCovering.Feature.PositionAwareLift));
    if (!windowCovering) return;
    windowCovering.setOperationalStatusAttribute({ global: status, lift: status, tilt: status });
  }

  setPosition(cover: MatterbridgeDevice, position: number) {
    const windowCovering = cover.getClusterServer(WindowCoveringCluster.with(WindowCovering.Feature.Lift, WindowCovering.Feature.PositionAwareLift));
    if (!windowCovering) return;
    windowCovering.setCurrentPositionLiftPercent100thsAttribute(position);
    windowCovering.setTargetPositionLiftPercent100thsAttribute(position);
  }

  // With Matter 0=open 10000=close
  moveToPosition(cover: MatterbridgeDevice, targetPosition: number) {
    const windowCovering = cover.getClusterServer(WindowCoveringCluster.with(WindowCovering.Feature.Lift, WindowCovering.Feature.PositionAwareLift));
    if (!windowCovering) return;
    let currentPosition = windowCovering.getCurrentPositionLiftPercent100thsAttribute();
    if (currentPosition === null) return;
    if (targetPosition === currentPosition) {
      windowCovering.setTargetPositionLiftPercent100thsAttribute(targetPosition);
      this.setStatus(cover, WindowCovering.MovementStatus.Stopped);
      this.log.debug(`****Moving from ${currentPosition} to ${targetPosition}. Movement stopped.`);
      return;
    }
    const movement = targetPosition - currentPosition;
    const fullMovementSeconds = 30;
    const movementSeconds = Math.abs((movement * fullMovementSeconds) / 10000);
    this.log.debug(`****Moving from ${currentPosition} to ${targetPosition} in ${movementSeconds} seconds. Movement requested ${movement}`);
    windowCovering.setTargetPositionLiftPercent100thsAttribute(targetPosition);
    this.setStatus(cover, targetPosition > currentPosition ? WindowCovering.MovementStatus.Closing : WindowCovering.MovementStatus.Opening);
    const interval = setInterval(() => {
      currentPosition = Math.round(currentPosition! + movement / movementSeconds);
      this.log.debug(`****Moving from ${currentPosition} to ${targetPosition} difference ${Math.abs(targetPosition - currentPosition)}`);
      if (Math.abs(targetPosition - currentPosition) <= 100 || (movement > 0 && currentPosition >= targetPosition) || (movement < 0 && currentPosition <= targetPosition)) {
        windowCovering.setCurrentPositionLiftPercent100thsAttribute(targetPosition);
        this.setStatus(cover, WindowCovering.MovementStatus.Stopped);
        clearInterval(interval);
      } else {
        windowCovering.setCurrentPositionLiftPercent100thsAttribute(Math.max(0, Math.min(currentPosition, 10000)));
      }
    }, 1000);
    interval.unref();
  }
}
