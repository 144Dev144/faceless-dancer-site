import { useEffect, useRef } from "preact/hooks";

const AUDIO_MASS_BASE = "/dance-station/audiomass";
const AUDIO_MASS_SCRIPTS = [
  "vendor/wavesurfer/wavesurfer.js",
  "vendor/wavesurfer/plugin/wavesurfer.regions.js",
  "oneup.js",
  "app.js",
  "keys.js",
  "markers.js",
  "contextmenu.js",
  "lufs.js",
  "ui-fx.js",
  "ui.js",
  "modal.js",
  "state.js",
  "engine.js",
  "actions.js",
  "drag.js",
  "recorder.js",
  "fx-pg-eq.js",
  "fx-auto.js",
  "local.js",
  "id3.js",
  "lzma.js",
  "amss-format.js",
  "multitrack.js",
  "adapters/dance-station-bridge.js",
];

const AUDIO_MASS_VARIABLES = `
  --bg-0:#07080a; --bg-1:#0e1013; --bg-2:#14171c; --bg-3:#1c2026; --bg-4:#262b32;
  --fg-0:#e8edf0; --fg-1:#9aa3ad; --fg-2:#6a7380; --fg-3:#3a414a;
  --ac:#5af2ff; --ac-2:#99c2c6; --ac-soft:rgba(90,242,255,.12); --ac-glow:rgba(90,242,255,.45); --ac-ink:#041014;
  --rec:#ff3355; --rec-glow:rgba(255,51,85,.45); --solo:#28c8f0; --solo-glow:rgba(40,200,240,.45);
  --warn:#f5c542; --ok:#6ecc87; --pl:#ff8c35;
  --bd:rgba(255,255,255,.07); --bd-s:rgba(255,255,255,.04); --bd-h:rgba(90,242,255,.4);
  --r:2px; --r-md:4px; --r-lg:8px; --s1:4px; --s2:8px; --s3:12px; --s4:16px;
  --ease:cubic-bezier(.2,.7,.3,1); --tr:160ms var(--ease);
  --glow:0 0 0 1px var(--bd-h),0 0 10px var(--ac-glow); --inset-hi:inset 0 1px 0 rgba(255,255,255,.04);
  --ff:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --ff-mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
`;

const AUDIO_MASS_HOST_CSS = `
  :host {
    display:block;
    width:100%;
    height:100%;
    min-width:0;
    min-height:0;
    overflow:hidden;
    box-sizing:border-box;
    color:var(--fg-0);
    background:var(--bg-0);
    font:13px/1.45 var(--ff);
    -webkit-font-smoothing:antialiased;
    ${AUDIO_MASS_VARIABLES}
  }
  :host *, :host *::before, :host *::after { box-sizing:border-box; }
  :host .pk_app { width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; }
  :host .pk_tbc { max-width:100%; }
  :host .pk_mt_main { min-width:0; overflow-x:auto; }
  :host .pk_mt_lanes { min-width:0; }
  :host button, :host input, :host select, :host textarea { font:inherit; }
`;

type AudioMassPayload = Record<string, unknown>;

export interface AudioMassEvent {
  type: string;
  payload: AudioMassPayload;
}

interface AudioMassBridge {
  attachEditor(editor: unknown): void;
  ready(): void;
  setAssetCatalog(assets: AudioMassPayload[]): void;
  addAudioClip(payload: AudioMassPayload): void;
  addAudioBuffer(payload: AudioMassPayload): void;
  exportToDanceStation(name: string, requestId: string): void;
}

interface AudioMassEditorGlobal {
  init(element: HTMLElement, options?: { multitrack?: boolean }): unknown;
}

interface AudioMassHostGlobal {
  onEvent: (type: string, payload: AudioMassPayload) => void;
}

declare global {
  interface Window {
    PKAudioEditor?: AudioMassEditorGlobal;
    DanceStationAudioMassBridge?: AudioMassBridge;
    __DANCE_STATION_AUDIOMASS_HOST__?: AudioMassHostGlobal;
    __DANCE_STATION_AUDIOMASS_ROOT__?: HTMLElement;
  }
}

let scriptLoadPromise: Promise<void> | null = null;

function loadAudioMassScript(relativePath: string): Promise<void> {
  const src = `${AUDIO_MASS_BASE}/${relativePath}`;
  const existing = Array.from(document.scripts).find((script) => script.dataset.danceStationAudiomass === src);
  if (existing) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.dataset.danceStationAudiomass = src;
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`AudioMass could not load ${relativePath}.`));
    document.head.appendChild(script);
  });
}

function loadAudioMassScripts(): Promise<void> {
  if (!scriptLoadPromise) {
    scriptLoadPromise = AUDIO_MASS_SCRIPTS.reduce(
      (promise, script) => promise.then(() => loadAudioMassScript(script)),
      Promise.resolve(),
    );
  }
  return scriptLoadPromise;
}

function loadAudioMassStyles(shadow: ShadowRoot): Promise<void> {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `${AUDIO_MASS_BASE}/main.css`;
  shadow.appendChild(link);

  return new Promise((resolve) => {
    link.onload = () => resolve();
    link.onerror = () => resolve();
  });
}

class AudioMassInlineController {
  private host: HTMLDivElement | null = null;
  private root: HTMLDivElement | null = null;
  private bridge: AudioMassBridge | null = null;
  private ready = false;
  private onEvent: ((event: AudioMassEvent) => void) | null = null;
  private initialization: Promise<void> | null = null;

  private readonly hostBinding: AudioMassHostGlobal = {
    onEvent: (type, payload) => {
      this.onEvent?.({ type, payload });
    },
  };

  async mount(container: HTMLElement, onEvent: (event: AudioMassEvent) => void): Promise<void> {
    this.onEvent = onEvent;
    window.__DANCE_STATION_AUDIOMASS_HOST__ = this.hostBinding;

    if (this.host) {
      container.appendChild(this.host);
      if (this.ready) onEvent({ type: "dance-station:audiomass-ready", payload: {} });
      return;
    }

    this.host = document.createElement("div");
    this.host.className = "dance-station-audiomass-inline-host";
    this.host.style.width = "100%";
    this.host.style.height = "100%";
    this.host.style.minWidth = "0";
    this.host.style.minHeight = "0";

    const shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = AUDIO_MASS_HOST_CSS;
    shadow.appendChild(style);
    this.root = document.createElement("div");
    this.root.id = "dance-station-audiomass-root";
    window.__DANCE_STATION_AUDIOMASS_ROOT__ = this.root;
    shadow.appendChild(this.root);
    container.appendChild(this.host);

    this.initialization = Promise.all([loadAudioMassStyles(shadow), loadAudioMassScripts()]).then(() => {
      if (!this.root || !window.PKAudioEditor || !window.DanceStationAudioMassBridge) {
        throw new Error("AudioMass direct mount is missing its editor bootstrap.");
      }
      const editor = window.PKAudioEditor.init(this.root, { multitrack: true });
      this.bridge = window.DanceStationAudioMassBridge;
      this.bridge.attachEditor(editor);
      this.bridge.ready();
      this.ready = true;
    }).catch((error) => {
      this.onEvent?.({
        type: "dance-station:audiomass-error",
        payload: { message: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    });

    await this.initialization;
  }

  unmount(): void {
    if (!this.host) return;
    const parent = this.host.parentElement;
    if (parent) parent.removeChild(this.host);
    this.onEvent = null;
  }

  isReady(): boolean {
    return this.ready && Boolean(this.bridge);
  }

  setAssetCatalog(assets: AudioMassPayload[]): void {
    this.bridge?.setAssetCatalog(assets);
  }

  addAudioBuffer(payload: AudioMassPayload): void {
    this.bridge?.addAudioBuffer(payload);
  }

  addAudioClip(payload: AudioMassPayload): void {
    this.bridge?.addAudioClip(payload);
  }

  exportAudio(name: string, requestId: string): void {
    this.bridge?.exportToDanceStation(name, requestId);
  }
}

export const audioMassInlineController = new AudioMassInlineController();

export function AudioMassInlineEditor({ onEvent }: { onEvent: (event: AudioMassEvent) => void }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let active = true;
    const container = containerRef.current;
    if (!container) return () => undefined;
    void audioMassInlineController.mount(container, (event) => {
      if (active) onEventRef.current(event);
    }).catch(() => undefined);
    return () => {
      active = false;
      audioMassInlineController.unmount();
    };
  }, []);

  return <div ref={containerRef} className="dance-station-audiomass-inline-mount" aria-label="AudioMass editor" />;
}
