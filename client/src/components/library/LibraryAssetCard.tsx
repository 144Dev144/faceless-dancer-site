import { useEffect, useRef, useState } from "preact/hooks";
import { AudioWaveform, Download, MoreHorizontal } from "lucide-preact";
import type { LibraryItem } from "../../lib/api";
import { AudioPlayButton, useSiteAudioPlayer } from "../audio/SiteAudioPlayer";

interface Props {
  item: LibraryItem;
  actionLabel?: string;
  actionDisabled?: boolean;
  actionTitle?: string;
  onAction?: (() => void) | null;
  className?: string;
}

export function LibraryAssetCard({
  item,
  actionLabel,
  actionDisabled = false,
  actionTitle,
  onAction,
  className = "",
}: Props): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { playTrack } = useSiteAudioPlayer();
  const audioFile = item.files.find((file) => (file.role === "audio" || file.role === "preview") && file.publicUrl);
  const coverFile = item.files.find((file) => file.role === "cover" && file.publicUrl);
  const datasetSamples = item.files.filter((file) => file.role === "dataset_sample").length;
  const fileCount = item.files.length;
  const updated = new Date(item.updatedAt);
  const creatorName = item.creator?.displayName || item.creator?.creatorSlug || item.creator?.publicKey || "Faceless creator";
  const cardImage = coverFile?.publicUrl || item.creator?.bannerUrl || item.creator?.avatarUrl || "";
  const kindClass = item.kind.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const factTags = [
    ...(item.license ? [item.license] : []),
    ...rhythmGameFacts(item.metadata || {}),
  ];
  const durationSeconds = Number(audioFile?.metadata?.durationSeconds ?? 0);
  const isNew = Number.isFinite(updated.getTime()) && Date.now() - updated.getTime() < 1000 * 60 * 60 * 24 * 30;
  const track = audioFile?.publicUrl
    ? {
        id: `library-audio-${item.id}`,
        title: item.title,
        url: audioFile.publicUrl,
        mimeType: audioFile.mimeType,
        artworkUrl: cardImage || undefined,
        creatorName,
      }
    : null;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [item.id, menuOpen]);

  return (
    <article className={`library-card library-card--${kindClass}${cardImage ? " library-card--image" : ""}${className ? ` ${className}` : ""}`}>
      <div className="library-card__art">
        {cardImage ? <img src={cardImage} alt="" loading="lazy" /> : <FallbackArtwork kind={item.kind} />}
        <div className="library-card__art-shade" />
        <div className="library-card__badge-row">
          <span className="library-card__kind-badge">{formatKind(item.kind)}</span>
          {isNew ? <span className="library-card__new-badge">New</span> : null}
        </div>
        {track ? <AudioPlayButton track={track} /> : null}
      </div>

      <div className="library-card__content">
        <div className="library-card__meta">
          <span>By {creatorName}</span>
          {item.kind === "dataset" && datasetSamples ? <span>{datasetSamples} samples</span> : null}
        </div>
        <h2 title={item.title}>{item.title}</h2>
        <p>{item.description || fallbackDescription(item.kind)}</p>
        <div className="library-card__facts">
          {factTags.slice(0, 3).map((fact) => <span key={fact}>{fact}</span>)}
        </div>
        {item.tags.length ? (
          <div className="library-card__tags">
            {item.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        ) : null}
        <div className="library-card__footer">
          <div className="library-card__details">
            {track ? <span><AudioWaveform aria-hidden="true" size={13} /> {durationSeconds > 0 ? formatDuration(durationSeconds) : "Audio preview"}</span> : null}
            <span>{Number.isNaN(updated.getTime()) ? "Recent" : updated.toLocaleDateString()}</span>
            <span>{fileCount} files</span>
          </div>
          <div className="library-card__actions" ref={menuRef}>
            {actionLabel ? (
              <button type="button" className="library-card__action-button" disabled={actionDisabled} title={actionTitle} onClick={() => onAction?.()}>
                {actionLabel}
              </button>
            ) : null}
            <button type="button" className="library-card__options-button" onClick={() => setMenuOpen((value) => !value)} aria-label={`Options for ${item.title}`} aria-expanded={menuOpen} title="Asset options">
              <MoreHorizontal aria-hidden="true" size={18} />
            </button>
            {menuOpen ? (
              <div className="library-card__options-menu">
                {track ? <button type="button" onClick={() => { playTrack(track); setMenuOpen(false); }}><AudioWaveform aria-hidden="true" size={14} /> Play preview</button> : null}
                {audioFile?.publicUrl ? <a href={audioFile.publicUrl} download={audioFile.metadata?.originalName ? String(audioFile.metadata.originalName) : `${item.title}.audio`}><Download aria-hidden="true" size={14} /> Download audio</a> : null}
                {!track && !audioFile?.publicUrl ? <span>No downloadable file</span> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function FallbackArtwork({ kind }: { kind: string }): JSX.Element {
  return (
    <div className={`library-card__fallback library-card__fallback--${kind.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
      <div className="library-card__waveform" aria-hidden="true">
        {Array.from({ length: 28 }, (_, index) => <span key={index} style={{ height: `${24 + ((index * 37) % 66)}%` }} />)}
      </div>
      <AudioWaveform aria-hidden="true" size={42} strokeWidth={1.2} />
    </div>
  );
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, " ");
}

function formatDuration(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function rhythmGameFacts(metadata: Record<string, unknown>): string[] {
  if (metadata.category !== "rhythm_game" && metadata.officialVolume !== true && metadata.official_volume !== true) return [];
  const supported = (metadata.supportedGameModes as Record<string, unknown> | undefined) ?? (metadata.supported_game_modes as Record<string, unknown> | undefined) ?? {};
  const facts: string[] = [];
  const volumeLabel = String(metadata.volumeLabel ?? metadata.volume_label ?? "").trim();
  const gameEnabled = typeof metadata.gameEnabled === "boolean" ? metadata.gameEnabled : typeof metadata.game_enabled === "boolean" ? metadata.game_enabled : false;
  if (volumeLabel) facts.push(volumeLabel);
  facts.push(gameEnabled ? "Game Enabled" : "Game Hidden");
  const stepArrows = typeof supported.stepArrows === "boolean" ? supported.stepArrows : typeof supported.step_arrows === "boolean" ? supported.step_arrows : true;
  const orbBeat = typeof supported.orbBeat === "boolean" ? supported.orbBeat : typeof supported.orb_beat === "boolean" ? supported.orb_beat : false;
  if (stepArrows) facts.push("Step Arrows");
  if (orbBeat) facts.push("Orb Beat");
  return facts;
}

function fallbackDescription(kind: string): string {
  if (kind === "dataset") return "Captioned training dataset prepared for creator workflows.";
  if (kind === "lokr") return "Trained LoKr adapter for compatible Dance Station generation workflows.";
  if (kind === "rhythm_game") return "Rhythm-game-ready music and metadata package.";
  return "Published Dance Station library item.";
}
