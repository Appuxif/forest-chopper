# ORI-07: Network orientation and authoritative chopping

Move packets remain the sole periodic player-pose updates (about 8–10 Hz).
The legacy yaw field is legs facing, in radians. Added torsoYaw (world yaw),
torsoPitch, headYaw, headPitch and motion (Idle, Walk, WalkBackward, Run,
RunBackward, StrafeLeft, StrafeRight, Jump). The same values appear in
welcome/join/move, without transmitting skeleton bones.

Remote avatars interpolate yaw across the shortest angle and pitch linearly,
and add procedural spine/head look after their existing AnimationMixer tick.
Older clients/bots without pose fields default to torsoYaw=yaw, zero pitch and
head offsets, and inferred movement animation.

The Python server validates numeric pose fields and motion names before
rebroadcasting: chest twist <=90 degrees, head yaw <=100 degrees, local
pitch <=90 degrees. The old yaw-only packet stays supported.

Before damaging a tree or dismantling a structure, the server checks:
- Axe is equipped and target is valid.
- Horizontal distance to target center <=2 m, measured from the last
  server-accepted player position.
- Target lies in front of legs (open +/-90-degree hemisphere).
- Target lies within +/-60 degrees of the reported torso yaw.
- Existing stamina, bag capacity, and server-computed axe damage rules.
- Swing cooldown based on 46 frames at 30FPS, played at 1.6x and
  adjusted for weapon tier, plus 35ms padding.

The client selects the intended target at Chop2 contact frame 25 and sends
the ordinary hit event. The server cannot verify the exact contact *frame*
without an authoritative attack-start protocol; it verifies geometry,
equipment and cooldown rather than trusting client-supplied damage. Client
reported position/orientation is not a full server-authoritative physics
simulation, so additional anti-cheat work would be required before PvP.

Multiplayer server currently supports only the default axe. The new crescent
axe and its 3-point damage remain debug-only/offline.

Tests: tests/network-pose.test.mjs and tests/test_network_pose.py (WebSocket
move/join/welcome, bad pose, range, behind-player targets and structures),
along with the existing integration suite.

Manual acceptance: two clients, walking forward/back, strafe, sprint,
sideways free-look, swings while turning, all three humanoid bodies,
fall/ragdoll/respawn, and older yaw-only bots. Restart the Python server
to load new validation code. Browser manual visual verification is pending.
