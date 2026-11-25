// The hero scene, rendered with three.js. A quern is a pair of millstones, so
// that is what stands on the scan table: unordered grain spirals in over the
// top stone, drops through the eye, and leaves along the floor in straight,
// evenly spaced rows. A scan ring passes up and down through the stones.
//
// The scene is the page's status display. While the program type-checks the
// grain flows and everything is lit in the "clean" colour. When the compiler
// reports an error, the stones turn to the error colour, refuse the grain and
// throw it back out, and the ordered rows on the floor run dry.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Theme } from '../lib/theme.ts';

interface Props {
  errors: number;
  theme: Theme;
}

const GRAINS = 2600;
const RAYS = 28;
const FLOOR = -1.3;
const TOP = 0.36;

const Phase = { Inflow: 0, Fall: 1, Rows: 2, Rejected: 3 } as const;

function cssColor(name: string): THREE.Color {
  return new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#ffffff');
}

/** Circle of line segments in the XZ plane. `dash` keeps every other segment. */
function circle(points: number[], radius: number, y: number, segments = 128, dash = false): void {
  for (let i = 0; i < segments; i++) {
    if (dash && i % 2 === 1) continue;
    const a = (i / segments) * Math.PI * 2;
    const b = ((i + 1) / segments) * Math.PI * 2;
    points.push(Math.cos(a) * radius, y, Math.sin(a) * radius, Math.cos(b) * radius, y, Math.sin(b) * radius);
  }
}

function lines(points: number[], material: THREE.LineBasicMaterial): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, material);
}

function stone(material: THREE.LineBasicMaterial, faint: THREE.LineBasicMaterial, fill: THREE.MeshBasicMaterial): THREE.Group {
  const group = new THREE.Group();
  const strong: number[] = [];
  const soft: number[] = [];
  const half = 0.085;
  circle(strong, 1, half);
  circle(strong, 1, -half);
  circle(strong, 0.24, half, 48);
  circle(soft, 0.62, half, 96, true);
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    soft.push(Math.cos(a), half, Math.sin(a), Math.cos(a), -half, Math.sin(a));
  }
  // Furrows are cut at a slant, as on a real millstone.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const b = a + 0.42;
    strong.push(Math.cos(a) * 0.24, half, Math.sin(a) * 0.24, Math.cos(b), half, Math.sin(b));
    const c = a + 0.2;
    soft.push(Math.cos(c) * 0.55, half, Math.sin(c) * 0.55, Math.cos(c + 0.24), half, Math.sin(c + 0.24));
  }
  group.add(lines(strong, material), lines(soft, faint));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, half * 2, 64, 1, true), fill);
  group.add(body);
  return group;
}

export default function Scene3D({ errors, theme }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef({ errors, theme });
  state.current = { errors, theme };

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      return; // No WebGL: the hero simply has no scene.
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    const rig = new THREE.Group();
    scene.add(rig);

    // Materials. Colours are filled in by applyTheme and eased toward the status colour each frame.
    const strong = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95 });
    const faint = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.32 });
    const fill = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false });
    const floorMaterial = new THREE.LineBasicMaterial({ transparent: true, vertexColors: true, opacity: 0.9 });
    const hud = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.4 });
    const scanMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 });
    const scanFill = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
    const grainMaterial = new THREE.PointsMaterial({ size: 0.03, sizeAttenuation: true, transparent: true, vertexColors: true, depthWrite: false });

    // The two stones.
    const runner = stone(strong, faint, fill);
    runner.position.y = 0.17;
    const bed = stone(strong, faint, fill);
    bed.position.y = -0.07;
    rig.add(runner, bed);

    // The spindle the stones turn on, and the instrument rings around them.
    rig.add(lines([0, 0.95, 0, 0, FLOOR, 0], faint));
    const ringA: number[] = [];
    circle(ringA, 1.95, 0, 160, true);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const r = i % 4 === 0 ? 2.08 : 2.01;
      ringA.push(Math.cos(a) * 1.95, 0, Math.sin(a) * 1.95, Math.cos(a) * r, 0, Math.sin(a) * r);
    }
    const outer = lines(ringA, hud);
    outer.rotation.x = 0.32;
    const ringB: number[] = [];
    circle(ringB, 2.3, 0, 96, true);
    const outer2 = lines(ringB, hud);
    outer2.rotation.set(-0.5, 0, 0.35);
    rig.add(outer, outer2);

    // The scan ring.
    const scanPoints: number[] = [];
    circle(scanPoints, 1.28, 0, 128);
    const scanRing = lines(scanPoints, scanMaterial);
    const scanDisc = new THREE.Mesh(new THREE.CircleGeometry(1.28, 96), scanFill);
    scanDisc.rotation.x = -Math.PI / 2;
    const scan = new THREE.Group();
    scan.add(scanRing, scanDisc);
    rig.add(scan);

    // The scan table: a polar grid that fades toward its edge.
    const floorPoints: number[] = [];
    const floorColors: number[] = [];
    const floorTint = new THREE.Color();
    const pushFloor = (x1: number, z1: number, x2: number, z2: number): void => {
      floorPoints.push(x1, FLOOR, z1, x2, FLOOR, z2);
      for (const [x, z] of [[x1, z1], [x2, z2]] as const) {
        const fade = Math.max(0, 1 - Math.hypot(x, z) / 4.2);
        floorColors.push(fade, fade, fade);
      }
    };
    for (let r = 0.6; r <= 4.2; r += 0.6) {
      for (let i = 0; i < 128; i++) {
        const a = (i / 128) * Math.PI * 2;
        const b = ((i + 1) / 128) * Math.PI * 2;
        pushFloor(Math.cos(a) * r, Math.sin(a) * r, Math.cos(b) * r, Math.sin(b) * r);
      }
    }
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2;
      for (let r = 0.3; r < 4.2; r += 0.3) pushFloor(Math.cos(a) * r, Math.sin(a) * r, Math.cos(a) * (r + 0.3), Math.sin(a) * (r + 0.3));
    }
    const floorGeometry = new THREE.BufferGeometry();
    floorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(floorPoints, 3));
    const floorFade = new Float32Array(floorColors);
    floorGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(floorColors.length), 3));
    rig.add(new THREE.LineSegments(floorGeometry, floorMaterial));

    // Grain.
    const positions = new Float32Array(GRAINS * 3);
    const colors = new Float32Array(GRAINS * 3);
    const phase = new Uint8Array(GRAINS);
    const angle = new Float32Array(GRAINS);
    const radius = new Float32Array(GRAINS);
    const height = new Float32Array(GRAINS);
    const speed = new Float32Array(GRAINS);
    const lift = new Float32Array(GRAINS);
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const spawn = (i: number, anywhere: boolean): void => {
      phase[i] = Phase.Inflow;
      angle[i] = random() * Math.PI * 2;
      radius[i] = anywhere ? 0.2 + random() * 2.6 : 2.5 + random() * 0.4;
      speed[i] = 0.55 + random() * 0.9;
      lift[i] = (random() - 0.5) * 0.12;
      height[i] = 0;
    };
    for (let i = 0; i < GRAINS; i++) {
      spawn(i, true);
      // Start with the stream and the rows already populated.
      const r = random();
      if (r < 0.14) {
        phase[i] = Phase.Fall;
        height[i] = random();
      } else if (r < 0.5) {
        phase[i] = Phase.Rows;
        angle[i] = (Math.floor(random() * RAYS) / RAYS) * Math.PI * 2;
        radius[i] = random() * 3.9;
      }
    }
    const grainGeometry = new THREE.BufferGeometry();
    grainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    grainGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    rig.add(new THREE.Points(grainGeometry, grainMaterial));

    // Colour state.
    const palette = { ok: new THREE.Color(), err: new THREE.Color(), accent: new THREE.Color(), mute: new THREE.Color(), bg: new THREE.Color(), theme: '' as string };
    const status = new THREE.Color();
    const applyTheme = (): void => {
      palette.ok = cssColor('--ok');
      palette.err = cssColor('--err');
      palette.accent = cssColor('--accent');
      palette.mute = cssColor('--mute');
      palette.bg = cssColor('--bg');
      palette.theme = state.current.theme;
      const dark = palette.theme === 'dark';
      // Light adds up on a dark page; on a light page it has to be drawn as ink.
      const blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
      for (const m of [strong, faint, fill, floorMaterial, hud, scanMaterial, scanFill, grainMaterial]) {
        m.blending = blending;
        m.needsUpdate = true;
      }
      grainMaterial.size = dark ? 0.03 : 0.034;
      hud.color.copy(palette.mute);
      renderer.domElement.style.filter = dark ? 'drop-shadow(0 0 18px color-mix(in oklab, var(--status, var(--accent)) 35%, transparent))' : 'none';
    };

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let heat = state.current.errors > 0 ? 1 : 0;
    let yaw = 0.4;
    let velocity = 0;
    let dragging = false;
    let lastX = 0;
    let pointerX = 0;
    let pointerY = 0;
    let time = 0;
    let last = performance.now();
    let frame = 0;
    let running = true;
    let visible = true;

    const resize = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      // Pull the camera back on narrow canvases so the whole table stays in view.
      const distance = 6.4 * Math.max(1, 1.25 / camera.aspect);
      camera.position.set(0, 2.1, distance);
      camera.lookAt(0, -0.35, 0);
      camera.updateProjectionMatrix();
    };

    const step = (dt: number): void => {
      const failing = state.current.errors > 0;
      const dark = palette.theme === 'dark';
      const base = dark ? new THREE.Color(0, 0, 0) : palette.bg;
      for (let i = 0; i < GRAINS; i++) {
        let x = 0;
        let y = 0;
        let z = 0;
        let glow = 1;
        switch (phase[i]) {
          case Phase.Inflow: {
            radius[i]! -= dt * speed[i]! * (0.3 + 0.25 / (radius[i]! + 0.4));
            angle[i]! += dt * (0.5 + 1.1 / (radius[i]! + 0.35));
            const r = radius[i]!;
            if (failing && r < 1.08) {
              phase[i] = Phase.Rejected;
              height[i] = 0;
            } else if (r < 0.1) {
              phase[i] = Phase.Fall;
              height[i] = 0;
            }
            // A shallow funnel: grain arrives high and unordered, then skims the stone.
            y = TOP + Math.max(0, r - 1) * 0.55 + lift[i]! * Math.min(1, r);
            x = Math.cos(angle[i]!) * r;
            z = Math.sin(angle[i]!) * r;
            glow = 0.35 + 0.65 * Math.min(1, (2.9 - r) / 1.2);
            break;
          }
          case Phase.Fall: {
            height[i]! += dt * speed[i]! * 1.1;
            if (height[i]! >= 1) {
              phase[i] = Phase.Rows;
              radius[i] = 0;
              angle[i] = (Math.floor(random() * RAYS) / RAYS) * Math.PI * 2;
            }
            y = TOP - 0.3 - height[i]! * (TOP - 0.3 - FLOOR);
            x = Math.cos(angle[i]!) * 0.035;
            z = Math.sin(angle[i]!) * 0.035;
            break;
          }
          case Phase.Rows: {
            // Out along a ray at a steady pace: the same grain, now in order.
            radius[i]! += dt * 0.55;
            if (radius[i]! > 4) spawn(i, false);
            x = Math.cos(angle[i]!) * radius[i]!;
            z = Math.sin(angle[i]!) * radius[i]!;
            y = FLOOR + 0.012;
            glow = Math.max(0, 1 - radius[i]! / 4);
            break;
          }
          default: {
            // Thrown back out by a stone that will not grind it.
            height[i]! += dt;
            radius[i]! += dt * speed[i]! * 1.5;
            angle[i]! += dt * 1.6;
            y = TOP + Math.sin(Math.min(1, height[i]! / 1.4) * Math.PI) * 0.75 * speed[i]!;
            x = Math.cos(angle[i]!) * radius[i]!;
            z = Math.sin(angle[i]!) * radius[i]!;
            glow = Math.max(0, 1 - height[i]! / 1.4);
            if (height[i]! > 1.4) spawn(i, false);
          }
        }
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        colors[i * 3] = base.r + (status.r - base.r) * glow;
        colors[i * 3 + 1] = base.g + (status.g - base.g) * glow;
        colors[i * 3 + 2] = base.b + (status.b - base.b) * glow;
      }
      grainGeometry.attributes.position!.needsUpdate = true;
      grainGeometry.attributes.color!.needsUpdate = true;
    };

    const draw = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (palette.theme !== state.current.theme) applyTheme();

      const failing = state.current.errors > 0;
      heat += ((failing ? 1 : 0) - heat) * Math.min(1, dt * 3.5);
      status.copy(palette.ok).lerp(palette.err, heat);
      const dark = palette.theme === 'dark';
      strong.color.copy(status);
      faint.color.copy(status);
      fill.color.copy(status);
      scanMaterial.color.copy(palette.accent);
      scanFill.color.copy(palette.accent);
      // The floor fades toward its edge: toward black where light adds, toward the page colour where it does not.
      floorTint.copy(dark ? new THREE.Color(0, 0, 0) : palette.bg);
      const floorColor = floorGeometry.attributes.color as THREE.BufferAttribute;
      const target = dark ? status : palette.mute;
      for (let i = 0; i < floorFade.length; i += 3) {
        const f = floorFade[i]! * (dark ? 0.55 : 0.8);
        floorColor.array[i] = floorTint.r + (target.r - floorTint.r) * f;
        floorColor.array[i + 1] = floorTint.g + (target.g - floorTint.g) * f;
        floorColor.array[i + 2] = floorTint.b + (target.b - floorTint.b) * f;
      }
      floorColor.needsUpdate = true;

      if (!still) {
        time += dt;
        if (!dragging) {
          yaw += dt * 0.1 + velocity * dt;
          velocity *= 0.93;
        }
        runner.rotation.y += dt * (failing ? 0.12 : 0.7);
        bed.rotation.y -= dt * (failing ? 0.04 : 0.18);
        outer.rotation.y += dt * 0.07;
        outer2.rotation.y -= dt * 0.05;
        step(dt);
      } else if (time === 0) {
        time = 1;
        step(0.016);
      } else {
        step(0);
      }
      scan.position.y = -0.1 + Math.sin(time * 0.9) * 0.62;
      rig.rotation.y = yaw + pointerX * 0.18;
      rig.rotation.x = pointerY * 0.06;
      renderer.render(scene, camera);
      if (running && visible && !still) frame = requestAnimationFrame(draw);
    };

    const start = (): void => {
      cancelAnimationFrame(frame);
      last = performance.now();
      frame = requestAnimationFrame(draw);
    };
    const onDown = (e: PointerEvent): void => {
      dragging = true;
      lastX = e.clientX;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      const box = el.getBoundingClientRect();
      pointerX = (e.clientX - box.left) / box.width - 0.5;
      pointerY = (e.clientY - box.top) / box.height - 0.5;
      if (!dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      yaw += dx * 0.008;
      velocity = dx * 0.35;
      if (still) start();
    };
    const onUp = (): void => {
      dragging = false;
    };
    const onLeave = (): void => {
      pointerX = 0;
      pointerY = 0;
    };
    const onVisibility = (): void => {
      running = !document.hidden;
      if (running) start();
    };

    applyTheme();
    resize();
    const sizeObserver = new ResizeObserver(() => {
      resize();
      if (still) start();
    });
    sizeObserver.observe(el);
    // Stop drawing while the scene is scrolled away or its tab is hidden.
    const viewObserver = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) start();
    });
    viewObserver.observe(el);
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    start();
    // With reduced motion the scene holds still and is redrawn only to follow status and theme.
    const redraw = still ? window.setInterval(start, 500) : 0;

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      window.clearInterval(redraw);
      sizeObserver.disconnect();
      viewObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.remove();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) object.geometry.dispose();
      });
      for (const m of [strong, faint, fill, floorMaterial, hud, scanMaterial, scanFill, grainMaterial]) m.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={host}
      role="img"
      aria-label="A turning pair of millstones on a scan table. Grain flows through and leaves in ordered rows when the program type-checks, and is thrown back out when it has an error."
      className="h-full w-full cursor-grab touch-pan-y active:cursor-grabbing"
    />
  );
}
