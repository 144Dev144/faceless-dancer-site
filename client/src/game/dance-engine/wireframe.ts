import { CANONICAL_EDGES, HUMANOID_SKELETON } from "./canonicalMotion";

type Point3 = [number, number, number];
export type WireframePoints = Record<string, Point3>;

export interface WireframeCamera {
  width: number;
  height: number;
  minX: number;
  minY: number;
  scale: number;
}

const REGION_COLORS: Record<string, string> = {
  "full-body": "#d9e3f0",
  "lower-body": "#ffb86b",
  hips: "#ffdf7e",
  torso: "#72e2ff",
  "left-arm": "#a78bfa",
  "right-arm": "#f58bd8",
  head: "#c8f56a",
  hands: "#c8f56a"
};

function evenDimension(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

export function createWireframeCamera(frames: Array<WireframePoints>): WireframeCamera {
  const points = frames.flatMap((frame) => Object.values(frame));
  const validPoints = points.filter((point) => point.every(Number.isFinite));
  const minX = Math.min(...validPoints.map((point) => point[0]), -0.8);
  const maxX = Math.max(...validPoints.map((point) => point[0]), 0.8);
  const minY = Math.min(...validPoints.map((point) => point[1]), -1.2);
  const maxY = Math.max(...validPoints.map((point) => point[1]), 1.2);
  const rangeX = Math.max(1.6, maxX - minX);
  const rangeY = Math.max(2.4, maxY - minY);
  const padding = Math.max(0.22, Math.max(rangeX, rangeY) * 0.14);
  const contentWidth = rangeX + padding * 2;
  const contentHeight = rangeY + padding * 2;
  const longestSide = Math.max(contentWidth, contentHeight);
  const maxOutputDimension = 960;
  const width = evenDimension(maxOutputDimension * contentWidth / longestSide);
  const height = evenDimension(maxOutputDimension * contentHeight / longestSide);
  const scale = Math.min((width - 2) / contentWidth, (height - 2) / contentHeight);
  return { width, height, minX: minX - padding, minY: minY - padding, scale };
}

function project(point: Point3, camera: WireframeCamera): [number, number] {
  const x = (point[0] - camera.minX) * camera.scale;
  const y = camera.height - (point[1] - camera.minY) * camera.scale;
  return [x, y];
}

export function drawWireframe(
  canvas: HTMLCanvasElement,
  points: WireframePoints | null,
  status = "POSE REVIEW",
  camera?: WireframeCamera
): void {
  const width = Math.max(320, canvas.width || 960);
  const height = Math.max(220, canvas.height || 540);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#0d1422");
  background.addColorStop(1, "#04070d");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(150, 178, 208, 0.08)";
  context.lineWidth = 1;
  for (let x = 0; x < width; x += Math.max(48, width / 12)) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
  }
  for (let y = 0; y < height; y += Math.max(42, height / 10)) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }
  context.fillStyle = "rgba(221, 235, 250, 0.66)";
  context.font = "600 11px Inter, system-ui, sans-serif";
  context.letterSpacing = "0.12em";
  context.fillText(status, 18, 24);
  if (!points) {
    context.fillStyle = "rgba(221, 235, 250, 0.44)";
    context.font = "500 15px Inter, system-ui, sans-serif";
    context.fillText("Upload a full-body dance video to begin pose review", 18, height / 2);
    return;
  }
  const frameCamera = camera ?? createWireframeCamera([points]);
  for (const [parentId, childId] of CANONICAL_EDGES) {
    const start = points[parentId];
    const end = points[childId];
    if (!start || !end) continue;
    const [x1, y1] = project(start, frameCamera);
    const [x2, y2] = project(end, frameCamera);
    const child = HUMANOID_SKELETON.joints.find((joint) => joint.id === childId);
    context.strokeStyle = REGION_COLORS[child?.region ?? "full-body"];
    context.globalAlpha = 0.82;
    context.lineWidth = childId.toLowerCase().includes("foot") || childId.toLowerCase().includes("toe") ? 4 : 3;
    context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
  }
  context.globalAlpha = 1;
  for (const joint of HUMANOID_SKELETON.joints) {
    const point = points[joint.id];
    if (!point) continue;
    const [x, y] = project(point, frameCamera);
    context.fillStyle = REGION_COLORS[joint.region] ?? REGION_COLORS["full-body"];
    context.beginPath(); context.arc(x, y, joint.optional ? 3 : 4.5, 0, Math.PI * 2); context.fill();
  }
}
