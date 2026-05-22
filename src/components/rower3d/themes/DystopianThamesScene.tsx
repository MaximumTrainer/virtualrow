import React, { useMemo } from 'react';
import { RENDER_CONFIG } from '../constants';
import { seededRandom } from '../helpers';

export const DystopianThamesLandscape: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -35 : 35;
  
  const ruins = useMemo(() => {
    const result: Array<{ x: number; z: number; height: number; width: number; damaged: boolean; rustLevel: number; debrisX: number; debrisZ: number; searchlight: boolean }> = [];
    for (let z = -500; z < 500; z += 30) {
      const i = Math.round((z + 500) / 30);
      const damaged = seededRandom(i * 31 + 5) > 0.4;
      result.push({
        x: xOffset + (seededRandom(i * 31 + 1) - 0.5) * 20,
        z: z + (seededRandom(i * 31 + 2) - 0.5) * 15,
        height: 15 + seededRandom(i * 31 + 3) * 35,
        width: 4 + seededRandom(i * 31 + 4) * 6,
        damaged,
        rustLevel: seededRandom(i * 31 + 6),
        debrisX: (seededRandom(i * 31 + 7) - 0.5),
        debrisZ: (seededRandom(i * 31 + 8) - 0.5),
        searchlight: seededRandom(i * 31 + 9) > 0.75 && !damaged,
      });
    }
    return result;
  }, [xOffset]);
  
  return (
    <group position={[0, 0, boatZ]}>
      {ruins.map((r, i) => {
        const actualHeight = r.damaged ? r.height * 0.7 : r.height;
        const concreteColor = r.rustLevel > 0.6 ? '#1a1a28' : '#1e1e2a';
        return (
          <group key={i} position={[r.x, 0, r.z]}>
            <mesh position={[0, actualHeight / 2, 0]} castShadow={Math.abs(r.z) < RENDER_CONFIG.shadowNearBand} receiveShadow>
              <boxGeometry args={[r.width, actualHeight, r.width]} />
              <meshPhysicalMaterial color={concreteColor} roughness={0.94} metalness={0.03} clearcoat={0.02} clearcoatRoughness={0.95} />
            </mesh>
            <mesh position={[r.width / 2 + 0.02, actualHeight * 0.6, 0]}>
              <boxGeometry args={[0.05, actualHeight * 0.5, r.width * 0.3]} />
              <meshPhysicalMaterial color="#3a2820" roughness={0.98} transparent opacity={0.4 + r.rustLevel * 0.3} />
            </mesh>
            {r.damaged && (
              <>
                <mesh position={[r.width * 0.3, actualHeight + 0.5, 0]} rotation={[0, 0, 0.3]}>
                  <cylinderGeometry args={[0.08, 0.08, 3, 6]} />
                  <meshPhysicalMaterial color="#4a3530" roughness={0.7} metalness={0.6} />
                </mesh>
                <mesh position={[-r.width * 0.2, actualHeight + 0.8, r.width * 0.2]} rotation={[0.2, 0, -0.4]}>
                  <cylinderGeometry args={[0.06, 0.06, 2.5, 6]} />
                  <meshPhysicalMaterial color="#3a2a25" roughness={0.75} metalness={0.55} />
                </mesh>
              </>
            )}
            {[0.2, 0.4, 0.6, 0.8].map((yPos, j) => {
              const isBroken = seededRandom(i * 13 + j) > 0.6;
              const hasLight = !isBroken && seededRandom(i * 13 + j + 4) > 0.7;
              return (
                <group key={j}>
                  <mesh position={[r.width / 2 + 0.02, actualHeight * yPos, 0]}>
                    <boxGeometry args={[0.08, 1.4, r.width * 0.65]} />
                    <meshPhysicalMaterial color="#0a0a12" roughness={0.8} metalness={0.2} />
                  </mesh>
                  {!isBroken && (
                    <mesh position={[r.width / 2 + 0.05, actualHeight * yPos, 0]}>
                      <boxGeometry args={[0.02, 1.2, r.width * 0.6]} />
                      <meshPhysicalMaterial color="#0f1525" roughness={0.08} metalness={0.92} reflectivity={1.0} clearcoat={1.0} clearcoatRoughness={0.03} emissive={hasLight ? "#ff3030" : "#0a1520"} emissiveIntensity={hasLight ? 0.5 : 0.08} transparent opacity={0.9} />
                    </mesh>
                  )}
                </group>
              );
            })}
            {r.damaged && (
              <group>
                <mesh position={[r.debrisX * r.width, actualHeight * 0.35 + 1, r.debrisZ * r.width]} rotation={[0.3, 0.5, 0.2]}>
                  <boxGeometry args={[r.width * 0.35, 2.5, r.width * 0.35]} />
                  <meshPhysicalMaterial color="#16213e" roughness={0.96} />
                </mesh>
                <mesh position={[r.width * 0.5, 0.4, r.width * 0.3]} rotation={[0.1, 0.4, 0.2]}>
                  <dodecahedronGeometry args={[0.8, 0]} />
                  <meshPhysicalMaterial color="#1a1a28" roughness={0.95} />
                </mesh>
                <mesh position={[-r.width * 0.3, 0.3, -r.width * 0.4]} rotation={[0.2, 0.1, 0.3]}>
                  <dodecahedronGeometry args={[0.6, 0]} />
                  <meshPhysicalMaterial color="#161620" roughness={0.94} />
                </mesh>
              </group>
            )}
            {r.searchlight && (
              <group position={[0, r.height + 1.5, 0]}>
                <mesh>
                  <cylinderGeometry args={[0.15, 0.35, 2.5, 8]} />
                  <meshPhysicalMaterial color="#2a2a30" roughness={0.6} metalness={0.4} />
                </mesh>
                <mesh position={[0, 1.5, 0]}>
                  <sphereGeometry args={[0.3, 8, 8]} />
                  <meshPhysicalMaterial color="#ffd60a" emissive="#ffd60a" emissiveIntensity={0.7} roughness={0.2} />
                </mesh>
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
};
