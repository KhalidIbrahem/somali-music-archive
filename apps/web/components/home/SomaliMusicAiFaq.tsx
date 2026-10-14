import Link from 'next/link';

interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

const FAQS: readonly FaqItem[] = [
  {
    question: 'What is Somali Music AI?',
    answer:
      'Somali Music AI (QaraamiGenAI) is the first artificial intelligence platform engineered specifically for Somali music and cultural preservation. Unlike generic AI models that default to Western scales, QaraamiGenAI is trained on traditional Somali pentatonic modes (5-note scales), Kaban (oud) acoustic ornamentation, Durbaan rhythms, and historic Radio Hargeisa recordings to generate, transcribe, and preserve Somali music.',
  },
  {
    question: 'How does Somali Music AI generate authentic Qaraami and Somali songs?',
    answer:
      'The platform uses generative audio neural networks fine-tuned with custom LoRA adapters trained on hundreds of hours of authentic Somali recordings. You can generate authentic Somali genres—including Qaraami, Heello, Dhaanto, and Buraanbur—by specifying traditional scales, tempo (BPM), and instruments, producing audio that strictly honors traditional Somali modal structures.',
  },
  {
    question: 'Can AI transcribe old Somali cassette recordings into sheet music?',
    answer:
      'Yes. QaraamiGenAI features a complete transcription pipeline that isolates vocals and instruments via neural stem separation, extracts pitches with deep CREPE models, fits the melody to authentic Somali pentatonic scales, and engraves playable sheet music. Transcriptions can be previewed with synchronous audio playback and exported to PDF, MIDI, or MusicXML.',
  },
  {
    question: 'What instruments and features does the online Somali Music Studio provide?',
    answer:
      'The browser-based Somali Music Studio (DAW) includes virtual sampled Kaban (Somali Oud) with pentatonic scale lock, Durbaan frame drums with traditional groove presets, celebratory hand claps, acoustic bass, multitrack audio recording, and professional mixing tools built specifically for Somali compositions.',
  },
  {
    question: 'How does this project preserve the legacy of Radio Hargeisa?',
    answer:
      'Founded in 1943 as the first Somali radio station in history, Radio Hargeisa was the cradle of modern Somali song and recorded masters like Cabdullaahi Qarshe, Cabdi Sinimo, Cumar Dhuule, and Maxamed Mooge. Many master tapes survived only because staff buried over 12,000 reels underground during the 1988 bombardment. Somali Music AI converts these fragile analog recordings into permanent digital notation and playable AI models.',
  },
  {
    question: 'Is Somali Music AI free to use?',
    answer:
      'Yes. QaraamiGenAI provides public access to AI-generated Qaraami recordings in the Listening Room, transcription examples, educational resources, and browser-based music creation tools for researchers, students, and musicians worldwide.',
  },
  {
    question: 'Who created Somali Music AI (QaraamiGenAI)?',
    answer:
      'QaraamiGenAI was created by Khalid Ibrahim, an AI engineer and musician based in Minneapolis, MN. Combining modern artificial intelligence with traditional music training, Khalid created the platform to ensure Somali musical heritage is documented, understood, and revitalized for future generations.',
  },
];

const FAQ_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.answer,
    },
  })),
};

export function SomaliMusicAiFaq(): React.JSX.Element {
  return (
    <section id="somali-music-ai" className="border-t border-hairline bg-page/30">
      {/* FAQPage JSON-LD Structured Data for Google Rich Snippets */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_SCHEMA) }}
      />

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 py-24 sm:px-6">
        {/* Header & Pillar Overview */}
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-state" />
            <p className="numeric text-xs tracking-[0.24em] text-accent-state uppercase">
              Somali Music AI · Architecture &amp; Capabilities
            </p>
          </div>
          <h2 className="mt-4 font-display text-3xl text-hi sm:text-4xl">
            The Technology Behind Somali Music AI
          </h2>
          <p className="mt-4 text-base leading-relaxed text-mid">
            QaraamiGenAI combines generative machine learning, neural audio stem separation, and
            computational ethnomusicology to bring Somali musical traditions into the artificial
            intelligence era.
          </p>
        </div>

        {/* 3 Core Capability Cards */}
        <div className="grid gap-6 md:grid-cols-3">
          <div className="flex flex-col justify-between rounded-[4px] border border-hairline bg-chrome-1 p-6 transition-colors hover:border-accent-state/60">
            <div>
              <span className="numeric text-[11px] tracking-[0.16em] text-accent-state uppercase">
                01 · Audio Generation
              </span>
              <h3 className="mt-2 font-display text-xl text-hi">Somali AI Generation</h3>
              <p className="mt-3 text-xs leading-relaxed text-mid">
                Generate authentic Somali Qaraami songs, solo Kaban improvisations, and traditional
                rhythmic pieces using fine-tuned neural models trained on archival recordings.
              </p>
            </div>
            <Link
              href="/generate"
              className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-accent-state hover:text-hi"
            >
              Open AI Generator →
            </Link>
          </div>

          <div className="flex flex-col justify-between rounded-[4px] border border-hairline bg-chrome-1 p-6 transition-colors hover:border-accent-state/60">
            <div>
              <span className="numeric text-[11px] tracking-[0.16em] text-accent-state uppercase">
                02 · Audio Transcription
              </span>
              <h3 className="mt-2 font-display text-xl text-hi">Pentatonic Transcription</h3>
              <p className="mt-3 text-xs leading-relaxed text-mid">
                Convert old cassette tapes into accurate sheet music. Automatically detects Somali
                pentatonic modes, separates stems, and outputs playable PDF, MIDI, and MusicXML.
              </p>
            </div>
            <Link
              href="/transcribe"
              className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-accent-state hover:text-hi"
            >
              View Transcription →
            </Link>
          </div>

          <div className="flex flex-col justify-between rounded-[4px] border border-hairline bg-chrome-1 p-6 transition-colors hover:border-accent-state/60">
            <div>
              <span className="numeric text-[11px] tracking-[0.16em] text-accent-state uppercase">
                03 · Browser Studio
              </span>
              <h3 className="mt-2 font-display text-xl text-hi">Virtual Kaban &amp; Studio</h3>
              <p className="mt-3 text-xs leading-relaxed text-mid">
                Compose in the browser with authentic virtual Somali instruments: Kaban (oud),
                Durbaan frame drums, and hand claps locked to Somali musical scales.
              </p>
            </div>
            <Link
              href="/studio"
              className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-accent-state hover:text-hi"
            >
              Launch Studio DAW →
            </Link>
          </div>
        </div>

        {/* FAQs Section */}
        <div className="rounded-[4px] border border-hairline bg-chrome-1/60 p-6 sm:p-8">
          <div className="mb-8">
            <span className="numeric text-[11px] tracking-[0.2em] text-accent-state uppercase">
              Frequently Asked Questions
            </span>
            <h3 className="mt-2 font-display text-2xl text-hi sm:text-3xl">
              Frequently Asked Questions About Somali Music AI
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-mid">
              Everything you need to know about the first artificial intelligence platform dedicated
              to Somali music.
            </p>
          </div>

          <div className="divide-y divide-hairline">
            {FAQS.map((faq) => (
              <details
                key={faq.question}
                className="group py-5 transition-colors focus-within:outline-none"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-4 font-display text-base text-hi transition-colors hover:text-accent-state group-open:text-accent-state sm:text-lg">
                  <span>{faq.question}</span>
                  <span className="numeric ml-2 shrink-0 rounded-full border border-hairline px-2 py-0.5 text-xs text-mid transition-transform duration-300 group-open:rotate-180">
                    ↓
                  </span>
                </summary>
                <div className="mt-3 pr-6 text-xs leading-relaxed text-mid sm:text-sm">
                  <p>{faq.answer}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
