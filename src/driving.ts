import { ROAD_HALF, roadHeading, roadLateral } from './road'

export type DrivingState = {
  x: number; z: number; yaw: number; forward: number; lateral: number
  yawRate: number; steering: number; speed: number; rearGrip: number
}

export const initialDriving = (): DrivingState => ({
  x: 0, z: 0, yaw: 0, forward: 0, lateral: 0, yawRate: 0, steering: 0, speed: 0, rearGrip: 1,
})

// A planar bicycle model. Tire forces act at each axle, so rear grip loss
// produces rotation rather than a prescribed drift angle.
export function stepDriving(
  s: DrivingState,
  steer: number,
  gas: boolean,
  brake: boolean,
  handbrake: boolean,
  dt: number,
) {
  const steps = Math.ceil(dt / (1 / 120))
  const h = dt / steps
  for (let i = 0; i < steps; i++) {
    const lateralFromRoad = roadLateral(s.x, s.z)
    const offroad = Math.abs(lateralFromRoad) > ROAD_HALF
    const bodySpeed = Math.hypot(s.forward, s.lateral)
    // Raw atan2 — no forward clamp. Clamping near 0 made slip flip around 180°+ and yank the car.
    const slip = Math.atan2(s.lateral, s.forward)
    // Mild countersteer assistance for linked drifts. Off during handbrake so the rear can free-glide.
    const catchAssist = handbrake ? 0 : Math.max(-.24, Math.min(.24, slip * .65))
    const targetSteering = steer * (.5 / (1 + bodySpeed / 32)) + catchAssist
    const countersteering = steer * s.yawRate < 0
    const steeringStep = (countersteering ? 2.8 : steer === 0 ? 1.5 : 1.9) * h
    s.steering += Math.max(-steeringStep, Math.min(steeringStep, targetSteering - s.steering))
    const denominator = Math.max(3, bodySpeed)
    const frontSlip = Math.atan2(s.lateral + 1.35 * s.yawRate, denominator) - s.steering
    const rearSlip = Math.atan2(s.lateral - 1.4 * s.yawRate, denominator)
    const surface = offroad ? .48 : 1
    const loadTransfer = brake ? .8 : gas ? 1.08 : .93
    const frontLimit = 7.8 * surface / loadTransfer
    // Space = rear glider only. Breaks traction; does not add yaw push.
    const absSlip = Math.abs(slip)
    const sliding = Math.min(1, absSlip / .35)
    const targetRearGrip = handbrake ? .18 : gas ? .82 - sliding * .12 : 1
    s.rearGrip += (targetRearGrip - s.rearGrip) * (1 - Math.exp(-h * (handbrake ? 10 : 5)))
    const rearLimit = 8.4 * surface * loadTransfer * s.rearGrip
    const tireForce = (slipAngle: number, stiffness: number, limit: number) => {
      const peak = Math.tanh(slipAngle * stiffness / limit)
      const slidingGrip = 1 - .14 * Math.min(1, Math.max(0, (Math.abs(slipAngle) - .22) / .6))
      return -limit * peak * slidingGrip
    }
    const prevForward = s.forward
    const prevLateral = s.lateral
    const keptSpeed = Math.hypot(prevForward, prevLateral)
    const lowSpeedGrip = Math.min(1, keptSpeed / 3)
    // Handbrake: tires don't push linear or yaw — that self-align flips past 180° and yanks at speed.
    const front = handbrake ? 0 : tireForce(frontSlip, 48, frontLimit) * lowSpeedGrip
    const rear = handbrake ? 0 : tireForce(rearSlip, 52, rearLimit) * lowSpeedGrip
    const drive = gas ? 14 * Math.max(0, 1 - keptSpeed / 82) : 0
    const resistance = (handbrake ? .12 : .35) + .0012 * keptSpeed * keptSpeed * (handbrake ? .2 : 1) + (offroad ? 3 : 0)
    const deceleration = (brake ? 14 : 0) + (handbrake ? .08 : 0) + resistance

    if (handbrake) {
      // Fast flip target, blended (not torque-slammed) so mid-360 stays smooth.
      const spinTarget = steer === 0
        ? 0
        : steer * (2.55 + Math.min(keptSpeed, 55) * .018)
      const spinFollow = steer === 0 ? 2.2 : 9
      s.yawRate += (spinTarget - s.yawRate) * (1 - Math.exp(-spinFollow * h))
      s.yawRate = Math.max(-3.6, Math.min(3.6, s.yawRate))
    } else {
      const spinDamping = .4 + Math.max(0, absSlip - .35) * 2.6
      const yawTorque = (1.35 * front * Math.cos(s.steering) - 1.4 * rear) / 3
      s.yawRate += (yawTorque - s.yawRate * spinDamping) * h
      s.yawRate = Math.max(-4.2, Math.min(4.2, s.yawRate))
    }

    // World-space glide for the whole handbrake hold so body-frame slip wrapping
    // never feeds the integrator (that was the mid-360 sideways jump).
    if (handbrake && keptSpeed > .8) {
      const yawBefore = s.yaw
      s.yaw += s.yawRate * h
      const sn0 = Math.sin(yawBefore), cs0 = Math.cos(yawBefore)
      let wx = -sn0 * prevForward - cs0 * prevLateral
      let wz = -cs0 * prevForward + sn0 * prevLateral
      const wSpeed = Math.hypot(wx, wz)
      // Extra drag while spinning hard → tighter arc instead of a wide slide.
      const spinBleed = Math.abs(s.yawRate) * (1.1 + wSpeed * .035)
      const glideDrag = .04 + resistance * .08 + spinBleed + (offroad ? 1.0 : 0)
      const target = Math.max(0, wSpeed - glideDrag * h)
      if (wSpeed > .05) {
        wx *= target / wSpeed
        wz *= target / wSpeed
      }
      const sn = Math.sin(s.yaw), cs = Math.cos(s.yaw)
      s.forward = -sn * wx - cs * wz
      s.lateral = -cs * wx + sn * wz
      s.x += wx * h
      s.z += wz * h
    } else {
      const forwardAcceleration = drive - deceleration - front * Math.sin(s.steering) + s.yawRate * s.lateral
      const lateralAcceleration = front * Math.cos(s.steering) + rear - s.yawRate * s.forward
      s.forward += forwardAcceleration * h
      s.lateral += lateralAcceleration * h
      // Never hard-zero reverse while handbraking — that kills 180° glides.
      if (s.forward < 0 && !handbrake) s.forward = 0
      const total = Math.hypot(s.forward, s.lateral)
      if (total < 4 && !handbrake) {
        s.lateral *= Math.exp(-5 * h)
        s.yawRate *= Math.exp(-5 * h)
      }
      s.yaw += s.yawRate * h
      const sn = Math.sin(s.yaw), cs = Math.cos(s.yaw)
      s.x -= (sn * s.forward + cs * s.lateral) * h
      s.z += (-cs * s.forward + sn * s.lateral) * h
    }
    // Soft desert wall in road-lateral space so curve insides aren’t false walls.
    const wallLat = roadLateral(s.x, s.z)
    if (Math.abs(wallLat) > 32) {
      const side = Math.sign(wallLat)
      const heading = roadHeading(s.z)
      const rightX = Math.cos(heading)
      const rightZ = -Math.sin(heading)
      const overflow = Math.abs(wallLat) - 32
      s.x -= side * overflow * rightX
      s.z -= side * overflow * rightZ
      const sn = Math.sin(s.yaw), cs = Math.cos(s.yaw)
      let vx = -sn * s.forward - cs * s.lateral
      let vz = -cs * s.forward + sn * s.lateral
      if (handbrake) {
        const outward = vx * rightX + vz * rightZ
        if (outward * side > 0) {
          const kill = Math.min(Math.abs(outward), 18 * h + Math.abs(outward) * (1 - Math.exp(-3 * h)))
          vx -= side * rightX * kill
          vz -= side * rightZ * kill
        }
        s.forward = -sn * vx - cs * vz
        s.lateral = -cs * vx + sn * vz
        s.yawRate *= .98
      } else {
        s.forward *= .65
        s.lateral *= -.2
        s.yawRate *= .5
      }
    }
    s.speed = Math.hypot(s.forward, s.lateral)
  }
}
