import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Check, ChevronDown, ChevronUp, Pause, Play, Plus, Scissors, Sparkles, Trash2, Upload, X } from "lucide-preact";
import type { RemoteGenerationInput } from "../../lib/api";

export interface TransitionAudioChoice {
  id: string;
  title: string;
  input: RemoteGenerationInput;
}

interface SourceClipDraft {
  id: string;
  inputId: string;
  title: string;
  input: RemoteGenerationInput;
  timelineStartSeconds: number;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
}

interface TransitionClipDraft {
  id: string;
  kind: "bridge" | "extension";
  fromSourceClipId: string;
  toSourceClipId?: string;
  startSeconds: number;
  endSeconds: number;
  prompt: string;
  repaintStrength: number;
  crossfadeSeconds: number;
}

export interface TransitionWorkspaceValue {
  inputs: RemoteGenerationInput[];
  plan: {
    schemaVersion: 1;
    sourceClips: Array<Pick<SourceClipDraft, "id" | "inputId" | "timelineStartSeconds" | "sourceStartSeconds" | "sourceEndSeconds">>;
    transitionClips: TransitionClipDraft[];
    inferenceSteps: number;
    guidanceScale: number;
  };
  valid: boolean;
  errors: string[];
}

interface Props {
  choices: TransitionAudioChoice[];
  inferenceSteps: number;
  guidanceScale: number;
  busy: boolean;
  uploadBusy: boolean;
  uploadError: string;
  onUpload: (file: File) => Promise<TransitionAudioChoice | undefined> | void;
  onChange: (value: TransitionWorkspaceValue) => void;
}

const MAX_SECONDS = 360;
const DEFAULT_TRANSITION_SECONDS = 4;
const DEFAULT_REPAINT_STRENGTH = 0.5;
const DEFAULT_CROSSFADE_SECONDS = 0.25;
const MAX_CROSSFADE_SECONDS = 10;
const TIMELINE_PIXELS_PER_SECOND = 4;
const SNAP_THRESHOLD_SECONDS = 0.5;

type PreviewSchedule =
  | { kind: "clip"; sourceId: string }
  | { kind: "gap"; startSeconds: number; endSeconds: number; startedAt: number };

function durationOf(source: SourceClipDraft): number {
  return source.sourceEndSeconds - source.sourceStartSeconds;
}

function endOf(source: SourceClipDraft): number {
  return source.timelineStartSeconds + durationOf(source);
}

function roundSeconds(value: number): number {
  return Math.round(Math.max(0, value) * 1000) / 1000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function readRemoteAudioDuration(sourceUrl: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const finish = (duration?: number) => {
      audio.removeAttribute("src");
      audio.load();
      resolve(duration && Number.isFinite(duration) && duration > 0 ? duration : undefined);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish();
    audio.src = sourceUrl;
  });
}

function defaultBridge(from: SourceClipDraft, to: SourceClipDraft, id: string): TransitionClipDraft {
  const start = Math.max(from.timelineStartSeconds, endOf(from) - Math.min(DEFAULT_TRANSITION_SECONDS, Math.max(0.5, durationOf(from) / 2)));
  const end = Math.min(endOf(to), to.timelineStartSeconds + Math.min(DEFAULT_TRANSITION_SECONDS, Math.max(0.5, durationOf(to) / 2)));
  return {
    id,
    kind: "bridge",
    fromSourceClipId: from.id,
    toSourceClipId: to.id,
    startSeconds: roundSeconds(start),
    endSeconds: roundSeconds(Math.max(start + 0.5, end)),
    prompt: "A seamless musical transition that preserves the energy and groove",
    repaintStrength: DEFAULT_REPAINT_STRENGTH,
    crossfadeSeconds: DEFAULT_CROSSFADE_SECONDS,
  };
}

function ensureBridges(sources: SourceClipDraft[], current: TransitionClipDraft[]): TransitionClipDraft[] {
  const sorted = [...sources].sort((a, b) => a.timelineStartSeconds - b.timelineStartSeconds);
  const next = current
    .filter((transition) => transition.kind === "extension" || sorted.some((source) => source.id === transition.fromSourceClipId))
    .map((transition) => ({
      ...transition,
      repaintStrength: Number.isFinite(transition.repaintStrength) ? clamp(transition.repaintStrength, 0, 1) : DEFAULT_REPAINT_STRENGTH,
      crossfadeSeconds: Number.isFinite(transition.crossfadeSeconds) ? clamp(transition.crossfadeSeconds, 0, MAX_CROSSFADE_SECONDS) : DEFAULT_CROSSFADE_SECONDS,
    }));
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const from = sorted[index];
    const to = sorted[index + 1];
    if (!next.some((transition) => transition.kind === "bridge" && transition.fromSourceClipId === from.id && transition.toSourceClipId === to.id)) {
      next.push(defaultBridge(from, to, `transition-${from.id}-${to.id}`));
    }
  }
  return next;
}

function validate(sources: SourceClipDraft[], transitions: TransitionClipDraft[]): string[] {
  const errors: string[] = [];
  const sorted = [...sources].sort((a, b) => a.timelineStartSeconds - b.timelineStartSeconds);
  if (sorted.length < 2) errors.push("Add at least two source clips.");
  const seenIds = new Set<string>();
  sorted.forEach((source) => {
    if (seenIds.has(source.id)) errors.push("Source clip ids must be unique.");
    seenIds.add(source.id);
    if (durationOf(source) <= 0) errors.push(`${source.title} needs a positive source range.`);
    if (source.timelineStartSeconds < 0 || endOf(source) > MAX_SECONDS) errors.push(`${source.title} must stay inside ${MAX_SECONDS} seconds.`);
    if (typeof source.input.durationSeconds === "number" && source.sourceEndSeconds > source.input.durationSeconds + 0.01) errors.push(`${source.title} extends beyond its source audio.`);
  });
  sorted.slice(1).forEach((source, index) => {
    if (source.timelineStartSeconds < endOf(sorted[index]) - 0.01) errors.push("Source clips cannot overlap.");
  });
  const bridgeKeys = new Set<string>();
  transitions.forEach((transition) => {
    const from = sorted.find((source) => source.id === transition.fromSourceClipId);
    const to = transition.toSourceClipId ? sorted.find((source) => source.id === transition.toSourceClipId) : undefined;
    if (!from || transition.endSeconds <= transition.startSeconds) {
      errors.push("Every transition needs a positive range.");
      return;
    }
    if (!Number.isFinite(transition.repaintStrength) || transition.repaintStrength < 0 || transition.repaintStrength > 1) {
      errors.push("Repaint strength must stay between 0 and 1.");
    }
    if (!Number.isFinite(transition.crossfadeSeconds) || transition.crossfadeSeconds < 0 || transition.crossfadeSeconds > MAX_CROSSFADE_SECONDS) {
      errors.push(`Crossfade must stay between 0 and ${MAX_CROSSFADE_SECONDS} seconds.`);
    }
    if (transition.startSeconds < from.timelineStartSeconds || transition.startSeconds >= endOf(from)) errors.push("A transition must start inside its source clip.");
    if (transition.kind === "bridge") {
      const fromIndex = sorted.findIndex((source) => source.id === from.id);
      if (!to || sorted[fromIndex + 1]?.id !== to.id) errors.push("Each bridge must connect adjacent source clips.");
      if (to && (transition.endSeconds < to.timelineStartSeconds || transition.endSeconds > endOf(to))) errors.push("A bridge must end inside its destination clip.");
      const key = `${from.id}->${to?.id ?? "missing"}`;
      if (bridgeKeys.has(key)) errors.push("Each source boundary can have only one bridge.");
      bridgeKeys.add(key);
    } else if (from.id !== sorted.at(-1)?.id || transition.endSeconds <= endOf(from)) {
      errors.push("An extension must continue after the final source clip.");
    }
  });
  for (let index = 0; index < sorted.length - 1; index += 1) {
    if (!bridgeKeys.has(`${sorted[index].id}->${sorted[index + 1].id}`)) errors.push("Every source boundary needs a transition.");
  }
  if (transitions.filter((transition) => transition.kind === "extension").length > 1) errors.push("Only one final extension is allowed.");
  return [...new Set(errors)];
}

export function TransitionWorkspace({ choices, inferenceSteps, guidanceScale, busy, uploadBusy, uploadError, onUpload, onChange }: Props): JSX.Element {
  const [sources, setSources] = useState<SourceClipDraft[]>([]);
  const [transitions, setTransitions] = useState<TransitionClipDraft[]>([]);
  const [choiceId, setChoiceId] = useState(choices[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState("");
  const [cursorSeconds, setCursorSeconds] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [resolvingSource, setResolvingSource] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const timelineViewportRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAnimationRef = useRef<number | null>(null);
  const previewLoadHandlerRef = useRef<(() => void) | null>(null);
  const previewScheduleRef = useRef<PreviewSchedule | null>(null);
  const previewSourceIdRef = useRef<string | null>(null);
  const previewPlayingRef = useRef(false);
  const latestSourcesRef = useRef<SourceClipDraft[]>([]);
  const latestTransitionsRef = useRef<TransitionClipDraft[]>([]);
  const latestTimelineEndRef = useRef(30);
  const latestCursorRef = useRef(0);
  const dragRef = useRef<{ kind: "source" | "transition" | "blend"; id: string; edge?: "start" | "end"; startX: number; startScrollLeft: number; initial: SourceClipDraft | TransitionClipDraft } | null>(null);

  const sortedSources = useMemo(() => [...sources].sort((a, b) => a.timelineStartSeconds - b.timelineStartSeconds), [sources]);
  const timelineEnd = Math.min(MAX_SECONDS, Math.max(30, ...sources.map(endOf), ...transitions.map((transition) => transition.endSeconds + transition.crossfadeSeconds)));
  const errors = useMemo(() => validate(sources, transitions), [sources, transitions]);

  latestSourcesRef.current = sortedSources;
  latestTransitionsRef.current = transitions;
  latestTimelineEndRef.current = timelineEnd;
  latestCursorRef.current = cursorSeconds;

  const maxCrossfadeSecondsFor = (transition: TransitionClipDraft): number => {
    const from = sortedSources.find((source) => source.id === transition.fromSourceClipId);
    const to = transition.toSourceClipId ? sortedSources.find((source) => source.id === transition.toSourceClipId) : undefined;
    const before = from ? Math.max(0, transition.startSeconds - from.timelineStartSeconds) : MAX_CROSSFADE_SECONDS;
    const after = transition.kind === "bridge" && to ? Math.max(0, endOf(to) - transition.endSeconds) : MAX_CROSSFADE_SECONDS;
    return Math.min(MAX_CROSSFADE_SECONDS, before, after);
  };

  function snapTargets(activeKind: "source" | "transition", activeId: string): number[] {
    const targets = [latestCursorRef.current];
    latestSourcesRef.current.forEach((source) => {
      if (activeKind === "source" && source.id === activeId) return;
      targets.push(source.timelineStartSeconds, endOf(source));
    });
    latestTransitionsRef.current.forEach((transition) => {
      if (activeKind === "transition" && transition.id === activeId) return;
      targets.push(transition.startSeconds, transition.endSeconds);
    });
    return targets.filter((target) => Number.isFinite(target));
  }

  function snapPosition(value: number, targets: number[]): number {
    let closest = value;
    let closestDistance = SNAP_THRESHOLD_SECONDS;
    targets.forEach((target) => {
      const distance = Math.abs(target - value);
      if (distance < closestDistance) {
        closest = target;
        closestDistance = distance;
      }
    });
    return closest;
  }

  function snapRange(start: number, end: number, targets: number[]): { start: number; end: number } {
    let offset = 0;
    let closestDistance = SNAP_THRESHOLD_SECONDS;
    targets.forEach((target) => {
      [target - start, target - end].forEach((candidate) => {
        const distance = Math.abs(candidate);
        if (distance < closestDistance) {
          offset = candidate;
          closestDistance = distance;
        }
      });
    });
    return { start: start + offset, end: end + offset };
  }

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!drag || !rect || rect.width <= 0) return;
      const viewport = timelineViewportRef.current;
      if (viewport) {
        const viewportRect = viewport.getBoundingClientRect();
        const edgeDistance = 32;
        if (event.clientX < viewportRect.left + edgeDistance) {
          viewport.scrollLeft = Math.max(0, viewport.scrollLeft - 18);
        } else if (event.clientX > viewportRect.right - edgeDistance) {
          viewport.scrollLeft = Math.min(viewport.scrollWidth - viewport.clientWidth, viewport.scrollLeft + 18);
        }
      }
      const scrollDelta = viewport ? viewport.scrollLeft - drag.startScrollLeft : 0;
      const delta = ((event.clientX - drag.startX + scrollDelta) / rect.width) * timelineEnd;
      if (drag.kind === "source") {
        const initial = drag.initial as SourceClipDraft;
        const targets = snapTargets("source", drag.id);
        setSources((current) => current.map((source) => {
          if (source.id !== drag.id) return source;
          if (!drag.edge) {
            const length = durationOf(initial);
            const rawStart = Math.max(0, Math.min(MAX_SECONDS - length, initial.timelineStartSeconds + delta));
            const snapped = snapRange(rawStart, rawStart + length, targets);
            return { ...source, timelineStartSeconds: roundSeconds(Math.max(0, Math.min(MAX_SECONDS - length, snapped.start))) };
          }
          if (drag.edge === "start") {
            const rawSourceStart = Math.max(0, Math.min(initial.sourceEndSeconds - 0.25, initial.sourceStartSeconds + delta));
            const rawTimelineStart = initial.timelineStartSeconds + (rawSourceStart - initial.sourceStartSeconds);
            const snappedTimelineStart = snapPosition(rawTimelineStart, targets);
            const nextStart = Math.max(0, Math.min(initial.sourceEndSeconds - 0.25, initial.sourceStartSeconds + (snappedTimelineStart - initial.timelineStartSeconds)));
            return { ...source, timelineStartSeconds: roundSeconds(initial.timelineStartSeconds + (nextStart - initial.sourceStartSeconds)), sourceStartSeconds: roundSeconds(nextStart) };
          }
          const maximumSourceEnd = Math.min(Number(initial.input.durationSeconds ?? MAX_SECONDS), MAX_SECONDS - initial.timelineStartSeconds + initial.sourceStartSeconds);
          const rawSourceEnd = Math.max(initial.sourceStartSeconds + 0.25, Math.min(initial.sourceEndSeconds + delta, maximumSourceEnd));
          const rawTimelineEnd = initial.timelineStartSeconds + (rawSourceEnd - initial.sourceStartSeconds);
          const snappedTimelineEnd = snapPosition(rawTimelineEnd, targets);
          const nextEnd = Math.max(initial.sourceStartSeconds + 0.25, Math.min(maximumSourceEnd, initial.sourceStartSeconds + (snappedTimelineEnd - initial.timelineStartSeconds)));
          return { ...source, sourceEndSeconds: roundSeconds(nextEnd) };
        }));
      } else if (drag.kind === "transition") {
        const initial = drag.initial as TransitionClipDraft;
        const targets = snapTargets("transition", drag.id);
        setTransitions((current) => current.map((transition) => {
          if (transition.id !== drag.id) return transition;
          if (!drag.edge) {
            const length = initial.endSeconds - initial.startSeconds;
            const rawStart = Math.max(0, Math.min(MAX_SECONDS - length, initial.startSeconds + delta));
            const snapped = snapRange(rawStart, rawStart + length, targets);
            const start = Math.max(0, Math.min(MAX_SECONDS - length, snapped.start));
            return { ...transition, startSeconds: roundSeconds(start), endSeconds: roundSeconds(start + length) };
          }
          if (drag.edge === "start") {
            const rawStart = Math.max(0, Math.min(initial.endSeconds - 0.25, initial.startSeconds + delta));
            return { ...transition, startSeconds: roundSeconds(Math.max(0, Math.min(initial.endSeconds - 0.25, snapPosition(rawStart, targets)))) };
          }
          const rawEnd = Math.min(MAX_SECONDS, Math.max(initial.startSeconds + 0.25, initial.endSeconds + delta));
          return { ...transition, endSeconds: roundSeconds(Math.min(MAX_SECONDS, Math.max(initial.startSeconds + 0.25, snapPosition(rawEnd, targets)))) };
        }));
      } else {
        const initial = drag.initial as TransitionClipDraft;
        const adjustment = drag.edge === "start" ? -delta : delta;
        setTransitions((current) => current.map((transition) => {
          if (transition.id !== drag.id) return transition;
          const requested = clamp(initial.crossfadeSeconds + adjustment, 0, MAX_CROSSFADE_SECONDS);
          return { ...transition, crossfadeSeconds: roundSeconds(Math.min(requested, maxCrossfadeSecondsFor(transition))) };
        }));
      }
    };
    const stop = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
    return () => { window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", stop); };
  }, [timelineEnd]);

  useEffect(() => {
    onChange({
      inputs: sources.map((source) => ({ ...source.input, id: source.inputId, role: "transition_source" })),
      plan: {
        schemaVersion: 1,
        sourceClips: sources.map(({ id, inputId, timelineStartSeconds, sourceStartSeconds, sourceEndSeconds }) => ({ id, inputId, timelineStartSeconds, sourceStartSeconds, sourceEndSeconds })),
        transitionClips: transitions,
        inferenceSteps,
        guidanceScale,
      },
      valid: errors.length === 0,
      errors,
    });
  }, [errors, guidanceScale, inferenceSteps, onChange, sources, transitions]);

  useEffect(() => {
    if (choiceId && !choices.some((choice) => choice.id === choiceId)) setChoiceId(choices[0]?.id ?? "");
    if (!choiceId && choices[0]) setChoiceId(choices[0].id);
  }, [choiceId, choices]);

  const addSource = async (uploadedChoice?: TransitionAudioChoice) => {
    const choice = uploadedChoice ?? choices.find((item) => item.id === choiceId);
    if (!choice) {
      setSourceError("Choose an audio asset before adding a source clip.");
      return;
    }
    let duration = choice.input.durationSeconds;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
      if (!choice.input.sourceUrl) {
        setSourceError("This audio asset has no readable duration and cannot be added.");
        return;
      }
      setResolvingSource(true);
      duration = await readRemoteAudioDuration(choice.input.sourceUrl);
      setResolvingSource(false);
    }
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
      setSourceError("This audio asset has no readable duration and cannot be added.");
      return;
    }
    setSourceError("");
    const sourceInput = choice.input.durationSeconds === duration ? choice.input : { ...choice.input, durationSeconds: duration };
    const id = `source-${Date.now().toString(36)}-${sources.length}`;
    const inputId = `transition-input-${id}`;
    const timelineStartSeconds = roundSeconds(Math.min(MAX_SECONDS - Math.min(duration, MAX_SECONDS), Math.max(0, ...sources.map(endOf))));
    const source: SourceClipDraft = { id, inputId, title: choice.title, input: sourceInput, timelineStartSeconds, sourceStartSeconds: 0, sourceEndSeconds: Math.min(duration, MAX_SECONDS - timelineStartSeconds) };
    const nextSources = [...sources, source];
    setSources(nextSources);
    setTransitions((current) => ensureBridges(nextSources, current));
    setSelectedId(id);
  };

  const handleUpload = async (file: File) => {
    setSourceError("");
    const uploadedChoice = await onUpload(file);
    if (uploadedChoice) addSource(uploadedChoice);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    if (!sources.some((source) => source.id === selectedId)) {
      setTransitions((current) => current.filter((transition) => transition.id !== selectedId));
      setSelectedId("");
      return;
    }
    const nextSources = sources.filter((source) => source.id !== selectedId);
    setSources(nextSources);
    setTransitions((current) => ensureBridges(nextSources, current.filter((transition) => transition.fromSourceClipId !== selectedId && transition.toSourceClipId !== selectedId)));
    setSelectedId("");
  };

  const splitSelected = () => {
    const source = sources.find((item) => item.id === selectedId);
    if (!source || cursorSeconds <= source.timelineStartSeconds + 0.1 || cursorSeconds >= endOf(source) - 0.1) return;
    const splitOffset = cursorSeconds - source.timelineStartSeconds;
    const splitSourceSeconds = source.sourceStartSeconds + splitOffset;
    const left: SourceClipDraft = { ...source, id: `${source.id}-a`, sourceEndSeconds: roundSeconds(splitSourceSeconds) };
    const right: SourceClipDraft = { ...source, id: `${source.id}-b`, inputId: `${source.inputId}-b`, timelineStartSeconds: roundSeconds(cursorSeconds), sourceStartSeconds: roundSeconds(splitSourceSeconds) };
    const nextSources = sources.flatMap((item) => item.id === source.id ? [left, right] : [item]);
    const nextTransitions = transitions.map((transition) => ({
      ...transition,
      fromSourceClipId: transition.fromSourceClipId === source.id ? right.id : transition.fromSourceClipId,
      toSourceClipId: transition.toSourceClipId === source.id ? left.id : transition.toSourceClipId,
    })).filter((transition) => !(transition.fromSourceClipId === left.id && transition.toSourceClipId === right.id));
    setSources(nextSources);
    setTransitions(ensureBridges(nextSources, nextTransitions));
    setSelectedId(left.id);
  };

  const addExtension = () => {
    const final = sortedSources.at(-1);
    if (!final || transitions.some((transition) => transition.kind === "extension")) return;
    const start = Math.max(final.timelineStartSeconds, endOf(final) - Math.min(DEFAULT_TRANSITION_SECONDS, Math.max(0.5, durationOf(final) / 2)));
    const end = Math.min(MAX_SECONDS, endOf(final) + DEFAULT_TRANSITION_SECONDS);
    setTransitions((current) => [...current, { id: `extension-${final.id}`, kind: "extension", fromSourceClipId: final.id, startSeconds: roundSeconds(start), endSeconds: roundSeconds(end), prompt: "Continue the final musical idea with a natural ending", repaintStrength: DEFAULT_REPAINT_STRENGTH, crossfadeSeconds: DEFAULT_CROSSFADE_SECONDS }]);
  };

  const beginDrag = (event: PointerEvent, kind: "source" | "transition" | "blend", id: string, initial: SourceClipDraft | TransitionClipDraft, edge?: "start" | "end") => {
    if (busy) return;
    event.stopPropagation();
    dragRef.current = { kind, id, edge, startX: event.clientX, startScrollLeft: timelineViewportRef.current?.scrollLeft ?? 0, initial };
    setSelectedId(id);
  };

  const setCursorFromEvent = (event: MouseEvent) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const nextSeconds = roundSeconds(Math.max(0, Math.min(MAX_SECONDS, ((event.clientX - rect.left) / rect.width) * timelineEnd)));
    latestCursorRef.current = nextSeconds;
    setCursorSeconds(nextSeconds);
    if (previewPlayingRef.current) startPreviewAt(nextSeconds);
  };

  const percent = (seconds: number) => `${Math.max(0, Math.min(100, seconds / timelineEnd * 100))}%`;

  function clearPreviewAnimation(): void {
    if (previewAnimationRef.current !== null) {
      window.cancelAnimationFrame(previewAnimationRef.current);
      previewAnimationRef.current = null;
    }
  }

  function cancelPreviewLoad(): void {
    const audio = previewAudioRef.current;
    if (audio && previewLoadHandlerRef.current) audio.removeEventListener("loadedmetadata", previewLoadHandlerRef.current);
    previewLoadHandlerRef.current = null;
  }

  function stopPreview(resetCursor = false): void {
    previewPlayingRef.current = false;
    clearPreviewAnimation();
    cancelPreviewLoad();
    previewScheduleRef.current = null;
    previewSourceIdRef.current = null;
    const audio = previewAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setPreviewPlaying(false);
    if (resetCursor) {
      latestCursorRef.current = 0;
      setCursorSeconds(0);
    }
  }

  function pausePreview(): void {
    previewPlayingRef.current = false;
    clearPreviewAnimation();
    cancelPreviewLoad();
    previewScheduleRef.current = null;
    previewAudioRef.current?.pause();
    setPreviewPlaying(false);
  }

  function previewSourceAt(position: number): SourceClipDraft | undefined {
    return latestSourcesRef.current.find((source) => position >= source.timelineStartSeconds && position < endOf(source) - 0.01);
  }

  function startPreviewClock(): void {
    clearPreviewAnimation();
    const tick = () => {
      previewAnimationRef.current = null;
      if (!previewPlayingRef.current) return;
      const schedule = previewScheduleRef.current;
      if (!schedule) return;

      if (schedule.kind === "gap") {
        const elapsed = (performance.now() - schedule.startedAt) / 1000;
        const position = Math.min(schedule.endSeconds, schedule.startSeconds + elapsed);
        latestCursorRef.current = position;
        setCursorSeconds(position);
        if (position >= schedule.endSeconds - 0.01) {
          startPreviewAt(schedule.endSeconds);
          return;
        }
      } else {
        const source = latestSourcesRef.current.find((item) => item.id === schedule.sourceId);
        const audio = previewAudioRef.current;
        if (!source || !audio) {
          startPreviewAt(latestCursorRef.current);
          return;
        }
        if (audio.readyState >= 1 && !audio.paused) {
          const position = source.timelineStartSeconds + (audio.currentTime - source.sourceStartSeconds);
          latestCursorRef.current = Math.max(source.timelineStartSeconds, Math.min(endOf(source), position));
          setCursorSeconds(latestCursorRef.current);
          if (audio.ended || audio.currentTime >= source.sourceEndSeconds - 0.025) {
            audio.pause();
            startPreviewAt(endOf(source));
            return;
          }
        }
      }

      previewAnimationRef.current = window.requestAnimationFrame(tick);
    };
    previewAnimationRef.current = window.requestAnimationFrame(tick);
  }

  function startPreviewAt(position: number): void {
    const limit = latestTimelineEndRef.current;
    const nextPosition = Math.max(0, Math.min(limit, position));
    latestCursorRef.current = nextPosition;
    setCursorSeconds(nextPosition);

    const source = previewSourceAt(nextPosition);
    const nextSource = latestSourcesRef.current.find((item) => item.timelineStartSeconds > nextPosition + 0.01);
    if (!source) {
      const gapEnd = nextSource?.timelineStartSeconds ?? limit;
      if (gapEnd <= nextPosition + 0.01) {
        stopPreview();
        latestCursorRef.current = gapEnd;
        setCursorSeconds(gapEnd);
        return;
      }
      cancelPreviewLoad();
      previewAudioRef.current?.pause();
      previewSourceIdRef.current = null;
      previewScheduleRef.current = { kind: "gap", startSeconds: nextPosition, endSeconds: gapEnd, startedAt: performance.now() };
      startPreviewClock();
      return;
    }

    const audio = previewAudioRef.current;
    if (!audio || !source.input.sourceUrl) {
      setPreviewError("This source cannot be previewed.");
      pausePreview();
      return;
    }

    setPreviewError("");
    const sourceTime = source.sourceStartSeconds + Math.max(0, nextPosition - source.timelineStartSeconds);
    const sameSource = previewSourceIdRef.current === source.id && audio.src === source.input.sourceUrl && audio.readyState >= 1;
    previewSourceIdRef.current = source.id;
    previewScheduleRef.current = { kind: "clip", sourceId: source.id };

    const seekAndPlay = () => {
      previewLoadHandlerRef.current = null;
      if (!previewPlayingRef.current) return;
      try {
        audio.currentTime = Math.max(source.sourceStartSeconds, Math.min(source.sourceEndSeconds - 0.01, sourceTime));
      } catch {
        setPreviewError("This source could not be positioned for preview.");
        pausePreview();
        return;
      }
      void audio.play().then(() => startPreviewClock()).catch(() => {
        setPreviewError("This source could not be played.");
        pausePreview();
      });
      startPreviewClock();
    };

    cancelPreviewLoad();
    if (sameSource) {
      seekAndPlay();
      return;
    }

    audio.pause();
    audio.src = source.input.sourceUrl;
    audio.load();
    previewLoadHandlerRef.current = seekAndPlay;
    audio.addEventListener("loadedmetadata", seekAndPlay, { once: true });
    if (audio.readyState >= 1) seekAndPlay();
    startPreviewClock();
  }

  function togglePreview(): void {
    if (previewPlayingRef.current) {
      pausePreview();
      return;
    }
    if (!latestSourcesRef.current.length) return;
    previewPlayingRef.current = true;
    setPreviewPlaying(true);
    setPreviewError("");
    startPreviewAt(latestCursorRef.current);
  }

  useEffect(() => {
    if (collapsed || busy) pausePreview();
  }, [busy, collapsed]);

  useEffect(() => () => {
    previewPlayingRef.current = false;
    clearPreviewAnimation();
    cancelPreviewLoad();
    previewAudioRef.current?.pause();
  }, []);

  return <section className="dance-station-transition-workspace">
    <div className="dance-station-transition-toolbar">
      <div><strong>Transition arrangement</strong><small>{sources.length < 2 ? "Add two or more source clips to begin." : "Place a bridge over every boundary, then add prompts for each stage."}</small></div>
      <div className="dance-station-transition-actions">
        <select value={choiceId} onChange={(event) => setChoiceId((event.currentTarget as HTMLSelectElement).value)} disabled={busy || choices.length === 0} aria-label="Source audio to add">
          <option value="">{choices.length ? "Select source audio" : "No audio assets available"}</option>
          {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.title}</option>)}
        </select>
        <button type="button" className="dance-station-inline-button" onClick={() => void addSource()} disabled={busy || resolvingSource || !choiceId}><Plus size={13} aria-hidden="true" /> {resolvingSource ? "Reading..." : "Add source"}</button>
        <input id="dance-station-transition-source-file" className="dance-station-source-file-input" type="file" accept="audio/*" onChange={(event) => { const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0]; input.value = ""; if (file) void handleUpload(file); }} disabled={busy || uploadBusy} />
        <label className="dance-station-inline-button" htmlFor="dance-station-transition-source-file"><Upload size={13} aria-hidden="true" /> {uploadBusy ? "Uploading..." : "Upload source"}</label>
        <button type="button" className="dance-station-inline-button" onClick={splitSelected} disabled={busy || !selectedId}><Scissors size={13} aria-hidden="true" /> Split</button>
        <button type="button" className="dance-station-inline-button" onClick={removeSelected} disabled={busy || !selectedId}><Trash2 size={13} aria-hidden="true" /> Remove</button>
        <button type="button" className="dance-station-inline-button" onClick={() => setTransitions((current) => ensureBridges(sources, current))} disabled={busy || sources.length < 2}><Sparkles size={13} aria-hidden="true" /> Add bridges</button>
        <button type="button" className="dance-station-inline-button" onClick={addExtension} disabled={busy || sortedSources.length < 2 || transitions.some((transition) => transition.kind === "extension")}><Plus size={13} aria-hidden="true" /> End extension</button>
        <button type="button" className="dance-station-inline-button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={collapsed ? "Expand transition arrangement" : "Collapse transition arrangement"}>{collapsed ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}</button>
      </div>
    </div>
    {!collapsed ? <>
      {sourceError || uploadError ? <p className="dance-station-error dance-station-transition-source-error" role="alert">{sourceError || uploadError}</p> : null}
      <div className={`dance-station-transition-validation${errors.length ? " is-invalid" : " is-valid"}`} role="status">
        {errors.length ? <><X size={14} aria-hidden="true" /><span>{errors[0]}{errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}</span></> : <><Check size={14} aria-hidden="true" /><span>Ready for generation.</span></>}
      </div>
      <div className="dance-station-transition-timeline-frame">
        <button type="button" className={`dance-station-transition-preview-button${previewPlaying ? " is-playing" : ""}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); togglePreview(); }} disabled={busy || !sources.length} title={previewPlaying ? "Pause arrangement preview" : "Play arrangement preview"} aria-label={previewPlaying ? "Pause arrangement preview" : "Play arrangement preview"}>
          {previewPlaying ? <Pause size={14} strokeWidth={2.3} aria-hidden="true" /> : <Play size={14} strokeWidth={2.3} aria-hidden="true" />}
        </button>
        <div ref={timelineViewportRef} className="dance-station-transition-timeline-scroll">
          <div ref={timelineRef} className="dance-station-transition-timeline" style={{ width: `${Math.max(780, timelineEnd * TIMELINE_PIXELS_PER_SECOND)}px` }} onClick={setCursorFromEvent}>
          <div className="dance-station-transition-ruler">
            {previewError ? <span className="dance-station-transition-preview-status" role="status">{previewError}</span> : null}
            {[0, 60, 120, 180, 240, 300, 360].filter((second) => second <= timelineEnd).map((second) => <span key={second} className={second === 0 ? "is-origin" : ""} style={{ left: percent(second) }}>{Math.floor(second / 60)}:{String(second % 60).padStart(2, "0")}</span>)}
          </div>
          <div className="dance-station-transition-cursor" style={{ left: percent(cursorSeconds) }} aria-label={`Cursor at ${formatTimelineTime(cursorSeconds)}`}>
            <span className="dance-station-transition-cursor-time" style={{ transform: cursorSeconds < 8 ? "translateX(0)" : cursorSeconds > timelineEnd - 8 ? "translateX(-100%)" : "translateX(-50%)" }}>{formatTimelineTime(cursorSeconds)}</span>
          </div>
          <div className="dance-station-transition-row"><div className="dance-station-transition-track"><span className="dance-station-transition-track-label">Source</span>{sortedSources.map((source) => <div key={source.id} className={`dance-station-transition-clip source${selectedId === source.id ? " is-selected" : ""}`} style={{ left: percent(source.timelineStartSeconds), width: percent(durationOf(source)) }} title={`${source.title} · ${formatSeconds(durationOf(source))}`} aria-label={`${source.title}, ${formatSeconds(durationOf(source))}`} onPointerDown={(event) => beginDrag(event, "source", source.id, source)}>
          <button type="button" className="transition-clip-handle left" aria-label={`Trim start of ${source.title}`} onPointerDown={(event) => beginDrag(event, "source", source.id, source, "start")} />
          <span>{source.title}</span><small>{formatSeconds(durationOf(source))}</small>
          <button type="button" className="transition-clip-handle right" aria-label={`Trim end of ${source.title}`} onPointerDown={(event) => beginDrag(event, "source", source.id, source, "end")} />
        </div>)}</div></div>
           <div className="dance-station-transition-row"><div className="dance-station-transition-track"><span className="dance-station-transition-track-label">Transition</span>{transitions.map((transition) => {
             const blendStart = Math.max(0, transition.startSeconds - transition.crossfadeSeconds);
             const blendEnd = Math.min(MAX_SECONDS, transition.endSeconds + transition.crossfadeSeconds);
             return <div key={transition.id} className="dance-station-transition-layer">
               <span className="transition-blend-window" style={{ left: percent(blendStart), width: percent(blendEnd - blendStart) }} aria-hidden="true" />
               <button type="button" className={`transition-blend-handle left${selectedId === transition.id ? " is-selected" : ""}`} style={{ left: percent(blendStart) }} aria-label={`Adjust ${transition.kind === "extension" ? "extension" : "bridge"} crossfade`} title={`Crossfade ${formatSeconds(transition.crossfadeSeconds)}`} onPointerDown={(event) => beginDrag(event, "blend", transition.id, transition, "start")} />
               <button type="button" className={`transition-blend-handle right${selectedId === transition.id ? " is-selected" : ""}`} style={{ left: percent(blendEnd) }} aria-label={`Adjust ${transition.kind === "extension" ? "extension" : "bridge"} crossfade`} title={`Crossfade ${formatSeconds(transition.crossfadeSeconds)}`} onPointerDown={(event) => beginDrag(event, "blend", transition.id, transition, "end")} />
               <div className={`dance-station-transition-clip transition${selectedId === transition.id ? " is-selected" : ""}`} style={{ left: percent(transition.startSeconds), width: percent(transition.endSeconds - transition.startSeconds) }} title={`${transition.kind === "extension" ? "End extension" : "Bridge"} · ${formatSeconds(transition.endSeconds - transition.startSeconds)} · Crossfade ${formatSeconds(transition.crossfadeSeconds)}`} aria-label={`${transition.kind === "extension" ? "End extension" : "Bridge"}, ${formatSeconds(transition.endSeconds - transition.startSeconds)}, crossfade ${formatSeconds(transition.crossfadeSeconds)}`} onPointerDown={(event) => beginDrag(event, "transition", transition.id, transition)}>
                 <button type="button" className="transition-clip-handle left" aria-label="Trim transition start" onPointerDown={(event) => beginDrag(event, "transition", transition.id, transition, "start")} /><span>{transition.kind === "extension" ? "End" : "Bridge"}</span><small>{formatSeconds(transition.endSeconds - transition.startSeconds)} · CF {formatSeconds(transition.crossfadeSeconds)}</small><button type="button" className="transition-clip-handle right" aria-label="Trim transition end" onPointerDown={(event) => beginDrag(event, "transition", transition.id, transition, "end")} />
               </div>
             </div>;
           })}</div></div>
          </div>
        </div>
      </div>
      <div className="dance-station-transition-details">
         {transitions.map((transition, index) => <div key={transition.id} className="dance-station-transition-detail-card">
           <label><span>{transition.kind === "extension" ? "Final extension prompt" : `Bridge ${transitions.slice(0, index + 1).filter((item) => item.kind === "bridge").length} prompt`}</span><textarea rows={2} value={transition.prompt} onInput={(event) => setTransitions((current) => current.map((item) => item.id === transition.id ? { ...item, prompt: (event.currentTarget as HTMLTextAreaElement).value } : item))} disabled={busy} /></label>
           <div className="dance-station-transition-detail-controls">
             <label><span>Repaint strength <output>{transition.repaintStrength.toFixed(2)}</output></span><input type="range" min="0" max="1" step="0.05" value={transition.repaintStrength} onInput={(event) => setTransitions((current) => current.map((item) => item.id === transition.id ? { ...item, repaintStrength: Number((event.currentTarget as HTMLInputElement).value) } : item))} disabled={busy} /></label>
             <span className="dance-station-transition-crossfade-value">Crossfade {formatSeconds(transition.crossfadeSeconds)}</span>
           </div>
         </div>)}
      </div>
    </> : null}
    <audio ref={previewAudioRef} className="dance-station-transition-preview-audio" preload="metadata" aria-hidden="true" onError={() => {
      if (!previewPlayingRef.current) return;
      setPreviewError("This source could not be previewed.");
      pausePreview();
    }} />
  </section>;
}

function formatSeconds(value: number): string {
  return `${Math.max(0, value).toFixed(2)}s`;
}

function formatTimelineTime(value: number): string {
  const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
  const minutes = Math.floor(safeValue / 60);
  const seconds = (safeValue - minutes * 60).toFixed(3).padStart(6, "0");
  return `${minutes}:${seconds}`;
}
