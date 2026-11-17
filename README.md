# Tafheet

An endless desert-highway drifting game built with React, Three.js, and Vite.

```sh
npm install
npm run dev
```

Use W / ↑ for throttle, S / ↓ for brakes, A / D or ← / → to steer, and Space for the handbrake. Escape pauses. Touch controls are available on touch devices (on-screen wheel, buttons, or device gyro tilt).

Runs have no time limit. Score comes from distance on asphalt, drift speed and angle, linked direction changes, and close traffic passes. A drift chain stays alive for 1.5 seconds between slides. Multipliers grow to ×5. Direction changes award 250 × multiplier, close passes award 200 × multiplier, and sideways passes award 600 × multiplier. Leaving the asphalt or touching any traffic car immediately ends the run. After your first drift, letting the 1.5-second chain window expire or spinning out also ends the run. Before the first drift, you can accelerate without a chain countdown.

The crown button opens the device's top ten completed runs, sorted by score and then distance. Rankings and personal bests use browser local storage; they are not shared online. Clearing browser data clears them. If storage is unavailable, the leaderboard remains available for the current session.

Traffic occupies three lanes in staggered rows, moves at different speeds, and recycles ahead of the player. Row spacing gradually shrinks with distance, while following cars slow down to prevent bunching.

Checks:

```sh
npm test
npm run lint
npm run build
```

Gameplay tests cover linked drifts at 30/60/120 FPS, chain resets, collisions, one-time pass rewards, traffic spawning/recycling, and leaderboard ranking and storage parsing.
# hajwala
