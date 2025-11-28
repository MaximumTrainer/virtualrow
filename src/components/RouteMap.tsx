import React, { useMemo, useRef, useEffect } from 'react';
import { latLngToMeters } from '../utils/geoUtils';
import type { WaterRoute } from '../types/index';
import './RouteMap.css';

interface RouteMapProps {
  route: WaterRoute;
  highlightMode?: boolean;
  progressPercent?: number; // 0-100, percentage of route completed
}

export const RouteMap: React.FC<RouteMapProps> = ({
  route,
  highlightMode,
  progressPercent,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Convert lat/lng coordinates to pixel positions
  const { points, bounds } = useMemo(() => {
    if (!route || !route.coordinates || route.coordinates.length === 0) {
      return { points: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 } };
    }
    
    const originLat = route.coordinates[0].lat;
    const originLng = route.coordinates[0].lng;
    
    // Convert to meters
    const meterPoints = route.coordinates.map((c) => {
      const p = latLngToMeters(c.lat, c.lng, originLat, originLng);
      return { x: p.x, y: p.y };
    });
    
    // Calculate bounds
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (const point of meterPoints) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    
    const width = maxX - minX;
    const height = maxY - minY;
    
    return {
      points: meterPoints,
      bounds: { minX, maxX, minY, maxY, width, height }
    };
  }, [route]);

  // Draw the route on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Get actual canvas dimensions
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // Set canvas size with device pixel ratio for crisp rendering
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const canvasWidth = rect.width;
    const canvasHeight = rect.height;
    
    // Calculate scale to fit route in canvas with padding
    const padding = 40;
    const availableWidth = canvasWidth - padding * 2;
    const availableHeight = canvasHeight - padding * 2;
    
    const scaleX = bounds.width > 0 ? availableWidth / bounds.width : 1;
    const scaleY = bounds.height > 0 ? availableHeight / bounds.height : 1;
    const scale = Math.min(scaleX, scaleY);
    
    // Center offset
    const routeWidth = bounds.width * scale;
    const routeHeight = bounds.height * scale;
    const offsetX = padding + (availableWidth - routeWidth) / 2;
    const offsetY = padding + (availableHeight - routeHeight) / 2;
    
    // Transform function: meters to canvas pixels
    const toCanvas = (x: number, y: number) => ({
      x: offsetX + (x - bounds.minX) * scale,
      y: offsetY + (bounds.maxY - y) * scale // Flip Y for canvas coordinates
    });
    
    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    // Draw earth background (green/gray gradient)
    const earthGradient = ctx.createRadialGradient(
      canvasWidth / 2, canvasHeight / 2, 0,
      canvasWidth / 2, canvasHeight / 2, Math.max(canvasWidth, canvasHeight)
    );
    earthGradient.addColorStop(0, '#6b8e6b'); // Green-gray center
    earthGradient.addColorStop(0.5, '#5a7d5a'); // Slightly darker
    earthGradient.addColorStop(1, '#4a6a4a'); // Darker edges
    ctx.fillStyle = earthGradient;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // Add subtle texture pattern
    ctx.globalAlpha = 0.1;
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * canvasWidth;
      const y = Math.random() * canvasHeight;
      const size = Math.random() * 3 + 1;
      ctx.fillStyle = Math.random() > 0.5 ? '#3d5c3d' : '#7a9e7a';
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    
    // Draw water area around route (lighter blue area)
    const waterPadding = 30;
    ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
    ctx.beginPath();
    
    // Create water path following route with offset
    if (points.length > 0) {
      const firstPoint = toCanvas(points[0].x, points[0].y);
      ctx.moveTo(firstPoint.x - waterPadding, firstPoint.y - waterPadding);
      
      for (const point of points) {
        const p = toCanvas(point.x, point.y);
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.2)';
    ctx.lineWidth = 60;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    
    // Calculate split point for progress
    const splitIndex = progressPercent !== undefined && progressPercent > 0
      ? Math.min(Math.floor((progressPercent / 100) * points.length), points.length - 1)
      : 0;
    
    // Draw route shadow for depth
    ctx.beginPath();
    const shadowStart = toCanvas(points[0].x, points[0].y);
    ctx.moveTo(shadowStart.x + 2, shadowStart.y + 2);
    for (let i = 1; i < points.length; i++) {
      const p = toCanvas(points[i].x, points[i].y);
      ctx.lineTo(p.x + 2, p.y + 2);
    }
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    
    // Draw completed portion (red) if there's progress
    if (progressPercent !== undefined && progressPercent > 0 && splitIndex > 0) {
      ctx.beginPath();
      const completedStart = toCanvas(points[0].x, points[0].y);
      ctx.moveTo(completedStart.x, completedStart.y);
      for (let i = 1; i <= splitIndex; i++) {
        const p = toCanvas(points[i].x, points[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = '#ef4444'; // Red
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      
      // Draw remaining portion (green)
      if (splitIndex < points.length - 1) {
        ctx.beginPath();
        const remainingStart = toCanvas(points[splitIndex].x, points[splitIndex].y);
        ctx.moveTo(remainingStart.x, remainingStart.y);
        for (let i = splitIndex + 1; i < points.length; i++) {
          const p = toCanvas(points[i].x, points[i].y);
          ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = '#22c55e'; // Green
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    } else {
      // Draw full route (blue)
      ctx.beginPath();
      const start = toCanvas(points[0].x, points[0].y);
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < points.length; i++) {
        const p = toCanvas(points[i].x, points[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = '#3b82f6'; // Blue
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    
    // Draw start marker (green circle)
    const startPoint = toCanvas(points[0].x, points[0].y);
    ctx.beginPath();
    ctx.arc(startPoint.x, startPoint.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Draw end marker (red circle with flag)
    const endPoint = toCanvas(points[points.length - 1].x, points[points.length - 1].y);
    ctx.beginPath();
    ctx.arc(endPoint.x, endPoint.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Draw current position marker (yellow) if there's progress
    if (progressPercent !== undefined && progressPercent > 0 && splitIndex < points.length) {
      const currentPoint = toCanvas(points[splitIndex].x, points[splitIndex].y);
      ctx.beginPath();
      ctx.arc(currentPoint.x, currentPoint.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Inner dot
      ctx.beginPath();
      ctx.arc(currentPoint.x, currentPoint.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();
    }
    
    // Draw distance scale in corner (if not in highlight mode)
    if (!highlightMode) {
      const scaleBarWidth = 100;
      const scaleDistance = scaleBarWidth / scale; // meters
      const scaleX = canvasWidth - padding - scaleBarWidth;
      const scaleY = canvasHeight - 20;
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(scaleX - 10, scaleY - 20, scaleBarWidth + 20, 30);
      
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(scaleX, scaleY);
      ctx.lineTo(scaleX + scaleBarWidth, scaleY);
      ctx.stroke();
      
      // Scale ticks
      ctx.beginPath();
      ctx.moveTo(scaleX, scaleY - 5);
      ctx.lineTo(scaleX, scaleY + 5);
      ctx.moveTo(scaleX + scaleBarWidth, scaleY - 5);
      ctx.lineTo(scaleX + scaleBarWidth, scaleY + 5);
      ctx.stroke();
      
      // Scale label
      ctx.fillStyle = '#374151';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      const distanceLabel = scaleDistance >= 1000 
        ? `${(scaleDistance / 1000).toFixed(1)} km` 
        : `${Math.round(scaleDistance)} m`;
      ctx.fillText(distanceLabel, scaleX + scaleBarWidth / 2, scaleY - 8);
    }
    
  }, [points, bounds, progressPercent, highlightMode]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      // Trigger re-render by updating canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const event = new Event('resize');
        window.dispatchEvent(event);
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className={`route-map-container ${highlightMode ? 'highlight-mode' : ''}`}>
      <div className="route-map">
        <canvas 
          ref={canvasRef}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
};

export default RouteMap;
