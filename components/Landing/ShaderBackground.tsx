import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

function WaveShader() {
  const meshRef = useRef<THREE.Mesh>(null);
  const mouseRef = useRef({ x: 0, y: 0 });

  // Track mouse movement
  useMemo(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: -(e.clientY / window.innerHeight) * 2 + 1,
      };
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Custom shader material
  const shaderMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uMouse: { value: new THREE.Vector2(0, 0) },
          uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform vec2 uMouse;
          uniform vec2 uResolution;
          varying vec2 vUv;

          // Noise function
          float noise(vec2 st) {
            return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
          }

          void main() {
            vec2 uv = vUv;
            vec2 mouse = uMouse * 0.5;

            // Create flowing waves
            float wave1 = sin(uv.x * 3.0 + uTime * 0.5 + mouse.x * 2.0) * 0.5;
            float wave2 = cos(uv.y * 4.0 - uTime * 0.3 + mouse.y * 2.0) * 0.5;
            float wave3 = sin((uv.x + uv.y) * 2.0 + uTime * 0.4) * 0.3;

            // Combine waves
            float pattern = wave1 + wave2 + wave3;

            // Add noise texture
            float n = noise(uv * 10.0 + uTime * 0.1) * 0.1;
            pattern += n;

            // Color gradient - deep space colors
            vec3 color1 = vec3(0.012, 0.012, 0.02); // Deep obsidian
            vec3 color2 = vec3(0.145, 0.208, 0.475); // Midnight blue
            vec3 color3 = vec3(0.231, 0.361, 0.965); // Electric blue
            vec3 color4 = vec3(0.545, 0.361, 0.965); // Cyber purple

            // Mix colors based on pattern
            vec3 finalColor = mix(color1, color2, smoothstep(-0.5, 0.0, pattern));
            finalColor = mix(finalColor, color3, smoothstep(0.0, 0.5, pattern) * 0.3);
            finalColor = mix(finalColor, color4, smoothstep(0.5, 1.0, pattern) * 0.2);

            // Add glow effect near mouse
            float dist = length(uv - (mouse * 0.5 + 0.5));
            float glow = exp(-dist * 3.0) * 0.15;
            finalColor += vec3(0.231, 0.361, 0.965) * glow;

            gl_FragColor = vec4(finalColor, 1.0);
          }
        `,
      }),
    []
  );

  useFrame((state) => {
    if (meshRef.current) {
      const material = meshRef.current.material as THREE.ShaderMaterial;
      material.uniforms.uTime.value = state.clock.elapsedTime;
      material.uniforms.uMouse.value.set(mouseRef.current.x, mouseRef.current.y);
    }
  });

  return (
    <mesh ref={meshRef} scale={[2, 2, 1]}>
      <planeGeometry args={[2, 2]} />
      <primitive object={shaderMaterial} attach="material" />
    </mesh>
  );
}

export function ShaderBackground() {
  return (
    <div className="fixed inset-0 -z-10">
      <Canvas
        camera={{ position: [0, 0, 1], fov: 75 }}
        style={{ background: '#030305' }}
      >
        <WaveShader />
      </Canvas>
      {/* Radial gradient overlay for additional depth */}
      <div className="absolute inset-0 bg-gradient-radial from-transparent via-obsidian/50 to-obsidian pointer-events-none" />
    </div>
  );
}
