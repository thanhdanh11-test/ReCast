import * as THREE from "three";

/** Grayscale vehicle palette shared by bundled GLB cars and procedural bus/truck bodies. */
export const NEUTRAL_PALETTE = {
  paint: 0xd9d9d9,
  glass: 0x353535,
  rubber: 0x282828,
  trim: 0x777777,
} as const;

/**
 * Fixed presentation lamps: white front, red rear. They never encode observed brake,
 * indicator or headlight state (not in the source data) and add no scene lights.
 */
export function createLampMaterial(
  side: "front" | "rear",
): THREE.MeshStandardMaterial {
  const material =
    side === "front"
      ? new THREE.MeshStandardMaterial({
          color: 0xf4f4f4,
          emissive: 0xffffff,
          emissiveIntensity: 0.35,
          roughness: 0.25,
        })
      : new THREE.MeshStandardMaterial({
          color: 0xb3121a,
          emissive: 0xff1a1a,
          emissiveIntensity: 0.45,
          roughness: 0.3,
        });
  material.name = `lamp-${side}`;
  material.userData.lamp = side;
  material.userData.actorSurface = "lights";
  return material;
}
