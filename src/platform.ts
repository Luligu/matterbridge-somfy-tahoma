import { DeviceTypes, WindowCovering, WindowCoveringCluster, logEndpoint } from 'matterbridge';
import { Matterbridge, MatterbridgeDevice, MatterbridgeDynamicPlatform } from 'matterbridge';
import { AnsiLogger } from 'node-ansi-logger';

export class SomfyTahomaPlatform extends MatterbridgeDynamicPlatform {
  cover: MatterbridgeDevice | undefined = undefined;
  interval: NodeJS.Timeout | undefined = undefined;

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
    this.cover.createDefaultPowerSourceRechargeableBatteryClusterServer(86);
    this.cover.createDefaultWindowCoveringClusterServer();

    await this.registerDevice(this.cover);

    /*
    this.interval = setInterval(
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

    this.cover.addCommandHandler('stopMotion', async () => {
      this.log.info('Command stopMotion called');
      clearInterval(this.interval);
      this.cover?.setWindowCoveringTargetAsCurrentAndStopped();
      //if (this.cover) this.moveToPosition(this.cover, liftPercent100thsValue);WindowCovering
    });
  }

  override async onConfigure() {
    this.log.info('onConfigure called');

    // Set cover to target = current position and status to stopped (current position is persisted in the cluster)
    this.cover?.setWindowCoveringTargetAsCurrentAndStopped();
    this.log.debug('Set cover initial targetPositionLiftPercent100ths = currentPositionLiftPercent100ths and operationalStatus to Stopped.');
  }

  override async onShutdown(reason?: string) {
    this.log.info('onShutdown called with reason:', reason ?? 'none');
    clearInterval(this.interval);
    await this.unregisterAllDevices();
  }

  // With Matter 0=open 10000=close
  moveToPosition(cover: MatterbridgeDevice, targetPosition: number) {
    const windowCovering = cover.getClusterServer(WindowCoveringCluster.with(WindowCovering.Feature.Lift, WindowCovering.Feature.PositionAwareLift));
    if (!windowCovering) return;

    if (cover.getWindowCoveringStatus() !== WindowCovering.MovementStatus.Stopped) {
      this.log.info('**Stopping movement.');
      clearInterval(this.interval);
      this.cover?.setWindowCoveringTargetAsCurrentAndStopped();
      return;
    }
    let currentPosition = windowCovering.getCurrentPositionLiftPercent100thsAttribute();
    if (currentPosition === null) return;
    if (targetPosition === currentPosition) {
      clearInterval(this.interval);
      this.cover?.setWindowCoveringTargetAsCurrentAndStopped();
      this.log.info(`**Moving from ${currentPosition} to ${targetPosition}. Movement stopped.`);
      return;
    }
    const movement = targetPosition - currentPosition;
    const fullMovementSeconds = 30;
    const movementSeconds = Math.abs((movement * fullMovementSeconds) / 10000);
    this.log.info(`**Moving from ${currentPosition} to ${targetPosition} in ${movementSeconds} seconds. Movement requested ${movement}`);
    windowCovering.setTargetPositionLiftPercent100thsAttribute(targetPosition);
    cover.setWindowCoveringStatus(targetPosition > currentPosition ? WindowCovering.MovementStatus.Closing : WindowCovering.MovementStatus.Opening);
    this.interval = setInterval(() => {
      currentPosition = Math.round(currentPosition! + movement / movementSeconds);
      if (Math.abs(targetPosition - currentPosition) <= 100 || (movement > 0 && currentPosition >= targetPosition) || (movement < 0 && currentPosition <= targetPosition)) {
        clearInterval(this.interval);
        cover.setWindowCoveringCurrentTargetStatus(targetPosition, targetPosition, WindowCovering.MovementStatus.Stopped);
        this.log.info(`**Moving stopped at ${targetPosition}`);
      } else {
        this.log.info(`**Moving from ${currentPosition} to ${targetPosition} difference ${Math.abs(targetPosition - currentPosition)}`);
        windowCovering.setCurrentPositionLiftPercent100thsAttribute(Math.max(0, Math.min(currentPosition, 10000)));
      }
    }, 1000);
  }
}
