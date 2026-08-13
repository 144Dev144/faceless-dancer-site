import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const PREVIEW_MODEL_HEIGHT = 2.15;
const PREVIEW_SIZE = 512;

function disposeModel(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      material.dispose();
      for (const value of Object.values(material)) {
        if (value && typeof value === "object" && "isTexture" in value && value.isTexture) {
          (value as THREE.Texture).dispose();
        }
      }
    });
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not export the avatar preview image."));
    }, "image/png");
  });
}

export async function captureAvatarPreview(options: {
  url: string;
  yawRadians?: number;
  size?: number;
}): Promise<Blob> {
  if (!options.url.trim()) throw new Error("This avatar has no model file to preview.");
  const size = Math.max(256, Math.min(1024, Math.round(options.size ?? PREVIEW_SIZE)));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  let renderer: THREE.WebGLRenderer | null = null;
  let root: THREE.Object3D | null = null;
  try {
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
        powerPreference: "low-power",
      });
    } catch {
      throw new Error("This browser could not create a graphics preview. Try enabling hardware acceleration.");
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x0b1420, 1);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xbfe7ff, 0x101827, 1.9));
    const keyLight = new THREE.DirectionalLight(0xffe6cf, 2.4);
    keyLight.position.set(2.5, 4.5, 4.5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x8fd8ff, 1.1);
    fillLight.position.set(-3, 2.5, 2);
    scene.add(fillLight);

    const gltf = await new GLTFLoader().loadAsync(options.url);
    root = gltf.scene;
    if (options.yawRadians) root.rotation.y += options.yawRadians;

    let bounds = new THREE.Box3().setFromObject(root);
    const sourceSize = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(sourceSize.y) || sourceSize.y <= 0) {
      throw new Error("The avatar model has no visible height to preview.");
    }
    root.scale.setScalar(PREVIEW_MODEL_HEIGHT / sourceSize.y);
    bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.y -= bounds.min.y;
    root.position.z -= center.z;
    scene.add(root);

    bounds = new THREE.Box3().setFromObject(root);
    const modelSize = bounds.getSize(new THREE.Vector3());
    const modelCenter = bounds.getCenter(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(25, 1, 0.01, 50);
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const verticalDistance = modelSize.y / (2 * Math.tan(verticalFov / 2));
    const horizontalDistance = modelSize.x / (2 * Math.tan(horizontalFov / 2));
    const distance = Math.max(3.1, verticalDistance, horizontalDistance) * 1.22;
    camera.position.set(modelCenter.x, modelCenter.y, modelCenter.z + distance);
    camera.lookAt(modelCenter);

    renderer.render(scene, camera);
    return await canvasBlob(canvas);
  } finally {
    if (root) disposeModel(root);
    renderer?.dispose();
  }
}
