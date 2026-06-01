import { useRef, useState } from "preact/hooks";
import { api } from "../lib/api";
import { ScheduleSlotPicker } from "./ScheduleSlotPicker";

interface ScheduleSelection {
  startIso: string;
  endIso: string;
  hasPendingConflict: boolean;
}

interface Props {
  enabled: boolean;
  selectedStart?: string;
  selectedEnd?: string;
  hasPendingConflict?: boolean;
  onScheduleSelect?: (selection: ScheduleSelection) => void;
  scheduleRefreshKey?: number;
  hideSchedulePicker?: boolean;
  onSubmissionCreated?: () => void;
}

export function SubmissionCard({
  enabled,
  selectedStart,
  selectedEnd,
  hasPendingConflict,
  onScheduleSelect,
  scheduleRefreshKey,
  hideSchedulePicker = false,
  onSubmissionCreated,
}: Props) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [desiredStart, setDesiredStart] = useState("");
  const [desiredEnd, setDesiredEnd] = useState("");
  const [submissionId, setSubmissionId] = useState("");
  const [assetType, setAssetType] = useState("background");
  const [file, setFile] = useState<File | null>(null);
  const [pendingWarning, setPendingWarning] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState("Idle");
  const [uploadStatus, setUploadStatus] = useState("Idle");
  const [localScheduleRefreshKey, setLocalScheduleRefreshKey] = useState(0);
  const [uploadedAssets, setUploadedAssets] = useState<Array<{ assetId: string; assetType: string; fileName: string; publicUrl: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileAccept = assetType === "music" ? ".mp3,audio/mpeg" : ".png,image/png";

  const activeStart = selectedStart ?? desiredStart;
  const activeEnd = selectedEnd ?? desiredEnd;
  const activePendingWarning = hasPendingConflict ?? pendingWarning;
  const activeScheduleRefreshKey = scheduleRefreshKey ?? localScheduleRefreshKey;

  const handleScheduleSelect = (selection: ScheduleSelection) => {
    if (onScheduleSelect) {
      onScheduleSelect(selection);
      return;
    }

    setDesiredStart(selection.startIso);
    setDesiredEnd(selection.endIso);
    setPendingWarning(selection.hasPendingConflict);
  };

  const resetScheduleSelection = () => {
    if (onScheduleSelect) {
      onScheduleSelect({ startIso: "", endIso: "", hasPendingConflict: false });
      return;
    }

    setDesiredStart("");
    setDesiredEnd("");
    setPendingWarning(false);
  };

  const submitRequest = async () => {
    if (!activeStart || !activeEnd) {
      throw new Error("Choose both desired start and desired end");
    }

    setSubmissionStatus("Submitting request...");
    const created = await api.createSubmission({
      title,
      notes,
      desiredStart: new Date(activeStart).toISOString(),
      desiredEnd: new Date(activeEnd).toISOString(),
    });
    setSubmissionId(created.submissionId);
    setSubmissionStatus(`Submission created: ${created.submissionId}`);
    setSubmissionId("");
    setTitle("");
    setNotes("");
    resetScheduleSelection();
    setUploadedAssets([]);
    setUploadStatus("Idle");
    setLocalScheduleRefreshKey((value) => value + 1);
    onSubmissionCreated?.();
  };

  const uploadAsset = async () => {
    if (!file) {
      throw new Error("Choose a file first");
    }

    const fileName = file.name.toLowerCase();
    const isMusic = assetType === "music";
    const isValidFile =
      isMusic
        ? file.type === "audio/mpeg" || fileName.endsWith(".mp3")
        : file.type === "image/png" || fileName.endsWith(".png");

    if (!isValidFile) {
      throw new Error(isMusic ? "Music uploads must be a single .mp3 file" : "Visual uploads must be a single .png file");
    }

    setUploadStatus("Uploading asset...");
    const uploaded = await api.uploadAsset(assetType, file, submissionId || undefined);
    setSubmissionId(uploaded.submissionId);
    setUploadedAssets((current) => [
      { assetId: uploaded.assetId, assetType, fileName: file.name, publicUrl: uploaded.publicUrl },
      ...current,
    ]);
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setUploadStatus(`Asset uploaded: ${uploaded.assetId}`);
  };

  return (
    <section className="card">
      <h2>Holder Submission</h2>
      <p className="small">Only verified holders can submit schedule requests and assets.</p>
      {!enabled ? <span className="badge warn">Holder verification required</span> : <span className="badge ok">Enabled</span>}

      <div className="row">
        <label>
          Asset Type
          <select value={assetType} onInput={(event) => setAssetType((event.target as HTMLSelectElement).value)} disabled={!enabled}>
            <option value="background">Background</option>
            <option value="head">Head</option>
            <option value="torso">Torso</option>
            <option value="music">Music</option>
          </select>
        </label>
        <label>
          File
          <input ref={fileInputRef} type="file" accept={fileAccept} onInput={(event) => setFile((event.target as HTMLInputElement).files?.[0] ?? null)} disabled={!enabled} />
        </label>
      </div>

      <button type="button" disabled={!enabled} onClick={() => uploadAsset().catch((error) => setUploadStatus(error.message))}>
        Upload Asset
      </button>
      <div className="small">{uploadStatus}</div>
      {uploadedAssets.length > 0 ? (
        <div className="uploaded-assets">
          <div className="small">Uploaded Assets</div>
          {uploadedAssets.map((asset) => (
            <div key={asset.assetId} className="uploaded-assets__item small">
              <span>{asset.assetType} | {asset.fileName}</span>
              <a href={asset.publicUrl} target="_blank" rel="noreferrer">View</a>
            </div>
          ))}
        </div>
      ) : null}

      <hr style={{ borderColor: "#24354f", opacity: 0.4 }} />

      <div className="row">
        <label>
          Title
          <input value={title} onInput={(event) => setTitle((event.target as HTMLInputElement).value)} disabled={!enabled} />
        </label>
      </div>

      {!hideSchedulePicker ? (
        <ScheduleSlotPicker
          enabled={enabled}
          selectedStart={activeStart}
          selectedEnd={activeEnd}
          refreshKey={activeScheduleRefreshKey}
          onSelect={handleScheduleSelect}
        />
      ) : null}

      {activePendingWarning ? (
        <p className="small">
          Warning: this slot already has a pending request. It is still selectable, but
          pending requests are first come first serve and may be accepted before yours.
        </p>
      ) : null}

      <label>
        Notes
        <textarea value={notes} onInput={(event) => setNotes((event.target as HTMLTextAreaElement).value)} disabled={!enabled} />
      </label>

      <button type="button" disabled={!enabled} onClick={() => submitRequest().catch((error) => setSubmissionStatus(error.message))}>
        Create Submission
      </button>
      <div className="small">{submissionStatus}</div>
    </section>
  );
}
