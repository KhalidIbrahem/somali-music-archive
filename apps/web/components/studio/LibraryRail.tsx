/**
 * Library rail (280px): collections, recordings, transcription sessions, and
 * exports. Static content in B1-02 — the archive API wires in with Block 2.
 * Selection is amber (accent-state); density follows the 8px grid with 32px
 * rows.
 */

const SECTIONS: ReadonlyArray<{
  title: string;
  items: ReadonlyArray<{ name: string; active?: boolean; meta?: string }>;
}> = [
  {
    title: 'Collections',
    items: [
      { name: 'Qaraami classics', meta: '48' },
      { name: 'Field recordings 1971–1989', meta: '212' },
      { name: 'Radio reels', meta: '96' },
    ],
  },
  {
    title: 'Recordings',
    items: [
      { name: 'Voice and kaban — reel 14', meta: '5:48' },
      { name: 'Kaban solo — reel 3', meta: '3:12' },
      { name: 'Ensemble — festival tape', meta: '7:41' },
    ],
  },
  {
    title: 'Sessions',
    items: [{ name: 'Sample session — voice', active: true, meta: 'open' }],
  },
  {
    title: 'Exports',
    items: [
      { name: 'sample-session.pdf', meta: 'Aug 5' },
      { name: 'sample-session.musicxml', meta: 'Aug 5' },
    ],
  },
];

export function LibraryRail(): React.JSX.Element {
  return (
    <nav aria-label="Library sections" className="flex h-full flex-col overflow-y-auto py-2">
      {SECTIONS.map((section) => (
        <div key={section.title} className="px-2 pb-4">
          <h2 className="flex h-8 items-center px-2 text-[11px] font-semibold tracking-[0.08em] text-low uppercase">
            {section.title}
          </h2>
          <ul>
            {section.items.map((item) => (
              <li key={item.name}>
                <button
                  type="button"
                  aria-current={item.active === true ? 'true' : undefined}
                  className={`group relative flex h-8 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-live ${
                    item.active === true
                      ? 'bg-chrome-2 text-hi'
                      : 'text-mid hover:bg-chrome-2 hover:text-hi'
                  }`}
                >
                  {item.active === true && (
                    <span
                      aria-hidden
                      className="absolute top-1 bottom-1 left-0 w-0.5 rounded-full bg-accent-state"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {item.meta !== undefined && (
                    <span className="numeric shrink-0 text-[11px] text-low">{item.meta}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
