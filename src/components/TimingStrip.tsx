"use client";

import {
  durationBetween,
  formatClinicalTime,
  formatDurationMs,
  type TimingStamp,
} from "@/lib/time";
import styles from "./TimingStrip.module.css";

type Props = {
  timing?: TimingStamp | null;
  /** Compact single-line for chips */
  compact?: boolean;
  className?: string;
};

export function TimingStrip({ timing, compact, className }: Props) {
  if (!timing?.startIso) return null;

  const duration =
    timing.durationMs ??
    durationBetween(timing.startIso, timing.endIso) ??
    null;

  if (compact) {
    return (
      <div className={`${styles.compact} ${className || ""}`}>
        <span title={formatClinicalTime(timing.startIso)}>
          ▶ {formatClinicalTime(timing.startIso)}
        </span>
        {timing.endIso && (
          <span title={formatClinicalTime(timing.endIso)}>
            ■ {formatClinicalTime(timing.endIso)}
          </span>
        )}
        <span className={styles.dur}>{formatDurationMs(duration)}</span>
      </div>
    );
  }

  return (
    <div className={`${styles.panel} ${className || ""}`}>
      <div className={styles.row}>
        <span className={styles.key}>Start</span>
        <span className={styles.val}>{formatClinicalTime(timing.startIso)}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.key}>Finish</span>
        <span className={styles.val}>
          {timing.endIso ? formatClinicalTime(timing.endIso) : "— (in progress)"}
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.key}>Duration</span>
        <span className={styles.val}>{formatDurationMs(duration)}</span>
      </div>
      {(timing.ttftMs != null || timing.answerTtftMs != null) && (
        <div className={styles.row}>
          <span className={styles.key}>TTFT</span>
          <span className={styles.val}>
            {formatDurationMs(timing.ttftMs)}
            {timing.answerTtftMs != null
              ? ` · answer ${formatDurationMs(timing.answerTtftMs)}`
              : ""}
          </span>
        </div>
      )}
    </div>
  );
}

type CompareProps = {
  a?: TimingStamp | null;
  b?: TimingStamp | null;
  aLabel?: string;
  bLabel?: string;
};

/** Side-by-side clinical timing for A/B. */
export function TimingCompare({ a, b, aLabel = "A", bLabel = "B" }: CompareProps) {
  if (!a?.startIso && !b?.startIso) return null;

  const durA =
    a?.durationMs ?? durationBetween(a?.startIso, a?.endIso) ?? null;
  const durB =
    b?.durationMs ?? durationBetween(b?.startIso, b?.endIso) ?? null;
  let deltaNote = "";
  if (durA != null && durB != null) {
    const d = durA - durB;
    if (Math.abs(d) < 5) deltaNote = "≈ same wall time";
    else if (d < 0)
      deltaNote = `${aLabel} faster by ${formatDurationMs(Math.abs(d))}`;
    else deltaNote = `${bLabel} faster by ${formatDurationMs(d)}`;
  }

  return (
    <div className={styles.compare}>
      <div className={styles.compareTitle}>Clinical timing comparison</div>
      <div className={styles.compareGrid}>
        <div>
          <div className={styles.compareHead}>{aLabel}</div>
          <TimingStrip timing={a} />
        </div>
        <div>
          <div className={styles.compareHead}>{bLabel}</div>
          <TimingStrip timing={b} />
        </div>
      </div>
      {deltaNote && <div className={styles.delta}>{deltaNote}</div>}
    </div>
  );
}
