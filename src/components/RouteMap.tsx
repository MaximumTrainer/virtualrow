import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { 
  CatmullRomCurve3, 
  Vector3, 
  TubeGeometry,
  ACESFilmicToneMapping,
  SRGBColorSpace
} from 'three';
import { Sky } from '@react-three/drei';
import { latLngToMeters } from '../utils/geoUtils';
import type { WaterRoute } from '../types/index';
import './RouteMap.css';

interface RouteMapProps {
  route: WaterRoute;
  onRouteSelected?: (route: WaterRoute) => void;
  highlightMode?: boolean;
  progressPercent?: number; // 0-100, percentage of route completed
}

// Props for the internal 3D scene component (subset of RouteMapProps)
interface RouteSceneProps {
  route: WaterRoute;
  progressPercent?: number;
}

// Scale factor to convert real-world meters to scene units
const SCALE_FACTOR = 0.0005;

// Component for rendering the route line and markers in 3D
const RouteScene: React.FC<RouteSceneProps> = ({
  route,
  progressPercent,
}) => {
  const { camera } = useThree();
  
  // Convert lat/lng coordinates to 3D positions
  const routePoints = useMemo(() => {
    if (!route || !route.coordinates || route.coordinates.length === 0) return [];
    const originLat = route.coordinates[0].lat;
    const originLng = route.coordinates[0].lng;
    
    return route.coordinates.map((c) => {
      const p = latLngToMeters(c.lat, c.lng, originLat, originLng);
      // Scale and convert: x = east/west, z = north/south, y = elevation (0 for water)
      return new Vector3(p.x * SCALE_FACTOR, 0, -p.y * SCALE_FACTOR);
    });
  }, [route]);

  // Create smooth curve from route points
  const routeCurve = useMemo(() => {
    if (routePoints.length < 2) return null;
    return new CatmullRomCurve3(routePoints, false, 'centripetal', 0.5);
  }, [routePoints]);

  // Calculate bounds for camera positioning
  const bounds = useMemo(() => {
    if (routePoints.length === 0) return { center: new Vector3(0, 0, 0), size: 10 };
    
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    for (const point of routePoints) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
    
    const center = new Vector3(
      (minX + maxX) / 2,
      0,
      (minZ + maxZ) / 2
    );
    const size = Math.max(maxX - minX, maxZ - minZ);
    
    return { center, size };
  }, [routePoints]);

  // Split progress index
  const splitIndex = useMemo(() => {
    if (progressPercent === undefined || progressPercent <= 0) return 0;
    return Math.min(
      Math.floor((progressPercent / 100) * routePoints.length),
      routePoints.length - 1
    );
  }, [progressPercent, routePoints.length]);

  // Refs for animated elements
  const cameraInitialized = useRef(false);

  // Set up camera on first render
  useFrame(() => {
    if (!cameraInitialized.current && bounds.size > 0) {
      const distance = bounds.size * 1.5;
      camera.position.set(
        bounds.center.x,
        distance,
        bounds.center.z + distance * 0.3
      );
      camera.lookAt(bounds.center.x, 0, bounds.center.z);
      cameraInitialized.current = true;
    }
  });

  // Create geometries for completed and remaining portions
  const completedGeometry = useMemo(() => {
    if (!routeCurve || splitIndex <= 0) return null;
    const completedPoints = routePoints.slice(0, splitIndex + 1);
    if (completedPoints.length < 2) return null;
    const completedCurve = new CatmullRomCurve3(completedPoints, false, 'centripetal', 0.5);
    return new TubeGeometry(completedCurve, completedPoints.length * 4, 0.15, 8, false);
  }, [routeCurve, routePoints, splitIndex]);

  const remainingGeometry = useMemo(() => {
    if (!routeCurve) return null;
    if (progressPercent !== undefined && progressPercent > 0 && splitIndex < routePoints.length - 1) {
      const remainingPoints = routePoints.slice(splitIndex);
      if (remainingPoints.length < 2) return null;
      const remainingCurve = new CatmullRomCurve3(remainingPoints, false, 'centripetal', 0.5);
      return new TubeGeometry(remainingCurve, remainingPoints.length * 4, 0.15, 8, false);
    }
    // No progress - show full route in blue
    return new TubeGeometry(routeCurve, routePoints.length * 4, 0.15, 8, false);
  }, [routeCurve, routePoints, progressPercent, splitIndex]);

  // Current position for marker
  const currentPosition = useMemo(() => {
    if (progressPercent === undefined || progressPercent <= 0 || splitIndex >= routePoints.length) {
      return null;
    }
    return routePoints[splitIndex];
  }, [progressPercent, splitIndex, routePoints]);

  // Start and end positions
  const startPosition = routePoints[0];
  const endPosition = routePoints[routePoints.length - 1];

  if (routePoints.length < 2) {
    return null;
  }

  return (
    <>
      {/* Improved lighting for better reflections */}
      <ambientLight intensity={0.4} />
      <directionalLight 
        position={[10, 20, 10]} 
        intensity={1.0} 
        castShadow
      />
      <directionalLight 
        position={[-5, 10, -5]} 
        intensity={0.3} 
        color="#b3d4fc"
      />
      
      {/* Realistic sky */}
      <Sky 
        distance={450000}
        sunPosition={[100, 20, 100]}
        inclination={0.5}
        azimuth={0.25}
      />
      
      {/* Water plane with improved reflections */}
      <mesh 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[bounds.center.x, -0.1, bounds.center.z]}
      >
        <planeGeometry args={[bounds.size * 3, bounds.size * 3, 32, 32]} />
        <meshStandardMaterial 
          color={'#1a5fb4'} 
          metalness={0.6}
          roughness={0.3}
          envMapIntensity={1.0}
        />
      </mesh>

      {/* Land/shore around water */}
      <mesh 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[bounds.center.x, -0.15, bounds.center.z]}
      >
        <ringGeometry args={[bounds.size * 1.2, bounds.size * 3, 32]} />
        <meshStandardMaterial color={'#4ade80'} roughness={0.9} />
      </mesh>

      {/* Completed portion of route (red) */}
      {completedGeometry && progressPercent !== undefined && progressPercent > 0 && (
        <mesh geometry={completedGeometry}>
          <meshStandardMaterial 
            color={'#ef4444'} 
            metalness={0.2} 
            roughness={0.6} 
          />
        </mesh>
      )}

      {/* Remaining/full route (green if progress, blue otherwise) */}
      {remainingGeometry && (
        <mesh geometry={remainingGeometry}>
          <meshStandardMaterial 
            color={progressPercent !== undefined && progressPercent > 0 ? '#22c55e' : '#3b82f6'} 
            metalness={0.2} 
            roughness={0.6} 
          />
        </mesh>
      )}

      {/* Current position marker (yellow) */}
      {currentPosition && (
        <mesh 
          position={[currentPosition.x, 0.5, currentPosition.z]}
        >
          <sphereGeometry args={[0.3, 16, 16]} />
          <meshStandardMaterial 
            color={'#fbbf24'} 
            emissive={'#f59e0b'}
            emissiveIntensity={0.3}
          />
        </mesh>
      )}

      {/* Start marker (green) */}
      {startPosition && (
        <group position={[startPosition.x, 0, startPosition.z]}>
          {/* Pin base */}
          <mesh position={[0, 0.4, 0]}>
            <cylinderGeometry args={[0.15, 0.25, 0.8, 8]} />
            <meshStandardMaterial color={'#22c55e'} />
          </mesh>
          {/* Pin top */}
          <mesh position={[0, 1.0, 0]}>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshStandardMaterial 
              color={'#22c55e'} 
              emissive={'#16a34a'}
              emissiveIntensity={0.2}
            />
          </mesh>
        </group>
      )}

      {/* End marker (red) */}
      {endPosition && (
        <group position={[endPosition.x, 0, endPosition.z]}>
          {/* Pin base */}
          <mesh position={[0, 0.4, 0]}>
            <cylinderGeometry args={[0.15, 0.25, 0.8, 8]} />
            <meshStandardMaterial color={'#ef4444'} />
          </mesh>
          {/* Pin top */}
          <mesh position={[0, 1.0, 0]}>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshStandardMaterial 
              color={'#ef4444'} 
              emissive={'#dc2626'}
              emissiveIntensity={0.2}
            />
          </mesh>
        </group>
      )}
    </>
  );
};

export const RouteMap: React.FC<RouteMapProps> = ({
  route,
  onRouteSelected,
  highlightMode,
  progressPercent,
}) => {
  return (
    <div className={`route-map-container ${highlightMode ? 'highlight-mode' : ''}`}>
      <div className="route-map">
        <Canvas 
          camera={{ 
            position: [0, 10, 10], 
            fov: 50,
            near: 0.1,
            far: 1000
          }}
          gl={{ 
            antialias: true, // Enable for smoother edges
            alpha: true,
            powerPreference: 'high-performance',
            failIfMajorPerformanceCaveat: false, // Allow software rendering
            preserveDrawingBuffer: true, // Helps prevent context loss
            toneMapping: ACESFilmicToneMapping,
            toneMappingExposure: 1.0,
          }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = SRGBColorSpace;
          }}
        >
          <RouteScene 
            route={route} 
            progressPercent={progressPercent}
          />
        </Canvas>
      </div>

      <div className="route-info-overlay">
        {!highlightMode && (
          <div className="route-info-card">
            <h3>{route.name}</h3>
            <div className="route-stats">
              <div className="stat">
                <span className="label">Distance</span>
                <span className="value">{route.distance} km</span>
              </div>
              <div className="stat">
                <span className="label">Difficulty</span>
                <span className={`badge badge-${route.difficulty}`}>
                  {route.difficulty}
                </span>
              </div>
              <div className="stat">
                <span className="label">Est. Time</span>
                <span className="value">{route.estimatedTime} min</span>
              </div>
            </div>
            <p className="description">{route.description}</p>
            {onRouteSelected && (
              <button
                className="btn btn-primary"
                onClick={() => onRouteSelected(route)}
              >
                Select This Route
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RouteMap;
