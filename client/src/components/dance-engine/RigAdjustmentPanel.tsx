import { useEffect, useMemo, useState } from "preact/hooks";
import { CheckCircle2, CircleHelp, Download, FileJson, RefreshCw, RotateCcw, Ruler, Save, SlidersHorizontal, Upload } from "lucide-preact";
import {
  cloneCanonicalRigProfile,
  getCanonicalBoneLength,
  getCanonicalChildren,
  moveCanonicalJoint,
  parseCanonicalRigProfile,
  setCanonicalBoneLength,
  type CanonicalRigProfile
} from "../../game/dance-engine/canonicalRigProfile";
import type { DanceModelManifest, DanceModelPreset } from "../../game/dance-engine/types";
import { RigAdjustmentStage } from "./RigAdjustmentStage";

interface RigAdjustmentPanelProps {
  model: DanceModelPreset;
  profile: CanonicalRigProfile | null;
  originalProfile: CanonicalRigProfile | null;
  orientationYawRadians: number;
  originalOrientationYawRadians: number;
  onProfileChange: (profile: CanonicalRigProfile) => void;
  onOrientationChange: (yawRadians: number) => void;
  onSave?: (manifest: DanceModelManifest) => Promise<void> | void;
  onReskin?: () => Promise<void> | void;
  reskinBusy?: boolean;
  reskinDisabled?: boolean;
  reskinDisabledReason?: string;
  onLoadProfile: (profile: CanonicalRigProfile, fileName: string) => void;
}

function downloadJson(fileName: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : "0.0000";
}

function normalizeYawRadians(value: number): number {
  const fullTurn = Math.PI * 2;
  return ((value + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}

function formatDegrees(radians: number): string {
  return `${Math.round((radians * 180) / Math.PI)}°`;
}

function ActionHelp({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <span className={`dance-engine-rig-action-help${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="dance-engine-rig-action-help__button"
        aria-label={text}
        aria-expanded={open}
        title={text}
        onClick={() => setOpen((value) => !value)}
      >
        <CircleHelp size={14} aria-hidden="true" />
      </button>
      <span className="dance-engine-rig-action-help__tooltip" role="tooltip">{text}</span>
    </span>
  );
}

function labelForJoint(name: string): string {
  const legBoneLabels: Record<string, string> = {
    leftUpperLeg: "Left hip",
    rightUpperLeg: "Right hip",
    leftLowerLeg: "Left upper leg",
    rightLowerLeg: "Right upper leg",
    leftFoot: "Left lower leg",
    rightFoot: "Right lower leg",
    leftToe: "Left foot",
    rightToe: "Right foot"
  };
  if (legBoneLabels[name]) return legBoneLabels[name];
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (value) => value.toUpperCase());
}

export function RigAdjustmentPanel({
  model,
  profile,
  originalProfile,
  orientationYawRadians,
  originalOrientationYawRadians,
  onProfileChange,
  onOrientationChange,
  onSave,
  onReskin,
  reskinBusy = false,
  reskinDisabled = false,
  reskinDisabledReason,
  onLoadProfile
}: RigAdjustmentPanelProps): JSX.Element {
  const [selectedJoint, setSelectedJoint] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const selected = selectedJoint && profile?.joints[selectedJoint] ? profile.joints[selectedJoint] : null;
  const childName = selected && profile ? getCanonicalChildren(profile, selectedJoint!)[0] : undefined;
  const selectedLength = selectedJoint && profile ? getCanonicalBoneLength(profile, selectedJoint) : null;
  const dirty = useMemo(() => {
    if (!profile || !originalProfile) return false;
    return JSON.stringify(profile) !== JSON.stringify(originalProfile)
      || Math.abs(orientationYawRadians - originalOrientationYawRadians) > 0.000001;
  }, [originalOrientationYawRadians, originalProfile, orientationYawRadians, profile]);

  const stageModel = useMemo(() => model.manifest
    ? { ...model, manifest: { ...model.manifest, orientation: { yawRadians: orientationYawRadians } } }
    : model, [model, orientationYawRadians]);

  useEffect(() => {
    if (profile && (!selectedJoint || !profile.joints[selectedJoint])) {
      setSelectedJoint(profile.requiredRoles.find((role) => profile.joints[role]) ?? Object.keys(profile.joints)[0] ?? null);
    }
  }, [profile, selectedJoint]);

  const setPosition = (axis: 0 | 1, value: number) => {
    if (!selectedJoint || !profile || !Number.isFinite(value)) return;
    const position = [...profile.joints[selectedJoint].position] as [number, number, number];
    position[axis] = value;
    onProfileChange(moveCanonicalJoint(profile, selectedJoint, position[0], position[1]));
  };

  const setLength = (value: number) => {
    if (!selectedJoint || !profile || !Number.isFinite(value)) return;
    onProfileChange(setCanonicalBoneLength(profile, selectedJoint, value));
  };

  const setOrientationDegrees = (degrees: number) => {
    if (!Number.isFinite(degrees)) return;
    onOrientationChange(normalizeYawRadians((degrees * Math.PI) / 180));
  };

  const loadProfile = async (event: Event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const parsed = parseCanonicalRigProfile(JSON.parse(await file.text()));
      onLoadProfile(parsed.profile, file.name);
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : "Unable to load the canonical profile.");
    }
    (event.currentTarget as HTMLInputElement).value = "";
  };

  const reset = () => {
    if (originalProfile) onProfileChange(cloneCanonicalRigProfile(originalProfile));
    onOrientationChange(originalOrientationYawRadians);
  };

  const manifest: DanceModelManifest | null = model.manifest && profile
    ? { ...model.manifest, orientation: { yawRadians: orientationYawRadians }, canonicalProfile: profile }
    : null;

  const save = async () => {
    if (!manifest || saving) return;
    if (!onSave) {
      downloadJson("manifest-adjusted.json", manifest);
      return;
    }
    setSaving(true);
    try {
      await onSave(manifest);
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : "Unable to save the adjusted avatar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`dance-engine-rig-adjustment${isOpen ? " is-open" : ""}`}>
      <header className="dance-engine-rig-adjustment__header">
        <div>
          <span className="dance-engine-eyebrow"><SlidersHorizontal size={14} aria-hidden="true" /> Rig adjustment</span>
          <h2>Fit the canonical skeleton</h2>
          <p>Adjust the humanoid profile against the loaded avatar before sending it back for reskinning.</p>
        </div>
        <div className="dance-engine-rig-adjustment__header-actions">
          {profile ? <span className={`dance-engine-rig-state${dirty ? " is-dirty" : ""}`}><CheckCircle2 size={14} aria-hidden="true" /> {dirty ? "Unsaved edits" : "Profile loaded"}</span> : null}
          <button type="button" className="secondary" onClick={() => setIsOpen((value) => !value)}>{isOpen ? "Collapse" : "Open"}</button>
        </div>
      </header>
      {isOpen ? (
        <div className="dance-engine-rig-adjustment__body">
          <div className="dance-engine-rig-adjustment__stage-wrap">
            {profile ? <RigAdjustmentStage model={stageModel} profile={profile} selectedJoint={selectedJoint} onSelectJoint={setSelectedJoint} onMoveJoint={(name, x, y) => onProfileChange(moveCanonicalJoint(profile, name, x, y))} /> : <div className="dance-engine-rig-empty"><Ruler size={24} aria-hidden="true" /><strong>Load a canonical profile</strong><span>Select a manifest containing <code>canonicalProfile</code>, or load a standalone profile JSON.</span></div>}
          </div>
          <aside className="dance-engine-rig-adjustment__controls">
            <div className="dance-engine-section-title"><span>Profile</span><small>{profile ? `${Object.keys(profile.joints).length} joints` : "No profile loaded"}</small></div>
            <label className="dance-engine-rig-file"><Upload size={14} aria-hidden="true" /><span>Load profile JSON</span><input type="file" accept="application/json,.json" onChange={loadProfile} /></label>
            {profile ? <div className="dance-engine-rig-orientation">
              <div className="dance-engine-section-title"><span>Facing rotation</span><small>Stored in manifest</small></div>
              <label className="dance-engine-range"><span>Y rotation <output>{formatDegrees(orientationYawRadians)}</output></span><input type="range" min="-180" max="180" step="1" value={(orientationYawRadians * 180) / Math.PI} onInput={(event) => setOrientationDegrees(Number(event.currentTarget.value))} /></label>
              <label className="dance-engine-field"><span>Degrees</span><input type="number" min="-180" max="180" step="1" value={Math.round((orientationYawRadians * 180) / Math.PI)} onInput={(event) => setOrientationDegrees(Number(event.currentTarget.value))} /></label>
              <small className="dance-engine-rig-orientation-note">Rotate the avatar around its vertical axis. The adjustment is included in the manifest used by preview, export, and reskin.</small>
            </div> : null}
            {profile ? <div className="dance-engine-rig-action-row">
              <div className="dance-engine-rig-action">
                <button type="button" className="secondary dance-engine-rig-action-button" disabled={!manifest || saving} onClick={() => void save()}>
                  <Save size={14} aria-hidden="true" /> {saving ? "Saving..." : "Save adjustments"}
                </button>
                <ActionHelp text="Save Model Rotation (Should be facing you)" />
              </div>
              {onReskin ? <div className="dance-engine-rig-action">
                <button type="button" className="rhythm-beats-secondary-button rhythm-beats-secondary-button--primary dance-engine-rig-action-button" disabled={reskinBusy || reskinDisabled} title={reskinDisabled ? reskinDisabledReason : undefined} onClick={() => void onReskin()}>
                  {reskinBusy ? <RefreshCw size={14} className="is-spinning" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />} {reskinBusy ? "Reskinning..." : "Reskin with adjusted rig"}
                </button>
                <ActionHelp text="Apply weights to model based on your adjusted rigging" />
              </div> : null}
            </div> : null}
            {profile && selected ? (
              <>
                <label className="dance-engine-field"><span>Selected bone</span><select value={selectedJoint ?? ""} onChange={(event) => setSelectedJoint(event.currentTarget.value)}>{Object.keys(profile.joints).map((name) => <option key={name} value={name}>{labelForJoint(name)}</option>)}</select></label>
                <div className="dance-engine-rig-selected"><strong>{labelForJoint(selectedJoint ?? "")}</strong><span>{childName ? `Bone to ${labelForJoint(childName)}` : "Terminal joint"}</span></div>
                <div className="dance-engine-rig-coordinates"><label className="dance-engine-field"><span>X position</span><input type="number" step="0.001" value={formatNumber(selected.position[0])} onInput={(event) => setPosition(0, Number(event.currentTarget.value))} /></label><label className="dance-engine-field"><span>Y position</span><input type="number" step="0.001" value={formatNumber(selected.position[1])} onInput={(event) => setPosition(1, Number(event.currentTarget.value))} /></label><label className="dance-engine-field"><span>Z position</span><input type="number" step="0.001" value={formatNumber(selected.position[2])} readOnly /></label></div>
                {selectedLength !== null ? <label className="dance-engine-range"><span>Bone length <output>{selectedLength.toFixed(4)}</output></span><input type="range" min="0.001" max={Math.max(0.8, selectedLength * 3)} step="0.001" value={selectedLength} onInput={(event) => setLength(Number(event.currentTarget.value))} /></label> : null}
                <button type="button" className="secondary dance-engine-rig-reset" onClick={reset} disabled={!dirty}><RotateCcw size={14} aria-hidden="true" /> Reset all edits</button>
              </>
            ) : null}
            <div className="dance-engine-rig-adjustment__exports"><div className="dance-engine-section-title"><span>Export</span><small>Worker-compatible JSON</small></div><button type="button" className="secondary" disabled={!profile} onClick={() => profile && downloadJson("canonical-profile-adjusted.json", profile)}><FileJson size={14} aria-hidden="true" /> Download profile</button><button type="button" className="secondary" disabled={!manifest} onClick={() => manifest && downloadJson("manifest-adjusted.json", manifest)}><Download size={14} aria-hidden="true" /> Download manifest</button></div>
            <p className="dance-engine-rig-footnote">The source GLB is never modified in the browser. Exported profile data is the input for the worker reskin step.</p>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
