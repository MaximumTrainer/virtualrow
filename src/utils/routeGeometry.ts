// Utility functions for converting GPX routes to 3D geometry

import { Vector3, CatmullRomCurve3 } from 'three';
import type { Coordinate } from '../types/index';

export interface RoutePoint3D {
  position: Vector3;
  tangent: Vector3;
  normal: Vector3; // perpendicular to tangent, for bank placement
  distanceAlongRoute: number; // meters from start
}

/**
 * Convert lat/lng to local meters using equirectangular projection
 * Returns x (east-west) and y (north-south) in meters from origin
 */
export function latLngToLocalMeters(
  lat: number, 
  lng: number, 
  originLat: number, 
  originLng: number
): { x: number; y: number } {
  const R = 6378137; // Earth radius in meters
  const dLat = (lat - originLat) * (Math.PI / 180);
  const dLng = (lng - originLng) * (Math.PI / 180);
  const x = dLng * R * Math.cos(originLat * Math.PI / 180);
  const y = dLat * R;
  return { x, y };
}

/**
 * Calculate the total distance of a route in meters
 */
export function calculateRouteDistanceMeters(coordinates: Coordinate[]): number {
  if (coordinates.length < 2) return 0;
  const R = 6378137; // Earth radius in meters
  let total = 0;
  
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1];
    const b = coordinates[i];
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);
    const c = sinDLat * sinDLat + 
              Math.cos(a.lat * Math.PI / 180) * 
              Math.cos(b.lat * Math.PI / 180) * 
              sinDLng * sinDLng;
    const d = 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
    total += R * d;
  }
  
  return total;
}

/**
 * Convert GPX coordinates to a smooth 3D curve with downsampling
 * Scale factor converts meters to 3D world units (smaller = more zoomed out view)
 */
export function createRouteCurve(
  coordinates: Coordinate[],
  scale: number = 0.01, // 1 meter = 0.01 world units
  maxPoints: number = 200 // Limit points for performance
): { curve: CatmullRomCurve3; originLat: number; originLng: number; totalMeters: number } | null {
  if (!coordinates || coordinates.length < 2) return null;
  
  const originLat = coordinates[0].lat;
  const originLng = coordinates[0].lng;
  
  // Downsample if too many points
  let sampledCoords = coordinates;
  if (coordinates.length > maxPoints) {
    const step = Math.ceil(coordinates.length / maxPoints);
    sampledCoords = coordinates.filter((_, i) => i % step === 0 || i === coordinates.length - 1);
  }
  
  const points: Vector3[] = sampledCoords.map(coord => {
    const local = latLngToLocalMeters(coord.lat, coord.lng, originLat, originLng);
    // Map: x = east-west (local.x), z = -north-south (we invert so north is forward/negative z)
    return new Vector3(local.x * scale, 0, -local.y * scale);
  });
  
  const totalMeters = calculateRouteDistanceMeters(coordinates);
  const curve = new CatmullRomCurve3(points);
  
  return { curve, originLat, originLng, totalMeters };
}

/**
 * Get detailed points along the route curve with positions, tangents, and normals
 */
export function getRoutePoints(
  curve: CatmullRomCurve3,
  totalMeters: number,
  numPoints: number = 100
): RoutePoint3D[] {
  const points: RoutePoint3D[] = [];
  
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const position = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    
    // Normal is perpendicular to tangent in the XZ plane (horizontal)
    // Cross tangent with up vector (0, 1, 0) to get right-facing normal
    const normal = new Vector3(-tangent.z, 0, tangent.x).normalize();
    
    points.push({
      position,
      tangent,
      normal,
      distanceAlongRoute: t * totalMeters
    });
  }
  
  return points;
}

/**
 * Generate bank vertices for a river/canal route
 * Returns left and right bank point arrays
 */
export function generateBankGeometry(
  routePoints: RoutePoint3D[],
  bankWidth: number = 4 // Half-width of the waterway
): { leftBank: Vector3[]; rightBank: Vector3[] } {
  const leftBank: Vector3[] = [];
  const rightBank: Vector3[] = [];
  
  for (const point of routePoints) {
    // Left bank is in the negative normal direction
    leftBank.push(point.position.clone().add(point.normal.clone().multiplyScalar(-bankWidth)));
    // Right bank is in the positive normal direction
    rightBank.push(point.position.clone().add(point.normal.clone().multiplyScalar(bankWidth)));
  }
  
  return { leftBank, rightBank };
}

/**
 * Generate bank vertices with variable width along the route
 * The widthFunction receives (progress: 0-1, totalMeters: number) and returns half-width
 * This allows natural river width variation - wider in meadows/delta, narrower in gorges
 */
export function generateVariableWidthBankGeometry(
  routePoints: RoutePoint3D[],
  widthFunction: (progress: number, totalMeters: number) => number,
  totalMeters: number
): { leftBank: Vector3[]; rightBank: Vector3[]; widths: number[] } {
  const leftBank: Vector3[] = [];
  const rightBank: Vector3[] = [];
  const widths: number[] = [];
  
  const numPoints = routePoints.length;
  
  for (let i = 0; i < numPoints; i++) {
    const point = routePoints[i];
    const progress = i / (numPoints - 1);
    const halfWidth = widthFunction(progress, totalMeters);
    widths.push(halfWidth);
    
    // Left bank is in the negative normal direction
    leftBank.push(point.position.clone().add(point.normal.clone().multiplyScalar(-halfWidth)));
    // Right bank is in the positive normal direction
    rightBank.push(point.position.clone().add(point.normal.clone().multiplyScalar(halfWidth)));
  }
  
  return { leftBank, rightBank, widths };
}

/**
 * Convert a geographic coordinate to a 3D position relative to the route
 * This allows placing landmarks at their real-world locations
 */
export function geoToRoutePosition(
  lat: number,
  lng: number,
  originLat: number,
  originLng: number,
  scale: number = 0.01,
  heightOffset: number = 0
): Vector3 {
  const local = latLngToLocalMeters(lat, lng, originLat, originLng);
  return new Vector3(local.x * scale, heightOffset, -local.y * scale);
}

/**
 * Find the closest point on the route to a given position
 * Returns the route parameter t (0-1) and the distance to the route
 */
export function findClosestRoutePoint(
  curve: CatmullRomCurve3,
  position: Vector3,
  samples: number = 100
): { t: number; distance: number; closestPoint: Vector3 } {
  let minDist = Infinity;
  let bestT = 0;
  let closestPoint = new Vector3();
  
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const point = curve.getPointAt(t);
    const dist = position.distanceTo(point);
    if (dist < minDist) {
      minDist = dist;
      bestT = t;
      closestPoint = point;
    }
  }
  
  return { t: bestT, distance: minDist, closestPoint };
}

/**
 * Get the bearing (heading) at a point on the route in degrees
 * 0 = north, 90 = east, 180 = south, 270 = west
 */
export function getRouteBearingAt(curve: CatmullRomCurve3, t: number): number {
  const tangent = curve.getTangentAt(Math.max(0, Math.min(1, t)));
  // Convert tangent to bearing (atan2 of x and -z since -z is north)
  let bearing = Math.atan2(tangent.x, -tangent.z) * (180 / Math.PI);
  if (bearing < 0) bearing += 360;
  return bearing;
}
