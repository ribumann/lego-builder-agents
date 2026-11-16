export const DEFAULT_CAMERA_OFFSET = Object.freeze({ x: 0.75, y: 0.35, z: 0.55 });

export function cameraViewOffset(flipped) {
  const side = flipped ? -1 : 1;
  return {
    x: DEFAULT_CAMERA_OFFSET.x * side,
    y: DEFAULT_CAMERA_OFFSET.y,
    z: DEFAULT_CAMERA_OFFSET.z * side,
  };
}
