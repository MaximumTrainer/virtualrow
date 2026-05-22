# HD Boat Model — Asset Slot

This directory is reserved for the production high-fidelity sculling boat `.glb` file.

## Expected File

`public/assets/boat/scull.glb`

## Required GLB Structure

The asset is loaded via `@react-three/drei`'s `useGLTF` hook and must contain the
following named nodes for animation binding:

| Node name | Description |
|---|---|
| `Hull` | Main boat hull mesh |
| `LeftOar` | Left oar assembly (shaft + blade) |
| `RightOar` | Right oar assembly (shaft + blade) |
| `LeftRigger` | Left rigger/outrigger |
| `RightRigger` | Right rigger/outrigger |
| `Rower` | Rower root group |
| `Rower_Torso` | Torso (for body rock animation) |
| `Rower_LeftArm` | Left arm chain root |
| `Rower_RightArm` | Right arm chain root |
| `Rower_LeftLeg` | Left leg chain root |
| `Rower_RightLeg` | Right leg chain root |
| `Seat` | Sliding seat (Z-axis travel) |

## Bounding Box Requirements

The model **must** fit within these bounds to preserve route-following logic:

- Length (Z-axis): **8.0 – 8.4 m**  
- Beam (X-axis): **0.25 – 0.35 m**  
- Height (Y-axis, hull only): **0.15 – 0.25 m**

The pivot origin should be at the geometric centre of the hull at water level (Y = 0).

## Recommended Sources

| Source | Search terms | Notes |
|---|---|---|
| Sketchfab | "rowing scull", "single scull boat", "rowing shell" | Filter: CC licence, rigged |
| TurboSquid | "racing scull 3D model" | Commercial licence required |
| CGTrader | "rowing boat single scull" | Check rigging compatibility |
| Custom | Commission from a 3D artist | ~$200–$800 for production quality |

## Recommended Licence

**CC BY 4.0** or **CC BY-SA 4.0** for open-source use.  
For commercial deployment, obtain a royalty-free commercial licence.

## Format

Export as **glTF 2.0 binary** (`.glb`), with PBR materials (base colour + metallic/roughness textures).  
Target polygon count: **20,000 – 80,000 triangles** (hull + rower + oars combined).

## Integration

Once the production `.glb` is placed here, update `src/components/Rower3D.tsx`:

```tsx
// Replace the procedural RowingScull component usage with:
import { useGLTF } from '@react-three/drei';

const { nodes, materials } = useGLTF('/assets/boat/scull.glb');
```

Oar animation is driven by `strokeCycleT` from the Wasm physics engine
(exposed via `usePhysicsEngine` hook → `boatState.strokeCycleT`).
