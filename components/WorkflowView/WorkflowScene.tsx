import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export interface StagePulse {
  /** unique per stage change, so a repeated move pulses again */
  id: string;
  from: number;
  to: number;
}

interface WorkflowSceneProps {
  /** issues per stage, drives each station's glow */
  counts: number[];
  /** px from the top of the scene to the light track (the stage header row) */
  trackY: number;
  pulses: StagePulse[];
  reducedMotion: boolean;
}

const CURSOR = new THREE.Color('#8fd0ff');
const DIM = new THREE.Color('#4f67a0');
const FLOW_COUNT = 260;
const DUST_COUNT = 140;
const PULSE_MS = 1400;

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

/**
 * Ambient WebGL layer behind the stage columns: a light track through one station per stage,
 * a particle stream flowing towards "Fertig", and a comet for every stage change.
 * Pixel-space orthographic camera, so stations sit exactly over the HTML columns.
 * Renders nothing without WebGL; with reduced motion it draws one still frame.
 */
const WorkflowScene: React.FC<WorkflowSceneProps> = ({ counts, trackY, pulses, reducedMotion }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const countsRef = useRef(counts);
  const pulsesRef = useRef<{ p: StagePulse; start: number }[]>([]);
  const seen = useRef(new Set<string>());
  countsRef.current = counts;

  useEffect(() => {
    for (const p of pulses) {
      if (seen.current.has(p.id)) continue;
      seen.current.add(p.id);
      pulsesRef.current.push({ p, start: window.performance.now() });
    }
  }, [pulses]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // no WebGL: the HTML track carries everything
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
    const sprite = glowTexture();
    const n = countsRef.current.length;
    let w = 1;
    let h = 1;

    const stationX = (i: number) => ((i + 0.5) / n) * w;
    // Track: gentle wave through the stations, y in pixels below the top edge
    const trackAt = (t: number) =>
      new THREE.Vector3(t * w, -trackY + Math.sin(t * Math.PI * 3) * 6, 0);

    const trackGeo = new THREE.BufferGeometry();
    const trackMat = new THREE.LineBasicMaterial({
      color: DIM,
      transparent: true,
      opacity: 0.85,
    });
    const track = new THREE.Line(trackGeo, trackMat);
    scene.add(track);

    const stationGeo = new THREE.BufferGeometry();
    const stationPos = new Float32Array(n * 3);
    const stationCol = new Float32Array(n * 3);
    stationGeo.setAttribute('position', new THREE.BufferAttribute(stationPos, 3));
    stationGeo.setAttribute('color', new THREE.BufferAttribute(stationCol, 3));
    const stationMat = new THREE.PointsMaterial({
      map: sprite,
      size: 34,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stations = new THREE.Points(stationGeo, stationMat);
    scene.add(stations);

    const flowSeeds = Float32Array.from({ length: FLOW_COUNT }, () => Math.random());
    const flowGeo = new THREE.BufferGeometry();
    const flowPos = new Float32Array(FLOW_COUNT * 3);
    flowGeo.setAttribute('position', new THREE.BufferAttribute(flowPos, 3));
    const flow = new THREE.Points(
      flowGeo,
      new THREE.PointsMaterial({
        map: sprite,
        size: 5,
        sizeAttenuation: false,
        color: CURSOR,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    scene.add(flow);

    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(DUST_COUNT * 3);
    const dustSeeds = Float32Array.from({ length: DUST_COUNT * 2 }, () => Math.random());
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        map: sprite,
        size: 3,
        sizeAttenuation: false,
        color: DIM,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      })
    );
    scene.add(dust);

    const cometGeo = new THREE.BufferGeometry();
    const cometPos = new Float32Array(24 * 3);
    cometGeo.setAttribute('position', new THREE.BufferAttribute(cometPos, 3));
    const comets = new THREE.Points(
      cometGeo,
      new THREE.PointsMaterial({
        map: sprite,
        size: 14,
        sizeAttenuation: false,
        color: new THREE.Color('#ffffff'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    scene.add(comets);

    const layout = () => {
      w = Math.max(1, host.clientWidth);
      h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.right = w;
      camera.bottom = -h;
      camera.updateProjectionMatrix();
      trackGeo.setFromPoints(Array.from({ length: 121 }, (_, i) => trackAt(i / 120)));
    };

    const frame = (now: number) => {
      const t = now / 1000;
      const cs = countsRef.current;
      const max = Math.max(1, ...cs);
      cs.slice(0, n).forEach((c, i) => {
        const p = trackAt(stationX(i) / w);
        stationPos.set([p.x, p.y, 1], i * 3);
        const k = c ? 0.45 + 0.55 * (c / max) : 0.18;
        const pulse = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(t * 2 + i);
        const color = DIM.clone().lerp(CURSOR, k).multiplyScalar(pulse);
        stationCol.set([color.r, color.g, color.b], i * 3);
      });
      stationGeo.attributes.position.needsUpdate = true;
      stationGeo.attributes.color.needsUpdate = true;

      for (let i = 0; i < FLOW_COUNT; i++) {
        const u = (flowSeeds[i] + t * 0.035 * (0.6 + flowSeeds[(i * 7) % FLOW_COUNT])) % 1;
        const p = trackAt(u);
        const spread = (flowSeeds[(i * 13) % FLOW_COUNT] - 0.5) * 18;
        flowPos.set([p.x, p.y + spread, 0], i * 3);
      }
      flowGeo.attributes.position.needsUpdate = true;

      for (let i = 0; i < DUST_COUNT; i++) {
        const x = ((dustSeeds[i] + t * 0.004) % 1) * w;
        const y = -dustSeeds[DUST_COUNT + i] * h + Math.sin(t * 0.3 + i) * 4;
        dustPos.set([x, y, -1], i * 3);
      }
      dustGeo.attributes.position.needsUpdate = true;

      // Comets: head plus a short tail, eased from the old to the new station
      pulsesRef.current = pulsesRef.current.filter((c) => now - c.start < PULSE_MS);
      cometPos.fill(0);
      let k = 0;
      for (const c of pulsesRef.current.slice(0, 3)) {
        const prog = Math.min(1, (now - c.start) / PULSE_MS);
        for (let s = 0; s < 8; s++) {
          const e = 1 - Math.pow(1 - Math.max(0, prog - s * 0.025), 3);
          const x = stationX(c.p.from) + (stationX(c.p.to) - stationX(c.p.from)) * e;
          const p = trackAt(x / w);
          cometPos.set([p.x, p.y, 2], k++ * 3);
        }
      }
      cometGeo.setDrawRange(0, k);
      cometGeo.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
    };

    layout();
    const ro = new ResizeObserver(() => {
      layout();
      if (reducedMotion) frame(0);
    });
    ro.observe(host);

    let raf = 0;
    const loop = (now: number) => {
      frame(now);
      raf = requestAnimationFrame(loop);
    };
    if (reducedMotion) frame(0);
    else raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse((o) => {
        const obj = o as THREE.Points;
        obj.geometry?.dispose();
        (obj.material as THREE.Material | undefined)?.dispose?.();
      });
      sprite.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // A still frame (reduced motion) is redrawn by rebuilding when the counts change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackY, reducedMotion, counts.length, reducedMotion ? counts.join() : '']);

  return <div ref={hostRef} className="absolute inset-0 pointer-events-none" aria-hidden="true" />;
};

export default WorkflowScene;
