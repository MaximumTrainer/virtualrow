import React, { useMemo } from 'react';
import { RENDER_CONFIG } from '../constants';
import { seededRandom } from '../helpers';

export const GothicVeniceLandscape: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -25 : 25;
  
  const buildings = useMemo(() => {
    const result: Array<{ x: number; z: number; height: number; width: number; depth: number; color: string; tilt: number; windowGlow: number; debrisOffset: number }> = [];
    const colors = ['#2d3436', '#1e272e', '#2c3e50', '#34495e', '#192a56'];
    for (let z = -400; z < 400; z += 20) {
      const i = Math.round((z + 400) / 20);
      result.push({
        x: xOffset + (seededRandom(i * 19 + 1) - 0.5) * 12,
        z: z + (seededRandom(i * 19 + 2) - 0.5) * 10,
        height: 8 + seededRandom(i * 19 + 3) * 14,
        width: 4 + seededRandom(i * 19 + 4) * 6,
        depth: 4 + seededRandom(i * 19 + 5) * 5,
        color: colors[Math.floor(seededRandom(i * 19 + 6) * colors.length)],
        tilt: (seededRandom(i * 19 + 7) - 0.5) * 0.15,
        windowGlow: seededRandom(i * 19 + 8),
        debrisOffset: (seededRandom(i * 19 + 9) - 0.5),
      });
    }
    return result;
  }, [xOffset]);
  
  return (
    <group position={[0, 0, boatZ]}>
      {buildings.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]} rotation={[0, 0, b.tilt]}>
          <mesh position={[0, b.height / 2, 0]} castShadow={Math.abs(b.z) < RENDER_CONFIG.shadowNearBand} receiveShadow>
            <boxGeometry args={[b.width, b.height, b.depth]} />
            <meshPhysicalMaterial color={b.color} roughness={0.92} metalness={0.02} clearcoat={0.05} clearcoatRoughness={0.9} />
          </mesh>
          <mesh position={[0, b.height * 0.95, 0]} castShadow={Math.abs(b.z) < RENDER_CONFIG.shadowNearBand}>
            <boxGeometry args={[b.width + 0.3, 0.4, b.depth + 0.3]} />
            <meshPhysicalMaterial color="#3d4a50" roughness={0.88} metalness={0.03} />
          </mesh>
          <mesh position={[0, b.height * 0.6, 0]} castShadow={Math.abs(b.z) < RENDER_CONFIG.shadowNearBand}>
            <boxGeometry args={[b.width + 0.15, 0.2, b.depth + 0.15]} />
            <meshPhysicalMaterial color="#3d4a50" roughness={0.9} />
          </mesh>
          {[0.25, 0.45, 0.65, 0.85].map((yPos, j) => (
            <group key={j}>
              <mesh position={[b.width / 2 + 0.02, b.height * yPos, 0]}>
                <boxGeometry args={[0.08, 1.8, b.depth * 0.5]} />
                <meshPhysicalMaterial color="#1a1a2e" roughness={0.7} metalness={0.1} />
              </mesh>
              <mesh position={[b.width / 2 + 0.06, b.height * yPos, 0]}>
                <boxGeometry args={[0.02, 1.6, b.depth * 0.45]} />
                <meshPhysicalMaterial color="#0a2040" roughness={0.1} metalness={0.9} reflectivity={1.0} clearcoat={1.0} clearcoatRoughness={0.05} emissive={b.windowGlow > 0.7 ? "#ff9500" : "#0a2a4a"} emissiveIntensity={b.windowGlow > 0.7 ? 0.4 : 0.15} transparent opacity={0.85} />
              </mesh>
              <mesh position={[b.width / 2 + 0.02, b.height * yPos + 1.0, 0]} rotation={[0, 0, Math.PI / 4]}>
                <boxGeometry args={[0.3, 0.3, 0.08]} />
                <meshPhysicalMaterial color="#1a1a2e" roughness={0.75} />
              </mesh>
            </group>
          ))}
          <mesh position={[0, 0.5, b.depth / 2 + 0.01]}>
            <boxGeometry args={[b.width * 0.8, 1.5, 0.05]} />
            <meshPhysicalMaterial color="#2a3a2a" roughness={0.95} transparent opacity={0.6} />
          </mesh>
          <mesh position={[b.debrisOffset * b.width * 0.3, b.height + 0.5, 0]} castShadow={Math.abs(b.z) < RENDER_CONFIG.shadowNearBand}>
            <boxGeometry args={[b.width * 0.4, 1.2, b.depth * 0.4]} />
            <meshPhysicalMaterial color={b.color} roughness={0.95} />
          </mesh>
          <mesh position={[b.width * 0.4, 0.3, b.depth * 0.3]} rotation={[0.2, 0.5, 0.1]}>
            <boxGeometry args={[0.8, 0.5, 0.6]} />
            <meshPhysicalMaterial color="#3d4550" roughness={0.92} />
          </mesh>
        </group>
      ))}
    </group>
  );
};
