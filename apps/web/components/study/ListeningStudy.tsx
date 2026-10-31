'use client';

/**
 * The blind listening study (/study). A participant answers a few background
 * questions, then hears 12 pairs of AI-generated clips plus one attention
 * check (lib/study/design.ts) and says, for each pair, which sounds more like
 * Somali music and which sounds better as a recording. Progress survives a
 * reload (this browser only). Answers go to POST /api/study; if that fails
 * the participant can download them instead.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import stimuliJson from '@/lib/study/stimuli.json';
import {
  BACKGROUNDS,
  PLAYBACK,
  buildSession,
  sessionId,
  type Stimuli,
  type StudyAnswer,
  type StudyResponse,
  type Trial,
} from '@/lib/study/design';
import { STRINGS, type Lang } from '@/lib/study/strings';

const STIMULI = stimuliJson as unknown as Stimuli;
const STORAGE_KEY = 'qg-study-v1';
const MIN_LISTEN_SEC = 3;

type Stage = 'intro' | 'trials' | 'comment' | 'sending' | 'done' | 'failed';
type Somali = StudyAnswer['somali'];
type Quality = StudyAnswer['quality'];

interface Profile {
  background: StudyResponse['background'] | null;
  instrument: string;
  years: string;
  familiarity: number | null;
  playback: StudyResponse['playback'] | null;
  consent: boolean;
}

interface Saved {
  session: string;
  lang: Lang;
  stage: Stage;
  trials: Trial[];
  answers: StudyAnswer[];
  profile: Profile;
  comment: string;
  startedAt: string;
}

const EMPTY_PROFILE: Profile = {
  background: null,
  instrument: '',
  years: '',
  familiarity: null,
  playback: null,
  consent: false,
};

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function persist(s: Saved | null): void {
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the study still works, without resume.
  }
}

const choice =
  'rounded-lg border px-3 py-2 font-body text-sm transition-colors disabled:opacity-40 ';
const chosen = 'border-amber bg-amber text-bg-primary font-semibold';
const unchosen = 'border-line-primary text-ink-secondary hover:text-ink-primary';
const primary =
  'rounded-lg bg-amber px-5 py-2.5 font-body text-sm font-semibold text-bg-primary transition-opacity hover:opacity-90 disabled:opacity-40';

function ClipPlayer({
  label,
  id,
  onPlayed,
  onStart,
  register,
}: {
  label: string;
  id: string;
  onPlayed: (sec: number) => void;
  onStart: () => void;
  register: (el: HTMLAudioElement | null) => void;
}): React.JSX.Element {
  const last = useRef<number | null>(null);
  const total = useRef(0);
  useEffect(() => {
    last.current = null;
    total.current = 0;
  }, [id]);
  return (
    <div className="rounded-xl border border-line-secondary bg-bg-primary/40 p-3">
      <p className="mb-2 font-display text-lg text-ink-primary">{label}</p>
      <audio
        ref={register}
        key={id}
        src={`/study/${id}.mp3`}
        controls
        preload="metadata"
        playsInline
        className="w-full"
        onPlay={(e) => {
          last.current = e.currentTarget.currentTime;
          onStart();
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          if (last.current !== null && !e.currentTarget.paused) {
            const d = t - last.current;
            if (d > 0 && d < 1.5) {
              total.current += d;
              onPlayed(total.current);
            }
          }
          last.current = t;
        }}
        onEnded={() => onPlayed(Math.max(total.current, MIN_LISTEN_SEC))}
      />
    </div>
  );
}

function Choices<T extends string>({
  options,
  value,
  onChange,
  disabled,
  label,
}: {
  options: readonly { value: T; text: string }[];
  value: T | null;
  onChange: (v: T) => void;
  disabled: boolean;
  label: string;
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="mt-2 flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={choice + (value === o.value ? chosen : unchosen)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

export function ListeningStudy(): React.JSX.Element {
  const [lang, setLang] = useState<Lang>('en');
  const [stage, setStage] = useState<Stage>('intro');
  const [session, setSession] = useState('');
  const [trials, setTrials] = useState<Trial[]>([]);
  const [answers, setAnswers] = useState<StudyAnswer[]>([]);
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [comment, setComment] = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [resumable, setResumable] = useState<Saved | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // Current trial state.
  const [somali, setSomali] = useState<Somali | null>(null);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [played, setPlayed] = useState<[number, number]>([0, 0]);
  const trialStart = useRef(0);
  const players = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);

  const t = STRINGS[lang];
  const index = answers.length;
  const trial = trials[index];

  useEffect(() => {
    const saved = load();
    if (saved && saved.stage !== 'done' && saved.answers.length > 0) setResumable(saved);
    if (saved) setLang(saved.lang);
    else if (navigator.language.toLowerCase().startsWith('so')) setLang('so');
  }, []);

  useEffect(() => {
    if (stage === 'intro' || !session) return;
    persist({ session, lang, stage, trials, answers, profile, comment, startedAt });
  }, [session, lang, stage, trials, answers, profile, comment, startedAt]);

  useEffect(() => {
    setSomali(null);
    setQuality(null);
    setPlayed([0, 0]);
    trialStart.current = performance.now();
  }, [index, stage]);

  const canStart =
    profile.consent &&
    profile.background !== null &&
    profile.familiarity !== null &&
    profile.playback !== null;

  const start = (): void => {
    const s = sessionId();
    setSession(s);
    setTrials(buildSession(STIMULI, Math.random));
    setAnswers([]);
    setStartedAt(new Date().toISOString());
    setStage('trials');
    setResumable(null);
    window.scrollTo({ top: 0 });
  };

  const resume = (): void => {
    if (!resumable) return;
    setSession(resumable.session);
    setTrials(resumable.trials);
    setAnswers(resumable.answers);
    setProfile(resumable.profile);
    setComment(resumable.comment);
    setStartedAt(resumable.startedAt);
    setLang(resumable.lang);
    setStage(
      resumable.stage === 'sending' || resumable.stage === 'failed' ? 'comment' : resumable.stage,
    );
    setResumable(null);
  };

  const listened = played[0] >= MIN_LISTEN_SEC && played[1] >= MIN_LISTEN_SEC;

  const next = (): void => {
    if (!trial || !somali || !quality) return;
    for (const p of players.current) p?.pause();
    const answer: StudyAnswer = {
      index: trial.index,
      comparison: trial.comparison,
      pair: trial.pair,
      a: trial.a,
      b: trial.b,
      attention: trial.attention,
      somali,
      quality,
      playedA: Math.round(played[0] * 10) / 10,
      playedB: Math.round(played[1] * 10) / 10,
      ms: Math.round(performance.now() - trialStart.current),
    };
    const all = [...answers, answer];
    setAnswers(all);
    if (all.length >= trials.length) setStage('comment');
    window.scrollTo({ top: 0 });
  };

  const payload = useCallback((): StudyResponse => {
    const years = Number.parseInt(profile.years, 10);
    return {
      study: 'qaraamigen-listening-v1',
      session,
      lang,
      consent: true,
      background: profile.background ?? 'other',
      instrument: profile.instrument.trim().slice(0, 80),
      years: Number.isFinite(years) && years >= 0 && years <= 90 ? years : null,
      familiarity: profile.familiarity ?? 1,
      playback: profile.playback ?? 'speakers',
      answers,
      comment: comment.trim().slice(0, 2000),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }, [answers, comment, lang, profile, session, startedAt]);

  const send = async (): Promise<void> => {
    setStage('sending');
    const body = payload();
    try {
      const res = await fetch('/api/study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStage('done');
      persist(null);
    } catch {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(body, null, 1)], { type: 'application/json' }),
      );
      setDownloadUrl(url);
      setStage('failed');
    }
  };

  const shareLink = useMemo(
    () => (typeof window === 'undefined' ? '' : `${window.location.origin}/study`),
    [],
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <h1 className="font-display text-3xl text-ink-primary sm:text-4xl">{t.title}</h1>
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'so' : 'en')}
          className="shrink-0 rounded-lg border border-line-primary px-3 py-1.5 font-body text-xs text-ink-secondary hover:text-ink-primary"
        >
          {t.langSwitch}
        </button>
      </div>

      {stage === 'intro' ? (
        <section className="mt-6 space-y-6">
          <p className="font-body text-base leading-relaxed text-ink-secondary">
            {t.intro(STIMULI.comparisons.length * 4 + 1)}
          </p>
          <p className="font-body text-sm text-ink-tertiary">
            {t.privacy} {t.aiNote}
          </p>
          {resumable ? (
            <button type="button" onClick={resume} className={primary}>
              {t.resume} ({resumable.answers.length}/{resumable.trials.length})
            </button>
          ) : null}

          <fieldset className="rounded-2xl border border-line-secondary bg-bg-secondary p-5">
            <legend className="px-1 font-body text-sm font-semibold text-ink-primary">
              {t.backgroundQ}
            </legend>
            <div className="mt-2 grid gap-2">
              {BACKGROUNDS.map((b) => (
                <label
                  key={b}
                  className="flex items-start gap-2 font-body text-sm text-ink-secondary"
                >
                  <input
                    type="radio"
                    name="background"
                    className="mt-1"
                    checked={profile.background === b}
                    onChange={() => setProfile((p) => ({ ...p, background: b }))}
                  />
                  {t.backgrounds[b]}
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="font-body text-sm text-ink-secondary">
                {t.instrument}
                <input
                  type="text"
                  maxLength={80}
                  value={profile.instrument}
                  onChange={(e) => setProfile((p) => ({ ...p, instrument: e.target.value }))}
                  className="mt-1 block w-full rounded-lg border border-line-primary bg-bg-primary px-2 py-1.5 text-sm text-ink-primary"
                />
              </label>
              <label className="font-body text-sm text-ink-secondary">
                {t.years}
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={90}
                  value={profile.years}
                  onChange={(e) => setProfile((p) => ({ ...p, years: e.target.value }))}
                  className="mt-1 block w-24 rounded-lg border border-line-primary bg-bg-primary px-2 py-1.5 text-sm text-ink-primary"
                />
              </label>
            </div>
            <div className="mt-4">
              <p className="font-body text-sm text-ink-secondary">{t.familiarity}</p>
              <Choices
                label={t.familiarity}
                disabled={false}
                value={profile.familiarity === null ? null : String(profile.familiarity)}
                onChange={(v) => setProfile((p) => ({ ...p, familiarity: Number(v) }))}
                options={['1', '2', '3', '4', '5'].map((v) => ({ value: v, text: v }))}
              />
              <p className="mt-1 font-body text-xs text-ink-tertiary">
                1 = {t.familiarityEnds[0]} · 5 = {t.familiarityEnds[1]}
              </p>
            </div>
            <div className="mt-4">
              <p className="font-body text-sm text-ink-secondary">{t.playbackQ}</p>
              <Choices
                label={t.playbackQ}
                disabled={false}
                value={profile.playback}
                onChange={(v) => setProfile((p) => ({ ...p, playback: v }))}
                options={PLAYBACK.map((p) => ({ value: p, text: t.playback[p] }))}
              />
            </div>
            <label className="mt-5 flex items-start gap-2 font-body text-sm text-ink-primary">
              <input
                type="checkbox"
                className="mt-1"
                checked={profile.consent}
                onChange={(e) => setProfile((p) => ({ ...p, consent: e.target.checked }))}
              />
              {t.consent}
            </label>
          </fieldset>
          <button type="button" disabled={!canStart} onClick={start} className={primary}>
            {t.start}
          </button>
        </section>
      ) : null}

      {stage === 'trials' && trial ? (
        <section className="mt-6" aria-live="polite">
          <div className="flex items-center justify-between font-body text-sm text-ink-tertiary">
            <span>{t.pairOf(index + 1, trials.length)}</span>
            <span aria-hidden="true">{Math.round((index / trials.length) * 100)}&nbsp;%</span>
          </div>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={trials.length}
            aria-valuenow={index}
          >
            <div
              className="h-full bg-amber"
              style={{ width: `${(index / trials.length) * 100}%` }}
            />
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {(['A', 'B'] as const).map((side, k) => (
              <ClipPlayer
                key={`${trial.index}-${side}`}
                label={t.clip(side)}
                id={k === 0 ? trial.a : trial.b}
                register={(el) => {
                  players.current[k] = el;
                }}
                onStart={() => players.current[1 - k]?.pause()}
                onPlayed={(sec) =>
                  setPlayed((p) =>
                    k === 0 ? [Math.max(p[0], sec), p[1]] : [p[0], Math.max(p[1], sec)],
                  )
                }
              />
            ))}
          </div>
          {!listened ? (
            <p className="mt-3 font-body text-sm text-ink-tertiary">{t.listenFirst}</p>
          ) : null}

          <div className="mt-6 rounded-2xl border border-line-secondary bg-bg-secondary p-5">
            <p className="font-body text-base font-semibold text-ink-primary">{t.somaliQ}</p>
            <Choices
              label={t.somaliQ}
              disabled={!listened}
              value={somali}
              onChange={setSomali}
              options={(['a', 'b', 'same', 'neither'] as const).map((v) => ({
                value: v,
                text: t.somali[v],
              }))}
            />
            <p className="mt-5 font-body text-base font-semibold text-ink-primary">{t.qualityQ}</p>
            <Choices
              label={t.qualityQ}
              disabled={!listened}
              value={quality}
              onChange={setQuality}
              options={(['a', 'b', 'same'] as const).map((v) => ({ value: v, text: t.quality[v] }))}
            />
          </div>
          <button
            type="button"
            disabled={!somali || !quality}
            onClick={next}
            className={`${primary} mt-5`}
          >
            {index + 1 >= trials.length ? t.finish : t.next}
          </button>
        </section>
      ) : null}

      {stage === 'comment' || stage === 'sending' ? (
        <section className="mt-6 space-y-4">
          <label className="block font-body text-sm text-ink-secondary">
            {t.commentQ}
            <textarea
              value={comment}
              maxLength={2000}
              rows={5}
              onChange={(e) => setComment(e.target.value)}
              className="mt-2 block w-full rounded-lg border border-line-primary bg-bg-primary px-3 py-2 text-sm text-ink-primary"
            />
          </label>
          <button
            type="button"
            disabled={stage === 'sending'}
            onClick={() => void send()}
            className={primary}
          >
            {stage === 'sending' ? t.sending : t.send}
          </button>
        </section>
      ) : null}

      {stage === 'done' ? (
        <section className="mt-6 space-y-3 rounded-2xl border border-amber/40 bg-bg-secondary p-5">
          <p role="status" className="font-display text-xl text-ink-primary">
            {t.thanks}
          </p>
          <p className="font-body text-sm text-ink-secondary">{t.share}</p>
          <p className="break-all font-body text-sm text-amber">{shareLink}</p>
        </section>
      ) : null}

      {stage === 'failed' ? (
        <section className="mt-6 space-y-3 rounded-2xl border border-danger p-5">
          <p role="alert" className="font-body text-sm text-danger">
            {t.failed}
          </p>
          {downloadUrl ? (
            <a href={downloadUrl} download={`qaraamigen-study-${session}.json`} className={primary}>
              {t.download}
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => void send()}
            className="ml-3 rounded-lg border border-line-primary px-4 py-2 font-body text-sm text-ink-secondary"
          >
            {t.send}
          </button>
        </section>
      ) : null}
    </main>
  );
}
