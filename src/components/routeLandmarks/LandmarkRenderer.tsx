// Generic Landmark Renderer Component
// Renders route-specific landmarks based on injected configuration

import React from 'react';
import type { RouteLandmarkConfig } from './types';

interface LandmarkRendererProps {
  config: RouteLandmarkConfig | null;
}

/**
 * Generic renderer for route-specific landmarks
 * Takes a configuration object and renders the appropriate 3D elements
 */
export const LandmarkRenderer: React.FC<LandmarkRendererProps> = ({ config }) => {
  if (!config) return null;

  return (
    <group>
      {/* Castle Landmark (e.g., Bled Castle) */}
      {config.castle && (
        <group position={[config.castle.x, 0, config.castle.z]}>
          {/* Castle cliff/hill */}
          <mesh position={[0, 4, 0]}>
            <coneGeometry args={[8, 8, 8]} />
            <meshStandardMaterial color={'#6b7280'} roughness={0.9} />
          </mesh>
          {/* Castle main building */}
          <mesh position={[0, 10, 0]}>
            <boxGeometry args={[config.castle.width, config.castle.height, config.castle.depth]} />
            <meshStandardMaterial color={'#d4c4a8'} roughness={0.8} />
          </mesh>
          {/* Castle towers */}
          {config.castle.towers?.map((tower, idx) => (
            <React.Fragment key={`castle-tower-${idx}`}>
              <mesh position={[tower.x, tower.height / 2 + 8, tower.z]}>
                <cylinderGeometry args={[tower.radius, tower.radius + 0.5, tower.height, 8]} />
                <meshStandardMaterial color={'#c9b896'} roughness={0.8} />
              </mesh>
              {tower.roofHeight && (
                <mesh position={[tower.x, tower.height + 8 + tower.roofHeight / 2, tower.z]}>
                  <coneGeometry args={[tower.radius + 1, tower.roofHeight, 8]} />
                  <meshStandardMaterial color={'#8b4513'} roughness={0.85} />
                </mesh>
              )}
            </React.Fragment>
          ))}
        </group>
      )}

      {/* Island Landmark (e.g., Bled Island with Church) */}
      {config.island && (
        <group position={[config.island.x, 0, config.island.z]}>
          {/* Island base */}
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[config.island.radius || 6, (config.island.radius || 6) + 2, 1, 16]} />
            <meshStandardMaterial color={'#4ade80'} roughness={0.9} />
          </mesh>
          {/* Island elevated area */}
          <mesh position={[0, 1.5, 0]}>
            <cylinderGeometry args={[(config.island.radius || 6) - 2, (config.island.radius || 6) - 1, 2, 12]} />
            <meshStandardMaterial color={'#3aa06a'} roughness={0.9} />
          </mesh>
          {/* Church main building */}
          <mesh position={[0, 5, 0]}>
            <boxGeometry args={[3, 6, 4]} />
            <meshStandardMaterial color={'#f8fafc'} roughness={0.7} />
          </mesh>
          {/* Church bell tower */}
          <mesh position={[0, 10, -1]}>
            <boxGeometry args={[2, 6, 2]} />
            <meshStandardMaterial color={'#f8fafc'} roughness={0.7} />
          </mesh>
          {/* Church spire */}
          <mesh position={[0, 14, -1]}>
            <coneGeometry args={[1.5, 4, 8]} />
            <meshStandardMaterial color={'#374151'} roughness={0.6} />
          </mesh>
          {/* Church roof */}
          <mesh position={[0, 8.5, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[3, 2, 4]} />
            <meshStandardMaterial color={'#dc2626'} roughness={0.7} />
          </mesh>
          {/* Stairs */}
          {config.island.stepsToChurch && Array.from({ length: 5 }, (_, i) => (
            <mesh key={`step-${i}`} position={[4 + i * 0.8, 0.3 + i * 0.3, 0]}>
              <boxGeometry args={[1, 0.3, 2]} />
              <meshStandardMaterial color={'#9ca3af'} roughness={0.9} />
            </mesh>
          ))}
        </group>
      )}

      {/* Mountains (e.g., Julian Alps) */}
      {config.mountains?.map((mountain, idx) => (
        <group key={`mountain-${idx}`} position={[mountain.x, 0, mountain.z]} rotation={[0, mountain.rotation, 0]}>
          {/* Main peak */}
          <mesh position={[0, mountain.scaleY / 2, 0]}>
            <coneGeometry args={[mountain.scaleX, mountain.scaleY, 8]} />
            <meshStandardMaterial color={'#6b7280'} roughness={0.9} />
          </mesh>
          {/* Snow cap */}
          {mountain.hasSnowCap && (
            <mesh position={[0, mountain.scaleY * 0.85, 0]}>
              <coneGeometry args={[mountain.scaleX * 0.35, mountain.scaleY * 0.25, 8]} />
              <meshStandardMaterial color={'#f8fafc'} roughness={0.7} />
            </mesh>
          )}
          {/* Secondary peak */}
          <mesh position={[mountain.scaleX * 0.4, mountain.scaleY * 0.25, mountain.scaleX * 0.15]}>
            <coneGeometry args={[mountain.scaleX * 0.5, mountain.scaleY * 0.5, 6]} />
            <meshStandardMaterial color={'#4b5563'} roughness={0.9} />
          </mesh>
        </group>
      ))}

      {/* Clock Tower (e.g., Big Ben) */}
      {config.clockTower && (
        <group position={[config.clockTower.x, 0, config.clockTower.z]}>
          {/* Elizabeth Tower (Big Ben) */}
          <mesh position={[0, config.clockTower.towerHeight / 2, 0]}>
            <boxGeometry args={[config.clockTower.towerWidth, config.clockTower.towerHeight, config.clockTower.towerWidth]} />
            <meshStandardMaterial color={'#c9a227'} roughness={0.7} />
          </mesh>
          {/* Tower spire */}
          <mesh position={[0, config.clockTower.towerHeight + 3, 0]}>
            <coneGeometry args={[1.5, 6, 8]} />
            <meshStandardMaterial color={'#1e3a5f'} roughness={0.6} />
          </mesh>
          {/* Clock face (front) */}
          <mesh position={[config.clockTower.towerWidth / 2 + 0.01, config.clockTower.towerHeight * 0.75, 0]}>
            <circleGeometry args={[config.clockTower.clockSize, 16]} />
            <meshStandardMaterial color={'#f8fafc'} roughness={0.3} />
          </mesh>
          {/* Clock hands */}
          <mesh position={[config.clockTower.towerWidth / 2 + 0.02, config.clockTower.towerHeight * 0.75, 0]}>
            <boxGeometry args={[0.1, config.clockTower.clockSize * 0.8, 0.1]} />
            <meshStandardMaterial color={'#1f2937'} roughness={0.3} />
          </mesh>
          {/* Houses of Parliament */}
          {config.clockTower.parliamentLength && config.clockTower.parliamentHeight && (
            <>
              <mesh position={[8, config.clockTower.parliamentHeight / 2, 0]}>
                <boxGeometry args={[config.clockTower.parliamentLength, config.clockTower.parliamentHeight, 6]} />
                <meshStandardMaterial color={'#c9a227'} roughness={0.75} />
              </mesh>
              {/* Parliament towers/spires */}
              {[-3, 5, 12, 18].map((xOffset, i) => (
                <mesh key={`parliament-tower-${i}`} position={[xOffset, config.clockTower!.parliamentHeight! + 1.5, 0]}>
                  <coneGeometry args={[0.8, 3, 6]} />
                  <meshStandardMaterial color={'#1e3a5f'} roughness={0.6} />
                </mesh>
              ))}
            </>
          )}
        </group>
      )}

      {/* Tower Bridge */}
      {config.towerBridge && (
        <group position={[config.towerBridge.x, 0, config.towerBridge.z]}>
          {/* Left tower */}
          <mesh position={[-15, config.towerBridge.towerHeight / 2, 0]}>
            <boxGeometry args={[config.towerBridge.towerWidth, config.towerBridge.towerHeight, config.towerBridge.towerWidth]} />
            <meshStandardMaterial color={'#6b7280'} roughness={0.7} />
          </mesh>
          {/* Left tower turrets */}
          {[-1.5, 1.5].map((zOffset, i) => (
            <mesh key={`left-turret-${i}`} position={[-15, config.towerBridge!.towerHeight + 2, zOffset]}>
              <coneGeometry args={[1.2, 4, 8]} />
              <meshStandardMaterial color={'#1e3a5f'} roughness={0.6} />
            </mesh>
          ))}
          {/* Right tower */}
          <mesh position={[15, config.towerBridge.towerHeight / 2, 0]}>
            <boxGeometry args={[config.towerBridge.towerWidth, config.towerBridge.towerHeight, config.towerBridge.towerWidth]} />
            <meshStandardMaterial color={'#6b7280'} roughness={0.7} />
          </mesh>
          {/* Right tower turrets */}
          {[-1.5, 1.5].map((zOffset, i) => (
            <mesh key={`right-turret-${i}`} position={[15, config.towerBridge!.towerHeight + 2, zOffset]}>
              <coneGeometry args={[1.2, 4, 8]} />
              <meshStandardMaterial color={'#1e3a5f'} roughness={0.6} />
            </mesh>
          ))}
          {/* Upper walkway */}
          <mesh position={[0, config.towerBridge.towerHeight - 2, 0]}>
            <boxGeometry args={[30, 1, 3]} />
            <meshStandardMaterial color={'#4a90a4'} metalness={0.3} roughness={0.5} />
          </mesh>
          {/* Lower bridge deck */}
          <mesh position={[0, config.towerBridge.bridgeHeight, 0]}>
            <boxGeometry args={[config.towerBridge.bridgeWidth, 0.5, 4]} />
            <meshStandardMaterial color={'#6b7280'} roughness={0.7} />
          </mesh>
          {/* Bridge suspension cables */}
          {[-20, -10, 10, 20].map((xPos, i) => (
            <mesh key={`cable-${i}`} position={[xPos, (config.towerBridge!.towerHeight + config.towerBridge!.bridgeHeight) / 2, 0]}>
              <cylinderGeometry args={[0.1, 0.1, config.towerBridge!.towerHeight - config.towerBridge!.bridgeHeight, 8]} />
              <meshStandardMaterial color={'#4a90a4'} roughness={0.5} />
            </mesh>
          ))}
        </group>
      )}

      {/* Observation Wheel (e.g., London Eye) */}
      {config.observationWheel && (
        <group position={[config.observationWheel.x, 0, config.observationWheel.z]}>
          {/* Main wheel */}
          <mesh position={[0, config.observationWheel.radius + 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[config.observationWheel.radius, 0.3, 8, 32]} />
            <meshStandardMaterial color={'#f8fafc'} metalness={0.4} roughness={0.4} />
          </mesh>
          {/* Wheel spokes */}
          {Array.from({ length: config.observationWheel.spokeCount }, (_, i) => {
            const angle = (i / config.observationWheel!.spokeCount) * Math.PI * 2;
            return (
              <mesh 
                key={`spoke-${i}`} 
                position={[
                  0,
                  config.observationWheel!.radius + 2 + Math.sin(angle) * config.observationWheel!.radius * 0.5,
                  Math.cos(angle) * config.observationWheel!.radius * 0.5
                ]}
                rotation={[angle, 0, 0]}
              >
                <cylinderGeometry args={[0.08, 0.08, config.observationWheel!.radius, 4]} />
                <meshStandardMaterial color={'#d1d5db'} roughness={0.5} />
              </mesh>
            );
          })}
          {/* Support structure (A-frame) */}
          <mesh position={[-2, config.observationWheel.radius / 2 + 1, 0]} rotation={[0, 0, 0.3]}>
            <cylinderGeometry args={[0.4, 0.6, config.observationWheel.radius + 4, 8]} />
            <meshStandardMaterial color={'#9ca3af'} roughness={0.6} />
          </mesh>
          <mesh position={[2, config.observationWheel.radius / 2 + 1, 0]} rotation={[0, 0, -0.3]}>
            <cylinderGeometry args={[0.4, 0.6, config.observationWheel.radius + 4, 8]} />
            <meshStandardMaterial color={'#9ca3af'} roughness={0.6} />
          </mesh>
        </group>
      )}

      {/* Pyramidal Tower (e.g., The Shard) */}
      {config.pyramidalTower && (
        <group position={[config.pyramidalTower.x, 0, config.pyramidalTower.z]}>
          {/* Main pyramidal structure */}
          <mesh position={[0, config.pyramidalTower.height / 2, 0]}>
            <coneGeometry args={[config.pyramidalTower.baseWidth, config.pyramidalTower.height, 4]} />
            <meshStandardMaterial color={'#94a3b8'} metalness={0.6} roughness={0.2} />
          </mesh>
          {/* Glass panels effect */}
          {[-1, 0, 1].map((offset, i) => (
            <mesh key={`shard-panel-${i}`} position={[offset * 1.2, config.pyramidalTower!.height / 2, config.pyramidalTower!.baseWidth / 2 + 0.01]}>
              <boxGeometry args={[0.1, config.pyramidalTower!.height * 0.9, 0.1]} />
              <meshStandardMaterial color={'#cbd5e1'} metalness={0.7} roughness={0.2} />
            </mesh>
          ))}
        </group>
      )}

      {/* Dome Building (e.g., MIT, St Paul's) */}
      {config.domeBuilding && (
        <group position={[config.domeBuilding.x, 0, config.domeBuilding.z]}>
          {/* Building base */}
          <mesh position={[0, config.domeBuilding.buildingHeight / 2, 0]}>
            <boxGeometry args={[config.domeBuilding.buildingWidth, config.domeBuilding.buildingHeight, 8]} />
            <meshStandardMaterial color={'#d4c4a8'} roughness={0.8} />
          </mesh>
          {/* Columns */}
          {config.domeBuilding.hasColumns && [-4, -2, 0, 2, 4].map((xPos, i) => (
            <mesh key={`column-${i}`} position={[xPos, config.domeBuilding!.buildingHeight / 2, 4.5]}>
              <cylinderGeometry args={[0.3, 0.3, config.domeBuilding!.buildingHeight - 1, 8]} />
              <meshStandardMaterial color={'#f8fafc'} roughness={0.6} />
            </mesh>
          ))}
          {/* Dome */}
          <mesh position={[0, config.domeBuilding.buildingHeight + config.domeBuilding.domeRadius * 0.5, 0]}>
            <sphereGeometry args={[config.domeBuilding.domeRadius, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={'#9ca3af'} roughness={0.5} />
          </mesh>
        </group>
      )}

      {/* Secondary Dome Building (e.g., St Paul's Cathedral) */}
      {config.domeBuildingSecondary && (
        <group position={[config.domeBuildingSecondary.x, 0, config.domeBuildingSecondary.z]}>
          {/* Main building */}
          <mesh position={[0, config.domeBuildingSecondary.buildingHeight / 2, 0]}>
            <boxGeometry args={[config.domeBuildingSecondary.buildingWidth, config.domeBuildingSecondary.buildingHeight, 8]} />
            <meshStandardMaterial color={'#f5f5f4'} roughness={0.7} />
          </mesh>
          {/* Dome base */}
          <mesh position={[0, config.domeBuildingSecondary.buildingHeight + 1, 0]}>
            <cylinderGeometry args={[config.domeBuildingSecondary.domeRadius + 1, config.domeBuildingSecondary.domeRadius + 2, 2, 16]} />
            <meshStandardMaterial color={'#f5f5f4'} roughness={0.7} />
          </mesh>
          {/* Main dome */}
          <mesh position={[0, config.domeBuildingSecondary.buildingHeight + 5, 0]}>
            <sphereGeometry args={[config.domeBuildingSecondary.domeRadius, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={'#6b7280'} roughness={0.5} />
          </mesh>
          {/* Lantern on top */}
          <mesh position={[0, config.domeBuildingSecondary.buildingHeight + config.domeBuildingSecondary.domeRadius + 5, 0]}>
            <cylinderGeometry args={[0.8, 1, 3, 8]} />
            <meshStandardMaterial color={'#f5f5f4'} roughness={0.6} />
          </mesh>
          {/* Cross on top */}
          {config.domeBuildingSecondary.hasCross && (
            <>
              <mesh position={[0, config.domeBuildingSecondary.buildingHeight + config.domeBuildingSecondary.domeRadius + 7.5, 0]}>
                <boxGeometry args={[0.2, 2, 0.2]} />
                <meshStandardMaterial color={'#c9a227'} roughness={0.4} />
              </mesh>
              <mesh position={[0, config.domeBuildingSecondary.buildingHeight + config.domeBuildingSecondary.domeRadius + 8, 0]}>
                <boxGeometry args={[1.2, 0.2, 0.2]} />
                <meshStandardMaterial color={'#c9a227'} roughness={0.4} />
              </mesh>
            </>
          )}
          {/* Front columns */}
          {config.domeBuildingSecondary.hasColumns && [-3, -1.5, 0, 1.5, 3].map((xPos, i) => (
            <mesh key={`stpauls-column-${i}`} position={[xPos, config.domeBuildingSecondary!.buildingHeight / 2, 4.5]}>
              <cylinderGeometry args={[0.4, 0.4, config.domeBuildingSecondary!.buildingHeight - 1, 8]} />
              <meshStandardMaterial color={'#f5f5f4'} roughness={0.6} />
            </mesh>
          ))}
        </group>
      )}

      {/* University Towers (e.g., Harvard) */}
      {config.universityTowers?.map((tower, idx) => (
        <group key={`university-${idx}`} position={[tower.x, 0, tower.z]}>
          {/* Building base */}
          <mesh position={[0, tower.height / 2, 0]}>
            <boxGeometry args={[tower.width, tower.height, tower.width * 0.8]} />
            <meshStandardMaterial color={'#8b0000'} roughness={0.8} />
          </mesh>
          {/* Spire */}
          {tower.hasSpire && (
            <mesh position={[0, tower.height + 2, 0]}>
              <coneGeometry args={[1.5, 4, 8]} />
              <meshStandardMaterial color={'#f8fafc'} roughness={0.6} />
            </mesh>
          )}
          {/* Windows */}
          {[0.3, 0.5, 0.7].map((yPos, i) => (
            <mesh key={i} position={[tower.width / 2 + 0.01, tower.height * yPos, 0]}>
              <boxGeometry args={[0.1, 1, 0.8]} />
              <meshStandardMaterial color={'#fef3c7'} roughness={0.3} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Skyscrapers (Boston skyline, etc.) */}
      {config.skyscrapers?.map((tower, idx) => (
        <group key={`skyscraper-${idx}`} position={[tower.x, 0, tower.z]}>
          {/* Main tower */}
          <mesh position={[0, tower.height / 2, 0]}>
            <boxGeometry args={[tower.width, tower.height, tower.depth]} />
            <meshStandardMaterial color={tower.color} metalness={0.3} roughness={0.4} />
          </mesh>
          {/* Windows */}
          {[-0.3, 0, 0.3].map((xOffset, i) => (
            <mesh key={i} position={[tower.width / 2 + 0.01, tower.height / 2, xOffset * tower.depth]}>
              <boxGeometry args={[0.05, tower.height * 0.8, tower.depth * 0.15]} />
              <meshStandardMaterial color={'#94a3b8'} metalness={0.5} roughness={0.3} />
            </mesh>
          ))}
          {/* Antenna/spire */}
          {(tower.hasAntenna || tower.height > 15) && (
            <mesh position={[0, tower.height + 1.5, 0]}>
              <cylinderGeometry args={[0.1, 0.05, 3, 8]} />
              <meshStandardMaterial color={'#dc2626'} roughness={0.3} />
            </mesh>
          )}
        </group>
      ))}

      {/* City Buildings */}
      {config.cityBuildings?.map((bldg, idx) => (
        <mesh key={`city-bldg-${idx}`} position={[bldg.x, bldg.height / 2, bldg.z]}>
          <boxGeometry args={[bldg.width, bldg.height, bldg.depth]} />
          <meshStandardMaterial color={bldg.color} roughness={0.75} />
        </mesh>
      ))}

      {/* Bridges */}
      {config.bridges?.map((bridge, idx) => (
        <group key={`bridge-${idx}`} position={[bridge.x, 0, bridge.z]}>
          {/* Bridge deck */}
          <mesh position={[0, bridge.height, 0]}>
            <boxGeometry args={[bridge.width, 0.5, 3]} />
            <meshStandardMaterial color={'#6b7280'} roughness={0.7} />
          </mesh>
          {/* Bridge arches */}
          {Array.from({ length: bridge.archCount }, (_, i) => {
            const archX = (i - (bridge.archCount - 1) / 2) * (bridge.width / bridge.archCount);
            return (
              <mesh key={i} position={[archX, bridge.height / 2, 0]}>
                <cylinderGeometry args={[bridge.height * 0.6, bridge.height * 0.6, 2.5, 8, 1, false, 0, Math.PI]} />
                <meshStandardMaterial color={'#9ca3af'} roughness={0.7} />
              </mesh>
            );
          })}
          {/* Bridge railings */}
          <mesh position={[0, bridge.height + 0.4, 1.3]}>
            <boxGeometry args={[bridge.width, 0.3, 0.1]} />
            <meshStandardMaterial color={'#374151'} roughness={0.6} />
          </mesh>
          <mesh position={[0, bridge.height + 0.4, -1.3]}>
            <boxGeometry args={[bridge.width, 0.3, 0.1]} />
            <meshStandardMaterial color={'#374151'} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

export default LandmarkRenderer;
