import { useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Scissors, Trash2 } from "lucide-preact";
import type { DanceMotionCompositionSegment } from "@faceless/shared";

const PIXELS_PER_SECOND = 92;
const MIN_CLIP_SECONDS = 0.08;
const SNAP_SECONDS = 0.14;
const TRACK_MIN_SECONDS = 8;

type SegmentEdit = Partial<Pick<DanceMotionCompositionSegment, "offsetSeconds" | "trimStartSeconds" | "trimEndSeconds">>;

interface Props {
  segments: DanceMotionCompositionSegment[];
  selectedSegmentId: string | null;
  durationSeconds: number;
  cursorSeconds: number;
  onCursorChange: (seconds: number) => void;
  onSelectSegment: (id: string) => void;
  onUpdateSegment: (id: string, change: SegmentEdit) => void;
  onRemoveSegment: (id: string) => void;
  onCutAtCursor: () => void;
}

interface PointerEdit {
  kind: "move" | "trim-left" | "trim-right";
  id: string;
  startX: number;
  offsetSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
}

function clipDuration(segment: DanceMotionCompositionSegment): number {
  return Math.max(MIN_CLIP_SECONDS, segment.trimEndSeconds - segment.trimStartSeconds);
}

function snapValue(value: number, candidates: number[]): number {
  const closest = candidates.reduce<{ value: number; distance: number } | null>((best, candidate) => {
    const distance = Math.abs(candidate - value);
    return !best || distance < best.distance ? { value: candidate, distance } : best;
  }, null);
  return closest && closest.distance <= SNAP_SECONDS ? closest.value : value;
}

export function DanceMotionCompositionTrack({
  segments,
  selectedSegmentId,
  durationSeconds,
  cursorSeconds,
  onCursorChange,
  onSelectSegment,
  onUpdateSegment,
  onRemoveSegment,
  onCutAtCursor,
}: Props): JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pointerEditRef = useRef<PointerEdit | null>(null);
  const [cutMode, setCutMode] = useState(false);
  const trackSeconds = Math.max(TRACK_MIN_SECONDS, durationSeconds + 1);
  const trackWidth = trackSeconds * PIXELS_PER_SECOND;
  const selectedSegment = segments.find((segment) => segment.id === selectedSegmentId) ?? null;

  const secondsAtClientX = (clientX: number): number => {
    const viewport = viewportRef.current;
    if (!viewport) return 0;
    const bounds = viewport.getBoundingClientRect();
    return Math.max(0, Math.min(trackSeconds, (clientX - bounds.left + viewport.scrollLeft) / PIXELS_PER_SECOND));
  };

  const handleTimelinePointerDown = (event: PointerEvent) => {
    if ((event.target as HTMLElement).closest("[data-motion-segment]")) return;
    const seconds = secondsAtClientX(event.clientX);
    onCursorChange(seconds);
    if (cutMode && selectedSegment && seconds >= selectedSegment.offsetSeconds && seconds <= selectedSegment.offsetSeconds + clipDuration(selectedSegment)) {
      onCutAtCursor();
      setCutMode(false);
    }
  };

  const beginEdit = (event: PointerEvent, kind: PointerEdit["kind"], segment: DanceMotionCompositionSegment) => {
    event.stopPropagation();
    event.preventDefault();
    onSelectSegment(segment.id);
    pointerEditRef.current = {
      kind,
      id: segment.id,
      startX: event.clientX,
      offsetSeconds: segment.offsetSeconds,
      trimStartSeconds: segment.trimStartSeconds,
      trimEndSeconds: segment.trimEndSeconds,
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const updateEdit = (event: PointerEvent) => {
    const edit = pointerEditRef.current;
    if (!edit) return;
    const delta = (event.clientX - edit.startX) / PIXELS_PER_SECOND;
    const segment = segments.find((candidate) => candidate.id === edit.id);
    if (!segment) return;
    const otherEdges = segments.filter((candidate) => candidate.id !== edit.id).flatMap((candidate) => [candidate.offsetSeconds, candidate.offsetSeconds + clipDuration(candidate)]);
    const fixedRight = edit.offsetSeconds + (edit.trimEndSeconds - edit.trimStartSeconds);
    if (edit.kind === "move") {
      const nextOffset = snapValue(Math.max(0, edit.offsetSeconds + delta), [0, ...otherEdges]);
      onUpdateSegment(edit.id, { offsetSeconds: nextOffset });
      onCursorChange(nextOffset);
    } else if (edit.kind === "trim-left") {
      const proposedLeft = snapValue(Math.max(0, edit.offsetSeconds + delta), [0, ...otherEdges]);
      const nextLeft = Math.min(proposedLeft, fixedRight - MIN_CLIP_SECONDS);
      onUpdateSegment(edit.id, {
        offsetSeconds: nextLeft,
        trimStartSeconds: Math.max(0, Math.min(edit.trimEndSeconds - MIN_CLIP_SECONDS, edit.trimStartSeconds + nextLeft - edit.offsetSeconds)),
      });
    } else {
      const proposedRight = snapValue(Math.max(edit.offsetSeconds + MIN_CLIP_SECONDS, fixedRight + delta), otherEdges);
      const nextRight = Math.max(edit.offsetSeconds + MIN_CLIP_SECONDS, proposedRight);
      onUpdateSegment(edit.id, { trimEndSeconds: edit.trimStartSeconds + nextRight - edit.offsetSeconds });
    }
  };

  const endEdit = () => {
    pointerEditRef.current = null;
  };

  const ticks = Array.from({ length: Math.ceil(trackSeconds) + 1 }, (_, index) => index).filter((value) => value % 1 === 0);

  return (
    <div className="dance-motion-composition-editor">
      <div className="dance-motion-composition-toolbar">
        <span className="dance-motion-composition-toolbar__hint">Drag clips to position them. Pull either edge to trim.</span>
        <div className="dance-motion-composition-toolbar__actions">
          <button type="button" className={`rhythm-beats-secondary-button rhythm-beats-secondary-button--primary dance-motion-composition-tool-button${cutMode ? " is-active" : ""}`} title="Cut selected clip at the playhead" aria-label="Cut selected clip at the playhead" disabled={!selectedSegment} onClick={() => setCutMode((value) => !value)}><Scissors size={15} aria-hidden="true" /></button>
          <button type="button" className="rhythm-beats-secondary-button dance-motion-composition-tool-button dance-motion-composition-tool-button--remove" title="Remove selected clip" aria-label="Remove selected clip" disabled={!selectedSegment} onClick={() => selectedSegment && onRemoveSegment(selectedSegment.id)}><Trash2 size={15} aria-hidden="true" /></button>
        </div>
      </div>
      <div ref={viewportRef} className="dance-motion-composition-viewport" onPointerDown={handleTimelinePointerDown}>
        <div className="dance-motion-composition-canvas" style={{ width: `${trackWidth}px` }}>
          <div className="dance-motion-composition-axis" aria-hidden="true">{ticks.map((tick) => <span key={tick} style={{ left: `${tick * PIXELS_PER_SECOND}px` }}>{tick}s</span>)}</div>
          <div className="dance-motion-composition-lane">
            {segments.map((segment, index) => {
              const width = clipDuration(segment) * PIXELS_PER_SECOND;
              const left = Math.max(0, segment.offsetSeconds) * PIXELS_PER_SECOND;
              return <div
                key={segment.id}
                data-motion-segment="true"
                className={`dance-motion-composition-segment${selectedSegmentId === segment.id ? " is-selected" : ""}`}
                style={{ left: `${left}px`, width: `${Math.max(28, width)}px` }}
                title={`${segment.title} · ${clipDuration(segment).toFixed(2)} seconds`}
                onPointerDown={(event) => {
                  if (cutMode) {
                    event.stopPropagation();
                    event.preventDefault();
                    onSelectSegment(segment.id);
                    onCursorChange(secondsAtClientX(event.clientX));
                    if (selectedSegmentId === segment.id) {
                      onCutAtCursor();
                      setCutMode(false);
                    }
                    return;
                  }
                  beginEdit(event, "move", segment);
                }}
                onPointerMove={updateEdit}
                onPointerUp={endEdit}
                onPointerCancel={endEdit}
                onClick={(event) => { event.stopPropagation(); onSelectSegment(segment.id); }}
              >
                <button type="button" className="dance-motion-composition-handle is-left" aria-label={`Trim start of ${segment.title}`} onPointerDown={(event) => beginEdit(event, "trim-left", segment)} />
                <span className="dance-motion-composition-segment__index">{index + 1}</span>
                <span className="dance-motion-composition-segment__title">{segment.title}</span>
                <span className="dance-motion-composition-segment__duration">{clipDuration(segment).toFixed(1)}s</span>
                <button type="button" className="dance-motion-composition-handle is-right" aria-label={`Trim end of ${segment.title}`} onPointerDown={(event) => beginEdit(event, "trim-right", segment)} />
              </div>;
            })}
            {!segments.length ? <span className="dance-motion-composition-empty">Add a saved dance asset below to begin assembling.</span> : null}
            <div className="dance-motion-composition-playhead" style={{ left: `${Math.max(0, Math.min(trackSeconds, cursorSeconds)) * PIXELS_PER_SECOND}px` }} aria-label={`Playhead at ${cursorSeconds.toFixed(2)} seconds`} />
          </div>
        </div>
      </div>
      <div className="dance-motion-composition-selection">
        <span>{selectedSegment ? `Selected: ${selectedSegment.title}` : "Select a clip to edit it"}</span>
        <span>Playhead {cursorSeconds.toFixed(2)}s · {durationSeconds.toFixed(2)}s total</span>
        {cutMode ? <strong>Click inside the selected clip to cut</strong> : null}
      </div>
    </div>
  );
}
