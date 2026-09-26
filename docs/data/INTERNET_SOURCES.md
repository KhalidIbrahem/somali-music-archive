# Internet sources — rights-permitting acquisition

Generated 2026-09-26T07:30:07+00:00 by `scripts/internet_acquire.py --report`. Data: `data/internet/manifest.jsonl`, `skipped.jsonl`, `candidates.jsonl`, `runs.jsonl` (audio and its sidecars are git-ignored).

## Policy

Only material whose licence is explicit and permits reuse is downloaded: Internet Archive items whose `licenseurl` is CC BY or CC BY-SA, CC0 or the Public Domain Mark, or whose rights text says public domain, CC0 or CC BY with no negation or reservation in it ("Not in the public domain" and "all rights reserved" fail closed); YouTube videos whose licence field reads "Creative Commons Attribution license (reuse allowed)"; hand-added URLs only with a rights note, the tier `internet_cc` and a `licence_url` or `licence_text` that passes the same rules (contributor tiers are never downloadable here: consented audio goes through `data/incoming/` and `scripts/intake.py`). Everything else is logged with its reason and not fetched. Downloads carry the tier `internet_cc` (train + publish, attribution recorded in the sidecar and the manifest). `internet_research_only` is never downloaded: the tier exists so the manifest can name the policy, not so the corpus can grow around it. Requests are spaced by at least 5 s and downloads by at least 10 s (the latest run row's --request-gap/--download-gap, else the script defaults), 429/5xx answers are retried with back-off, and every run is capped per source and by total hours; items already downloaded or already decided are not re-evaluated. Caveat: a YouTube "Creative Commons Attribution" flag is the uploader's declaration, not proof of ownership. Uploads of classic recordings by third-party channels (a private channel posting a Xasan Aadan Samatar song, say) are downloaded under `internet_cc` because the declared licence permits it, but before any adapter trained on them is published each such item must be reviewed by hand and, where the uploader plainly does not hold the rights, its `tier` in `data/internet/manifest.jsonl` set to `internet_research_only` and `--inventory` re-run (the inventory then carries that tier and build_sets keeps it out of publishable sets; a blank or misspelled tier makes the inventory row research-only and excluded).

## Summary

| source | queries | candidates seen | rights-permitting | downloaded items | files | hours | pending (not downloaded) | skipped |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ia | 12 | 215 | 0 | 0 | 0 | 0.00 | 0 | 215 |
| yt | 15 | 218 | 196 | 163 | 163 | 40.00 | 33 | 22 |
| file | 1 | 0 | 0 | 0 | 0 | 0.00 | 0 | 0 |

Total downloaded: 163 items, 40.00 h of non-excluded audio; `data/inventory/internet_files.jsonl` holds 163 rows.

## Internet Archive

Queries:

- `somali AND mediatype:audio`
- `qaraami AND mediatype:audio`
- `somali oud AND mediatype:audio`
- `kaban somali AND mediatype:audio`
- `somali music 1960s AND mediatype:audio`
- `hees somali AND mediatype:audio`
- `Radio Hargeisa AND mediatype:audio`
- `Radio Mogadishu AND mediatype:audio`
- `somali traditional song AND mediatype:audio`
- `balwo AND mediatype:audio`
- `heello somali AND mediatype:audio`
- `dhaanto AND mediatype:audio`

### Downloaded (0)

None.

### Rights-permitting, not downloaded (0)

None.

### Skipped (215)

| reason | count |
| --- | --- |
| no licence metadata | 171 |
| CC-NC/ND (training use unclear) | 38 |
| not Somali by metadata | 6 |

Examples (licence text as read from the source):

- `3565683568536855853685682016_201701` — ayat quran Program with teacher voice and translation into 27 language — licence: (none)  → no licence metadata
- `chick_dosari` — khudbad amra wanaaga dadka[waxaa jeedin sheekh xafiid aldowsari xafida — licence: (none)  → not Somali by metadata
- `jamendo-578136` — Somali Songs - MUSTAFE DOLLAR Ft RODA KAYFMAARAGTA — licence: http://creativecommons.org/licenses/by-nc-nd/3.0/ http://creativecommons.org/licenses/by-nc-nd/3.0/ → CC-NC/ND (training use unclear)

## YouTube

Queries:

- `qaraami`
- `kaban`
- `somali oud`
- `heesta qaraami`
- `balwo`
- `heello`
- `dhaanto`
- `Somali music 1970s`
- `Somali oud solo`
- `Maxamed Suleebaan`
- `Xasan Aadan Samatar`
- `Maxamed Mooge Liibaan`
- `Axmed Cali Cigaal`
- `Hibo Maxamed`
- `Maryan Mursal`

Search mode: YouTube's own "Creative Commons" results filter (`sp=EgIwAQ==`) is used as a pre-filter unless a run passed `--no-yt-cc-filter`; the decision for every video is still its `license` field read with yt-dlp (`Creative Commons Attribution license (reuse allowed)` accepted; `Standard YouTube License` or no field rejected).

### Downloaded (163)

| item | title | creator | licence | URL | hours | files | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `-BLMXNmH6nk` | Khadra daahir iyo Axmad cali cigaal \|\| Waran caashaq with lyrcs | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=-BLMXNmH6nk | 0.193 | 1 |  |
| `-Y8yoyhxSNk` | Abdi Jibaar Alkhaliiji Heesta Abdi Dumar Ma Caashaqin Official Video HCTV 2017 | Horn Cable Tv | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=-Y8yoyhxSNk | 0.076 | 1 |  |
| `04nT_3DC1vA` | TIJAABI CODKAAGA 2017 HEES KABAN | RASTA MEDIA | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=04nT_3DC1vA | 0.000 | 1 | 04nT_3DC1vA.m4a: near_duplicate (data/ahmed_raw/GarageBand/caruurta.band/Media/06 Laba aabo wada dhalay Kaban.m4a) |
| `0AmxXP1s4S0` | KHADRA DAAHIR CIGE DADAW SAADAASHA GUUD | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=0AmxXP1s4S0 | 0.176 | 1 |  |
| `0UvE9xydpzg` | Somali beauty is a mysterious miracle/أجمل البنات في العالم | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=0UvE9xydpzg | 0.087 | 1 |  |
| `0cU2BRl5bio` | Two Raids, Two Kaban Wipes \| Escape From Tarkov | Eclipse | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=0cU2BRl5bio | 0.804 | 1 |  |
| `0qNuF1P3ZvE` | Maxamad S Tubeec \|\| Nasteexo with lyrics | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=0qNuF1P3ZvE | 0.096 | 1 | possible Harvard duplicate: Side A. Track 3: Nasteexo |
| `1k0s6HChFzk` | XALIIMA KHALIIF MAGOOL MA SALGUURE CAASHAQA WITH LYRICS KABAN | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=1k0s6HChFzk | 0.106 | 1 |  |
| `24bI1yrNmVI` | عزة في هواك \| بيت العود - الخرطوم، في الإسكندرية | Bait Al Oud - Khartoum | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=24bI1yrNmVI | 0.120 | 1 |  |
| `2LOf1qfZz6I` | Hunting New Boss KABAN - Escape From Tarkov | Axel_tv | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=2LOf1qfZz6I | 0.000 | 1 | 2LOf1qfZz6I.m4a: near_duplicate (data/ahmed_raw/Logic/Raali/Audio Files/Raali_1#07.aif) |
| `2MNl9OgMyj8` | DAAWO HEES QARAAMI AH OO CAJIIB AH CABDINASIR MACALIN CAYDIID | Mallay Media Pro | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=2MNl9OgMyj8 | 0.094 | 1 |  |
| `2PPh8SLrUSc` | 14 SANO KA HOR IYO BK HEESAHA UU QAADI JIRAY WAAYO WAAYO ! | Somali Sun | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=2PPh8SLrUSc | 0.072 | 1 |  |
| `2tT106RyMI0` | Heeso Xul Ah Qaraami Kaban Waayo Waayo 2020 | iskiinos | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=2tT106RyMI0 | 1.200 | 1 |  |
| `3-w0rW-qBZ4` | AXMAD CALI DARARAMLE WALI WAA CARUUROO WITH LYRICS KABANKII XUDEYDI | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=3-w0rW-qBZ4 | 0.187 | 1 |  |
| `3nRE7QYbV_s` | QARAAMI LAXANKA OLOL  RADIO MUQDISHO 1965  MAXAMED JAAMAC JOOF | Xogta heesaha Media | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=3nRE7QYbV_s | 0.088 | 1 |  |
| `4D8I0zlzRGQ` | Heestii Sudani  By Ali Sheikh | Farhan “Ugaas” Ahmed | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=4D8I0zlzRGQ | 0.241 | 1 |  |
| `4GOHW7tVE0s` | HANUUNIYE  HEESTII DAALO LYRICS BY HOYGA MURTIDA IYO MADADAALADA E MURTIBILE | Murtibile | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=4GOHW7tVE0s | 0.134 | 1 |  |
| `4UEzIA0Ts4s` | Hees Xamari Caasha Luula | Aweis Haji Nor | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=4UEzIA0Ts4s | 0.091 | 1 |  |
| `5-x-t5V4Uus` | Tarkov will Completely Change SOON! | JakeyPants | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=5-x-t5V4Uus | 0.163 | 1 |  |
| `56gEK3a4a90` | Hibo Nuura Xiiso Burur Best Song | khaalid offlcial | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=56gEK3a4a90 | 0.110 | 1 |  |
| `5W7L14G_sGI` | MAXAMED SALEEBAAN  TUBEEC \| HEESTII GUFAACO \| QARAAMI BILAA MUSIC AH WITH LYRI | M. Abshir | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=5W7L14G_sGI | 0.084 | 1 | possible Harvard duplicate: Side B. Track 2: Gufaaco |
| `5dtBSUXf4Zg` | Amiin Diini Heesta Jawhara Luula Xusuustii Cumar Dhuule Barnaamijka Hobolka Mant | Bulsho News | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=5dtBSUXf4Zg | 0.095 | 1 |  |
| `5ojYO4139AI` | Axmad Cali Cigaal \|\| Geeridii Abwaanka with lyrics kaban original | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=5ojYO4139AI | 0.237 | 1 |  |
| `67GJFbRiNmM` | HEESTI ALLAHAYOW MAXA IGA QABSADAY - KABANKA FILFIL + Lyrics | SheekoHub | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=67GJFbRiNmM | 0.047 | 1 |  |
| `6_cMxo0kfgo` | HABAD MUSA HEESTII XASILAYEY | XIDIGAHA ISLI PRANKS TUBE | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=6_cMxo0kfgo | 0.114 | 1 |  |
| `88JrP1EkY-M` | XASAN AADAN SAMATAR, WAA LA II ADIMAY AXADDII SIDAAN  KUU EEGAYEE | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=88JrP1EkY-M | 0.153 | 1 | possible Harvard duplicate: Side B. Track 2: Axaddii |
| `8We1Zo0Fjd4` | HAMDA YAR IYO CANAB COAST  YAA SI RASMI AH U LEH HEESTA JAG BAAN KUGU AHAY WAX B | Hamdi Jirow | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=8We1Zo0Fjd4 | 0.113 | 1 |  |
| `8p9XEZKxzZc` | Xayad maydal \| Heesta Dookh \| Haldoor GR \| Horn Cable Tv 2018 | Horn Cable Tv | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=8p9XEZKxzZc | 0.093 | 1 |  |
| `9JknFSpVT6A` | Qaraami Maandeeq | Saxartire TV | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=9JknFSpVT6A | 0.084 | 1 |  |
| `9VdujA08IN4` | HEESTII HUBAAL CAASHAQ IYO ALFAAN BOQORMATAAN 2017 | Ahmedseattle206 | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=9VdujA08IN4 | 0.084 | 1 |  |
| `A2Oo4YPGMpw` | HEESTA SABAALO CODADKII AUN CALI DIIRIYE(CALI GAAB) IYO SEYNAB CALI BAXSAN | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=A2Oo4YPGMpw | 0.177 | 1 |  |
| `AQaAhSqSzWc` | KHADRA DAAHIR CIGE HEES JACAYL AH KABAN AAD U MACAAN LABADII ISDOORTEE | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=AQaAhSqSzWc | 0.170 | 1 |  |
| `Be40OkDv4zs` | dhismo qoys siciid daa uud | SUBXAANYO MEDIA PRODUCTION | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=Be40OkDv4zs | 0.081 | 1 |  |
| `C5CEnFEm_XU` | axmed mooge miyaan xalay jiifsaday  qaaci } ~picolo sterio HD | PICOLO STUDIO BORAMA | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=C5CEnFEm_XU | 0.124 | 1 |  |
| `CG2ptoqYjVM` | The Fascinating History Of Somali People Spans Thousands of Years | RakGhana | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=CG2ptoqYjVM | 0.060 | 1 |  |
| `CX7blHrYgxM` | QAARAAMI XUL AH MAHADHADA WITH LYRICS WAAYO WAAYO | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=CX7blHrYgxM | 0.143 | 1 |  |
| `DE_oblRly-A` | KHADRA DAAHIR CIGE HEESTA CABDOW BARISAMAADKII/INUU BEER JACAYLOO | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=DE_oblRly-A | 0.161 | 1 |  |
| `E4KC4JZUol0` | FAADUMA AXMAD NUUR DAALACOW WITH LYRICS ORIGINAL | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=E4KC4JZUol0 | 0.116 | 1 |  |
| `ElSOz4944jo` | MAXAMAD S TUBEEC IYO MAGOOL \|\| ARAMIDU WITH LYRICS | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=ElSOz4944jo | 0.085 | 1 |  |
| `Er2nxVUbY8k` | KABAN Temarok -پڕۆگرامی نوێی کابان گوندی تیمارۆک | RENG TV | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=Er2nxVUbY8k | 0.657 | 1 |  |
| `F74Ah8FDSsY` | GABADH UDHALATAY DALKA SWEDEN OO QAADAYSA HEES MACAAN OO QARAAMI AH | Mallay Media Pro | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=F74Ah8FDSsY | 0.056 | 1 |  |
| `GDeNbz9svUQ` | CIGAAL HEESTA CANDALIIBKA LA HADLOO | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=GDeNbz9svUQ | 0.166 | 1 |  |
| `HOn0IjXCwpU` | KHADRA DAAHIR CIGE HEES KABAN MACAAN AXMAD CALI CIGAAL | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=HOn0IjXCwpU | 0.107 | 1 |  |
| `HSBt1tQvkbc` | KHADRA DAAHIR CIGE \|\| DADAW SAADAASHA GUUR WITH LYRICS | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=HSBt1tQvkbc | 0.169 | 1 |  |
| `I70RLNiuRdc` | HEESTII KABAN QARAMI CAJIIB AH CADBI DIGE | Faysal Abba | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=I70RLNiuRdc | 0.066 | 1 |  |
| `I7AIGhXTxDA` | Heesta dhul aan ceel lahayn baan with lyrics saado iyo khadra daahir | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=I7AIGhXTxDA | 0.174 | 1 |  |
| `IY6NbEWP8oA` | Cumar Shooli - Naftaa igu kaa qasbaysee | SheekoHub | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=IY6NbEWP8oA | 0.029 | 1 |  |
| `IZjk6NUijmU` | m saleebaan | Saxartire | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=IZjk6NUijmU | 0.061 | 1 |  |
| `Jh1Hv0gv4b4` | HEES CUSUB ( HUQ IYO CIIL ) IFRAAX GARNAYL HCTV 2017 | Horn Cable Tv | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=Jh1Hv0gv4b4 | 0.104 | 1 |  |
| `KPS3hdEmUMI` | Wadada ku Qul Qul Instrumental \| Somali no copyright Music | Somali Nation | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=KPS3hdEmUMI | 0.054 | 1 |  |
| `KQ0wQW5YGzU` | CABDULQAADIR JUBA KABAN QAACI AH | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=KQ0wQW5YGzU | 0.174 | 1 |  |
| `LY76MQyZpQc` | SAYNAB CIGE  ( HADII AAN JACAYL JIRIN )  CIIDA HCTV 2016 | Horn Cable Tv | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=LY76MQyZpQc | 0.100 | 1 |  |
| `M0C7yxs9_Jk` | Maxamuud Gaywarow - FAADUMO AAN U DIRO TAAR | SheekoHub | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=M0C7yxs9_Jk | 0.063 | 1 |  |
| `M1qyVqrOo7c` | KHADRA DAAHIR CIGE AWRKII CIRKAAN WITH LYRICS KABAN | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=M1qyVqrOo7c | 0.158 | 1 |  |
| `M8tYMjSQDxs` | 100% Kaban spawning \| Escape from Tarkov | BoomBostic | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=M8tYMjSQDxs | 4.002 | 1 |  |
| `M9kGi9b7aME` | History of Somalia \| Wikipedia audio article | wikipedia tts | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=M9kGi9b7aME | 1.208 | 1 |  |
| `MtY0Zgeqxbc` | Xaliima Kh Magool Kalah Banaadiri | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=MtY0Zgeqxbc | 0.179 | 1 |  |
| `N2wtbI6JocQ` | Shar gudban shaydaan xijaaban by maxmaad axmad kuluc | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=N2wtbI6JocQ | 0.126 | 1 |  |
| `N4Wfe3A9a2s` | Kaban, Imma Need That Weapon \| Escape from Tarkov | BoomBostic | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=N4Wfe3A9a2s | 4.660 | 1 |  |
| `NclnWPrlV7g` | Hunting Tagilla, Killa and Kaban | BoomBostic | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=NclnWPrlV7g | 2.079 | 1 |  |
| `O5a8R9mJRmE` | Faarax Murtiile Best Song | Maxamed Moto Gabalaax | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=O5a8R9mJRmE | 0.143 | 1 |  |
| `PIKcVpapdUk` | UUR HOOYO \| AXMED MOOGE LIIBAAN NEW  VERSION ORIGINAL | Suugaan Safari | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=PIKcVpapdUk | 0.154 | 1 | possible Harvard duplicate: Side B. Track 2: Uur hooyo |
| `PZ2OZdWGqxc` | ALLOW YAA TIMA KU SIIYOO \|\| WITH LYRICS ORIGINAL | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=PZ2OZdWGqxc | 0.065 | 1 |  |
| `PdBg8GCaQT8` | HEESTA SIDII WABI DURDURAYOO MAANDEEQ IYO DAA'UUD | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=PdBg8GCaQT8 | 0.121 | 1 |  |
| `Ph4A6hBTMEs` | samawada Cabdilahi yarrow | 3M MEDIA PRODUCTIONS | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=Ph4A6hBTMEs | 0.089 | 1 |  |
| `Qb0M_uKRQpI` | Deeqa Ali - Yuuskana aday baray" Xusuustii khadra daahir Somali Qaraami video 20 | Somali New Entertainment | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=Qb0M_uKRQpI | 0.075 | 1 |  |
| `QmcpG7WVva0` | نوبة \| بيت العود - الخرطوم، في القاهرة | Bait Al Oud - Khartoum | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=QmcpG7WVva0 | 0.137 | 1 |  |
| `QsGWVLITMZk` | Heesta Darandoori Naas Naasi Faadumo  Abdilaahi kahin(Maandeeq) | Mahad Health Tips | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=QsGWVLITMZk | 0.196 | 1 |  |
| `R7TsYTTIDow` | MOOGE YARE \| HEESTII TOLAY REER HARGEYSOW XUSUUSTII MAXAMED MOOGE | Somali New Entertainment | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=R7TsYTTIDow | 0.046 | 1 |  |
| `RC9TFoOWQUU` | Maritime history of Somalia \| Wikipedia audio article | Wikipedia Fan | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=RC9TFoOWQUU | 0.259 | 1 |  |
| `RHXwuCSBgxA` | DAD HADUU IS QOONSADO :CISMAAN GACANLOW & MAGOOL | Xogta heesaha Media | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=RHXwuCSBgxA | 0.161 | 1 |  |
| `ROdJGJv6m-E` | SAMRIYE \|\| GAASIRA \|\| XUSSUSTI { AXMED MOOGE }HEES KAMAN AH 4K | MK SOMALI LYRICS | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=ROdJGJv6m-E | 0.070 | 1 | possible Harvard duplicate: Side A. Track 2: Gaasira |
| `RtiPMa_6ZLc` | hi - trey456 | Dubble TV | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=RtiPMa_6ZLc | 0.017 | 1 |  |
| `S-DpUQnO_04` | HAMSE QURUS \| BURJI \| - New Somali Music Video 2019 (Official Video) | Mo Hamid Tv | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=S-DpUQnO_04 | 0.091 | 1 |  |
| `S-Ijgcj--h4` | أحب مكان \| بيت العود - الخرطوم، في القاهرة | Bait Al Oud - Khartoum | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=S-Ijgcj--h4 | 0.093 | 1 |  |
| `SSkKyqFVTJw` | Cumar dhuule \|\| Bulliyeey shinbiryahay with lyrics | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=SSkKyqFVTJw | 0.113 | 1 | possible Harvard duplicate: Side A. Track 6: Bulliyeey |
| `SV8kkwLQw0U` | YURUB GEENYO IYO CAABI MIRE NEW KABAN 2017 | Yamyam Production | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=SV8kkwLQw0U | 0.102 | 1 |  |
| `SY6ZC0dN2Rw` | FANKA & SUUGAANTA  QARAAMI IYO WAAYO WAAYO BINTI CUMAR GACAL  23  02  2018 | Hamdi Jirow | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=SY6ZC0dN2Rw | 0.879 | 1 |  |
| `T0XKCTg-ENw` | Sayid Khaliifa Barariyaaq With Lyrics Kaban | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=T0XKCTg-ENw | 0.199 | 1 |  |
| `T1RkXfI111k` | bluegrass on OUD ???     here is One (BelOudGrass) | Yaz Fentazi Oud | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=T1RkXfI111k | 0.072 | 1 |  |
| `T1_DOJ5sPjA` | Cumar Shooli: A Pre-Stage Journey in Hargeisa, Somaliland | SheekoHub | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=T1_DOJ5sPjA | 0.034 | 1 |  |
| `TXaev_B64D0` | KABAN is MINE! - ESCAPE FROM TARKOV | JetLegends | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=TXaev_B64D0 | 0.168 | 1 |  |
| `Ta0Au4nCut0` | Seynab Cige Ruuxii Dhab Kuu Jecel with lyrics | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=Ta0Au4nCut0 | 0.065 | 1 |  |
| `TxOWX3Ug1ss` | SAALAX QAASIN HAYAAN WITH LYRICS KABAN | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=TxOWX3Ug1ss | 0.196 | 1 | possible Harvard duplicate: Side A. Track 2: Hayaan (or Aa haa aa haa) |
| `UEurDUdX254` | HEESTA BEERQAAD/HADUU BEERKU QAYBSAMO | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=UEurDUdX254 | 0.196 | 1 |  |
| `UIg3c1RnvRg` | GOORMA AYAA KUGU  DANBAYSAY HEESO QARAAMI AH DAAWO | Mallay Media Pro | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=UIg3c1RnvRg | 0.040 | 1 |  |
| `UPS-S1vmqyw` | HIBO NUURO ARINTII SAQIIRNIMO KABAN QAACI AH | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=UPS-S1vmqyw | 0.122 | 1 |  |
| `UTqgqOjm1mQ` | naftu jaah wareerto kaban by samj | sAm J hAsSaN | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=UTqgqOjm1mQ | 0.096 | 1 |  |
| `VCum01NljL8` | CABDULQAADIR JUBA HARGEYSA WITH LYRICS KABAN ORIGINAL | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=VCum01NljL8 | 0.145 | 1 |  |
| `WenX9NZSw2U` | Cumar Shooli Dawadeyda | SheekoHub | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=WenX9NZSw2U | 0.039 | 1 |  |
| `XD38OSJggJk` | Hello! Hello! Hi | Meme Sound Effects | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=XD38OSJggJk | 0.002 | 1 |  |
| `XbfjyNs-az8` | Qosolkii Adunka Bedelada Heesaha Iyo Heesihi Axmed Zaki VS Heelo | Maxamed Moto Gabalaax | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=XbfjyNs-az8 | 0.020 | 1 |  |
| `YwgJ6FtJBxY` | Somali Yacht Club - Pulsar \| Live at secret place, Ivano-Frankivsk | ChV Live Music Shooting | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=YwgJ6FtJBxY | 0.150 | 1 |  |
| `Z-NiQR0PyKk` | Hees Cusub Gacalo Maxamed Dawlad Official Video RAZMI FILMS 2018 HD | Maxamed Moto Gabalaax | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=Z-NiQR0PyKk | 0.109 | 1 |  |
| `ZF4atKpM_J4` | Heesta waa saboolka caadadi codkii khadra daahir with lyrics my favourite song | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=ZF4atKpM_J4 | 0.181 | 1 |  |
| `ZHLKiEk8gKU` | Amiin Diini Heesta Dadka Hayska Weyneyn Xusuustii Maxamed Mooge Barnaamijka Hobo | Bulsho News | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=ZHLKiEk8gKU | 0.070 | 1 |  |
| `_LLBGmZT_9A` | CABDALLAH Y HANUUNIYE LABA WAJIILAHA WITH LYRICS KABAN | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=_LLBGmZT_9A | 0.121 | 1 |  |
| `_ZVGJRDRxtQ` | FARXIYA FISKA HEESTII GAYAAN KABAN AAD U MACAAN 2019 | Suldaan Studio | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=_ZVGJRDRxtQ | 0.099 | 1 |  |
| `_ZgioTOR0_I` | Xasan aadan Samatar \|\| iima laabna Kaban Halaasi ah | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=_ZgioTOR0_I | 0.154 | 1 |  |
| `a3Fb9oYxDn8` | CABDULQAADIR JUBA \|\| BILAAL ADDIN BAANU NIRI WITH LYRICS KABANKII DAAUUD CALI  | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=a3Fb9oYxDn8 | 0.137 | 1 |  |
| `afvzHb8HByA` | Saalax qaasim iyo Hibo nuuro \|\| ka bul dheh with lyrcs | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=afvzHb8HByA | 0.144 | 1 |  |
| `at3lVurbbLY` | Khadra daahir iyo axmed Cali cigaal mar hadaynu nahay gacal ))PICOLO HD | PICOLO STUDIO BORAMA | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=at3lVurbbLY | 0.195 | 1 |  |
| `cIcAoGyEhec` | Somali Yacht Club - Vero \| Live at secret place, Ivano-Frankivsk | ChV Live Music Shooting | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=cIcAoGyEhec | 0.211 | 1 |  |
| `ciwWntOVOyc` | KABAN QARAMI CADBI DIGE | Faysal Abba | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=ciwWntOVOyc | 0.050 | 1 |  |
| `dvBxwTa8bDQ` | HODAN C/RAXMAN HEESTII SIYAR SIYAR 2016 LIVE  SHOW MUQDISHO HAPPY NEW YEAR 2016 | Aflaanta Studio | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=dvBxwTa8bDQ | 0.075 | 1 |  |
| `eGShnpG_iJ8` | Ha u Dhiman Daraadey ( QAACI ) | Rageedii™ | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=eGShnpG_iJ8 | 0.055 | 1 |  |
| `edve8f_itig` | Sahra Dawo iyo Heesta NAFTAN U JEELLAN AWGAA  Ereyadii Axmed Ileeye Samatar | Xogta heesaha Media | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=edve8f_itig | 0.111 | 1 |  |
| `fJIAw1Utgwg` | PvE Tarkov with Friends: Killing KABAN! | @Chaotic | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=fJIAw1Utgwg | 0.034 | 1 |  |
| `fJcC-YyKEUo` | Kaban Guide: Easy Loot im Autohandel! - #escapefromtarkov #eft #outc1der | outc1der | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=fJcC-YyKEUo | 0.254 | 1 |  |
| `fN2wrY2NTwQ` | SOMALI SISTER GIVEN MAGIC BAKHOOR AS GIFT | Ruqya talk | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=fN2wrY2NTwQ | 0.194 | 1 |  |
| `hKGFz4wry3w` | Kaban Hunt Ends In Massacre - Escape from Tarkov | Silent Johnny | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=hKGFz4wry3w | 0.040 | 1 |  |
| `hRP7X2VpAsg` | XUSUUSTII QARAAMI AXMED CALI CIGAAL IYO SHANKAROON \| IKRAAN JAAMAC IYO MAXAMED  | Somali New Entertainment | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=hRP7X2VpAsg | 0.172 | 1 |  |
| `hU0Recv46RI` | QARAAMI :#KAAR- CODKII CABDI XASAN DIGE ,LAXANKUNA WAA SAXARDIID M JEBIYE | Xogta heesaha Media | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=hU0Recv46RI | 0.142 | 1 |  |
| `hcmG0QJG5ik` | HEESTA: SHACNI IYO WANAAG DARARAMLE IYO SAHRA SIYAAD | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=hcmG0QJG5ik | 0.141 | 1 |  |
| `iHDy_VMbIug` | HEESTA ALIF LA KORDHAABAY  ERRAYADII ABWAAN SACIID SAALAX AXMED  CODKII MACAANAA | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=iHDy_VMbIug | 0.059 | 1 |  |
| `jFMfykNWCDc` | WARAYSI  HEESO AXMED NAAJI SACAD OO SHAHAADO GUDOONSIIYAY FURINLE  Q 2AAD | BAALGORAY MEDIA (BAALMED) | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=jFMfykNWCDc | 0.547 | 1 |  |
| `jT_GjVrjofg` | MAXMED DAA'UUD CALI MASXAF HEESTII MARKAAN DA'DII JIRAY 15 OO WAZIIR MAREEYE KA  | Hamdi Jirow | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=jT_GjVrjofg | 0.076 | 1 |  |
| `j_7OPbjKToU` | Ahmed Cali Cigaal \| Suleesha \| Hees Qaraami ah \| Original. | Qarri Jiqood | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=j_7OPbjKToU | 0.170 | 1 |  |
| `jgWIJ4mb6ew` | AWALE ADAN IYO FAISA  \| CULUSA ALLAHAYOW \| NEW SOMALI SONG 2026 #somalimusic20 | East Africa Media 24 | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=jgWIJ4mb6ew | 0.163 | 1 |  |
| `jvLETMskzVs` | Qaaci show Djibouti 2025\|\|KHAALID KAAMIL Heesta ISKA DAANSHO DAANSHO\|\| Xasuu | GEESKA TV | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=jvLETMskzVs | 0.072 | 1 |  |
| `jxlJVKmvd1g` | QAACI HEES QARAAMI AH 2018 HD TOP | XOGOGAAL | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=jxlJVKmvd1g | 0.042 | 1 |  |
| `kO1etaQM1LQ` | HAMDI AND ADAN WEDDING DAAF | ABDI STUDIO WEDDING PRO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=kO1etaQM1LQ | 1.810 | 1 |  |
| `kV5T6IIXSNY` | Kaban's vs 500 hour player! | MajorMage | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=kV5T6IIXSNY | 0.046 | 1 |  |
| `lNmTjCOdoco` | Xasan Aadan Samatar Caddo soo baxdiyo Lyrcs kaban macaan original best somali gu | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=lNmTjCOdoco | 0.153 | 1 |  |
| `lnup6ci6c9o` | Heesta la gurguuro caashaqa khadra iyo cigaal erayadii Xasan ganey | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=lnup6ci6c9o | 0.295 | 1 | possible Harvard duplicate: Side B. Track 2: La gurguuro caashaqa  (or: Waa godob jacayl) |
| `lz_2T96RAJQ` | Ismaaciil Aarka Heesta Ugaaso Xusuustii Ahun Cabdi Tahliil Barnaamijka Hobolka M | Bulsho News | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=lz_2T96RAJQ | 0.148 | 1 |  |
| `mRe4WsEpIts` | Daawo: Prof Dalxa iyo Hees Qaraami Ah Cajiib | Mallay Media Pro | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=mRe4WsEpIts | 0.039 | 1 |  |
| `m_yYvmuppJU` | Hassan Guedi   Abdi Piano   Atteyeh   Lagaanyo | Mallay Media Pro | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=m_yYvmuppJU | 0.065 | 1 |  |
| `mokf-uVjk94` | Heesta: Qoortada dheer, Cabdi Salaad beerdilaashe iyo Xaliimo khaliif Cumar(mago | Mahad Health Tips | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=mokf-uVjk94 | 0.150 | 1 |  |
| `mqikTRNWrxU` | Qasiido War Hooy Soonku Waafaral \|\| Daud Xanfar \|\| 2021 | Xasan Absuge  official | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=mqikTRNWrxU | 0.040 | 1 |  |
| `mrSr45m1EBA` | XASAN AADAN SAMATAR DUUFAAN WITH LYRICS KABAN MACAAN | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=mrSr45m1EBA | 0.185 | 1 |  |
| `mxS07WpEXrk` | SPTarkov NPCs Battle #16: LexOs Car Dealership Raid | CafeinSquirrel | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=mxS07WpEXrk | 0.272 | 1 |  |
| `nVaXTALZaU4` | Cabdullaahi Nuur Xalweyste Faadumo with lyrics | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=nVaXTALZaU4 | 0.118 | 1 |  |
| `nly8WqqFTrc` | Accidental Kaban Kill | Axel_tv | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=nly8WqqFTrc | 0.194 | 1 |  |
| `noi8ZPXpj5Q` | WAA BIXISO ODAYOO, LEGEND KHADRA DAAHIR CIGE ERAYADII BAGAAG | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=noi8ZPXpj5Q | 0.168 | 1 |  |
| `oZFiNQcvjAM` | Nuuradiin Cali Amaan Heeso Qaraami Ah 0fficial video | Somali New Entertainment | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=oZFiNQcvjAM | 0.045 | 1 |  |
| `oiGbHEZt8xA` | SAYNAB CIGE OO RUXDAY FESTIVELKII IYO HEESO CAJIIB AH | Mallay Media Pro | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=oiGbHEZt8xA | 0.075 | 1 |  |
| `onm81Sw_Fhg` | NIIKO SOMALI BANTU BOYS KISMAYO SHARAROW BART 62 2022 | Studio Ali Adan | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=onm81Sw_Fhg | 0.677 | 1 |  |
| `p9E1zSMu3Os` | XASAN AADAN SAMATAR \| BALADWEYN \| HEES QARAAMI AH BILAA MUSIC AH | M. Abshir | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=p9E1zSMu3Os | 0.119 | 1 |  |
| `pF4GBeeeBFc` | Desire for More: Cumar Shooli's Hargeisa Experience | SheekoHub | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=pF4GBeeeBFc | 0.037 | 1 |  |
| `pFNRuG6K22I` | Escape from Tarkov, Back on Streets 💀 \| Revenge on Kaban & Quest Progression | TheBearAttitude | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=pFNRuG6K22I | 3.075 | 1 |  |
| `qxGLNDcqX_w` | Always wanted to learn to play the Arabic/Somali oud this way. This is pure tale | Ahmed 4K | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=qxGLNDcqX_w | 0.076 | 1 |  |
| `roO0SzwghGo` | Oud (Arabic) \| E-A-Db-Gb-B-E \| HQ Tuning Notes & Info \| World of Tuning \| Rā | Rāga Junglism's World of Tuning \| Global Guitar | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=roO0SzwghGo | 0.029 | 1 |  |
| `ssjsVIeoJkI` | Khadra daahir  waa saboolka caadadi hees qiso weyn xambaarsan | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=ssjsVIeoJkI | 0.181 | 1 |  |
| `sxl-YpDoOB4` | somalia players training in ramadan 01/07/2015 | isma love | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=sxl-YpDoOB4 | 0.021 | 1 |  |
| `tCCrsVurjLA` | Sooraan Hees Macaan Jaceyl Baa I waalay Lyrics 2018   YouTube | Raaxeeye Vevo | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=tCCrsVurjLA | 0.076 | 1 |  |
| `tjpsLGRoebI` | XASAN A. SAMATAR IYO XALIIMO KH. MAGOOL \| CAASHAQA HA BAAYICIN \| QARAAMI BILAA | M. Abshir | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=tjpsLGRoebI | 0.125 | 1 | possible Harvard duplicate: Side A. Track 4: Caashaqa ha baayicin |
| `uJpDG4K48yU` | KABAN Bagha mra -پڕۆگرامی  کابان باغەمرە | RENG TV | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=uJpDG4K48yU | 0.734 | 1 |  |
| `uXzbZfh0OyI` | mandeq nuur iyo heesti leegag 2015 | Abdilahi Dauud | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=uXzbZfh0OyI | 0.115 | 1 |  |
| `ubLN1DYDzHk` | QARAAMI ~ MURUG \| SAYNAB CIGE \| NEW VERSION ORIGINAL | Suugaan Safari | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=ubLN1DYDzHk | 0.115 | 1 |  |
| `ulj4XkvQPyc` | ISMAACIIL DULCAD HEESTA DEGAN QARAAMI  OFFICIAL VIDEO 2018 HORN CABLE TV | Horn Cable Tv | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=ulj4XkvQPyc | 0.105 | 1 |  |
| `vF7KUre1vOE` | AAMINA CALI JIIS \|\| GOORMAAN HELAYAA \|\| HEES MACAAN QAARAAMI XUL AH KABAN BE | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=vF7KUre1vOE | 0.097 | 1 |  |
| `vWY6MnXIojI` | Barnaamij Gaara: Siyaad Sakariye oo ah nin hibo u leh inuu bilaa music ku qaado  | CBA TV | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=vWY6MnXIojI | 0.327 | 1 |  |
| `vySYlddTJjg` | Shey mire dacar iga tiiri caashaqa best kaban qaaci | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=vySYlddTJjg | 0.098 | 1 | possible Harvard duplicate: Side A. Track 3: Iga tiiri caashaqa (or: Taallo maw u samaysaan) |
| `wZYGp9g416o` | Karim Kaban - Yar Jwana(Ahang)_Clip \| كه‌ریم كابان - یار جوانه‌ | Karwan Dzaiy | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=wZYGp9g416o | 0.101 | 1 |  |
| `wj_XmP0XYvg` | KABAN - پرۆگرامی نوێی کابان | Reng Group HD | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=wj_XmP0XYvg | 0.592 | 1 |  |
| `x7DwQIXS6Xc` | CABDULQAADIR MACALIN JUBA \|\| HARGEYSAAY KABAN WITH LYRICS | GEEDI SHAAMBOW STUDIO | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=x7DwQIXS6Xc | 0.158 | 1 |  |
| `xRGZnltO3lo` | ABDIFATAAX MUKHTAAR WAX DHINTAAD KA SAMIRTAA BEATZ 2025 HD | LEEGO TV | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=xRGZnltO3lo | 0.120 | 1 |  |
| `xprvP2Cdp_Y` | axmed mooge caashaqa isoo riday   qaaci } ~picolo sterio HD | PICOLO STUDIO BORAMA | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=xprvP2Cdp_Y | 0.101 | 1 |  |
| `xz5ECzpRkHA` | Sahra Halgan (Somaliland) aux Suds, à Arles, Place Voltaire 16/07/2021 | Transcordancias & Jugalbandis - Global Music Live | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=xz5ECzpRkHA | 0.084 | 1 |  |
| `ya-OHP8Cm5c` | Heestii Nafjacayl Bastedan Bogsiiya Iyo Barwaaqo Qalanjo 2014 | Horn Cable Tv | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=ya-OHP8Cm5c | 0.110 | 1 |  |
| `zE4ZZ0linYg` | CAWEYSKA BEERTA LIBAAXYADA XIDIGAHA FANKA & JIMCAHA HBNKA SABTI SO GALAY | Real-Music- 4K | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=zE4ZZ0linYg | 0.050 | 1 |  |
| `zhToexO43cg` | Sahara abubakar | bigahmed92 | [Creative Commons Attribution license (reuse allowed)](https://creativecommons.org/licenses/by/3.0/legalcode) | https://www.youtube.com/watch?v=zhToexO43cg | 0.048 | 1 |  |

### Rights-permitting, not downloaded (33)

| item | title | licence | URL | why pending |
| --- | --- | --- | --- | --- |
| `29sXrfVRwtA` | Riwaayadi Guri Barwaaqo Iyo Heello Qaybtii 2Aad | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=29sXrfVRwtA | max-hours cap 40.0 h reached |
| `41TGsoetWDI` | AWALE ADAN & IFTIN YARE  DAYAXA  DJIBOUTI LAGA DAWADA  IOG 2026 | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=41TGsoetWDI | max-hours cap 40.0 h reached |
| `4ONIzmPqPqg` | SOORAAN OO FANAAN NOQDAY HEES CUSUB YAAB KKKKKKK | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=4ONIzmPqPqg | max-hours cap 40.0 h reached |
| `4R5-r4kF8vY` | Guri Bawaaqo Iyo Abwaan Heello Riwaayadi Gurku waa Bilicdeenee BAHDILADA KADAAYA | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=4R5-r4kF8vY | max-hours cap 40.0 h reached |
| `4SrvitNJ6BU` | Mouse speedpaint \|  Chibi | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=4SrvitNJ6BU | max-hours cap 40.0 h reached |
| `5lJm40LhCZo` | Abwaan Heelo Iyo Guri Barwaaqo 2019 HD | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=5lJm40LhCZo | max-hours cap 40.0 h reached |
| `8Xun9OhX1Cs` | Heelloo Gistlover and Lizzy AUTO BOLA LIVE AUDIO | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=8Xun9OhX1Cs | max-hours cap 40.0 h reached |
| `8dq1ILe0u2k` | EL GATO EN EL SOMBRERO SE MULTIPLICA EN HELLO NEIGHBOR (MOD) | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=8dq1ILe0u2k | max-hours cap 40.0 h reached |
| `B3b7RP8C1TM` | ABWAN C/RAXMAN HEELO QOSOL IS HAYNWAAYAY???? IYO MAANSO KU RAAGTAY? | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=B3b7RP8C1TM | max-hours cap 40.0 h reached |
| `DB4WypnAc7U` | MAJAJILAYSTE GURI BARWAAQO IYO ABWAAN CRAXMAAN HELLO LA SOCO QAYBTA 2AAD 2017 HD | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=DB4WypnAc7U | max-hours cap 40.0 h reached |
| `DeIVB-0brKQ` | FAST FREDBEAR PERO SU CASA ESTÁ INUNDADA EN AGUA (HELLO NEIGHBOR MOD) | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=DeIVB-0brKQ | max-hours cap 40.0 h reached |
| `DuMwu5phJU8` | FASTFREDBEAR PERO SU CASA ES EN LA LUNA (HELLO NEIGHBOR MOD) | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=DuMwu5phJU8 | max-hours cap 40.0 h reached |
| `KoJD2zhrr50` | Balance - Ander Martin Carricas | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=KoJD2zhrr50 | max-hours cap 40.0 h reached |
| `OGj2-Gp8sGc` | Abdi Heelo-Hibo | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=OGj2-Gp8sGc | max-hours cap 40.0 h reached |
| `QXtp7FykDLU` | Riwaaayadii Guri Barwaaqo iyo Heelo Qolikii Adunka | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=QXtp7FykDLU | max-hours cap 40.0 h reached |
| `SF00CSBw9Y8` | Buraanbur iyo Heello Cajiib ah oo ay Ardayda Dugsiga Sare Imaamu Alnawawi Qardho | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=SF00CSBw9Y8 | max-hours cap 40.0 h reached |
| `Z4LK9VwvU_U` | 'Waxay la kulmeen dibjirtii shalay shacabka xasuuqay,waa u ayaan daro,"Axmed Hee | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=Z4LK9VwvU_U | max-hours cap 40.0 h reached |
| `Z76TEBYP9cY` | RUWAAYAD CUSUB KALA MAQAN 2021 | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=Z76TEBYP9cY | max-hours cap 40.0 h reached |
| `bGUSlg3aw5s` | Cigaal iyo Khadra-Daahir_Heesta Leydh Caafimaad | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=bGUSlg3aw5s | max-hours cap 40.0 h reached |
| `bYtCnBuAIl8` | Heelloo Nigerian gouvernement se alafia lewa sir Hmmmmm today is about Nigérian  | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=bYtCnBuAIl8 | max-hours cap 40.0 h reached |
| `bcb9uyKZRjk` | FAST FREDBEAR PERO SU CASA ES UN TREN (HELLO NEIGHBOR MOD) | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=bcb9uyKZRjk | max-hours cap 40.0 h reached |
| `cYD604SSUKI` | Abwaan Cabdiraxmaan Hello Qosolkii Aduunka | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=cYD604SSUKI | max-hours cap 40.0 h reached |
| `hGOxLARuPmQ` | Fredbear, But We Are 10,000ft In The SKY.. | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=hGOxLARuPmQ | max-hours cap 40.0 h reached |
| `jDPoYOKAP5w` | Fruit Fly Auto Farming In Growtopia | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=jDPoYOKAP5w | max-hours cap 40.0 h reached |
| `kWCy0Mq693o` | Guri Barwaaqo Riwaayadii Reer Miyiga Qaybtii 2Aad Qosolkii Aduunka | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=kWCy0Mq693o | max-hours cap 40.0 h reached |
| `nH772RgxcrU` | HIBO NUURO IYO CABDULQAADIR JUBA HALOOW WITH LYRICS | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=nH772RgxcrU | max-hours cap 40.0 h reached |
| `pMC4FqQKYag` | Kim&Liz ASMR Compilation Eating ASMR | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=pMC4FqQKYag | max-hours cap 40.0 h reached |
| `psv4IUJiGI4` | DAAWO GURI BARWAAQO IYO ABWAAN CABDIRAXMAAN {HELLO} SHEEKADI UGU LAYABKA BADNAYD | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=psv4IUJiGI4 | max-hours cap 40.0 h reached |
| `qbjHW9xKypw` | MAGAALADA HARGAYSA OO AHAYD HOYGA FANKA AYAA MUDOOYINKII UGU DANBEYEY HOOS UDHAC | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=qbjHW9xKypw | max-hours cap 40.0 h reached |
| `r6r-P60MMxM` | DHANTO CUSUB 2021 \|\| GALMUDUG \|\| JAMAAL HEELO 2021  by kooxda qaran band | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=r6r-P60MMxM | max-hours cap 40.0 h reached |
| `vtsCgpxScRE` | GURI BARWAAQO IYO ABWAAN CABDI RAXMAAN {HELLO}  FILIMKA SANADKA CUSUB 2017 HD | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=vtsCgpxScRE | max-hours cap 40.0 h reached |
| `wCBCs9neLls` | PRINCESS ISTAAHIL MAXAMED HEESKA HELLO 2019 | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=wCBCs9neLls | max-hours cap 40.0 h reached |
| `zs85mpEqzTQ` | Laguna Seca ACC Test F2 Mod \| 1:12.522 | Creative Commons Attribution license (reuse allowed) | https://www.youtube.com/watch?v=zs85mpEqzTQ | max-hours cap 40.0 h reached |

### Skipped (22)

| reason | count |
| --- | --- |
| no licence field | 15 |
| unavailable | 7 |

Examples (licence text as read from the source):

- `2e5ogbwRBUU` — Cumar Dhuule Heestii _ Koley Caashaqaygii _ Hees Qaraami Xul ah With L — licence: (none)  → no licence field
- `G-YwmltQrkM` — KABAN Warte -پڕۆگرامی نوێی کابان وەرتێ — licence: Creative Commons Attribution license (reuse allowed) https://creativecommons.org/licenses/by/3.0/legalcode → unavailable: DownloadError('ERROR: unable to download video data: HTTP Error 403: Forbidden')

## Hand-added URLs (--sources-file)

Queries:

- `--sources-file rows`

### Downloaded (0)

None.

### Rights-permitting, not downloaded (0)

None.

### Skipped (0)

None.

## Dedupe

- Exact sha256 duplicates of the corpus (excluded): 0
- Near-duplicates of Ahmed's corpus (MERT last-layer cosine >= 0.97, excluded): 2
- Possible Harvard duplicates by title (logged, kept): 10
- Nearest-Ahmed cosine over 163 downloaded files: min 0.634, median 0.925, max 0.986

- near-duplicate: `yt/04nT_3DC1vA/04nT_3DC1vA.m4a` ~ data/ahmed_raw/GarageBand/caruurta.band/Media/06 Laba aabo wada dhalay Kaban.m4a (cos 0.9858)
- near-duplicate: `yt/2LOf1qfZz6I/2LOf1qfZz6I.m4a` ~ data/ahmed_raw/Logic/Raali/Audio Files/Raali_1#07.aif (cos 0.9726)
- possible Harvard duplicate: `yt/vySYlddTJjg` Shey mire dacar iga tiiri caashaqa best kaban qaaci ~ Side A. Track 3: Iga tiiri caashaqa (or: Taallo maw u samaysaan)
- possible Harvard duplicate: `yt/5W7L14G_sGI` MAXAMED SALEEBAAN  TUBEEC \| HEESTII GUFAACO \| QARAAMI BILA ~ Side B. Track 2: Gufaaco
- possible Harvard duplicate: `yt/88JrP1EkY-M` XASAN AADAN SAMATAR, WAA LA II ADIMAY AXADDII SIDAAN  KUU EE ~ Side B. Track 2: Axaddii
- possible Harvard duplicate: `yt/TxOWX3Ug1ss` SAALAX QAASIN HAYAAN WITH LYRICS KABAN ~ Side A. Track 2: Hayaan (or Aa haa aa haa)
- possible Harvard duplicate: `yt/tjpsLGRoebI` XASAN A. SAMATAR IYO XALIIMO KH. MAGOOL \| CAASHAQA HA BAAYI ~ Side A. Track 4: Caashaqa ha baayicin
- possible Harvard duplicate: `yt/PIKcVpapdUk` UUR HOOYO \| AXMED MOOGE LIIBAAN NEW  VERSION ORIGINAL ~ Side B. Track 2: Uur hooyo
- possible Harvard duplicate: `yt/ROdJGJv6m-E` SAMRIYE \|\| GAASIRA \|\| XUSSUSTI { AXMED MOOGE }HEES KAMAN ~ Side A. Track 2: Gaasira
- possible Harvard duplicate: `yt/SSkKyqFVTJw` Cumar dhuule \|\| Bulliyeey shinbiryahay with lyrics ~ Side A. Track 6: Bulliyeey
- possible Harvard duplicate: `yt/0qNuF1P3ZvE` Maxamad S Tubeec \|\| Nasteexo with lyrics ~ Side A. Track 3: Nasteexo
- possible Harvard duplicate: `yt/lnup6ci6c9o` Heesta la gurguuro caashaqa khadra iyo cigaal erayadii Xasan ~ Side B. Track 2: La gurguuro caashaqa  (or: Waa godob jacayl)

## Runs

| when | sources | search-only | limit | gaps (s) | candidates | downloaded | pending | skipped | cached | waits | elapsed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-26T05:41:23+00:00 | ia yt | True | 15 | ?/? | 30 | 0 | 0 | 30 | 0 | 17 | 89.7 s |
| 2026-09-26T05:45:37+00:00 | yt | False | 3 | ?/? | 3 | 3 | 0 | 0 | 0 | 7 | 37.0 s |
| 2026-09-26T07:27:54+00:00 | ia yt | False | 0 | 5.0/10.0 | 400 | 160 | 33 | 207 | 18 | 378 | 2069.5 s |
