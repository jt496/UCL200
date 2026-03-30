import React, { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Torus, Stars } from '@react-three/drei';
import * as THREE from 'three';
import type { Vertex, Edge } from '../App';

interface Torus3DProps {
  vertices: Vertex[];
  edges: Edge[];
  maxClique: Set<string>;
}

const R = 3; // Major radius
const r = 1; // Minor radius

const mapToTorus = (u: number, v: number): THREE.Vector3 => {
  const theta = u * Math.PI * 2;
  const phi = v * Math.PI * 2;
  const x = (R + r * Math.cos(phi)) * Math.cos(theta);
  const y = (R + r * Math.cos(phi)) * Math.sin(theta);
  const z = r * Math.sin(phi);
  return new THREE.Vector3(x, y, z);
};

const EdgeLine: React.FC<{ edge: Edge, from: Vertex, highlight: boolean }> = ({ edge, from, highlight }) => {
  const points = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push(mapToTorus(from.x + edge.dx * t, from.y + edge.dy * t));
    }
    return pts;
  }, [edge, from]);

  const curve = useMemo(() => new THREE.CatmullRomCurve3(points), [points]);

  return (
    <mesh>
      <tubeGeometry args={[curve, 128, highlight ? 0.07 : 0.04, 12, false]} />
      <meshStandardMaterial 
        color={highlight ? "#facc15" : "#818cf8"} 
        emissive={highlight ? "#eab308" : "#4338ca"} 
        emissiveIntensity={highlight ? 5 : 2.5} 
        toneMapped={false}
      />
    </mesh>
  );
};

export const Torus3D: React.FC<Torus3DProps> = ({ vertices, edges, maxClique }) => {
  return (
    <div className="w-full h-full bg-black">
      <Canvas shadows gl={{ antialias: true }}>
        <PerspectiveCamera makeDefault position={[0, 0, 10]} fov={50} />
        <OrbitControls autoRotate autoRotateSpeed={0.5} makeDefault />
        
        <Stars radius={100} depth={50} count={2000} factor={4} saturation={0} fade speed={1} />
        
        {/* Powerful 3-point lighting setup for clarity */}
        <ambientLight intensity={0.5} />
        <hemisphereLight intensity={0.6} groundColor="#000000" />
        
        {/* Main Key Lights */}
        <pointLight position={[10, 10, 10]} intensity={3} color="#ffffff" />
        <pointLight position={[-10, -10, -10]} intensity={2} color="#818cf8" />
        
        {/* Rim lights to define edges */}
        <pointLight position={[0, 0, -10]} intensity={2.5} color="#ffffff" />
        <spotLight position={[0, 20, 0]} intensity={4} angle={0.8} penumbra={1} color="#ffffff" />

        {/* The Doughnut Surface - High Contrast Matte Finish */}
        <Torus args={[R, r, 64, 128]}>
          <meshStandardMaterial 
            color="#2d3748" 
            transparent 
            opacity={0.95} 
            metalness={0.4}
            roughness={0.6}
          />
        </Torus>
        
        {/* Bright Cyber Cyan Wireframe */}
        <Torus args={[R, r, 32, 64]}>
          <meshBasicMaterial color="#22d3ee" wireframe transparent opacity={0.6} />
        </Torus>

        {/* Glowing Vertices */}
        {vertices.map(v => {
          const isHighlighted = maxClique.size >= 3 && maxClique.has(v.id);
          return (
            <mesh key={v.id} position={mapToTorus(v.x, v.y)}>
              <sphereGeometry args={[isHighlighted ? 0.18 : 0.12, 16, 16]} />
              <meshStandardMaterial 
                color={isHighlighted ? "#facc15" : "#ffffff"} 
                emissive="#ffffff" 
                emissiveIntensity={isHighlighted ? 3 : 2.5} 
                toneMapped={false} 
              />
              <pointLight intensity={isHighlighted ? 2 : 1} distance={isHighlighted ? 3 : 2} color={isHighlighted ? "#facc15" : "#ffffff"} />
            </mesh>
          );
        })}

        {/* Glowing Edges */}
        {edges.map(edge => {
          const from = vertices.find(v => v.id === edge.fromId);
          if (!from) return null;
          const isHighlighted = maxClique.size >= 3 && maxClique.has(edge.fromId) && maxClique.has(edge.toId);
          return <EdgeLine key={edge.id} edge={edge} from={from} highlight={isHighlighted} />;
        })}
      </Canvas>
    </div>
  );
};
