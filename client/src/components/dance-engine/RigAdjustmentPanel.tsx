import { useEffect, useMemo, useState } from "preact/hooks";
import { CheckCircle2, Download, FileJson, RotateCcw, Ruler, SlidersHorizontal, Upload } from "lucide-preact";
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
  onProfileChange: (profile: CanonicalRigProfile) => void;
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

export function RigAdjustmentPanel({
  model,
  profile,
  originalProfile,
  onProfileChange,
  onLoadProfile
}: RigAdjustmentPanelProps): JSX.Element {
  const [selectedJoint, setSelectedJoint] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const selected = selectedJoint && profile?.joints[selectedJoint] ? profile.joints[selectedJoint] : null;
  const childName = selected && profile ? getCanonicalChildren(profile, selectedJoint!)[0] : undefined;
  const selectedLength = selectedJoint && profile ? getCanonicalBoneLength(profile, selectedJoint) : null;
  const dirty = useMemo(() => {
    if (!profile || !originalProfile) return false;
    return JSON.stringify(profile) !== JSON.stringify(originalProfile);
  }, [originalProfile, profile]);

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
  };

  const manifest: DanceModelManifest | null = model.manifest && profile
    ? { ...model.manifest, canonicalProfile: profile }
    : null;

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
            {profile ? <RigAdjustmentStage model={model} profile={profile} selectedJoint={selectedJoint} onSelectJoint={setSelectedJoint} onMoveJoint={(name, x, y) => onProfileChange(moveCanonicalJoint(profile, name, x, y))} /> : <div className="dance-engine-rig-empty"><Ruler size={24} aria-hidden="true" /><strong>Load a canonical profile</strong><span>Select a manifest containing <code>canonicalProfile</code>, or load a standalone profile JSON.</span></div>}
          </div>
          <aside className="dance-engine-rig-adjustment__controls">
            <div className="dance-engine-section-title"><span>Profile</span><small>{profile ? `${Object.keys(profile.joints).length} joints` : "No profile loaded"}</small></div>
            <label className="dance-engine-rig-file"><Upload size={14} aria-hidden="true" /><span>Load profile JSON</span><input type="file" accept="application/json,.json" onChange={loadProfile} /></label>
            {profile && selected ? (
              <>
                <label className="dance-engine-field"><span>Selected joint</span><select value={selectedJoint ?? ""} onChange={(event) => setSelectedJoint(event.currentTarget.value)}>{Object.keys(profile.joints).map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
                <div className="dance-engine-rig-selected"><strong>{selectedJoint}</strong><span>{childName ? `Bone to ${childName}` : "Terminal joint"}</span></div>
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
