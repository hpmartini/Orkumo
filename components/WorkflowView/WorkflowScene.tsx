import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

type Pt = [number, number];

export interface ScenePulse {
  /** unique per station change, so a repeated move pulses again */
  id: string;
  /** polyline from the old to the new station */
  pts: Pt[];
}

export interface SceneEdge {
  id: string;
  pts: Pt[];
  back: boolean;
  /** issues on the edge's source station: drives the particle stream */
  active: number;
}

export interface SceneNode {
  x: number;
  y: number;
  count: number;
}

interface WorkflowSceneProps {
  width: number;
  height: number;
  edges: SceneEdge[];
  nodes: SceneNode[];
  pulses: ScenePulse[];
  reducedMotion: boolean;
}

/** Whether a WebGL context can be created; without it the graph draws its edges as SVG */
export function supportsWebGL(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl');
  } catch {
    return false;
  }
}

const CURSOR = new THREE.Color('#8fd0ff');
const DIM = new THREE.Color('#4f67a0');
const PER_EDGE = 7;
const PULSE_MS = 1500;

/** Soft round sprite so points read as light, not squares */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Length table of a polyline and a sampler for 0..1 along it */
function polyline(pts: Pt[]) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  return (u: number): Pt => {
    const s = Math.min(1, Math.max(0, u)) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const k = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [
      pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k,
      pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k,
    ];
  };
}

/**
 * WebGL layer under the HTML stations: the edges as light lines (loops dashed), a particle stream
 * along every forward edge, a glow per station and a comet for every station change.
 * Pixel-space orthographic camera, so everything sits exactly under the HTML nodes.
 * With reduced motion it draws one still frame.
 */
const WorkflowScene: React.FC<WorkflowSceneProps> = ({
  width,
  height,
  edges,
  nodes,
  pulses,
  reducedMotion,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const pulsesRef = useRef<{ p: ScenePulse; start: number }[]>([]);
  const seen = useRef(new Set<string>());
  nodesRef.current = nodes;
  edgesRef.current = edges;

  useEffect(() => {
    for (const p of pulses) {
      if (seen.current.has(p.id)) continue;
      seen.current.add(p.id);
      pulsesRef.current.push({ p, start: window.performance.now() });
    }
  }, [pulses]);

  // Rebuilt when the layout changes; counts and activity are read from refs every frame
  const layoutKey = `${width}x${height}:${edges.map((e) => e.id).join()}`;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // the SVG fallback carries the edges
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    host.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, {
      display: 'block',
      width: `${width}px`,
      height: `${height}px`,
    });

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, width, 0, -height, -10, 10);
    const sprite = glowTexture();
    const v = (p: Pt, z = 0) => new THREE.Vector3(p[0], -p[1], z);

    for (const e of edgesRef.current) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(e.pts.map((p) => v(p))),
        e.back
          ? new THREE.LineDashedMaterial({
              color: DIM,
              dashSize: 6,
              gapSize: 5,
              transparent: true,
              opacity: 0.8,
            })
          : new THREE.LineBasicMaterial({ color: DIM, transparent: true, opacity: 0.7 })
      );
      line.computeLineDistances();
      scene.add(line);
    }

    const paths = edgesRef.current.map((e) => polyline(e.pts));
    const streamed = edgesRef.current.map((e) => !e.back);
    const flowCount = edgesRef.current.length * PER_EDGE;
    const flowPos = new Float32Array(flowCount * 3);
    const flowCol = new Float32Array(flowCount * 3);
    const flowGeo = new THREE.BufferGeometry();
    flowGeo.setAttribute('position', new THREE.BufferAttribute(flowPos, 3));
    flowGeo.setAttribute('color', new THREE.BufferAttribute(flowCol, 3));
    scene.add(
      new THREE.Points(
        flowGeo,
        new THREE.PointsMaterial({
          map: sprite,
          size: 6,
          sizeAttenuation: false,
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      )
    );

    const nodeCount = nodesRef.current.length;
    const glowPos = new Float32Array(nodeCount * 3);
    const glowCol = new Float32Array(nodeCount * 3);
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
    glowGeo.setAttribute('color', new THREE.BufferAttribute(glowCol, 3));
    scene.add(
      new THREE.Points(
        glowGeo,
        new THREE.PointsMaterial({
          map: sprite,
          size: 96,
          sizeAttenuation: false,
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      )
    );

    const cometPos = new Float32Array(30 * 3);
    const cometGeo = new THREE.BufferGeometry();
    cometGeo.setAttribute('position', new THREE.BufferAttribute(cometPos, 3));
    scene.add(
      new THREE.Points(
        cometGeo,
        new THREE.PointsMaterial({
          map: sprite,
          size: 16,
          sizeAttenuation: false,
          color: new THREE.Color('#ffffff'),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      )
    );

    const frame = (now: number) => {
      const t = reducedMotion ? 0 : now / 1000;
      const max = Math.max(1, ...nodesRef.current.map((n) => n.count));
      nodesRef.current.forEach((n, i) => {
        // empty stations leave the layer: black additive points would smudge the alpha
        glowPos.set([n.count ? n.x : -1000, -n.y, -1], i * 3);
        const k = n.count ? 0.2 + 0.28 * (n.count / max) : 0;
        glowCol.set([DIM.r * k, DIM.g * k, DIM.b * k], i * 3);
      });
      glowGeo.attributes.position.needsUpdate = true;
      glowGeo.attributes.color.needsUpdate = true;

      edgesRef.current.forEach((e, ei) => {
        for (let j = 0; j < PER_EDGE; j++) {
          const o = (ei * PER_EDGE + j) * 3;
          if (!streamed[ei]) {
            flowCol.fill(0, o, o + 3);
            continue;
          }
          const p = paths[ei]((j / PER_EDGE + t * 0.12) % 1);
          flowPos.set([p[0], -p[1], 0], o);
          const k = e.active ? 0.9 : 0.22;
          flowCol.set([CURSOR.r * k, CURSOR.g * k, CURSOR.b * k], o);
        }
      });
      flowGeo.attributes.position.needsUpdate = true;
      flowGeo.attributes.color.needsUpdate = true;

      // Comets: head plus a short tail along the path from the old to the new station
      pulsesRef.current = pulsesRef.current.filter((c) => now - c.start < PULSE_MS);
      cometPos.fill(0);
      let k = 0;
      for (const c of pulsesRef.current.slice(0, 3)) {
        const at = polyline(c.p.pts);
        const prog = Math.min(1, (now - c.start) / PULSE_MS);
        for (let s = 0; s < 8; s++) {
          const e = 1 - Math.pow(1 - Math.max(0, prog - s * 0.02), 3);
          const p = at(e);
          cometPos.set([p[0], -p[1], 2], k++ * 3);
        }
      }
      cometGeo.setDrawRange(0, k);
      cometGeo.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
    };

    let raf = 0;
    const loop = (now: number) => {
      frame(now);
      raf = requestAnimationFrame(loop);
    };
    if (reducedMotion) frame(0);
    else raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      scene.traverse((o) => {
        const obj = o as THREE.Points;
        obj.geometry?.dispose();
        (obj.material as THREE.Material | undefined)?.dispose?.();
      });
      sprite.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, reducedMotion]);

  return (
    <div ref={hostRef} className="pointer-events-none absolute left-0 top-0" aria-hidden="true" />
  );
};

export default WorkflowScene;
