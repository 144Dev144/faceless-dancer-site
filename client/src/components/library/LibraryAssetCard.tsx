import type { LibraryItem } from "../../lib/api";

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
  const audioFile = item.files.find((file) => file.role === "audio" || file.role === "preview");
  const coverFile = item.files.find((file) => file.role === "cover");
  const datasetSamples = item.files.filter((file) => file.role === "dataset_sample").length;
  const fileCount = item.files.length;
  const updated = new Date(item.updatedAt);
  const creatorName = item.creator?.displayName || item.creator?.creatorSlug || "Faceless creator";
  const cardImage = coverFile?.publicUrl || item.creator?.bannerUrl || item.creator?.avatarUrl || "";
  const rhythmFacts = item.kind === "rhythm_game" ? rhythmGameFacts(item.metadata || {}) : [];
  const factTags = [
    ...(item.license ? [item.license] : []),
    ...rhythmFacts,
  ];

  return (
    <article
      className={`library-card${className ? ` ${className}` : ""}${cardImage ? " library-card--image" : ""}`}
      style={cardImage ? { backgroundImage: `linear-gradient(180deg, rgba(4, 10, 19, 0.2), rgba(4, 10, 19, 0.9)), url(${cardImage})` } : undefined}
    >
      <div className="library-card__content">
        <div className="library-card__meta">
          <span className="home-v2-tag">{formatKind(item.kind)}</span>
          <span className="home-v2-tag">By {creatorName}</span>
        </div>
        <div className="library-card__topline">
          <span>{Number.isNaN(updated.getTime()) ? "Recent" : updated.toLocaleDateString()}</span>
          <span>{fileCount} files</span>
          {item.kind === "dataset" ? <span>{datasetSamples} samples</span> : null}
        </div>
        <h2>{item.title}</h2>
        <p>{item.description || fallbackDescription(item.kind)}</p>
        <div className="library-card__facts">
          {factTags.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </div>
        {item.tags.length ? (
          <div className="library-card__tags">
            {item.tags.slice(0, 6).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}
        {audioFile?.publicUrl ? (
          <audio className="library-card__audio" controls preload="metadata" src={audioFile.publicUrl}></audio>
        ) : null}
        {actionLabel ? (
          <button
            type="button"
            className="home-v2-btn home-v2-btn--primary"
            disabled={actionDisabled}
            title={actionTitle}
            onClick={() => onAction?.()}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, " ");
}

function rhythmGameFacts(metadata: Record<string, unknown>): string[] {
  const supported =
    (metadata.supportedGameModes as Record<string, unknown> | undefined) ??
    (metadata.supported_game_modes as Record<string, unknown> | undefined) ??
    {};
  const facts: string[] = [];
  const volumeLabel = String(metadata.volumeLabel ?? metadata.volume_label ?? "").trim();
  const gameEnabled =
    typeof metadata.gameEnabled === "boolean"
      ? metadata.gameEnabled
      : typeof metadata.game_enabled === "boolean"
        ? metadata.game_enabled
        : false;
  if (volumeLabel) {
    facts.push(volumeLabel);
  }
  facts.push(gameEnabled ? "Game Enabled" : "Game Hidden");
  const modes: string[] = [];
  const stepArrows =
    typeof supported.stepArrows === "boolean"
      ? supported.stepArrows
      : typeof supported.step_arrows === "boolean"
        ? supported.step_arrows
        : true;
  const orbBeat =
    typeof supported.orbBeat === "boolean"
      ? supported.orbBeat
      : typeof supported.orb_beat === "boolean"
        ? supported.orb_beat
        : false;
  if (stepArrows) {
    modes.push("Step Arrows");
    modes.push("Rhythm Wizards");
  }
  if (orbBeat) {
    modes.push("Orb Beat");
  }
  if (modes.length) {
    facts.push(`Modes: ${modes.join(", ")}`);
  }
  return facts;
}

function fallbackDescription(kind: string): string {
  if (kind === "dataset") return "Captioned training dataset prepared for creator workflows.";
  if (kind === "lokr") return "Trained LoKr adapter for compatible Dance Station generation workflows.";
  if (kind === "rhythm_game") return "Rhythm-game-ready music and metadata package.";
  return "Published Dance Station library item.";
}
