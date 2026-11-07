'use client';

/**
 * Inspector (Studio v3) — the right pane, Logic's Inspector: what is selected,
 * in detail, always in the same place.
 *
 *  • Region — the primary selected region: a MIDI region's name, position,
 *    length, loop count, note count and transpose; an audio region's name,
 *    clip gain, fades and file span.
 *  • Track — the selected track's name, colour, kind, instrument, volume,
 *    pan, mute / solo / arm, and the insert FX (3-band EQ, compressor,
 *    reverb send) that the Mixer edits with knobs.
 *  • Project — tempo, time signature, scale lock, master level, size.
 *
 * Every control edits the plain project through onUpdate / onCommit, so the
 * Inspector, the Mixer and the arrangement can never disagree.
 */

import {
  COMP_RATIO_MAX,
  COMP_RATIO_MIN,
  COMP_THRESHOLD_MAX_DB,
  COMP_THRESHOLD_MIN_DB,
  EQ_MAX_DB,
  EQ_MIN_DB,
  GAIN_MAX,
  formatDb,
  formatPan,
} from '@/lib/daw/fx';
import {
  findRegion,
  moveNotes,
  regionName,
  renameRegion,
  renameTrack,
  setTrackColor,
  TRACK_COLORS,
  trackColor,
  type RegionRef,
} from '@/lib/daw/editOps';
import { PENTATONIC_MODES, ROOT_NAMES } from '@/lib/daw/scales';
import {
  INSTRUMENT_LABELS,
  projectEndBeat,
  trackFx,
  trackKind,
  type DawProject,
  type InstrumentId,
  type TrackFx,
} from '@/lib/daw/types';
import type { CommitFn, UpdateFn } from './DawApp';

const INSTRUMENTS: readonly InstrumentId[] = ['oud', 'durbaan', 'bass', 'keys'];

export function Inspector({
  project,
  selection,
  selectedTrackId,
  onUpdate,
  onCommit,
  onOpenMixer,
  onClose,
}: {
  project: DawProject;
  selection: readonly RegionRef[];
  selectedTrackId: string | null;
  onUpdate: UpdateFn;
  onCommit: CommitFn;
  onOpenMixer: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const primary = selection[selection.length - 1] ?? null;
  const found = primary ? findRegion(project, primary) : null;
  const trackIndex = project.tracks.findIndex((t) => t.id === selectedTrackId);
  const track = trackIndex >= 0 ? project.tracks[trackIndex] : undefined;
  const beatsPerBar = project.timeSignature.beatsPerBar;
  const secPerBeat = 60 / project.bpm;

  return (
    <aside
      aria-label="Inspector"
      className="flex h-full w-full flex-col border-l border-hairline bg-chrome-1 md:w-(--studio-inspector-rail)"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-hairline px-3">
        <h2 className="numeric text-[10px] tracking-[0.16em] text-accent-state uppercase">
          Inspector
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the inspector"
          className="h-7 w-7 rounded-[3px] text-sm text-low hover:bg-chrome-2 hover:text-hi"
        >
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {/* ── Region ─────────────────────────────────────────────────────── */}
        <Section title="Region">
          {found && primary ? (
            found.region.kind === 'midi' ? (
              <>
                <Field label="Name">
                  <TextInput
                    key={found.region.id}
                    value={regionName(found.region, found.track.name)}
                    maxLength={80}
                    onCommit={(name) => onCommit(renameRegion(project, primary, name))}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Readout
                    label="Position"
                    value={`${Math.floor(found.region.startBeat / beatsPerBar) + 1}.${
                      Math.floor(found.region.startBeat % beatsPerBar) + 1
                    }`}
                  />
                  <Readout label="Notes" value={String(found.region.notes.length)} />
                </div>
                <Field label={`Length ${found.region.lengthBeats} beats`}>
                  <input
                    type="range"
                    min={0.25}
                    max={Math.max(found.region.lengthBeats, beatsPerBar * 8)}
                    step={0.25}
                    value={found.region.lengthBeats}
                    aria-label="Region length in beats"
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      onUpdate((draft) => {
                        const f = findRegion(draft, primary);
                        if (f?.region.kind === 'midi') f.region.lengthBeats = Math.max(0.25, v);
                      }, `len:${primary.regionId}`);
                    }}
                    className="w-full accent-(--accent-state)"
                  />
                </Field>
                <Field label={`Loop ×${found.region.loopCount}`}>
                  <div className="flex gap-1">
                    <SmallButton
                      label="−"
                      aria="One loop pass fewer"
                      onClick={() =>
                        onUpdate((draft) => {
                          const f = findRegion(draft, primary);
                          if (f) f.region.loopCount = Math.max(1, f.region.loopCount - 1);
                        })
                      }
                    />
                    <SmallButton
                      label="+"
                      aria="One loop pass more"
                      onClick={() =>
                        onUpdate((draft) => {
                          const f = findRegion(draft, primary);
                          if (f) f.region.loopCount += 1;
                        })
                      }
                    />
                  </div>
                </Field>
                <Field label="Transpose">
                  <div className="flex gap-1">
                    {[
                      { d: -12, l: '−8ve' },
                      { d: -1, l: '−1' },
                      { d: 1, l: '+1' },
                      { d: 12, l: '+8ve' },
                    ].map(({ d, l }) => (
                      <SmallButton
                        key={d}
                        label={l}
                        aria={`Transpose region ${l}`}
                        onClick={() => {
                          const f = findRegion(project, primary);
                          if (!f || f.region.kind !== 'midi') return;
                          const ids = f.region.notes.map((n) => n.id);
                          if (ids.length === 0) return;
                          onCommit(
                            moveNotes(project, primary, ids, 0, d),
                            `transpose:${primary.regionId}`,
                          );
                        }}
                      />
                    ))}
                  </div>
                </Field>
              </>
            ) : (
              <>
                <Field label="Name">
                  <TextInput
                    key={found.region.id}
                    value={found.region.name}
                    maxLength={80}
                    onCommit={(name) =>
                      onUpdate((draft) => {
                        const f = findRegion(draft, primary);
                        if (f?.region.kind === 'audio') f.region.name = name;
                      })
                    }
                  />
                </Field>
                <Field
                  label={`Clip gain ${(20 * Math.log10(Math.max(0.001, found.region.gain))).toFixed(1)} dB`}
                >
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.01}
                    value={found.region.gain}
                    aria-label="Clip gain"
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      onUpdate((draft) => {
                        const f = findRegion(draft, primary);
                        if (f?.region.kind === 'audio') f.region.gain = v;
                      }, `gain:${primary.regionId}`);
                    }}
                    className="w-full accent-(--accent-state)"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  {(['fadeInSec', 'fadeOutSec'] as const).map((key) => (
                    <Field
                      key={key}
                      label={`${key === 'fadeInSec' ? 'Fade in' : 'Fade out'} ${found.region.kind === 'audio' ? found.region[key].toFixed(2) : '0'} s`}
                    >
                      <input
                        type="range"
                        min={0}
                        max={4}
                        step={0.01}
                        value={found.region.kind === 'audio' ? found.region[key] : 0}
                        aria-label={key === 'fadeInSec' ? 'Fade in' : 'Fade out'}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          onUpdate((draft) => {
                            const f = findRegion(draft, primary);
                            if (f?.region.kind === 'audio') f.region[key] = v;
                          }, `${key}:${primary.regionId}`);
                        }}
                        className="w-full accent-(--accent-state)"
                      />
                    </Field>
                  ))}
                </div>
                <p className="numeric text-[10px] leading-snug text-low">
                  starts {found.region.offsetSec.toFixed(2)} s into the file ·{' '}
                  {(found.region.lengthBeats * secPerBeat).toFixed(2)} s per pass · ×
                  {found.region.loopCount}
                </p>
                <p className="truncate text-[10px] text-low" title={found.region.source}>
                  {found.region.source.startsWith('idb:')
                    ? 'Stored in this browser'
                    : found.region.source}
                </p>
              </>
            )
          ) : (
            <p className="text-[11px] leading-snug text-low">
              Select a region in the tracks area to see and edit it here.
            </p>
          )}
        </Section>

        {/* ── Track ──────────────────────────────────────────────────────── */}
        <Section title="Track">
          {track ? (
            <>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-7 w-1.5 shrink-0 rounded-[2px]"
                  style={{ background: trackColor(track, trackIndex) }}
                />
                <TextInput
                  key={track.id}
                  value={track.name}
                  maxLength={40}
                  onCommit={(name) => onCommit(renameTrack(project, track.id, name))}
                />
                <span className="numeric shrink-0 rounded-[3px] border border-hairline px-1.5 py-0.5 text-[9px] tracking-[0.12em] text-low uppercase">
                  {trackKind(track) === 'audio' ? 'Audio' : 'MIDI'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Track colour">
                {TRACK_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Colour ${c}`}
                    onClick={() => onCommit(setTrackColor(project, track.id, c))}
                    className={`h-4 w-4 rounded-[2px] border ${
                      c === trackColor(track, trackIndex) ? 'border-hi' : 'border-transparent'
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
              {trackKind(track) === 'midi' ? (
                <Field label="Instrument">
                  <select
                    value={track.instrument}
                    aria-label="Instrument"
                    onChange={(e) => {
                      const instrument = INSTRUMENTS.find((i) => i === e.target.value);
                      if (!instrument) return;
                      onUpdate((draft) => {
                        const t = draft.tracks.find((x) => x.id === track.id);
                        if (t) t.instrument = instrument;
                      });
                    }}
                    className="numeric h-8 w-full rounded-[3px] border border-hairline bg-chrome-2 px-1 text-[11px] text-hi outline-none focus:border-accent-state"
                  >
                    {INSTRUMENTS.map((i) => (
                      <option key={i} value={i}>
                        {INSTRUMENT_LABELS[i]}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Field label={`Volume ${formatDb(track.gain)}`}>
                  <input
                    type="range"
                    min={0}
                    max={GAIN_MAX}
                    step={0.01}
                    value={track.gain}
                    aria-label={`${track.name} volume`}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      onUpdate((draft) => {
                        const t = draft.tracks.find((x) => x.id === track.id);
                        if (t) t.gain = v;
                      }, `gain:${track.id}`);
                    }}
                    className="w-full accent-(--accent-state)"
                  />
                </Field>
                <Field label={`Pan ${formatPan(track.pan)}`}>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={track.pan}
                    aria-label={`${track.name} pan`}
                    onDoubleClick={() =>
                      onUpdate((draft) => {
                        const t = draft.tracks.find((x) => x.id === track.id);
                        if (t) t.pan = 0;
                      })
                    }
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      onUpdate((draft) => {
                        const t = draft.tracks.find((x) => x.id === track.id);
                        if (t) t.pan = v;
                      }, `pan:${track.id}`);
                    }}
                    className="w-full accent-(--accent-state)"
                  />
                </Field>
              </div>
              <div className="flex gap-1">
                {(
                  [
                    ['muted', 'M', 'Mute'],
                    ['solo', 'S', 'Solo'],
                    ['armed', '●', 'Record-arm'],
                  ] as const
                ).map(([key, label, aria]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={track[key]}
                    aria-label={`${aria} ${track.name}`}
                    onClick={() =>
                      onUpdate((draft) => {
                        const t = draft.tracks.find((x) => x.id === track.id);
                        if (t) t[key] = !t[key];
                      })
                    }
                    className={`numeric h-7 flex-1 rounded-[3px] border text-[10px] uppercase transition-colors ${
                      track[key]
                        ? key === 'armed'
                          ? 'border-danger bg-danger/20 text-danger'
                          : 'border-accent-state bg-accent-state/20 text-accent-state'
                        : 'border-hairline text-low hover:text-hi'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <FxFields
                fx={trackFx(track)}
                trackName={track.name}
                onEdit={(mutate, key) =>
                  onUpdate((draft) => {
                    const t = draft.tracks.find((x) => x.id === track.id);
                    if (!t) return;
                    const base = trackFx(t);
                    const next: TrackFx = {
                      eq: { ...base.eq },
                      comp: { ...base.comp },
                      reverbSend: base.reverbSend,
                    };
                    mutate(next);
                    t.fx = next;
                  }, key)
                }
              />
              <SmallButton label="Open in Mixer" aria="Open the mixer" onClick={onOpenMixer} wide />
            </>
          ) : (
            <p className="text-[11px] leading-snug text-low">Select a track header.</p>
          )}
        </Section>

        {/* ── Project ────────────────────────────────────────────────────── */}
        <Section title="Project">
          <div className="grid grid-cols-2 gap-2">
            <Readout label="Tempo" value={`${project.bpm} BPM`} />
            <Readout
              label="Time"
              value={`${project.timeSignature.beatsPerBar}/${project.timeSignature.beatUnit}`}
            />
            <Readout
              label="Scale lock"
              value={
                project.scaleLock.enabled
                  ? `${ROOT_NAMES[project.scaleLock.root] ?? ''} ${
                      PENTATONIC_MODES.find((m) => m.id === project.scaleLock.mode)?.label ?? ''
                    }`
                  : 'off'
              }
            />
            <Readout
              label="Length"
              value={`${Math.ceil(projectEndBeat(project) / beatsPerBar)} bars`}
            />
          </div>
          <Field label={`Master ${formatDb(project.masterGain)}`}>
            <input
              type="range"
              min={0}
              max={GAIN_MAX}
              step={0.01}
              value={project.masterGain}
              aria-label="Master level"
              onChange={(e) => {
                const v = Number(e.target.value);
                onUpdate((draft) => {
                  draft.masterGain = v;
                }, 'master');
              }}
              className="w-full accent-(--accent-state)"
            />
          </Field>
          <p className="numeric text-[10px] text-low">
            {project.tracks.length} tracks · {project.markers?.length ?? 0} markers · saved{' '}
            {new Date(project.updatedAt).toLocaleTimeString()}
          </p>
        </Section>
      </div>
    </aside>
  );
}

function FxFields({
  fx,
  trackName,
  onEdit,
}: {
  fx: TrackFx;
  trackName: string;
  onEdit: (mutate: (fx: TrackFx) => void, coalesceKey?: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 rounded-[3px] border border-hairline/70 p-2">
      <p className="numeric text-[9px] tracking-[0.14em] text-low uppercase">Insert FX</p>
      <div className="grid grid-cols-3 gap-2">
        {(['low', 'mid', 'high'] as const).map((band) => (
          <Field
            key={band}
            label={`EQ ${band} ${fx.eq[band] > 0 ? '+' : ''}${fx.eq[band].toFixed(1)}`}
          >
            <input
              type="range"
              min={EQ_MIN_DB}
              max={EQ_MAX_DB}
              step={0.5}
              value={fx.eq[band]}
              aria-label={`${trackName} EQ ${band}`}
              onDoubleClick={() =>
                onEdit((f) => {
                  f.eq[band] = 0;
                })
              }
              onChange={(e) => {
                const v = Number(e.target.value);
                onEdit((f) => {
                  f.eq[band] = v;
                }, `eq:${band}:${trackName}`);
              }}
              className="w-full accent-(--accent-state)"
            />
          </Field>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={fx.comp.enabled}
          aria-label={`${trackName} compressor`}
          onClick={() =>
            onEdit((f) => {
              f.comp.enabled = !f.comp.enabled;
            })
          }
          className={`numeric h-6 rounded-[2px] border px-1.5 text-[9px] uppercase ${
            fx.comp.enabled
              ? 'border-accent-state bg-accent-state/20 text-accent-state'
              : 'border-hairline text-low'
          }`}
        >
          Comp {fx.comp.enabled ? 'on' : 'off'}
        </button>
        <label className="numeric flex flex-1 flex-col text-[9px] tracking-[0.12em] text-low uppercase">
          thr {fx.comp.thresholdDb.toFixed(0)} dB
          <input
            type="range"
            min={COMP_THRESHOLD_MIN_DB}
            max={COMP_THRESHOLD_MAX_DB}
            step={1}
            value={fx.comp.thresholdDb}
            aria-label={`${trackName} compressor threshold`}
            onChange={(e) => {
              const v = Number(e.target.value);
              onEdit((f) => {
                f.comp.thresholdDb = v;
              }, `thr:${trackName}`);
            }}
            className="w-full accent-(--accent-state)"
          />
        </label>
        <label className="numeric flex flex-1 flex-col text-[9px] tracking-[0.12em] text-low uppercase">
          ratio {fx.comp.ratio.toFixed(1)}:1
          <input
            type="range"
            min={COMP_RATIO_MIN}
            max={COMP_RATIO_MAX}
            step={0.5}
            value={fx.comp.ratio}
            aria-label={`${trackName} compressor ratio`}
            onChange={(e) => {
              const v = Number(e.target.value);
              onEdit((f) => {
                f.comp.ratio = v;
              }, `ratio:${trackName}`);
            }}
            className="w-full accent-(--accent-state)"
          />
        </label>
      </div>
      <Field label={`Reverb send ${Math.round(fx.reverbSend * 100)}%`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={fx.reverbSend}
          aria-label={`${trackName} reverb send`}
          onChange={(e) => {
            const v = Number(e.target.value);
            onEdit((f) => {
              f.reverbSend = v;
            }, `rev:${trackName}`);
          }}
          className="w-full accent-(--accent-state)"
        />
      </Field>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2 rounded-[4px] border border-hairline bg-chrome-2/60 p-2.5">
      <h3 className="numeric text-[9px] tracking-[0.16em] text-accent-state uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="numeric flex flex-col gap-1 text-[9px] tracking-[0.12em] text-low uppercase">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Readout({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="numeric flex flex-col rounded-[3px] bg-page/60 px-2 py-1">
      <span className="text-[8px] tracking-[0.16em] text-low uppercase">{label}</span>
      <span className="text-[12px] text-hi">{value}</span>
    </div>
  );
}

function TextInput({
  value,
  maxLength,
  onCommit,
}: {
  value: string;
  maxLength: number;
  onCommit: (value: string) => void;
}): React.JSX.Element {
  return (
    <input
      defaultValue={value}
      maxLength={maxLength}
      aria-label="Name"
      onBlur={(e) => {
        const next = e.target.value.trim();
        if (next && next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className="h-8 min-w-0 flex-1 rounded-[3px] border border-hairline bg-chrome-2 px-2 text-sm tracking-normal text-hi normal-case outline-none focus:border-accent-state"
    />
  );
}

function SmallButton({
  label,
  aria,
  onClick,
  wide = false,
}: {
  label: string;
  aria: string;
  onClick: () => void;
  wide?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={aria}
      title={aria}
      onClick={onClick}
      className={`numeric h-7 rounded-[3px] border border-hairline px-2 text-[10px] tracking-[0.08em] text-mid uppercase transition-colors hover:border-accent-state hover:text-hi ${
        wide ? 'w-full' : ''
      }`}
    >
      {label}
    </button>
  );
}
