import { useEffect, useRef, useState } from "preact/hooks";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getCanonicalProfileBounds, type CanonicalRigProfile } from "../../game/dance-engine/canonicalRigProfile";
import type { DanceModelPreset } from "../../game/dance-engine/types";

interface RigAdjustmentStageProps {
  model: DanceModelPreset;
  profile: CanonicalRigProfile;
  selectedJoint: string | null;
  onSelectJoint: (jointName: string) => void;
  onMoveJoint: (jointName: string, x: number, y: number) => void;
}

interface DisplayPoint {
  x: number;
  y: number;
}

interface DragState {
  jointName: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPosition: [number, number, number];
  rect: DOMRect;
  viewBox: { width: number; height: number };
  displayScale: number;
}

interface DisplayFrame {
  centerX: number;
  maxY: number;
  displayScale: number;
  viewBox: { x: number; y: number; width: number; height: number };
}

interface SourceBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const MODEL_HEIGHT = 2.15;
const VIEW_PADDING = 0.18;

function createDisplayFrame(profile: CanonicalRigProfile, sourceBounds?: SourceBounds): DisplayFrame {
  const bounds = sourceBounds ?? getCanonicalProfileBounds(profile);
  const sourceHeight = Math.max(0.001, bounds.maxY - bounds.minY);
  const displayScale = MODEL_HEIGHT / sourceHeight;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const displayWidth = Math.max(1.15, (bounds.maxX - bounds.minX) * displayScale);
  return {
    centerX,
    maxY: bounds.maxY,
    displayScale,
    viewBox: {
      x: -displayWidth / 2 - VIEW_PADDING,
      y: -VIEW_PADDING,
      width: displayWidth + VIEW_PADDING * 2,
      height: MODEL_HEIGHT + VIEW_PADDING * 2
    }
  };
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      material.dispose();
      for (const value of Object.values(material)) {
        if (value && typeof value === "object" && "isTexture" in value && value.isTexture) {
          (value as THREE.Texture).dispose();
        }
      }
    }
  });
}

function labelForJoint(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (value) => value.toUpperCase());
}

export function RigAdjustmentStage({
  model,
  profile,
  selectedJoint,
  onSelectJoint,
  onMoveJoint
}: RigAdjustmentStageProps): JSX.Element {
  const modelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [displayFrame, setDisplayFrame] = useState<DisplayFrame>(() => createDisplayFrame(profile));
  const viewBox = displayFrame.viewBox;

  useEffect(() => {
    setDisplayFrame(createDisplayFrame(profile));
  }, [model.id, model.url]);

  const displayPoint = (position: [number, number, number]): DisplayPoint => ({
    x: (position[0] - displayFrame.centerX) * displayFrame.displayScale,
    y: (displayFrame.maxY - position[1]) * displayFrame.displayScale
  });

  useEffect(() => {
    const canvas = modelCanvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x08101a, 1);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xbfe7ff, 0x111827, 1.8));
    const keyLight = new THREE.DirectionalLight(0xffe4ca, 2.2);
    keyLight.position.set(2, 4, 4);
    scene.add(keyLight);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 20);
    camera.position.set(0, 1.075, 4.5);
    camera.lookAt(0, 1.075, 0);
    let root: THREE.Object3D | null = null;
    let disposed = false;

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth || 1);
      const height = Math.max(1, canvas.clientHeight || 1);
      const aspect = width / height;
      const viewHeight = MODEL_HEIGHT + VIEW_PADDING * 2;
      const viewWidth = viewHeight * aspect;
      camera.left = -viewWidth / 2;
      camera.right = viewWidth / 2;
      camera.top = viewHeight / 2 + 0.05;
      camera.bottom = -viewHeight / 2 + 0.05;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    void new GLTFLoader().loadAsync(model.url)
      .then((gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        root = gltf.scene;
        const yawRadians = model.manifest?.orientation?.yawRadians ?? 0;
        if (yawRadians !== 0) root.rotation.y += yawRadians;
        const sourceBox = new THREE.Box3().setFromObject(root);
        const sourceSize = sourceBox.getSize(new THREE.Vector3());
        const displayScale = sourceSize.y > 0 ? MODEL_HEIGHT / sourceSize.y : 1;
        setDisplayFrame(createDisplayFrame(profile, {
          minX: sourceBox.min.x,
          maxX: sourceBox.max.x,
          minY: sourceBox.min.y,
          maxY: sourceBox.max.y
        }));
        root.scale.setScalar(displayScale);
        let box = new THREE.Box3().setFromObject(root);
        const center = box.getCenter(new THREE.Vector3());
        root.position.x -= center.x;
        root.position.y -= box.min.y;
        root.position.z -= center.z;
        scene.add(root);
      })
      .catch(() => {
        // The skeleton editor remains usable when a remote or local model cannot be loaded.
      });

    const frame = () => {
      if (disposed) return;
      renderer.render(scene, camera);
      window.requestAnimationFrame(frame);
    };
    const frameId = window.requestAnimationFrame(frame);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      if (root) {
        scene.remove(root);
        disposeObject(root);
      }
      renderer.dispose();
    };
  }, [model.id, model.url, model.manifest?.orientation?.yawRadians]);

  const handlePointerMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const deltaX = ((event.clientX - drag.startClientX) / drag.rect.width) * drag.viewBox.width / drag.displayScale;
    const deltaY = -((event.clientY - drag.startClientY) / drag.rect.height) * drag.viewBox.height / drag.displayScale;
    onMoveJoint(drag.jointName, drag.startPosition[0] + deltaX, drag.startPosition[1] + deltaY);
  };

  const stopDragging = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (drag && event.pointerId === drag.pointerId) {
      event.preventDefault();
      try { svgRef.current?.releasePointerCapture(drag.pointerId); } catch { /* pointer may already be released */ }
      dragRef.current = null;
    }
  };

  return (
    <div className="dance-engine-rig-stage">
      <canvas ref={modelCanvasRef} className="dance-engine-rig-model" aria-label={`${model.label} rig adjustment reference`} />
      <svg
        ref={svgRef}
        className="dance-engine-rig-overlay"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        role="img"
        aria-label="Canonical humanoid skeleton adjustment overlay"
        onDragStart={(event) => event.preventDefault()}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <line className="dance-engine-rig-centerline" x1="0" y1={viewBox.y} x2="0" y2={MODEL_HEIGHT + VIEW_PADDING} />
        {Object.entries(profile.joints).map(([name, joint]) => {
          if (!joint.parent || !profile.joints[joint.parent]) return null;
          const parent = displayPoint(profile.joints[joint.parent].position);
          const child = displayPoint(joint.position);
          return <line key={`bone-${name}`} className={`dance-engine-rig-bone${selectedJoint === name ? " is-selected" : ""}`} x1={parent.x} y1={parent.y} x2={child.x} y2={child.y} />;
        })}
        {Object.entries(profile.joints).map(([name, joint]) => {
          const point = displayPoint(joint.position);
          const isSelected = selectedJoint === name;
          return (
            <g key={name} data-joint={name} className={`dance-engine-rig-joint${isSelected ? " is-selected" : ""}`} onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const svg = svgRef.current;
              if (!svg) return;
              const rect = svg.getBoundingClientRect();
              dragRef.current = {
                jointName: name,
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
                startPosition: [...joint.position] as [number, number, number],
                rect,
                viewBox,
                displayScale: displayFrame.displayScale
              };
              onSelectJoint(name);
              try { svg.setPointerCapture(event.pointerId); } catch { /* pointer capture may be unavailable in a test surface */ }
            }}>
              <circle className="dance-engine-rig-joint-marker" cx={point.x} cy={point.y} r={isSelected ? 0.034 : 0.026} />
              {isSelected ? <text x={point.x + 0.055} y={point.y - 0.05}>{labelForJoint(name)}</text> : null}
            </g>
          );
        })}
      </svg>
      <div className="dance-engine-rig-stage-badge">Front view · drag a joint</div>
    </div>
  );
}
