\version "2.24.3"

\header {
  title = "Beerdilaacshe"
  subtitle = "Qaraami Melody"
  composer = "Composed by Abdillahi Qarshe (1950s)"
  arranger = "Sheet music by Khalid Ibrahim"
  tagline = ##f
}

melody = {
  \clef treble \numericTimeSignature
  \time 4/4
  \key c \major

  % A phrase (1)
  g'4 a' c''8 a' c''4        | % 1
  d''4 f''8 d'' g''4 f''     | % 2
  f''4 d'' f''8 c''~ c'' a'  | % 3
  c''8 a'~ a'4 g'2           | % 4

  % A phrase (2) — held ending
  g'4 a' c''8 a' c''4        | % 5
  d''4 f''8 d'' g'' f''~ f''4 | % 6
  d''1~                      | % 7
  d''1                       | % 8

  % A phrase (3)
  g'4 a' c''8 a' c''4        | % 9
  d''4 f''8 d'' g''4 f''     | % 10
  f''4 d'' f''8 c''~ c'' a'  | % 11
  c''8 a'~ a'4 g'2           | % 12

  % A phrase (4) — held ending
  g'4 a' c''8 a' c''4        | % 13
  d''4 f''8 d'' g'' f''~ f''4 | % 14
  d''1~                      | % 15
  d''1                       | % 16

  % B phrase (1)
  d''4 f'' g'' a''8 g''      | % 17
  c'''8 a'' c'''4 a'' g''8 f'' | % 18
  g''1~                      | % 19
  g''1                       | % 20

  % B phrase (2)
  d''4 f'' g'' a''8 g''      | % 21
  c'''8 a'' c'''4 a'' g''8 f'' | % 22
  g''1~                      | % 23
  g''1                       | % 24

  % C phrase — climax
  d''2 f''4 g''              | % 25
  a''4 c''' d'''2~           | % 26
  d'''2 d'''4. c'''8         | % 27
  d'''4 c'''8 d''' c''' a'' a'' g''~ | % 28
  g''4 g''8 c''' a'' g'' f'' d'' | % 29
  r8 d'' d'' g'' f'' d'' c'' a' | % 30
  a'8 d''~ d''4 c'' a'       | % 31
  g'1                        | % 32

  % Final refrain
  g'4 a' c''8 a' c''4        | % 33
  d''4 f''8 d'' g''4 f''     | % 34
  d''1                       | % 35
  \bar "|."
}

\score {
  \new Staff \melody
  \layout { }
}

\score {
  \unfoldRepeats \new Staff { \tempo 4 = 96 \melody }
  \midi { }
}
