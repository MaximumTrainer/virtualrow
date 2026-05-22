import React, { useMemo } from 'react';
import { RENDER_CONFIG } from '../constants';
import { seededRandom } from '../helpers';

export const CrystalBledLandscape: React.FC<{ side: 'left' | 'right'; boatZ: number }> = ({ side, boatZ }) => {
  const xOffset = side === 'left' ? -40 : 40;
  
  const crystals = useMemo(() => {
    const result: Array<{ x: number; z: number; height: number; radius: number; color: string; facets: number }> = [];
    const colors = ['#00f5d4', '#7df9ff', '#a0e7e5', '#40e0d0', '#00ced1'];
    for (let z = -500; z < 500; z += 30) {
      const i = Math.round((z + 500) / 30);
      result.push({
        x: xOffset + (seededRandom(i * 13 + 1) - 0.5) * 20,
        z: z + (seededRandom(i * 13 + 2) - 0.5) * 15,
        height: 12 + seededRandom(i * 13 + 3) * 25,
        radius: 1.5 + seededRandom(i * 13 + 4) * 2,
        color: colors[Math.floor(seededRandom(i * 13 + 5) * colors.length)],
        facets: 5 + Math.floor(seededRandom(i * 13 + 6) * 3),
      });
    }
    return result;
  }, [xOffset]);
  
  const mountains = useMemo(() => {
    const result: Array<{ x: number; z: number; scale: number; height: number; snowAmount: number }> = [];
    for (let z = -500; z < 500; z += 80) {
      const i = Math.round((z + 500) / 80);
      result.push({
        x: xOffset + (side === 'left' ? -30 : 30) + (seededRandom(i * 17 + 1) - 0.5) * 15,
        z: z + (seededRandom(i * 17 + 2) - 0.5) * 30,
        scale: 20 + seededRandom(i * 17 + 3) * 20,
        height: 30 + seededRandom(i * 17 + 4) * 40,
        snowAmount: 0.55 + seededRandom(i * 17 + 5) * 0.2,
      });
    }
    return result;
  }, [xOffset, side]);
  
  return (
    <group position={[0, 0, boatZ]}>
      {crystals.map((c, i) => (
        <group key={i} position={[c.x, 0, c.z]}>
          <mesh position={[0, c.height / 2, 0]} castShadow={Math.abs(c.z) < RENDER_CONFIG.shadowNearBand}>
            <cylinderGeometry args={[c.radius * 0.25, c.radius, c.height, c.facets]} />
            <meshPhysicalMaterial color={c.color} transparent opacity={0.75} transmission={0.6} thickness={2.0} roughness={0.05} metalness={0.0} ior={2.4} reflectivity={1.0} clearcoat={1.0} clearcoatRoughness={0.02} emissive={c.color} emissiveIntensity={0.25} iridescence={0.3} iridescenceIOR={1.3} />
          </mesh>
          <mesh position={[0, c.height / 2, 0]} castShadow={Math.abs(c.z) < RENDER_CONFIG.shadowNearBand}>
            <cylinderGeometry args={[c.radius * 0.15, c.radius * 0.6, c.height * 0.8, c.facets]} />
            <meshPhysicalMaterial color="#ffffff" transparent opacity={0.4} transmission={0.8} thickness={1.0} roughness={0.02} emissive={c.color} emissiveIntensity={0.4} />
          </mesh>
          <mesh position={[0, 0.4, 0]}>
            <cylinderGeometry args={[c.radius * 1.1, c.radius * 1.4, 0.8, 12]} />
            <meshPhysicalMaterial color={c.color} transparent opacity={0.35} emissive={c.color} emissiveIntensity={0.6} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[c.radius * 2, 16]} />
            <meshPhysicalMaterial color={c.color} transparent opacity={0.2} emissive={c.color} emissiveIntensity={0.3} />
          </mesh>
        </group>
      ))}
      {mountains.map((m, i) => (
        <group key={`mtn-${i}`} position={[m.x, 0, m.z]}>
          <mesh position={[0, m.height / 2 - 2, 0]} castShadow={Math.abs(m.z) < RENDER_CONFIG.shadowNearBand} receiveShadow>
            <coneGeometry args={[m.scale, m.height, 8]} />
            <meshPhysicalMaterial color="#5a6570" roughness={0.92} metalness={0.05} clearcoat={0.03} clearcoatRoughness={0.9} />
          </mesh>
          <mesh position={[m.scale * 0.35, m.height * 0.3, m.scale * 0.2]} castShadow={Math.abs(m.z) < RENDER_CONFIG.shadowNearBand}>
            <dodecahedronGeometry args={[m.scale * 0.12, 0]} />
            <meshPhysicalMaterial color="#4a5560" roughness={0.94} />
          </mesh>
          <mesh position={[0, m.height * m.snowAmount, 0]} castShadow={Math.abs(m.z) < RENDER_CONFIG.shadowNearBand}>
            <coneGeometry args={[m.scale * (1 - m.snowAmount) * 1.15, m.height * (1 - m.snowAmount) * 1.25, 8]} />
            <meshPhysicalMaterial color="#f8fafc" roughness={0.35} metalness={0.0} clearcoat={0.4} clearcoatRoughness={0.5} sheen={0.9} sheenColor="#e8f4ff" />
          </mesh>
          <mesh position={[m.scale * 0.25, m.height * (m.snowAmount - 0.12), m.scale * 0.15]} castShadow={Math.abs(m.z) < RENDER_CONFIG.shadowNearBand}>
            <sphereGeometry args={[m.scale * 0.1, 8, 6]} />
            <meshPhysicalMaterial color="#ffffff" roughness={0.32} sheen={0.85} sheenColor="#e0e8ff" />
          </mesh>
        </group>
      ))}
    </group>
  );
};
