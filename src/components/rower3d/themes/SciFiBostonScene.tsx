import React, { useMemo } from 'react';
import { RENDER_CONFIG } from '../constants';
import { seededRandom } from '../helpers';

export const SciFiBostonLandscape: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -35 : 35;
  
  const structures = useMemo(() => {
    const result: Array<{ x: number; z: number; height: number; type: 'tower' | 'cube' | 'pyramid' }> = [];
    for (let z = -500; z < 500; z += 28) {
      const i = Math.round((z + 500) / 28);
      const type = seededRandom(i * 37 + 1) > 0.6 ? 'tower' : (seededRandom(i * 37 + 2) > 0.5 ? 'cube' : 'pyramid');
      result.push({
        x: xOffset + (seededRandom(i * 37 + 3) - 0.5) * 18,
        z: z + (seededRandom(i * 37 + 4) - 0.5) * 14,
        height: 10 + seededRandom(i * 37 + 5) * 25,
        type,
      });
    }
    return result;
  }, [xOffset]);
  
  const colors = ['#00f5d4', '#7df9ff', '#40e0d0', '#00ced1', '#48d1cc'];
  
  return (
    <group position={[0, 0, boatZ]}>
      {structures.map((s, i) => {
        const color = colors[i % colors.length];
        return (
          <group key={i} position={[s.x, 0, s.z]}>
            {s.type === 'tower' && (
              <>
                <mesh position={[0, s.height / 2, 0]} castShadow={Math.abs(s.z) < RENDER_CONFIG.shadowNearBand}>
                  <boxGeometry args={[3, s.height, 3]} />
                  <meshStandardMaterial color={color} transparent opacity={0.7} emissive={color} emissiveIntensity={0.4} metalness={0.8} roughness={0.1} />
                </mesh>
                <mesh position={[0, s.height + 2, 0]}>
                  <cylinderGeometry args={[0.1, 0.2, 4, 4]} />
                  <meshStandardMaterial color="#ffd60a" emissive="#ffd60a" emissiveIntensity={0.6} />
                </mesh>
              </>
            )}
            {s.type === 'cube' && (
              <>
                <mesh position={[0, s.height * 0.5 + 3, 0]} rotation={[Math.PI / 6, Math.PI / 4, 0]}>
                  <boxGeometry args={[5, 5, 5]} />
                  <meshStandardMaterial color={color} transparent opacity={0.6} emissive={color} emissiveIntensity={0.5} wireframe />
                </mesh>
                <mesh position={[0, s.height * 0.5 + 3, 0]} rotation={[Math.PI / 4, Math.PI / 6, 0]}>
                  <boxGeometry args={[3.5, 3.5, 3.5]} />
                  <meshStandardMaterial color={color} transparent opacity={0.4} emissive={color} emissiveIntensity={0.3} />
                </mesh>
              </>
            )}
            {s.type === 'pyramid' && (
              <>
                <mesh position={[0, s.height * 0.5, 0]} rotation={[Math.PI, 0, 0]}>
                  <coneGeometry args={[4, s.height * 0.6, 4]} />
                  <meshStandardMaterial color={color} transparent opacity={0.7} emissive={color} emissiveIntensity={0.3} metalness={0.7} roughness={0.2} />
                </mesh>
                <mesh position={[0, s.height * 0.8, 0]}>
                  <boxGeometry args={[6, 1, 6]} />
                  <meshStandardMaterial color="#162447" metalness={0.5} roughness={0.4} />
                </mesh>
              </>
            )}
          </group>
        );
      })}
    </group>
  );
};
