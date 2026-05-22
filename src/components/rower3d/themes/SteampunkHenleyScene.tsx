import React, { useMemo } from 'react';
import { RENDER_CONFIG } from '../constants';
import { seededRandom } from '../helpers';

export const SteampunkHenleyLandscape: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -30 : 30;
  
  const structures = useMemo(() => {
    const result: Array<{ x: number; z: number; height: number; type: 'tower' | 'platform' | 'gear'; patina: number }> = [];
    for (let z = -400; z < 400; z += 25) {
      const i = Math.round((z + 400) / 25);
      const r1 = seededRandom(i * 29 + 1);
      const type = r1 > 0.6 ? 'tower' : (seededRandom(i * 29 + 2) > 0.5 ? 'platform' : 'gear');
      result.push({
        x: xOffset + (seededRandom(i * 29 + 3) - 0.5) * 15,
        z: z + (seededRandom(i * 29 + 4) - 0.5) * 12,
        height: 8 + seededRandom(i * 29 + 5) * 18,
        type,
        patina: seededRandom(i * 29 + 6),
      });
    }
    return result;
  }, [xOffset]);
  
  return (
    <group position={[0, 0, boatZ]}>
      {structures.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]}>
          {s.type === 'tower' && (
            <>
              <mesh position={[0, s.height / 2, 0]} castShadow={Math.abs(s.z) < RENDER_CONFIG.shadowNearBand} receiveShadow>
                <cylinderGeometry args={[1.8, 2.8, s.height, 12]} />
                <meshPhysicalMaterial color="#b87333" metalness={0.85} roughness={0.25} clearcoat={0.4} clearcoatRoughness={0.3} reflectivity={0.9} envMapIntensity={1.2} />
              </mesh>
              {[0.25, 0.5, 0.75].map((yPos, j) => (
                <mesh key={j} position={[0, s.height * yPos, 0]}>
                  <torusGeometry args={[2.2, 0.15, 8, 24]} />
                  <meshPhysicalMaterial color="#daa520" metalness={0.9} roughness={0.2} clearcoat={0.5} />
                </mesh>
              ))}
              <mesh position={[0, s.height + 1.2, 0]}>
                <sphereGeometry args={[2.6, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <meshPhysicalMaterial color={s.patina > 0.5 ? "#4a8066" : "#cd7f32"} metalness={0.8} roughness={s.patina > 0.5 ? 0.5 : 0.25} clearcoat={0.3} clearcoatRoughness={0.4} />
              </mesh>
              <mesh position={[0, s.height + 3, 0]}>
                <cylinderGeometry args={[0.25, 0.45, 2, 8]} />
                <meshPhysicalMaterial color="#8b7355" metalness={0.7} roughness={0.4} clearcoat={0.2} />
              </mesh>
              <mesh position={[0, s.height + 4.2, 0]}>
                <sphereGeometry args={[0.6, 8, 8]} />
                <meshPhysicalMaterial color="#ffffff" transparent opacity={0.25} emissive="#ffffff" emissiveIntensity={0.15} />
              </mesh>
            </>
          )}
          {s.type === 'platform' && (
            <>
              <mesh position={[0, s.height * 0.3, 0]} castShadow={Math.abs(s.z) < RENDER_CONFIG.shadowNearBand} receiveShadow>
                <boxGeometry args={[8, 0.8, 6]} />
                <meshPhysicalMaterial color="#5a4a40" metalness={0.6} roughness={0.55} clearcoat={0.15} clearcoatRoughness={0.7} />
              </mesh>
              <mesh position={[0, s.height * 0.3 + 0.5, 0]}>
                <boxGeometry args={[8.2, 0.15, 6.2]} />
                <meshPhysicalMaterial color="#4a3a30" metalness={0.65} roughness={0.5} />
              </mesh>
              {([[-3, -2], [-3, 2], [3, -2], [3, 2]] as [number, number][]).map(([x, z], j) => (
                <mesh key={j} position={[x, s.height * 0.15, z]}>
                  <cylinderGeometry args={[0.25, 0.35, s.height * 0.3, 8]} />
                  <meshPhysicalMaterial color="#4a3a30" metalness={0.55} roughness={0.6} clearcoat={0.1} />
                </mesh>
              ))}
              <mesh position={[-3, s.height * 0.15, 0]} rotation={[0, 0, 0.3]}>
                <cylinderGeometry args={[0.08, 0.08, 5, 6]} />
                <meshPhysicalMaterial color="#3a2a20" metalness={0.5} roughness={0.65} />
              </mesh>
              <mesh position={[3, s.height * 0.15, 0]} rotation={[0, 0, -0.3]}>
                <cylinderGeometry args={[0.08, 0.08, 5, 6]} />
                <meshPhysicalMaterial color="#3a2a20" metalness={0.5} roughness={0.65} />
              </mesh>
            </>
          )}
          {s.type === 'gear' && (
            <>
              <mesh position={[0, s.height * 0.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[4, 0.7, 12, 20]} />
                <meshPhysicalMaterial color="#daa520" metalness={0.9} roughness={0.18} clearcoat={0.5} clearcoatRoughness={0.25} reflectivity={1.0} envMapIntensity={1.3} />
              </mesh>
              {[...Array(12)].map((_, j) => {
                const angle = (j / 12) * Math.PI * 2;
                return (
                  <mesh key={j} position={[Math.cos(angle) * 4.6, s.height * 0.4, Math.sin(angle) * 4.6]} rotation={[Math.PI / 2, 0, angle]}>
                    <boxGeometry args={[0.8, 0.6, 0.7]} />
                    <meshPhysicalMaterial color="#c9a520" metalness={0.88} roughness={0.22} clearcoat={0.4} />
                  </mesh>
                );
              })}
              <mesh position={[0, s.height * 0.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[1.8, 1.8, 0.9, 12]} />
                <meshPhysicalMaterial color="#cd853f" metalness={0.85} roughness={0.25} clearcoat={0.4} />
              </mesh>
              <mesh position={[0, s.height * 0.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.4, 0.4, 1.5, 8]} />
                <meshPhysicalMaterial color="#8b7355" metalness={0.75} roughness={0.35} />
              </mesh>
            </>
          )}
        </group>
      ))}
    </group>
  );
};
