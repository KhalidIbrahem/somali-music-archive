# Harvard collection fetch — gap list

Generated 2026-09-26 05:44:30 -0500 by `apps/ai-service/scripts/harvard_gap_report.py` from `data/harvard_raw/manifest.jsonl` (1085 rows, 975 objects after keeping the last row per cid; last modified 2026-09-26 05:25:24), `data/harvard_catalog/mus00044.csv` and a listing of `data/harvard_raw/legacy` (105 `*.mp3` files). Every number below is computed from those inputs; rerun the script to refresh it. Research-only material: the files it counts are git-ignored and are never served (`docs/data/HARVARD_TERMS.md`).

**Status: complete.** Every one of the 975 linked catalog objects has a manifest row; 109 skipped objects would be re-queued by another fetcher run.

## 1. Totals

| quantity | count |
| --- | --- |
| catalog rows (Series / Item / Track) | 1 / 152 / 1142 |
| catalog objects with a digital-content link | 975 (150 cassette-level, 825 tracks) |
| manifest rows / objects | 1085 / 975 |
| fetched (this run) | 663 |
| legacy (2025 files matched to the catalog by URN) | 102 |
| skipped, total | 210 |
| skipped: requires a Harvard login (HarvardKey); not public | 77 |
| skipped: no public stream on the SDS page (no playlist) | 32 |
| skipped: cassette-level object superseded by its track objects (policy skip) | 91 |
| skipped: same digital object as another component (duplicate link, policy skip) | 10 |
| pending (linked objects with no manifest row yet) | 0 |
| catalog tracks with no digital object (not a fetch failure) | 317 |
| catalog cassette-level objects with no digital object | 2 |
| legacy files on disk / with no manifest row (see 8) | 105 / 3 |

## 2. Hours on disk

`duration_s` is what the fetcher measured with ffprobe on each file. Legacy files with no manifest row (section 8) are in no figure here.

| files | hours |
| --- | --- |
| fetched only | 102.27 h |
| legacy only | 21.84 h |
| fetched + legacy | 124.11 h |
| fetched + legacy, minus legacy whole-cassette files whose tracks are also on disk (unique audio) | 115.40 h |

## 3. Plan and progress

`harvard_fetch.plan()` over the catalog, with the manifest's legacy rows as the legacy index: track-level objects are fetched; a cassette-level object only when its cassette has no linked track objects; a link already on disk from 2025 is `legacy`; a link that repeats an earlier component is `duplicate_link`.

| plan group | objects | note |
| --- | --- | --- |
| fetch | 772 | fetched 663, skipped 109, pending 0; 37 of them cassette-level objects without linked tracks |
| legacy | 102 | 2025 files, not re-fetched |
| cassette_superseded_by_tracks | 91 | policy skip, see 4 |
| duplicate_link | 10 | policy skip, see 4 |

## 4. Skipped objects

Every manifest object whose last row has `status: skipped`, grouped by reason. Policy skips are final; the others are re-queued on the fetcher's next run.

### 4.1 Requires a Harvard login (HarvardKey); not public (77) — `requires_login`

| cid | cassette | type | title | reason | link |
| --- | --- | --- | --- | --- | --- |
| mus00044c00257 | 12222 | Track | Side A. Track 1: Allay Ileehee Ilwaaday, 1988 | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962064 |
| mus00044c00258 | 12222 | Track | Side A. Track 2: Cibaaro | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962066 |
| mus00044c00259 | 12222 | Track | Side A. Track 3: Geestaada ila qabo | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962078 |
| mus00044c00260 | 12222 | Track | Side A. Track 4: Xilashadii Gayaankay | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962074 |
| mus00044c00261 | 12222 | Track | Side A. Track 5: Bal kaalay Bilanay | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962072 |
| mus00044c00262 | 12222 | Track | Side B. Track 1: Nabsi Baa Hiiliyoo | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962080 |
| mus00044c00263 | 12222 | Track | Side B. Track 2: Raaxeeye Burcaawi | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962070 |
| mus00044c00264 | 12222 | Track | Side B. Track 3: Sidii Hogosha Roobka | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962084 |
| mus00044c00265 | 12222 | Track | Side B. Track 4: Gardarro | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962062 |
| mus00044c00266 | 12222 | Track | Side B. Track 5: Sidee Baan Tolow Idhaahdaa | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962076 |
| mus00044c00267 | 12223 | Track | Side A. Track 1: Afka Lagama Sheegtoo | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33959066 |
| mus00044c00268 | 12223 | Track | Side A. Track 2: Laqanyada Jacaylka | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33959068 |
| mus00044c00269 | 12223 | Track | Side A. Track 3: Faraskaagii laga badi | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33959054 |
| mus00044c00270 | 12223 | Track | Side A. Track 4: Mas'alo (or Waxaan kaa magansadaba) | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33959070 |
| mus00044c00271 | 12223 | Track | Side A. Track 5: Baraarug | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33959056 |
| mus00044c00272 | 12223 | Track | Side B. Track 1: Awrkii Cirka | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33959074 |
| mus00044c00273 | 12223 | Track | Side B. Track 2: Waa iska Xaal Adduun | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33959072 |
| mus00044c00274 | 12223 | Track | Side B. Track 3: Sida Laamo looshaha | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33959062 |
| mus00044c00275 | 12223 | Track | Side B. Track 4: Xaafuun | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33959058 |
| mus00044c00276 | 12223 | Track | Side B. Track 5: Dardaaran or Adiyo doqonnimadaa | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33959060 |
| mus00044c00277 | 12224 | Track | Side A. Track 1: Naagtii Walaalkay | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962379 |
| mus00044c00278 | 12224 | Track | Side A. Track 2: Taallo ma u samaysaan (or: Iga tiiri caashaqa) | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962373 |
| mus00044c00279 | 12224 | Track | Side A. Track 3: Durdur, 1975 | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962377 |
| mus00044c00280 | 12224 | Track | Side A. Track 4: Nayruus, 1974-09-08 | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962371 |
| mus00044c00281 | 12224 | Track | Side B. Track 1: Raalliya | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962367 |
| mus00044c00282 | 12224 | Track | Side B. Track 2: Aroor | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962369 |
| mus00044c00283 | 12224 | Track | Side B. Track 3: Nugul | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962381 |
| mus00044c00668 | 12277 | Track | Side A. Track 1: Arrintaan | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102428942 |
| mus00044c00669 | 12277 | Track | Side A. Track 2: Waan kaa helay | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102428952 |
| mus00044c00670 | 12277 | Track | Side A. Track 3: Hammigayga waa heli waayey | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102428901 |
| mus00044c00671 | 12277 | Track | Side A. Track 4: Inaan meel kale maagayeey | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102428950 |
| mus00044c00672 | 12277 | Track | Side A. Track 5: Abbaayeey adoon ku arkaaya | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102428958 |
| mus00044c00673 | 12277 | Track | Side B. Track 1: Duqyahow da'daa ogaaw | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102428891 |
| mus00044c00674 | 12277 | Track | Side B. Track 2: Aduun baan ku eegaa ii imaaw | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102428936 |
| mus00044c00675 | 12277 | Track | Side B. Track 3: Ilmo aabbahood ku imaan qabaan | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102428899 |
| mus00044c00676 | 12277 | Track | Side B. Track 4: Ma kaa maarmow | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102428917 |
| mus00044c00677 | 12277 | Track | Side B. Track 5: Ka haray, ka haray | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102428919 |
| mus00044c00679 | 12278 | Track | Side A. Track 1: Adigu iskay sii | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429049 |
| mus00044c00680 | 12278 | Track | Side A. Track 2: Shishifadii Naftaydow | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102428999 |
| mus00044c00681 | 12278 | Track | Side A. Track 3: Kaftan iyo jacaylkuna | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429031 |
| mus00044c00683 | 12278 | Track | Side B. Track 2: Alla kala fogaa | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429011 |
| mus00044c00684 | 12278 | Track | Side B. Track 3: Anna wadhida dumarkiyo | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429019 |
| mus00044c00685 | 12278 | Track | Side B. Track 4: Garta qaad jacaylow | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429025 |
| mus00044c00686 | 12278 | Track | Side B. Track 5: Caashaqa sed ima harinee | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429007 |
| mus00044c00700 | 12279 | Track | Side A. Track 1: Waqti | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429763 |
| mus00044c00701 | 12279 | Track | Side A. Track 2: Qaraami | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429723 |
| mus00044c00702 | 12279 | Track | Side A. Track 3: Nasteexo | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429731 |
| mus00044c00703 | 12279 | Track | Side A. Track 4: Qaraami | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429755 |
| mus00044c00704 | 12279 | Track | Side A. Track 5: Raaxeeye | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429709 |
| mus00044c00705 | 12279 | Track | Side B. Track 1: Gufaaco | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429707 |
| mus00044c00706 | 12279 | Track | Side B. Track 2: Sannad waliba hoodiyo | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429691 |
| mus00044c00707 | 12279 | Track | Side B. Track 3: Ii dheel dhudiyeey | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429699 |
| mus00044c00708 | 12279 | Track | Side B. Track 4: Ma ogtahay | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429739 |
| mus00044c00710 | 12280 | Track | Side A. Track 1: Geesiga sidee baa loo helaa | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430585 |
| mus00044c00711 | 12280 | Track | Side A. Track 2: Ruuneey waxaa la yidhi | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430615 |
| mus00044c00712 | 12280 | Track | Side A. Track 3: Aboowe ii warran | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430595 |
| mus00044c00713 | 12280 | Track | Side A. Track 4: Ma doob loo xishaa jira | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430617 |
| mus00044c00714 | 12280 | Track | Side B. Track 1: Fadhiyaro geel | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430551 |
| mus00044c00715 | 12280 | Track | Side B. Track 2: Doob qalanjadii gabay | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430563 |
| mus00044c00716 | 12280 | Track | Side B. Track 3: Nin xun xilo ha moodinin | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430553 |
| mus00044c00717 | 12280 | Track | Side B. Track 4: Heer Tumasho | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430559 |
| mus00044c00719 | 12281 | Track | Side A. Track 1: Adduunyooy waalaaleey | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430614 |
| mus00044c00720 | 12281 | Track | Side A. Track 2: Dhawrta idinkaa eh | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430572 |
| mus00044c00721 | 12281 | Track | Side A. Track 3: Dalxiis | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430647 |
| mus00044c00722 | 12281 | Track | Side B. Track 1: Waa la i heloo | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430591 |
| mus00044c00723 | 12281 | Track | Side B. Track 2: Xaggeen talo kaga hagaagaa | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430633 |
| mus00044c00724 | 12281 | Track | Side B. Track 3: Calaf lama dago | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430562 |
| mus00044c00725 | 12281 | Track | Side B. Track 4: Masiibo | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430594 |
| mus00044c00726 | 12281 | Track | Side B. Track 5: Taariikhdu waxbay hagtaa | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430582 |
| mus00044c00832 | ? | Track | Side A. Track 1: Waa duni gabowdoo [An aged/ending world], 1964-06-20 | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102449879 |
| mus00044c00833 | ? | Track | Side A. Track 2: Caydhiin iyo Bisayl or Cawaansayeey (from the play "Indho Sarcaad"), 1964-12-05 | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102449867 |
| mus00044c00834 | ? | Track | Side A. Track 3: Dagaallan, 1963 | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102449863 |
| mus00044c00835 | ? | Track | Side A. Track 4: Geeriyo magli'i (from the play "Indho Sarcaad"), 1963 | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102449875 |
| mus00044c00836 | ? | Track | Side B. Track 1: Geeriyo magli'i (from the play Indho Sarcaad), 1963 | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102449861 |
| mus00044c00837 | ? | Track | Side B. Track 2: Hawdeey magacaagiyo, 1965-04-03 | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102449871 |
| mus00044c00838 | ? | Track | Side B. Track 3: Ma habboontahay, 1962-10-23 | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102449877 |
| mus00044c00839 | ? | Track | Side B. Track 4: Wajeereey | SDS error page: 'Unfortunately, your request could not be completed' (server-side, not a login gate) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102449873 |

### 4.2 No public stream on the SDS page (no playlist) (32) — `no_playlist`

| cid | cassette | type | title | reason | link |
| --- | --- | --- | --- | --- | --- |
| mus00044c01000 | 12315 | Track | Side A. Track 1: Laal | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12315_1_1_Laal.mp3 |
| mus00044c01001 | 12315 | Track | Side A. Track 2: Hooyadaa nin liitow | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12315_1_2_Hooyadaa-nin-liitow.mp3 |
| mus00044c01002 | 12315 | Track | Side A. Track 3: Wacanay, 1969-06-01 | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12315_1_3_Wacanay.mp3 |
| mus00044c01003 | 12315 | Track | Side B. Track 1: Hilinka (or: Nabsi baa hiiliyee) | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12315_2_1_Hilinka-or-Nabsi-baa-hiiliyee.mp3 |
| mus00044c01004 | 12315 | Track | Side B. Track 2: Higsad (Qaraami) | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12315_2_2_Higsad.mp3 |
| mus00044c01005 | 12315 | Track | Side B. Track 3: Nin Garad | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12315_2_3_Nin-Garad.mp3 |
| mus00044c01007 | 12316 | Track | Side A. Track 1: Jawaabtii Beledweyne | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12316_1_1_Jawaabtii-Beledweyne.mp3 |
| mus00044c01008 | 12316 | Track | Side A. Track 2: Sama wade Hadraawow | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12316_1_2_Samawade-Hadraawow.mp3 |
| mus00044c01009 | 12316 | Track | Side A. Track 4: Qaaf lala qaade | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12316_1_4_Qaaf-lala-Qaade.mp3 |
| mus00044c01010 | 12316 | Track | Side B. Track 1: [?] | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12316_2_1.mp3 |
| mus00044c01011 | 12316 | Track | Side B. Track 2: [?] | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12316_2_2.mp3 |
| mus00044c01313 | 12316 | Track | Side  B. Track 4: [?] | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12316_2_4.mp3 |
| mus00044c01314 | 12316 | Track | Side B. Track 5: [?] | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12316_2_5.mp3 |
| mus00044c01315 | 12316 | Track | Side B. Track 6: [?] | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12316_2_6.mp3 |
| mus00044c01316 | 12316 | Track | Side B. Track 7: [?] | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12316_2_7.mp3 |
| mus00044c01317 | 12316 | Track | Side B. Track 8: [?] | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12316_2_8.mp3 |
| mus00044c01318 | 12316 | Track | Side B. Track 9: [?] | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12316_2_9.mp3 |
| mus00044c01014 | 12317 | Track | Side A. Track 1: Jowharad la mooddey | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12317_1_1_Jowharad-la-mooddey.mp3 |
| mus00044c01015 | 12317 | Track | Side A. Track 2: Bariidaduna waa sedee (or: Alla barasho wacanaa) | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12317_1_2_Bariidaduna-waa-sedee-or-Alla-barasho-wacanaa.mp3 |
| mus00044c01016 | 12317 | Track | Side A. Track 3: Waa bar kuma taal | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12317_1_3_Waa-bar-kuma-taal.mp3 |
| mus00044c01017 | 12317 | Track | Side B. Track 1: Ma ogiye jacayl | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12317_2_1_Ma-ogiye-jacayl.mp3 |
| mus00044c01018 | 12317 | Track | Side B. Track 2: Waa tahay | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12317_2_2_Waa-tahay.mp3 |
| mus00044c01022 | 12318 | Track | Side B. Track 1: Waa la guursadee | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12318_2_1_Waa-la-guursadee.mp3 |
| mus00044c01023 | 12318 | Track | Side B. Track 2: Gabdhahaan gacalkooda | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12318_2_2_Gabdhahaan-gacalkooda.mp3 |
| mus00044c01024 | 12318 | Track | Side B. Track 3: Saynabooy | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12318_2_3_Saynabooy.mp3 |
| mus00044c01025 | 12318 | Track | Side A. Track 1: Kuwi ku dhalee | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12318_1_1_Kuwi-ku-dhalee.mp3 |
| mus00044c01026 | 12318 | Track | Side A. Track 2: Meeday meeday | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12318_1_2_Meeday-meeday.mp3 |
| mus00044c01027 | 12318 | Track | Side A. Track 3: Adigaa  Heraysaa Maaneey | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12318_1_3_Adigaa-Heraysaa-Maaneey.mp3 |
| mus00044c01028 | 12318 | Track | Side A. Track 4: Allahay dul badanaayee | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12318_1_4_Allahay-dul-badanaayee.mp3 |
| mus00044c01029 | 12318 | Track | Side A. Track 5: Xis ii lahow | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12318_1_5_Xis-ii-lahow.mp3 |
| mus00044c01319 | 12318 | Track | Side A. Track 6: Extra Instrumental Track | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12318_1_6_Instrumental.mp3 |
| mus00044c01320 | 12318 | Track | Side B. Track 4: Extra Track | no public stream on the SDS page (no playlist) | https://somalisongs.share.library.harvard.edu/wp-content/uploads/2022/11/AWM_SC_12318_2_4_ExtraMusic.mp3 |

### 4.3 Cassette-level objects superseded by their track objects (91) — `cassette_superseded_by_tracks`

The cassette-level digital object is the union of the cassette's track objects; fetching both would put the same audio under two identities and leak across song-level splits.

| cid | cassette | type | title | reason | link |
| --- | --- | --- | --- | --- | --- |
| mus00044c00004 | 12202 | Item | Maxamed Axmed Kuluc and others (Mohamed Ahmed Kulu and others) | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33907389 |
| mus00044c00006 | 12204 | Item | Magool | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33896202 |
| mus00044c00007 | 12205 | Item | Mohamed Warsame and Magool (Maxamed Warsame and Magool) | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33897991 |
| mus00044c00008 | 12206 | Item | Maryan Mursal | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33892649 |
| mus00044c00009 | 12207 | Item | Cabbdinuur Callaale (Abdinur Allale) | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33896238 |
| mus00044c00010 | 12208 | Item | Naaji, Aweys and Fadumo Qaasim (Naji, Awes, and Fadumo Kassim) | cassette-level object; 10 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33893390 |
| mus00044c00011 | 12209 | Item | Kinsi, Samatar and Shamso | cassette-level object; 6 linked track objects fetched instead | mus00044c00011_1_d |
| mus00044c00013 | 12211 | Item | Cumar Dhuule and Axmed Gacayte (Omar Dule and Ahmed Ga`ayte) | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33901444 |
| mus00044c00014 | 12212 | Item | Sahra, Bacalwaan, Aamina, Cigaal (Sahra, Ba'alwan, Amina, Egal) | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33914896 |
| mus00044c00015 | 12213 | Item | Songs of the Play: Gaalo iyo islaan, gabdhow yaa idinleh | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33913074 |
| mus00044c00016 | 12214 | Item | Heesaha waddaniga | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33926602 |
| mus00044c00017 | 12215 | Item | Cumar Dhuule (Omar Duleh) | cassette-level object; 10 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33928788 |
| mus00044c00018 | 12216 | Item | [No Title] | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33934928 |
| mus00044c00019 | 12217 | Item | Maryan Mursal, Cabdi Salaad Beerdilaacshe, Cumar Dhuule (Maryan Omar, Abdi Adan Beerdilashe, and Omar Dhule) | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33935479 |
| mus00044c00020 | 12218 | Item | Seynab Cigeh and Saafi Ducaale (Zeinab Egeh and Safi Dualeh) | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33938845 |
| mus00044c00021 | 12219 | Item | Allah aammin ma iisho (Songs from the play by this name), 1966-08-25 | cassette-level object; 10 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33944713 |
| mus00044c00022 | 12220 | Item | Samatar, Shamso and Qays | cassette-level object; 5 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33944588 |
| mus00044c00023 | 12221 | Item | Xuud baa liqay jacaylkii (Songs from the play by this name) | cassette-level object; 6 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33956834 |
| mus00044c00024 | 12222 | Item | Maandeeq and others | cassette-level object; 10 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33962059 |
| mus00044c00025 | 12223 | Item | Khadra Daahir (Khadra Dahir) | cassette-level object; 10 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33959051 |
| mus00044c00032 | 12230 | Item | Maxamed Suleebaan (Mohamed Suleiman) | cassette-level object; 14 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376450 |
| mus00044c00035 | 12233 | Item | Untitled: Cassette 35 | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42401949 |
| mus00044c00038 | 12236 | Item | Cumar Dhuuleh (Omar Dhule) and Axmed Gacayte | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42401245 |
| mus00044c00039 | 12237 | Item | Axmed Moogeh (Ahmed Mogeh) and female singers | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376471 |
| mus00044c00040 | 12238 | Item | Untitled: Cassette 40 | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376500 |
| mus00044c00041 | 12239 | Item | Untitled: Cassette 41 | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376525 |
| mus00044c00042 | 12240 | Item | Heesaha Calanka (Songs for the Flag) | cassette-level object; 6 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376564 |
| mus00044c00043 | 12241 | Item | Galbeed waa la xoreeyey | cassette-level object; 5 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376604 |
| mus00044c00044 | 12242 | Item | Cismaan Maxamed "Gacanlo" | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376623 |
| mus00044c00046 | 12244 | Item | Untitled: Cassette 46 | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376648 |
| mus00044c00047 | 12245 | Item | Qaraami by Cumar Dhuule (Omar Dule) | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376673 |
| mus00044c00048 | 12246 | Item | Untitled: Cassette 48 | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100386583 |
| mus00044c00049 | 12247 | Item | Kinsi Aadan (Kinsi Aden) | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376698 |
| mus00044c00050 | 12248 | Item | Dooni Jacaylka | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376723 |
| mus00044c00055 | 12249 | Item | Khadra Daahir Cigeh (Khadar Dahir) | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376748 |
| mus00044c00056 | 12250 | Item | Maxamed Mooge Liibaan (Mohamed Mogeh Liban) | cassette-level object; 23 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42300293 |
| mus00044c00057 | 12251 | Item | Cumar Dhuule (Omar Dhule) | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42346308 |
| mus00044c00058 | 12252 | Item | Heesaha Calanka: Maxamed Suleebaan, Cismaan Maxamed and others (Mohamed Suleiman, Osman Mohamed, and others), 1964-04-29-1967-06-20 | cassette-level object; 6 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42349331 |
| mus00044c00059 | 12253 | Item | Maxamed Suleebaan (Mohamed Suleiman) | cassette-level object; 14 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42365153 |
| mus00044c00060 | 12254 | Item | Kooxda Horseed (Horseed Band) | cassette-level object; 6 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42357149 |
| mus00044c00062 | 12255 | Item | Untitled: Cassette 57 (Miscellaneous) | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42359871 |
| mus00044c00061 | 12256 | Item | Untitled: Cassette 58 (Miscellaneous) | cassette-level object; 9 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42363774 |
| mus00044c00063 | 12257 | Item | Maxamed Mooge Liibaan (Mohamed Mogeh Liban) | cassette-level object; 23 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42378567 |
| mus00044c00064 | 12258 | Item | Waa La Guursadee By Axmed Naaji Sacad (Ahmed Naji Sa'd) | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42389172 |
| mus00044c00065 | 12259 | Item | Untitled: Cassette 61 (Miscellaneous) | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42389147 |
| mus00044c00066 | 12260 | Item | Xasan Aadan Samatar (Hasan Aden Samatar) | cassette-level object; 15 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42389122 |
| mus00044c00067 | 12261 | Item | Djibouti Singers | cassette-level object; 6 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42382789 |
| mus00044c00068 | 12262 | Item | Fadumo Duur and Maxamuud Maxamad "Xeebow" (Faduma Duur and Mohamud Mohamed "Heebow") | cassette-level object; 6 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42389099 |
| mus00044c00069 | 12263 | Item | Maxamad Suleebaan (Mohamed Suleiman) | cassette-level object; 6 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42390411 |
| mus00044c00070 | 12264 | Item | From the Play "Geeddigii Kowaad" | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100346608 |
| mus00044c00071 | 12265 | Item | From the Play "Bidaar sibiq bay kugu gashaa" | cassette-level object; 6 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100347782 |
| mus00044c00072 | 12266 | Item | Songs from Djibouti | cassette-level object; 9 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100349420 |
| mus00044c00073 | 12267 | Item | Axmed Mooge Liibaan (Ahmed Mogeh Liban) | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100351731 |
| mus00044c00074 | 12268 | Item | Qaraami Songs | cassette-level object; 6 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100351756 |
| mus00044c00075 | 12269 | Item | Xasan Ismaacill | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100351777 |
| mus00044c00076 | 12270 | Item | From the Play "Qabrigii Jacaylka" | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376350 |
| mus00044c00078 | 12272 | Item | Heesihii hore ("Older Songs"), 1967 | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376398 |
| mus00044c00079 | 12273 | Item | Reer Xamar Songs (From the Play "Xasuuso Haddaad Xis Leedahay") | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376423 |
| mus00044c00080 | 12274 | Item | Fadumo Axmad, Aweys Khamiis, and Axmed Saad Naaji | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42526700 |
| mus00044c00667 | 12277 | Item | Heesihii Riwaayadda "Dud aan Da'diisa Ogayn" (Songs of the Benadiri (Reer Xamar) play "The Old Man Who Did Not Know His Age") | cassette-level object; 10 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102428866 |
| mus00044c00678 | 12278 | Item | Sir Jacayl (Songs by Djibouti Singers Nimco Jaamac, Cabdinuur Awaale, Nadiifo Axmed and Cabdi Cali (Nimo Jama, Abdinur Alale, Nadifo Ahmed and Abdi Ali) | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102428980 |
| mus00044c00699 | 12279 | Item | Maxamed Suleebaan Tubeec (Mohamed Suleiman Tubec) | cassette-level object; 9 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102429674 |
| mus00044c00709 | 12280 | Item | Songs from the play "Doob qalanjadii gabay" | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430527 |
| mus00044c00718 | 12281 | Item | Songs from the Play "Waa madays adduunyadu." | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102430546 |
| mus00044c00727 | 12282 | Item | Songs from the plays "Gaarabidhaan" and "Hadimo" | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102545189 |
| mus00044c00736 | 12283 | Item | Heeso xul ah (Mixed tape) | cassette-level object; 28 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102545210 |
| mus00044c00744 | 12284 | Item | Heeso xul ah (Mixed tape) | cassette-level object; 28 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546281 |
| mus00044c00753 | 12285 | Item | Xasan Aadan Samatar (Hasan Aden Samatar) | cassette-level object; 15 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546286 |
| mus00044c00762 | 12286 | Item | Xasan Aadan Samatar and Sahra Axmed | cassette-level object; 6 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546297 |
| mus00044c00769 | 12287 | Item | Selection of Songs made by Lidwien Kapteijns | cassette-level object; 9 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546312 |
| mus00044c00779 | 12288 | Item | Heeso xul ah – Djibouti (Mixed tape) | cassette-level object; 9 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546400 |
| mus00044c00789 | 12289 | Item | Heesaha Arooska (Selected Wedding Songs) | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546382 |
| mus00044c00799 | 12290 | Item | Qaraami: Faysal Cumar iyo Maxamed Suleebaan (Faisal Omar and Mohamed Suleiman) | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546380 |
| mus00044c00807 | 12291 | Item | Songs from the play "Jinni iyo Jacayl" | cassette-level object; 6 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546389 |
| mus00044c00814 | 12292 | Item | Farxiya Cali, Siraad, iyo Sahra Axmed (Farhia Ali, Sirad, and Zahra Ahmed) | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546487 |
| mus00044c00823 | 12293 | Item | Songs of Sahro Axmed (Zahra Ahmed) | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546471 |
| mus00044c00840 | 12295 | Item | Songs by Salaax Qaasim and Qamar Cabdillaahi Harawo (Salah Kassim and Qamar Abdillahi Harawo) | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546484 |
| mus00044c00848 | 12296 | Item | Songs by Maryan Mursal and Cabdinaasir Maxamad (Abdinasir Mohamed) | cassette-level object; 6 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546569 |
| mus00044c00855 | 12297 | Item | Kooxda Durdur, 1987 | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546522 |
| mus00044c00864 | 12298 | Item | Songs by Maxamed Suleebaan (Mohamed Suleiman) | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546589 |
| mus00044c00872 | 12299 | Item | Songs by Khadra Daahir iyo Axmed Cali Cigaal (Khadra Dahir and Ahmed Ali Egal) from the play "Jinni iyo Jacayl" | cassette-level object; 6 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546584 |
| mus00044c00906 | 12304 | Item | Heeso xul ah (Mixed tape) | cassette-level object; 28 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546740 |
| mus00044c00913 | 12305 | Item | Songs by Faarax Siidow (Farah Sidow) | cassette-level object; 9 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546677 |
| mus00044c00923 | 12306 | Item | Heeso xul ah (Mixed tape) | cassette-level object; 28 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546757 |
| mus00044c00931 | 12307 | Item | Songs by Salaad Maxamed Derbi (Salad Mohamed Derbi) | cassette-level object; 8 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546761 |
| mus00044c00940 | 12308 | Item | Songs from the play "Gaarabidhaan iyo Hadimo" | cassette-level object; 1 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546772 |
| mus00044c00948 | 12309 | Item | Songs by Maxamed Suleebaan (Mohamed Suleiman) | cassette-level object; 7 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546874 |
| mus00044c00999 | 12315 | Item | Songs by Maandeeq | cassette-level object; 6 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102306543 |
| mus00044c01006 | 12316 | Item | Songs by Cabdi Aadan Qays (Abdi Adan Qays) | cassette-level object; 12 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102306529 |
| mus00044c01013 | 12317 | Item | Songs by Salaax Qaasim (Salah Kassim) | cassette-level object; 6 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102306556 |
| mus00044c01021 | 12318 | Item | Songs by Axmed Naaji Sacad (Ahmed Naji), Caasha Cabdow (Asha Abdo), Baaslaaye, and Faadumo Qaasim (Fadumo Kasim) | cassette-level object; 10 linked track objects fetched instead | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102306569 |

### 4.4 Duplicate links (10) — `duplicate_link`

| cid | cassette | type | title | reason | link |
| --- | --- | --- | --- | --- | --- |
| mus00044c00222 | 12217 | Track | Side B. Track 3: Naftu Galgalato | same digital object as another component (duplicate link) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33935490 |
| mus00044c00301 | 12227 | Track | Side A. Track 1: I soo lali | same digital object as another component (duplicate link) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33944591 |
| mus00044c00305 | 12227 | Track | Side B. Track 1: Niyadda beenta ah | same digital object as another component (duplicate link) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42364498 |
| mus00044c00476 | 12249 | Track | Side B. Track 2: Darin (or: Dookh jacayl) | same digital object as another component (duplicate link) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100376759 |
| mus00044c00506 | 12253 | Track | Side B. Track 2: Malyuun Hibo | same digital object as another component (duplicate link) | https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42365166 |
| mus00044c00605 | 12266 | Track | Side A: Track 4: Gobannimo | same digital object as another component (duplicate link) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:100349481 |
| mus00044c00757 | 12285 | Track | Side A. Track 4: Taswiirtii Siciida, 1976 | same digital object as another component (duplicate link) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546326 |
| mus00044c00792 | 12289 | Track | Side A. Track 3: Ladnaan ku waara | same digital object as another component (duplicate link) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546387 |
| mus00044c00878 | 12299 | Track | Side B. Track 3: Yabaal | same digital object as another component (duplicate link) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546624 |
| mus00044c00898 | 12302 | Track | Side B. Track 4: Uu Aaa Qaraami | same digital object as another component (duplicate link) | https://nrs.lib.harvard.edu/URN-3:FHCL.LOEB:102546694 |

## 5. Legacy whole-cassette files that overlap track files

Manifest `legacy` rows of type `Item` (a 2025 file holding a whole cassette side or cassette) whose AWM SC number has linked `Track` objects in the catalog. Each of these files is a superset of those tracks and must be excluded from any training set that includes the tracks (it would repeat the same songs under another `song_sha256`). `overlaps on disk` says whether any of the tracks is fetched or legacy already; only those files are subtracted from the unique-audio figure in section 2, so `hours_unique_audio` falls as pending tracks arrive. A track that ends up skipped is not on disk, and the cassette file is then its only copy.

17 files: 16 overlap tracks on disk now, 1 have no track on disk yet (0 linked track objects pending for them).

| cid | cassette | title | legacy file | linked track objects in catalog | fetched track rows | legacy track rows | pending | overlaps on disk | hours |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mus00044c00002 | 12200 | Sahro Axmed (Sahra Ahmed) and others | data/harvard_raw/legacy/track_0001_Sahro_Axmed_Sahra_Ahmed_and_others.mp3 | 7 | 0 | 7 | 0 | yes | 0.50 h |
| mus00044c00003 | 12201 | Songs of the Play: Ninkeeda ku amaahday | data/harvard_raw/legacy/track_0009_Songs_of_the_Play_Ninkeeda_ku_amaahday.mp3 | 8 | 1 | 7 | 0 | yes | 0.53 h |
| mus00044c00005 | 12203 | Axmed Cali Cigaal and Magool (Ahmed Ali Egal and Magool) | data/harvard_raw/legacy/track_0344_Axmed_Cali_Cigaal_and_Magool_Ahmed_Ali_Egal_and_Magool.mp3 | 6 | 6 | 0 | 0 | yes | 0.49 h |
| mus00044c00012 | 12210 | Hibo Maxamed and Faysal Cumar Mushteeg (Hibo Mohamed and Faisal Omar Mushteeg) | data/harvard_raw/legacy/track_0018_Hibo_Maxamed_and_Faysal_Cumar_Mushteeg_Hibo_Mohamed_and_Faisal_Omar_Mushteeg.mp3 | 9 | 5 | 4 | 0 | yes | 0.52 h |
| mus00044c00026 | 12224 | Faysal, Samatar, and Mohamed Sulaiman | data/harvard_raw/legacy/track_0290_Faysal_Samatar_and_Mohamed_Sulaiman.mp3 | 7 | 0 | 0 | 0 | no | 0.53 h |
| mus00044c00027 | 12225 | Qalinle, Sado Ali, and Marwo Mohamed | data/harvard_raw/legacy/track_0298_Qalinle_Sado_Ali_and_Marwo_Mohamed.mp3 | 7 | 0 | 7 | 0 | yes | 0.51 h |
| mus00044c00028 | 12226 | Axmadey Abubakr (Ahmedey Abubakr) | data/harvard_raw/legacy/track_0306_Axmadey_Abubakr_Ahmedey_Abubakr.mp3 | 8 | 1 | 7 | 0 | yes | 0.52 h |
| mus00044c00029 | 12227 | Qalinle, Xarago, Kinsi, and others | data/harvard_raw/legacy/track_0315_Qalinle_Xarago_Kinsi_and_others.mp3 | 8 | 0 | 6 | 0 | yes | 0.53 h |
| mus00044c00030 | 12228 | Nabi Ammaan [Songs Praising the Prophet] | data/harvard_raw/legacy/track_0324_Nabi_Ammaan_Songs_Praising_the_Prophet.mp3 | 9 | 2 | 7 | 0 | yes | 0.52 h |
| mus00044c00031 | 12229 | Different Singers | data/harvard_raw/legacy/track_0334_Different_Singers.mp3 | 9 | 7 | 2 | 0 | yes | 0.51 h |
| mus00044c00033 | 12231 | Heesaha Calanka (Songs for the Flag of Independence) | data/harvard_raw/legacy/track_0358_Heesaha_Calanka_Songs_for_the_Flag_of_Independence.mp3 | 12 | 9 | 3 | 0 | yes | 0.78 h |
| mus00044c00034 | 12232 | Cumar Dhuule (Omar Dule) | data/harvard_raw/legacy/track_0371_Cumar_Dhuule_Omar_Dule.mp3 | 10 | 10 | 0 | 0 | yes | 0.78 h |
| mus00044c00036 | 12234 | Cumar Nuur Cabdulle (Omar Nur Abdalla) | data/harvard_raw/legacy/track_0391_Cumar_Nuur_Cabdulle_Omar_Nur_Abdalla.mp3 | 5 | 5 | 0 | 0 | yes | 0.52 h |
| mus00044c00037 | 12235 | Aqoon and Afgarad | data/harvard_raw/legacy/track_0397_Aqoon_and_Afgarad.mp3 | 8 | 8 | 0 | 0 | yes | 0.47 h |
| mus00044c00879 | 12300 | Benadiri (Reer Xamar) Songs from the play "Luul iyo Leyla" | data/harvard_raw/legacy/track_0028_Benadiri_Reer_Xamar_Songs_from_the_play_Luul_iyo_Leyla.mp3 | 7 | 6 | 1 | 0 | yes | 0.51 h |
| mus00044c00890 | 12302 | Heeso Xul ah (Qaraami): Qaraami songs by different singers | data/harvard_raw/legacy/track_0036_Heeso_Xul_ah_Qaraami_Qaraami_songs_by_different_singers.mp3 | 8 | 7 | 0 | 0 | yes | 0.52 h |
| mus00044c00899 | 12303 | Songs by Xasan Aadan Samatar (Hasan Aden Samatar) | data/harvard_raw/legacy/track_0045_Songs_by_Xasan_Aadan_Samatar_Hasan_Aden_Samatar.mp3 | 6 | 6 | 0 | 0 | yes | 0.51 h |

## 6. Catalog tracks with no digital object (317)

Track rows of the finding-aid export whose `Digital Content Link` is empty: no digital object in the finding aid. These are not fetch failures and nothing can be fetched for them; they are listed so the gap between the catalog's track count and the audio on disk is accounted for.

| cid | cassette | cassette title | track title |
| --- | --- | --- | --- |
| mus00044c01307 | 12200 | Sahro Axmed (Sahra Ahmed) and others | Side A. Track 4: Subcis [subgenre of qaraami songs] |
| mus00044c00410 | 12240 | Heesaha Calanka (Songs for the Flag) | Side B. Track [4?]: Adigiyo hodaniyo |
| mus00044c00424 | 12243 | [BLANK TAPE] Maxamed Axmed "Kuluc" (Mohamed Ahmed Kulu') [BLANK TAPE] | [Side A. Track 1: Isa soo maqiiq], 1964-01-12 |
| mus00044c00425 | 12243 | [BLANK TAPE] Maxamed Axmed "Kuluc" (Mohamed Ahmed Kulu') [BLANK TAPE] | [Side A. Track 2: Jiib Qaraami (in Qaraami genre)], 1962-06-20 |
| mus00044c00426 | 12243 | [BLANK TAPE] Maxamed Axmed "Kuluc" (Mohamed Ahmed Kulu') [BLANK TAPE] | [Side A. Track 3: Dhool Bari], 1962-06-20 |
| mus00044c00427 | 12243 | [BLANK TAPE] Maxamed Axmed "Kuluc" (Mohamed Ahmed Kulu') [BLANK TAPE] | [Side A. Track 4: Jacayl Daran], 1974-09-15 |
| mus00044c00428 | 12243 | [BLANK TAPE] Maxamed Axmed "Kuluc" (Mohamed Ahmed Kulu') [BLANK TAPE] | [Side B. Track 1: Durdur], 1963-10-19 |
| mus00044c00429 | 12243 | [BLANK TAPE] Maxamed Axmed "Kuluc" (Mohamed Ahmed Kulu') [BLANK TAPE] | [Side B. Track 2: Inakoon kala maarmayn], 1963-09-05 |
| mus00044c00430 | 12243 | [BLANK TAPE] Maxamed Axmed "Kuluc" (Mohamed Ahmed Kulu') [BLANK TAPE] | [Side B. Track 3: Ii hilow], 1964-03-06 |
| mus00044c00431 | 12243 | [BLANK TAPE] Maxamed Axmed "Kuluc" (Mohamed Ahmed Kulu') [BLANK TAPE] | [Side B. Track 4: Hayaan Qaraami] |
| mus00044c00593 | 12264 | From the Play "Geeddigii Kowaad" | Side B. Track 5: Koowaao |
| mus00044c00682 | 12278 | Sir Jacayl (Songs by Djibouti Singers Nimco Jaamac, Cabdinuur Awaale, Nadiifo Axmed and Cabdi Cali (Nimo Jama, Abdinur Alale, Nadifo Ahmed and Abdi Ali) | Side B. Track 1: Kaftan iyo jacaylkuna |
| mus00044c00949 | 12298 | Songs by Maxamed Suleebaan (Mohamed Suleiman) | Side A. Track 1: Riyo |
| mus00044c00950 | 12298 | Songs by Maxamed Suleebaan (Mohamed Suleiman) | Side A. Track 2: Jabaq iigu sheegaa |
| mus00044c00951 | 12298 | Songs by Maxamed Suleebaan (Mohamed Suleiman) | Side A. Track 3: Ruuneey |
| mus00044c00952 | 12298 | Songs by Maxamed Suleebaan (Mohamed Suleiman) | Side A. Track 4: Malyuun hibo |
| mus00044c00953 | 12298 | Songs by Maxamed Suleebaan (Mohamed Suleiman) | Side B. Track 1: Anigu kaa helay |
| mus00044c00954 | 12298 | Songs by Maxamed Suleebaan (Mohamed Suleiman) | Side B. Track 2: Ma ogtahay |
| mus00044c00955 | 12298 | Songs by Maxamed Suleebaan (Mohamed Suleiman) | Side B. Track 3: Aan dhammayno xaajada |
| mus00044c00956 | 12298 | Songs by Maxamed Suleebaan (Mohamed Suleiman) | Side B. Track 4: Waa Gar Jacayl |
| mus00044c00881 | 12301 | Songs from Djibouti by Cabdinuur Alaale (Abdinur Alaleh) | Side A. Track 1: Haddaad bogsateen haweenow |
| mus00044c00882 | 12301 | Songs from Djibouti by Cabdinuur Alaale (Abdinur Alaleh) | Side A. Track 2: Buti iyo dadqalato |
| mus00044c00883 | 12301 | Songs from Djibouti by Cabdinuur Alaale (Abdinur Alaleh) | Side A. Track 3: Yaanu idin luggoyn dumar |
| mus00044c00884 | 12301 | Songs from Djibouti by Cabdinuur Alaale (Abdinur Alaleh) | Side A. Track 4: Waxaad gocatay ii sheeg |
| mus00044c00885 | 12301 | Songs from Djibouti by Cabdinuur Alaale (Abdinur Alaleh) | Side A. Track 5: Erey jaban ka dhowr or Asqowday maad aammusiin |
| mus00044c00886 | 12301 | Songs from Djibouti by Cabdinuur Alaale (Abdinur Alaleh) | Side B. Track 1: Haygu waabin jacaylka |
| mus00044c00887 | 12301 | Songs from Djibouti by Cabdinuur Alaale (Abdinur Alaleh) | Side B. Track 2: Ayaandarro see waxay tahay or Geed odax leh |
| mus00044c00888 | 12301 | Songs from Djibouti by Cabdinuur Alaale (Abdinur Alaleh) | Side B. Track 3: Waana midabka dunida or Maandhaafka aadmiga |
| mus00044c00889 | 12301 | Songs from Djibouti by Cabdinuur Alaale (Abdinur Alaleh) | Side B. Track 4: dadka hayska Weyneen |
| mus00044c00942 | 12308 | Songs from the play "Gaarabidhaan iyo Hadimo" | Side A. Track 2: Dan la'aanta dhaaxaa |
| mus00044c00943 | 12308 | Songs from the play "Gaarabidhaan iyo Hadimo" | Side A. Track 3: Cakuyey naag madow |
| mus00044c00944 | 12308 | Songs from the play "Gaarabidhaan iyo Hadimo" | Side A. Track 4: Geed madi ahoo |
| mus00044c00945 | 12308 | Songs from the play "Gaarabidhaan iyo Hadimo" | Side B. Track 1: Subcis |
| mus00044c00946 | 12308 | Songs from the play "Gaarabidhaan iyo Hadimo" | Side B. Track 2: Babbaaygii Jamaamiyo |
| mus00044c00947 | 12308 | Songs from the play "Gaarabidhaan iyo Hadimo" | Side B. Track 3: Suleekha |
| mus00044c00958 | 12310 | Songs from the play "Xuskii jacaylka" | Side A. Track 1: Wallee aniga caashaqu |
| mus00044c00959 | 12310 | Songs from the play "Xuskii jacaylka" | Side A. Track 2: Haddaan kuu warramo |
| mus00044c00960 | 12310 | Songs from the play "Xuskii jacaylka" | Side A. Track 3: Dooni buuxdaan |
| mus00044c00961 | 12310 | Songs from the play "Xuskii jacaylka" | Side A. Track 4: Ubaxii Jacaylka |
| mus00044c00963 | 12310 | Songs from the play "Xuskii jacaylka" | Side A. Track 5: Waa keli Ilaahay [incomplete] |
| mus00044c00964 | 12310 | Songs from the play "Xuskii jacaylka" | Side B. Track 1: Dhaqan awowiyo |
| mus00044c00965 | 12310 | Songs from the play "Xuskii jacaylka" | Side B. Track 2: Xil ku saaran weeyee |
| mus00044c00966 | 12310 | Songs from the play "Xuskii jacaylka" | Side B. Track 3: Xamdi |
| mus00044c00967 | 12310 | Songs from the play "Xuskii jacaylka" | Side B. Track 4: Weligeed adduunyada [incomplete] |
| mus00044c00969 | 12311 | Songs by Cabdillaahi Diiriye Sooraan (Abdillahi Dirie Sooraan) | Side A. Track 1: Allayliyo Allaylihee i lumisee |
| mus00044c00970 | 12311 | Songs by Cabdillaahi Diiriye Sooraan (Abdillahi Dirie Sooraan) | Side A. Track 2: Kulan |
| mus00044c00971 | 12311 | Songs by Cabdillaahi Diiriye Sooraan (Abdillahi Dirie Sooraan) | Side A. Track 3: Ha i illaawinee hooy, 1968-12-03 |
| mus00044c00972 | 12311 | Songs by Cabdillaahi Diiriye Sooraan (Abdillahi Dirie Sooraan) | Side B. Track 1: Berisamaad |
| mus00044c00973 | 12311 | Songs by Cabdillaahi Diiriye Sooraan (Abdillahi Dirie Sooraan) | Side B. Track 2: Hododaamo, 1962-08-31 |
| mus00044c00974 | 12311 | Songs by Cabdillaahi Diiriye Sooraan (Abdillahi Dirie Sooraan) | Side B. Track 3: Ifka laguma waaro |
| mus00044c00976 | 12312 | Heeso Xul ah (Mixed tape) | Side A. Track 1: Horta waa abaalkaa |
| mus00044c00977 | 12312 | Heeso Xul ah (Mixed tape) | Side A. Track 2: Curaddii aan dhalayeey |
| mus00044c00978 | 12312 | Heeso Xul ah (Mixed tape) | Side A. Track 3: Garaad |
| mus00044c00979 | 12312 | Heeso Xul ah (Mixed tape) | Side A. Track 4: Waraabahan gurxamayow |
| mus00044c00980 | 12312 | Heeso Xul ah (Mixed tape) | Side B. Track 1: Waraabahan gurxamayow |
| mus00044c00981 | 12312 | Heeso Xul ah (Mixed tape) | Side B. Track 2: Allahayow |
| mus00044c00982 | 12312 | Heeso Xul ah (Mixed tape) | Side B. Track 3: Qraami |
| mus00044c00983 | 12312 | Heeso Xul ah (Mixed tape) | Side B. Track 4: Dahabooy |
| mus00044c00985 | 12313 | Songs by Maxamed Suleebaan iyo Maxamad Axmad Kuluc (Mohamed Suleiman and Mohamed Ahmed Kulu') | Side A. Track 1: Qaraami |
| mus00044c00986 | 12313 | Songs by Maxamed Suleebaan iyo Maxamad Axmad Kuluc (Mohamed Suleiman and Mohamed Ahmed Kulu') | Side A. Track 2: Qaraami |
| mus00044c00987 | 12313 | Songs by Maxamed Suleebaan iyo Maxamad Axmad Kuluc (Mohamed Suleiman and Mohamed Ahmed Kulu') | Side A. Track 3: Gufaaco |
| mus00044c00988 | 12313 | Songs by Maxamed Suleebaan iyo Maxamad Axmad Kuluc (Mohamed Suleiman and Mohamed Ahmed Kulu') | Side B. Track 1: Deeqaay dabac wanaageey |
| mus00044c00989 | 12313 | Songs by Maxamed Suleebaan iyo Maxamad Axmad Kuluc (Mohamed Suleiman and Mohamed Ahmed Kulu') | Side B. Track 2: Qaraami (Qaaci) |
| mus00044c00990 | 12313 | Songs by Maxamed Suleebaan iyo Maxamad Axmad Kuluc (Mohamed Suleiman and Mohamed Ahmed Kulu') | Side B. Track 3: Qaraami (Qaaci) |
| mus00044c00991 | 12313 | Songs by Maxamed Suleebaan iyo Maxamad Axmad Kuluc (Mohamed Suleiman and Mohamed Ahmed Kulu') | Side B. Track 4: Qaraami (Qaaci) |
| mus00044c00993 | 12314 | Songs by Axmed Naaji Sacad (Ahmed Naji Sa'd) | Side A. Track 1: Balanbaalis, 1978 |
| mus00044c00994 | 12314 | Songs by Axmed Naaji Sacad (Ahmed Naji Sa'd) | Side A. Track 2: Jiriirico (or: Allahayow maxaa iga qabsaday) |
| mus00044c00995 | 12314 | Songs by Axmed Naaji Sacad (Ahmed Naji Sa'd) | Side A. Track 3: Qadar dhacay |
| mus00044c00996 | 12314 | Songs by Axmed Naaji Sacad (Ahmed Naji Sa'd) | Side B. Track 1: Gaarida baarida haween |
| mus00044c00997 | 12314 | Songs by Axmed Naaji Sacad (Ahmed Naji Sa'd) | Side B. Track 2: Yaa i kaa baray |
| mus00044c00998 | 12314 | Songs by Axmed Naaji Sacad (Ahmed Naji Sa'd) | Side B. Track 3: Hoobaalayow hee dheh |
| mus00044c01321 | 12317 | Songs by Salaax Qaasim (Salah Kassim) | Side B. Track 4: Qadar musig ah [Some music] |
| mus00044c01031 | 12319 | Maxamed Nuur Giriig (Mohamed Nur Girig), Sahra Axmed (Sahra Ahmed), Khadija Fooday, Maxamad Suleebaan (Mohamed Sulaiman), Faadumo Cabdillaahi Maandeeq, Maxamad Axmad Kuluc (Mohamed Ahmed Kulu'), Cumar Dhuule (Omar Dule) | Side A. Track 1: Mahee Khadraay |
| mus00044c01032 | 12319 | Maxamed Nuur Giriig (Mohamed Nur Girig), Sahra Axmed (Sahra Ahmed), Khadija Fooday, Maxamad Suleebaan (Mohamed Sulaiman), Faadumo Cabdillaahi Maandeeq, Maxamad Axmad Kuluc (Mohamed Ahmed Kulu'), Cumar Dhuule (Omar Dule) | Side A. Track 2: Sida Geed Caleenliyo |
| mus00044c01033 | 12319 | Maxamed Nuur Giriig (Mohamed Nur Girig), Sahra Axmed (Sahra Ahmed), Khadija Fooday, Maxamad Suleebaan (Mohamed Sulaiman), Faadumo Cabdillaahi Maandeeq, Maxamad Axmad Kuluc (Mohamed Ahmed Kulu'), Cumar Dhuule (Omar Dule) | Side A. Track 3: Ha Ba Baran Lahaayaa |
| mus00044c01034 | 12319 | Maxamed Nuur Giriig (Mohamed Nur Girig), Sahra Axmed (Sahra Ahmed), Khadija Fooday, Maxamad Suleebaan (Mohamed Sulaiman), Faadumo Cabdillaahi Maandeeq, Maxamad Axmad Kuluc (Mohamed Ahmed Kulu'), Cumar Dhuule (Omar Dule) | Side B. Track 1: Geeddi Roon Allahayoow  (or: Gaabsan maayee) |
| mus00044c01035 | 12319 | Maxamed Nuur Giriig (Mohamed Nur Girig), Sahra Axmed (Sahra Ahmed), Khadija Fooday, Maxamad Suleebaan (Mohamed Sulaiman), Faadumo Cabdillaahi Maandeeq, Maxamad Axmad Kuluc (Mohamed Ahmed Kulu'), Cumar Dhuule (Omar Dule) | Side B. Track 2: Dhool Bari (or: Ogow dhuumashada qaar) |
| mus00044c01036 | 12319 | Maxamed Nuur Giriig (Mohamed Nur Girig), Sahra Axmed (Sahra Ahmed), Khadija Fooday, Maxamad Suleebaan (Mohamed Sulaiman), Faadumo Cabdillaahi Maandeeq, Maxamad Axmad Kuluc (Mohamed Ahmed Kulu'), Cumar Dhuule (Omar Dule) | Side B. Track 3: Hoheey Dumarku |
| mus00044c01037 | 12319 | Maxamed Nuur Giriig (Mohamed Nur Girig), Sahra Axmed (Sahra Ahmed), Khadija Fooday, Maxamad Suleebaan (Mohamed Sulaiman), Faadumo Cabdillaahi Maandeeq, Maxamad Axmad Kuluc (Mohamed Ahmed Kulu'), Cumar Dhuule (Omar Dule) | Side B. Track 4: Bulliyeey, 1975-08-09 |
| mus00044c01039 | 12320 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Cabdi Qays (Abdi Qays), Khadra Daahir (Khadra Dahir) | Side A. Track 1: Godobtayda Waan Jirin |
| mus00044c01040 | 12320 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Cabdi Qays (Abdi Qays), Khadra Daahir (Khadra Dahir) | Side A. Track 2: Lahashadaydiyo |
| mus00044c01041 | 12320 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Cabdi Qays (Abdi Qays), Khadra Daahir (Khadra Dahir) | Side A. Track 3: Kala Maqnaashaheennii |
| mus00044c01042 | 12320 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Cabdi Qays (Abdi Qays), Khadra Daahir (Khadra Dahir) | Side B. Track 1: Waan soo baraarugayaa (or: Bisinka) |
| mus00044c01043 | 12320 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Cabdi Qays (Abdi Qays), Khadra Daahir (Khadra Dahir) | Side B. Track 2: Labadii is doortee |
| mus00044c01044 | 12320 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Cabdi Qays (Abdi Qays), Khadra Daahir (Khadra Dahir) | Side B. Track 3: Nayl (or: Sida Neefta Waylaha), 1974 |
| mus00044c01046 | 12321 | Songs by Faysal Cumar Mushteeg (Faisal Omar Mushtek) and songs by Axmed Cali Dararamle (Ahmed Ali Daramle) | Side A. Track 1: Rifdoor |
| mus00044c01047 | 12321 | Songs by Faysal Cumar Mushteeg (Faisal Omar Mushtek) and songs by Axmed Cali Dararamle (Ahmed Ali Daramle) | Side A. Track 2: Lacageey |
| mus00044c01048 | 12321 | Songs by Faysal Cumar Mushteeg (Faisal Omar Mushtek) and songs by Axmed Cali Dararamle (Ahmed Ali Daramle) | Side A. Track 3: Subcis |
| mus00044c01049 | 12321 | Songs by Faysal Cumar Mushteeg (Faisal Omar Mushtek) and songs by Axmed Cali Dararamle (Ahmed Ali Daramle) | Side B. Track 1: Weli Waa Caruuroo |
| mus00044c01050 | 12321 | Songs by Faysal Cumar Mushteeg (Faisal Omar Mushtek) and songs by Axmed Cali Dararamle (Ahmed Ali Daramle) | Side B. Track 2: Ha i gabinee ha i goynee |
| mus00044c01051 | 12321 | Songs by Faysal Cumar Mushteeg (Faisal Omar Mushtek) and songs by Axmed Cali Dararamle (Ahmed Ali Daramle) | Side B. Track 3: Aah Aah |
| mus00044c01053 | 12322 | Songs by Maxamed Suleebaan (Mohamed Suleiman) and Cumar Xasan Rooraye (Omar Hasan Roraye) | Side A. Track 1: Dumar Geesi |
| mus00044c01054 | 12322 | Songs by Maxamed Suleebaan (Mohamed Suleiman) and Cumar Xasan Rooraye (Omar Hasan Roraye) | Side A. Track 2: Ma Dhammaado Waqtigaad |
| mus00044c01055 | 12322 | Songs by Maxamed Suleebaan (Mohamed Suleiman) and Cumar Xasan Rooraye (Omar Hasan Roraye) | Side A. Track 3: Qaraami |
| mus00044c01056 | 12322 | Songs by Maxamed Suleebaan (Mohamed Suleiman) and Cumar Xasan Rooraye (Omar Hasan Roraye) | Side B. Track 1: Deeqa Dabac Wanaageey |
| mus00044c01057 | 12322 | Songs by Maxamed Suleebaan (Mohamed Suleiman) and Cumar Xasan Rooraye (Omar Hasan Roraye) | Side B. Track 2: Ma ogtahay |
| mus00044c01058 | 12322 | Songs by Maxamed Suleebaan (Mohamed Suleiman) and Cumar Xasan Rooraye (Omar Hasan Roraye) | Side B. Track 3: Aabbo iyo Hooyo, 1969-11-10 |
| mus00044c01060 | 12323 | Songs by Faadumo Cabdillaahi "Maandeeq" | Side A. Track 1: Gardarro (or: Ma ogtahay) |
| mus00044c01061 | 12323 | Songs by Faadumo Cabdillaahi "Maandeeq" | Side A. Track 2: Ma Jinn Baa Ma Jaan Baa |
| mus00044c01062 | 12323 | Songs by Faadumo Cabdillaahi "Maandeeq" | Side A. Track 3: Wadaaddada Qur'aanka |
| mus00044c01063 | 12323 | Songs by Faadumo Cabdillaahi "Maandeeq" | Side A. Track 4: Garashada Habboon |
| mus00044c01064 | 12323 | Songs by Faadumo Cabdillaahi "Maandeeq" | Side B. Track 1: Raaxeeye Burcaawi |
| mus00044c01065 | 12323 | Songs by Faadumo Cabdillaahi "Maandeeq" | Side B. Track 2: Sidii Hogosha Roobka |
| mus00044c01066 | 12323 | Songs by Faadumo Cabdillaahi "Maandeeq" | Side B. Track 3: Hoo Hoowaa |
| mus00044c01067 | 12323 | Songs by Faadumo Cabdillaahi "Maandeeq" | Side B. Track 4: Qaraami |
| mus00044c01069 | 12324 | Songs from Djibouti: by Faadumo Axmed (Fadumo Ahmed), Nadiifo Cawad (Nadifo Awad), group, Nimco Jaamac (Nimo Jama), Cabo Xamarqood (Abdo Hamakod), Cabdinuur Calaale (Abdinur Alale) and Qormo | Side A. Track 1: Qaniinyada Abeesada |
| mus00044c01070 | 12324 | Songs from Djibouti: by Faadumo Axmed (Fadumo Ahmed), Nadiifo Cawad (Nadifo Awad), group, Nimco Jaamac (Nimo Jama), Cabo Xamarqood (Abdo Hamakod), Cabdinuur Calaale (Abdinur Alale) and Qormo | Side A. Track 2: Xalay Gelin Dhexaadkii |
| mus00044c01071 | 12324 | Songs from Djibouti: by Faadumo Axmed (Fadumo Ahmed), Nadiifo Cawad (Nadifo Awad), group, Nimco Jaamac (Nimo Jama), Cabo Xamarqood (Abdo Hamakod), Cabdinuur Calaale (Abdinur Alale) and Qormo | Side A. Track 3: Gaashaanlee |
| mus00044c01072 | 12324 | Songs from Djibouti: by Faadumo Axmed (Fadumo Ahmed), Nadiifo Cawad (Nadifo Awad), group, Nimco Jaamac (Nimo Jama), Cabo Xamarqood (Abdo Hamakod), Cabdinuur Calaale (Abdinur Alale) and Qormo | Side A. Track 4: Hee Yaa (or Mala maleeyana waa Ilaah) - partial |
| mus00044c01073 | 12324 | Songs from Djibouti: by Faadumo Axmed (Fadumo Ahmed), Nadiifo Cawad (Nadifo Awad), group, Nimco Jaamac (Nimo Jama), Cabo Xamarqood (Abdo Hamakod), Cabdinuur Calaale (Abdinur Alale) and Qormo | Side B. Track 1: Hee Yaa (or Mala maleeyana waa Ilaah) - continued |
| mus00044c01074 | 12324 | Songs from Djibouti: by Faadumo Axmed (Fadumo Ahmed), Nadiifo Cawad (Nadifo Awad), group, Nimco Jaamac (Nimo Jama), Cabo Xamarqood (Abdo Hamakod), Cabdinuur Calaale (Abdinur Alale) and Qormo | Side B. Track 2: Waan u liita |
| mus00044c01075 | 12324 | Songs from Djibouti: by Faadumo Axmed (Fadumo Ahmed), Nadiifo Cawad (Nadifo Awad), group, Nimco Jaamac (Nimo Jama), Cabo Xamarqood (Abdo Hamakod), Cabdinuur Calaale (Abdinur Alale) and Qormo | Side B. Track 3: Wallee kuugu marayaa |
| mus00044c01076 | 12324 | Songs from Djibouti: by Faadumo Axmed (Fadumo Ahmed), Nadiifo Cawad (Nadifo Awad), group, Nimco Jaamac (Nimo Jama), Cabo Xamarqood (Abdo Hamakod), Cabdinuur Calaale (Abdinur Alale) and Qormo | Side B. Track 4: Dabeelyahay |
| mus00044c01077 | 12324 | Songs from Djibouti: by Faadumo Axmed (Fadumo Ahmed), Nadiifo Cawad (Nadifo Awad), group, Nimco Jaamac (Nimo Jama), Cabo Xamarqood (Abdo Hamakod), Cabdinuur Calaale (Abdinur Alale) and Qormo | Side B. Track 5: Xaqa Riidu leedahay |
| mus00044c01079 | 12325 | Heeso xul ah – (a selection of songs) by Magool, Maxamed Yuusuf (Mohamed Yusuf) and Waabberi band (here: Magool, Maandeeq, Iftiin, Guduudo Caewo (Gududo Arow), and Hibo Maxamed (Hibo Mohamed)), Maxamad Axmed Kuluc (Mohamed Ahmed Kulu') | Side A. Track 1: Geesigii Xarboow, 1969-06-07 |
| mus00044c01080 | 12325 | Heeso xul ah – (a selection of songs) by Magool, Maxamed Yuusuf (Mohamed Yusuf) and Waabberi band (here: Magool, Maandeeq, Iftiin, Guduudo Caewo (Gududo Arow), and Hibo Maxamed (Hibo Mohamed)), Maxamad Axmed Kuluc (Mohamed Ahmed Kulu') | Side A. Track 2: Kala Maqanee Maya, 1966-01-20 |
| mus00044c01081 | 12325 | Heeso xul ah – (a selection of songs) by Magool, Maxamed Yuusuf (Mohamed Yusuf) and Waabberi band (here: Magool, Maandeeq, Iftiin, Guduudo Caewo (Gududo Arow), and Hibo Maxamed (Hibo Mohamed)), Maxamad Axmed Kuluc (Mohamed Ahmed Kulu') | Side A. Track 3: Goobannimo |
| mus00044c01082 | 12325 | Heeso xul ah – (a selection of songs) by Magool, Maxamed Yuusuf (Mohamed Yusuf) and Waabberi band (here: Magool, Maandeeq, Iftiin, Guduudo Caewo (Gududo Arow), and Hibo Maxamed (Hibo Mohamed)), Maxamad Axmed Kuluc (Mohamed Ahmed Kulu') | Side A. Track 4: Oggolow Aabbahaa |
| mus00044c01083 | 12325 | Heeso xul ah – (a selection of songs) by Magool, Maxamed Yuusuf (Mohamed Yusuf) and Waabberi band (here: Magool, Maandeeq, Iftiin, Guduudo Caewo (Gududo Arow), and Hibo Maxamed (Hibo Mohamed)), Maxamad Axmed Kuluc (Mohamed Ahmed Kulu') | Side B. Track 1: Adaa Hadhuub Nabsigaa |
| mus00044c01084 | 12325 | Heeso xul ah – (a selection of songs) by Magool, Maxamed Yuusuf (Mohamed Yusuf) and Waabberi band (here: Magool, Maandeeq, Iftiin, Guduudo Caewo (Gududo Arow), and Hibo Maxamed (Hibo Mohamed)), Maxamad Axmed Kuluc (Mohamed Ahmed Kulu') | Side B. Track 2: U Guntadaay, 1967-02-06 |
| mus00044c01085 | 12325 | Heeso xul ah – (a selection of songs) by Magool, Maxamed Yuusuf (Mohamed Yusuf) and Waabberi band (here: Magool, Maandeeq, Iftiin, Guduudo Caewo (Gududo Arow), and Hibo Maxamed (Hibo Mohamed)), Maxamad Axmed Kuluc (Mohamed Ahmed Kulu') | Side B. Track 3: Markay ii habboonayd |
| mus00044c01086 | 12325 | Heeso xul ah – (a selection of songs) by Magool, Maxamed Yuusuf (Mohamed Yusuf) and Waabberi band (here: Magool, Maandeeq, Iftiin, Guduudo Caewo (Gududo Arow), and Hibo Maxamed (Hibo Mohamed)), Maxamad Axmed Kuluc (Mohamed Ahmed Kulu') | Side B. Track 4: Waa Duni Gabowdoo, 1964-06-20 |
| mus00044c01088 | 12326 | Songs from Maandeeq, Gacayte Ismaacil Yare (Ismail Yare), Cabdalla Sagsaag (Abdala Sagsag), Faysal Cumar Mushteeg (Faisal Omar Mushtek), Axmed Cali Dararamle (Ahmed Ali Daramle) | Side A. Track 1: Liibaane ha i lulinee |
| mus00044c01089 | 12326 | Songs from Maandeeq, Gacayte Ismaacil Yare (Ismail Yare), Cabdalla Sagsaag (Abdala Sagsag), Faysal Cumar Mushteeg (Faisal Omar Mushtek), Axmed Cali Dararamle (Ahmed Ali Daramle) | Side A. Track 2: Geed ba geedka u dheer |
| mus00044c01090 | 12326 | Songs from Maandeeq, Gacayte Ismaacil Yare (Ismail Yare), Cabdalla Sagsaag (Abdala Sagsag), Faysal Cumar Mushteeg (Faisal Omar Mushtek), Axmed Cali Dararamle (Ahmed Ali Daramle) | Side A. Track 3: Ha dardarin carrada |
| mus00044c01091 | 12326 | Songs from Maandeeq, Gacayte Ismaacil Yare (Ismail Yare), Cabdalla Sagsaag (Abdala Sagsag), Faysal Cumar Mushteeg (Faisal Omar Mushtek), Axmed Cali Dararamle (Ahmed Ali Daramle) | Side A. Track 4: Ha i gabin ee ha i goyn |
| mus00044c01092 | 12326 | Songs from Maandeeq, Gacayte Ismaacil Yare (Ismail Yare), Cabdalla Sagsaag (Abdala Sagsag), Faysal Cumar Mushteeg (Faisal Omar Mushtek), Axmed Cali Dararamle (Ahmed Ali Daramle) | Side B. Track 1: Geeri go'aan cidla ah |
| mus00044c01093 | 12326 | Songs from Maandeeq, Gacayte Ismaacil Yare (Ismail Yare), Cabdalla Sagsaag (Abdala Sagsag), Faysal Cumar Mushteeg (Faisal Omar Mushtek), Axmed Cali Dararamle (Ahmed Ali Daramle) | Side B. Track 2: Hadduu Geed Jacayl Yahay |
| mus00044c01094 | 12326 | Songs from Maandeeq, Gacayte Ismaacil Yare (Ismail Yare), Cabdalla Sagsaag (Abdala Sagsag), Faysal Cumar Mushteeg (Faisal Omar Mushtek), Axmed Cali Dararamle (Ahmed Ali Daramle) | Side B. Track 3: Bogsadee Aduun Hawl (or: Waa taad badheedheed) |
| mus00044c01095 | 12326 | Songs from Maandeeq, Gacayte Ismaacil Yare (Ismail Yare), Cabdalla Sagsaag (Abdala Sagsag), Faysal Cumar Mushteeg (Faisal Omar Mushtek), Axmed Cali Dararamle (Ahmed Ali Daramle) | Side B. Track 4: Meel joogsigaagii |
| mus00044c01097 | 12327 | Songs from Maxamed Suleebaan (Mohamed Sulaiman), Sulfa, Xaliima Milano (Halima Milano), Khadra Daahir (Khadra Dahir), Saalax Qaasim (Salah Kassim), and Shammuuri | Side A. Track 1: Hooyo |
| mus00044c01098 | 12327 | Songs from Maxamed Suleebaan (Mohamed Sulaiman), Sulfa, Xaliima Milano (Halima Milano), Khadra Daahir (Khadra Dahir), Saalax Qaasim (Salah Kassim), and Shammuuri | Side A. Track 2: Khayr al-anaami |
| mus00044c01099 | 12327 | Songs from Maxamed Suleebaan (Mohamed Sulaiman), Sulfa, Xaliima Milano (Halima Milano), Khadra Daahir (Khadra Dahir), Saalax Qaasim (Salah Kassim), and Shammuuri | Side A. Track 3: Nebi Ammaan |
| mus00044c01100 | 12327 | Songs from Maxamed Suleebaan (Mohamed Sulaiman), Sulfa, Xaliima Milano (Halima Milano), Khadra Daahir (Khadra Dahir), Saalax Qaasim (Salah Kassim), and Shammuuri | Side A. Track 4: Nabi Ammaan |
| mus00044c01101 | 12327 | Songs from Maxamed Suleebaan (Mohamed Sulaiman), Sulfa, Xaliima Milano (Halima Milano), Khadra Daahir (Khadra Dahir), Saalax Qaasim (Salah Kassim), and Shammuuri | Side B. Track 1: Sheeko Baraleey |
| mus00044c01102 | 12327 | Songs from Maxamed Suleebaan (Mohamed Sulaiman), Sulfa, Xaliima Milano (Halima Milano), Khadra Daahir (Khadra Dahir), Saalax Qaasim (Salah Kassim), and Shammuuri | Side B. Track 2: Jawaabtii Sheeko Baraleey |
| mus00044c01103 | 12327 | Songs from Maxamed Suleebaan (Mohamed Sulaiman), Sulfa, Xaliima Milano (Halima Milano), Khadra Daahir (Khadra Dahir), Saalax Qaasim (Salah Kassim), and Shammuuri | Side B. Track 3: Bariidaduna Waa Sedee |
| mus00044c01105 | 12328 | Songs by Dalays, Baxsan Xaaji Cali (Bahsan Haji Ali), Faadumo Cabdillaahi Maandeeq (Fadumo Abdillahi Maandeeq) | Side A. Track 1: Ani luun dhawaaye |
| mus00044c01106 | 12328 | Songs by Dalays, Baxsan Xaaji Cali (Bahsan Haji Ali), Faadumo Cabdillaahi Maandeeq (Fadumo Abdillahi Maandeeq) | Side A. Track 2: Guullahayoow |
| mus00044c01107 | 12328 | Songs by Dalays, Baxsan Xaaji Cali (Bahsan Haji Ali), Faadumo Cabdillaahi Maandeeq (Fadumo Abdillahi Maandeeq) | Side A. Track 3: Heelleelooy |
| mus00044c01108 | 12328 | Songs by Dalays, Baxsan Xaaji Cali (Bahsan Haji Ali), Faadumo Cabdillaahi Maandeeq (Fadumo Abdillahi Maandeeq) | Side B. Track 1: Ma Jin Baa Ma Jaan Baa |
| mus00044c01109 | 12328 | Songs by Dalays, Baxsan Xaaji Cali (Bahsan Haji Ali), Faadumo Cabdillaahi Maandeeq (Fadumo Abdillahi Maandeeq) | Side B. Track 2: Nabsi Baa Hiiliyoo |
| mus00044c01110 | 12328 | Songs by Dalays, Baxsan Xaaji Cali (Bahsan Haji Ali), Faadumo Cabdillaahi Maandeeq (Fadumo Abdillahi Maandeeq) | Side B. Track 3: Raaxeeye Burcaawi |
| mus00044c01112 | 12329 | Songs by Naadifo Xaaji Axmed (Nadifo Haji Ahmed), Axmed Cali Cigaal (Ahmed Ali Egal), Ismahaan Xumad (Ismahan Humad), Xaawa Guulwade (Hawa Gulwade) | Side A. Track 1: Jacaylku Hungoobi Maayo |
| mus00044c01113 | 12329 | Songs by Naadifo Xaaji Axmed (Nadifo Haji Ahmed), Axmed Cali Cigaal (Ahmed Ali Egal), Ismahaan Xumad (Ismahan Humad), Xaawa Guulwade (Hawa Gulwade) | Side A. Track 2: Garta Qaad Jacayloow |
| mus00044c01114 | 12329 | Songs by Naadifo Xaaji Axmed (Nadifo Haji Ahmed), Axmed Cali Cigaal (Ahmed Ali Egal), Ismahaan Xumad (Ismahan Humad), Xaawa Guulwade (Hawa Gulwade) | Side A. Track 3: Shiba Shiba |
| mus00044c01115 | 12329 | Songs by Naadifo Xaaji Axmed (Nadifo Haji Ahmed), Axmed Cali Cigaal (Ahmed Ali Egal), Ismahaan Xumad (Ismahan Humad), Xaawa Guulwade (Hawa Gulwade) | Side A. Track 4: Ma Beri Samaateen |
| mus00044c01116 | 12329 | Songs by Naadifo Xaaji Axmed (Nadifo Haji Ahmed), Axmed Cali Cigaal (Ahmed Ali Egal), Ismahaan Xumad (Ismahan Humad), Xaawa Guulwade (Hawa Gulwade) | Side A. Track 5: Igu Fiday Jacaylkii |
| mus00044c01117 | 12329 | Songs by Naadifo Xaaji Axmed (Nadifo Haji Ahmed), Axmed Cali Cigaal (Ahmed Ali Egal), Ismahaan Xumad (Ismahan Humad), Xaawa Guulwade (Hawa Gulwade) | Side A. Track 6: Haddaan ku warramo |
| mus00044c01118 | 12329 | Songs by Naadifo Xaaji Axmed (Nadifo Haji Ahmed), Axmed Cali Cigaal (Ahmed Ali Egal), Ismahaan Xumad (Ismahan Humad), Xaawa Guulwade (Hawa Gulwade) | Side B. Track 1: Hayaamooy maad i maqlaysaa |
| mus00044c01119 | 12329 | Songs by Naadifo Xaaji Axmed (Nadifo Haji Ahmed), Axmed Cali Cigaal (Ahmed Ali Egal), Ismahaan Xumad (Ismahan Humad), Xaawa Guulwade (Hawa Gulwade) | Side B. Track 2: Gabyayee, gabyayee |
| mus00044c01120 | 12329 | Songs by Naadifo Xaaji Axmed (Nadifo Haji Ahmed), Axmed Cali Cigaal (Ahmed Ali Egal), Ismahaan Xumad (Ismahan Humad), Xaawa Guulwade (Hawa Gulwade) | Side B. Track 3: Shalambood |
| mus00044c01121 | 12329 | Songs by Naadifo Xaaji Axmed (Nadifo Haji Ahmed), Axmed Cali Cigaal (Ahmed Ali Egal), Ismahaan Xumad (Ismahan Humad), Xaawa Guulwade (Hawa Gulwade) | Side B. Track 4: Allow ha ina kala tuurin |
| mus00044c01123 | 12330 | Songs by Hibo Maxamad (Hibo Mohamed), Shammuuri, Magool, Xasan Aadan Samatar (Hasan Aden Samatar), Magool, Maxamed Mooge (Mohamed Mogeh) | Side A. Track 1: Ma Muujiyee Jacaylka |
| mus00044c01124 | 12330 | Songs by Hibo Maxamad (Hibo Mohamed), Shammuuri, Magool, Xasan Aadan Samatar (Hasan Aden Samatar), Magool, Maxamed Mooge (Mohamed Mogeh) | Side A. Track 2: Duni Aakhir Sabaneey |
| mus00044c01125 | 12330 | Songs by Hibo Maxamad (Hibo Mohamed), Shammuuri, Magool, Xasan Aadan Samatar (Hasan Aden Samatar), Magool, Maxamed Mooge (Mohamed Mogeh) | Side A. Track 3: Rabbiyoow |
| mus00044c01126 | 12330 | Songs by Hibo Maxamad (Hibo Mohamed), Shammuuri, Magool, Xasan Aadan Samatar (Hasan Aden Samatar), Magool, Maxamed Mooge (Mohamed Mogeh) | Side B. Track 1: Rucub (or: Naftu kuma rabtee) |
| mus00044c01127 | 12330 | Songs by Hibo Maxamad (Hibo Mohamed), Shammuuri, Magool, Xasan Aadan Samatar (Hasan Aden Samatar), Magool, Maxamed Mooge (Mohamed Mogeh) | Side B. Track 2: Boqorkow na kulansii |
| mus00044c01128 | 12330 | Songs by Hibo Maxamad (Hibo Mohamed), Shammuuri, Magool, Xasan Aadan Samatar (Hasan Aden Samatar), Magool, Maxamed Mooge (Mohamed Mogeh) | Side B. Track 3: Maxaa kaa galay |
| mus00044c01129 | 12330 | Songs by Hibo Maxamad (Hibo Mohamed), Shammuuri, Magool, Xasan Aadan Samatar (Hasan Aden Samatar), Magool, Maxamed Mooge (Mohamed Mogeh) | Side B. Track 4: Waan Kuu Asqooboo |
| mus00044c01131 | 12331 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Baxsan Xaaji Cali (Bahsan Haji Ali), Hibo Maxamed (Hibo Mohamed), Cabdi Muxumad (Abdi Muhumed), Maryan Mursal | Side A. Track 1: Caashaqu Ma Fududee |
| mus00044c01132 | 12331 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Baxsan Xaaji Cali (Bahsan Haji Ali), Hibo Maxamed (Hibo Mohamed), Cabdi Muxumad (Abdi Muhumed), Maryan Mursal | Side A. Track 2: Aadna Taa Qiiro Ha Galin |
| mus00044c01133 | 12331 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Baxsan Xaaji Cali (Bahsan Haji Ali), Hibo Maxamed (Hibo Mohamed), Cabdi Muxumad (Abdi Muhumed), Maryan Mursal | Side A. Track 3: Kaftankuna Inoo Furan |
| mus00044c01134 | 12331 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Baxsan Xaaji Cali (Bahsan Haji Ali), Hibo Maxamed (Hibo Mohamed), Cabdi Muxumad (Abdi Muhumed), Maryan Mursal | Side A. Track 4: Ka Bul dheh |
| mus00044c01135 | 12331 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Baxsan Xaaji Cali (Bahsan Haji Ali), Hibo Maxamed (Hibo Mohamed), Cabdi Muxumad (Abdi Muhumed), Maryan Mursal | Side A. Track 5: Caashaq shaxdi |
| mus00044c01136 | 12331 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Baxsan Xaaji Cali (Bahsan Haji Ali), Hibo Maxamed (Hibo Mohamed), Cabdi Muxumad (Abdi Muhumed), Maryan Mursal | Side B. Track 1: Dagaalkii Xaal Ka Qaado |
| mus00044c01137 | 12331 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Baxsan Xaaji Cali (Bahsan Haji Ali), Hibo Maxamed (Hibo Mohamed), Cabdi Muxumad (Abdi Muhumed), Maryan Mursal | Side B. Track 2: Dhado Roob ma noqoto |
| mus00044c01138 | 12331 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Baxsan Xaaji Cali (Bahsan Haji Ali), Hibo Maxamed (Hibo Mohamed), Cabdi Muxumad (Abdi Muhumed), Maryan Mursal | Side B. Track 3: Dorraatoo Miyaad Illoowday |
| mus00044c01139 | 12331 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Baxsan Xaaji Cali (Bahsan Haji Ali), Hibo Maxamed (Hibo Mohamed), Cabdi Muxumad (Abdi Muhumed), Maryan Mursal | Side B. Track 4: Hoo Gacanta (or: Gacan baan ku siiyee), 1968 |
| mus00044c01140 | 12331 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Baxsan Xaaji Cali (Bahsan Haji Ali), Hibo Maxamed (Hibo Mohamed), Cabdi Muxumad (Abdi Muhumed), Maryan Mursal | Side B. Track 5: Armaynu hodanay (or: Haweeyaay) |
| mus00044c01142 | 12332 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Nageeye, Duniya | Side A. Track 1: Cakuyeey Hawl Adduun |
| mus00044c01143 | 12332 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Nageeye, Duniya | Side A. Track 2: Garqaado Jacaylyahow, 1971 |
| mus00044c01144 | 12332 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Nageeye, Duniya | Side A. Track 3: Ubax Dhashay (or: Midabkeeda Dhiinka ah), 1971 |
| mus00044c01145 | 12332 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Nageeye, Duniya | Side A. Track 4: Guuleed Hurdoow |
| mus00044c01146 | 12332 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Nageeye, Duniya | Side B. Track 1: Goobtaan fadhiistaba (or: Galgalasho) |
| mus00044c01147 | 12332 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Nageeye, Duniya | Side B. Track 2: Hilaac |
| mus00044c01148 | 12332 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Nageeye, Duniya | Side B. Track 3: Ma Tagaa cishqigu |
| mus00044c01149 | 12332 | Songs by Axmed Cali Cigaal (Ahmed Ali Egal), Nageeye, Duniya | Side B. Track 4: Caynkii Arraweelo |
| mus00044c01151 | 12333 | Songs by Maxamed Mooge (Mohamed Mogeh), Maxamad Axmad Kuluc (Mohamed Ahmed Kulu'), Magool, Maryan Mursal, Cumar Dhuule (Omar Duleh), Maxamed Nuur Giriig (Mohamed Nur Griig), Faadumo Axmed (Fadumo Ahmed | Side A. Track 1: Mahiigaan |
| mus00044c01152 | 12333 | Songs by Maxamed Mooge (Mohamed Mogeh), Maxamad Axmad Kuluc (Mohamed Ahmed Kulu'), Magool, Maryan Mursal, Cumar Dhuule (Omar Duleh), Maxamed Nuur Giriig (Mohamed Nur Griig), Faadumo Axmed (Fadumo Ahmed | Side A. Track 2: Dadnimad Aqoonso, 1975-07-12 |
| mus00044c01153 | 12333 | Songs by Maxamed Mooge (Mohamed Mogeh), Maxamad Axmad Kuluc (Mohamed Ahmed Kulu'), Magool, Maryan Mursal, Cumar Dhuule (Omar Duleh), Maxamed Nuur Giriig (Mohamed Nur Griig), Faadumo Axmed (Fadumo Ahmed | Side A. Track 3: Nabar Jacayl, 1973-12-08 |
| mus00044c01154 | 12333 | Songs by Maxamed Mooge (Mohamed Mogeh), Maxamad Axmad Kuluc (Mohamed Ahmed Kulu'), Magool, Maryan Mursal, Cumar Dhuule (Omar Duleh), Maxamed Nuur Giriig (Mohamed Nur Griig), Faadumo Axmed (Fadumo Ahmed | Side A. Track 4: Dahabooy ii Sheeg |
| mus00044c01155 | 12333 | Songs by Maxamed Mooge (Mohamed Mogeh), Maxamad Axmad Kuluc (Mohamed Ahmed Kulu'), Magool, Maryan Mursal, Cumar Dhuule (Omar Duleh), Maxamed Nuur Giriig (Mohamed Nur Griig), Faadumo Axmed (Fadumo Ahmed | Side B. Track 1: Bir baa igu Jabsanee |
| mus00044c01156 | 12333 | Songs by Maxamed Mooge (Mohamed Mogeh), Maxamad Axmad Kuluc (Mohamed Ahmed Kulu'), Magool, Maryan Mursal, Cumar Dhuule (Omar Duleh), Maxamed Nuur Giriig (Mohamed Nur Griig), Faadumo Axmed (Fadumo Ahmed | Side B. Track 2: Hinaaso |
| mus00044c01157 | 12333 | Songs by Maxamed Mooge (Mohamed Mogeh), Maxamad Axmad Kuluc (Mohamed Ahmed Kulu'), Magool, Maryan Mursal, Cumar Dhuule (Omar Duleh), Maxamed Nuur Giriig (Mohamed Nur Griig), Faadumo Axmed (Fadumo Ahmed | Side B. Track 3: Hiddo, 1967-10-01 |
| mus00044c01159 | 12334 | Songs by Faadumo Qaasim (Fadumo Kasim), Axmed Naaji (Ahmed Naji), Aways (Awes), Shooble | Side A. Track 1: Bildhaan Qurxoon |
| mus00044c01160 | 12334 | Songs by Faadumo Qaasim (Fadumo Kasim), Axmed Naaji (Ahmed Naji), Aways (Awes), Shooble | Side A. Track 2: Waqti Dhaaxaan |
| mus00044c01161 | 12334 | Songs by Faadumo Qaasim (Fadumo Kasim), Axmed Naaji (Ahmed Naji), Aways (Awes), Shooble | Side A. Track 3: Xaasida Xaawo iyo Aadan |
| mus00044c01162 | 12334 | Songs by Faadumo Qaasim (Fadumo Kasim), Axmed Naaji (Ahmed Naji), Aways (Awes), Shooble | Side A. Track 4: Casiisoow Midkaan Rabay |
| mus00044c01163 | 12334 | Songs by Faadumo Qaasim (Fadumo Kasim), Axmed Naaji (Ahmed Naji), Aways (Awes), Shooble | Side B. Track 1: Waqti dhaaxaan [repeat from Side A] |
| mus00044c01164 | 12334 | Songs by Faadumo Qaasim (Fadumo Kasim), Axmed Naaji (Ahmed Naji), Aways (Awes), Shooble | Side B. Track 2: Calaf Waa Xumaadaa (or: Ceeb maleh) |
| mus00044c01165 | 12334 | Songs by Faadumo Qaasim (Fadumo Kasim), Axmed Naaji (Ahmed Naji), Aways (Awes), Shooble | Side B. Track 3: La illaha illa Allah |
| mus00044c01166 | 12334 | Songs by Faadumo Qaasim (Fadumo Kasim), Axmed Naaji (Ahmed Naji), Aways (Awes), Shooble | Side B. Track 4: An Waan Guurayeey |
| mus00044c01168 | 12335 | Songs by Xasan Aadan Samatar (Hasan Aden Samatar), Axmadey Abubakar (Ahmedei Abubakr), Faadumo Qaasim (Fadumo Kasim), Faarax Sidoow (Farah Sidow), Sitay Manoogto, Shooli | Side A. Track 1: Qaahira |
| mus00044c01169 | 12335 | Songs by Xasan Aadan Samatar (Hasan Aden Samatar), Axmadey Abubakar (Ahmedei Abubakr), Faadumo Qaasim (Fadumo Kasim), Faarax Sidoow (Farah Sidow), Sitay Manoogto, Shooli | Side A. Track 2: Qays iyo Layla |
| mus00044c01170 | 12335 | Songs by Xasan Aadan Samatar (Hasan Aden Samatar), Axmadey Abubakar (Ahmedei Abubakr), Faadumo Qaasim (Fadumo Kasim), Faarax Sidoow (Farah Sidow), Sitay Manoogto, Shooli | Side A. Track 3: Qur'aan ha la i saaroo |
| mus00044c01171 | 12335 | Songs by Xasan Aadan Samatar (Hasan Aden Samatar), Axmadey Abubakar (Ahmedei Abubakr), Faadumo Qaasim (Fadumo Kasim), Faarax Sidoow (Farah Sidow), Sitay Manoogto, Shooli | Side A. Track 4: Manseer |
| mus00044c01172 | 12335 | Songs by Xasan Aadan Samatar (Hasan Aden Samatar), Axmadey Abubakar (Ahmedei Abubakr), Faadumo Qaasim (Fadumo Kasim), Faarax Sidoow (Farah Sidow), Sitay Manoogto, Shooli | Side A. Track 5: Caawa Waa Inaan Carraabaaye |
| mus00044c01173 | 12335 | Songs by Xasan Aadan Samatar (Hasan Aden Samatar), Axmadey Abubakar (Ahmedei Abubakr), Faadumo Qaasim (Fadumo Kasim), Faarax Sidoow (Farah Sidow), Sitay Manoogto, Shooli | Side A. Track 6: Waan Ku Hoobtee |
| mus00044c01174 | 12335 | Songs by Xasan Aadan Samatar (Hasan Aden Samatar), Axmadey Abubakar (Ahmedei Abubakr), Faadumo Qaasim (Fadumo Kasim), Faarax Sidoow (Farah Sidow), Sitay Manoogto, Shooli | Side B. Track 1: Huburow |
| mus00044c01175 | 12335 | Songs by Xasan Aadan Samatar (Hasan Aden Samatar), Axmadey Abubakar (Ahmedei Abubakr), Faadumo Qaasim (Fadumo Kasim), Faarax Sidoow (Farah Sidow), Sitay Manoogto, Shooli | Side B. Track 2: Warkaa ma diidaayo |
| mus00044c01176 | 12335 | Songs by Xasan Aadan Samatar (Hasan Aden Samatar), Axmadey Abubakar (Ahmedei Abubakr), Faadumo Qaasim (Fadumo Kasim), Faarax Sidoow (Farah Sidow), Sitay Manoogto, Shooli | Side B. Track 3: Xaakaba, 1972 |
| mus00044c01177 | 12335 | Songs by Xasan Aadan Samatar (Hasan Aden Samatar), Axmadey Abubakar (Ahmedei Abubakr), Faadumo Qaasim (Fadumo Kasim), Faarax Sidoow (Farah Sidow), Sitay Manoogto, Shooli | Side B. Track 4: Kookoyaado |
| mus00044c01178 | 12335 | Songs by Xasan Aadan Samatar (Hasan Aden Samatar), Axmadey Abubakar (Ahmedei Abubakr), Faadumo Qaasim (Fadumo Kasim), Faarax Sidoow (Farah Sidow), Sitay Manoogto, Shooli | Side B. Track 5: Halloow |
| mus00044c01180 | 12336 | Songs by Aamina Cali Jiisoow (Amina Ali Jiso) | Side A. Track 1: Waa Hubaal |
| mus00044c01181 | 12336 | Songs by Aamina Cali Jiisoow (Amina Ali Jiso) | Side A. Track 2: Caashaqu sal iyo baar |
| mus00044c01182 | 12336 | Songs by Aamina Cali Jiisoow (Amina Ali Jiso) | Side A. Track 3: Carcaraafayeey |
| mus00044c01183 | 12336 | Songs by Aamina Cali Jiisoow (Amina Ali Jiso) | Side B. Track 1: Mashxarad |
| mus00044c01184 | 12336 | Songs by Aamina Cali Jiisoow (Amina Ali Jiso) | Side B. Track 2: Ummuliso |
| mus00044c01185 | 12336 | Songs by Aamina Cali Jiisoow (Amina Ali Jiso) | Side B. Track 3: Cakuyeey |
| mus00044c01186 | 12336 | Songs by Aamina Cali Jiisoow (Amina Ali Jiso) | Side B. Track 4: Goormaan Helayaa |
| mus00044c01188 | 12337 | Songs from the play Shabeelnaagood | Side A. Track 1: Dab Dhaxmooday |
| mus00044c01189 | 12337 | Songs from the play Shabeelnaagood | Side A. Track 2: Adaa Garan Waxay Gubee (or: Garwaaqso) |
| mus00044c01190 | 12337 | Songs from the play Shabeelnaagood | Side A. Track 3: Sida Dhig iyo Udubkeed |
| mus00044c01191 | 12337 | Songs from the play Shabeelnaagood | Side A. Track 4: Haweeyaay |
| mus00044c01192 | 12337 | Songs from the play Shabeelnaagood | Side A. Track 5: Jawhar iyo Luul [only half] |
| mus00044c01193 | 12337 | Songs from the play Shabeelnaagood | Side B. Track 1: Alla, Alla Nimanku |
| mus00044c01194 | 12337 | Songs from the play Shabeelnaagood | Side B. Track 2: Beri Hore Waxaa Jiray |
| mus00044c01195 | 12337 | Songs from the play Shabeelnaagood | Side B. Track 3: Ruuneey Haweenku |
| mus00044c01196 | 12337 | Songs from the play Shabeelnaagood | Side B. Track 4: Dab Dhaxmooday [Repeated from side A] |
| mus00044c01205 | 12339 | Songs by Hibo Maxamad (Hibo Mohamed), Bashiir Xaddi (Bashir Haddi) | Side A. Track 1: Hoonbaro, 1967 |
| mus00044c01206 | 12339 | Songs by Hibo Maxamad (Hibo Mohamed), Bashiir Xaddi (Bashir Haddi) | Side A. Track 2: Rako |
| mus00044c01207 | 12339 | Songs by Hibo Maxamad (Hibo Mohamed), Bashiir Xaddi (Bashir Haddi) | Side A. Track 3: Sabab Kale |
| mus00044c01208 | 12339 | Songs by Hibo Maxamad (Hibo Mohamed), Bashiir Xaddi (Bashir Haddi) | Side A. Track 4: Laaleey |
| mus00044c01209 | 12339 | Songs by Hibo Maxamad (Hibo Mohamed), Bashiir Xaddi (Bashir Haddi) | Side B. Track 1: Muhasho, 1970-06-20 |
| mus00044c01210 | 12339 | Songs by Hibo Maxamad (Hibo Mohamed), Bashiir Xaddi (Bashir Haddi) | Side B. Track 2: Ma Huraan (or: Mahuuran), 1968 |
| mus00044c01211 | 12339 | Songs by Hibo Maxamad (Hibo Mohamed), Bashiir Xaddi (Bashir Haddi) | Side B. Track 3: Hubsad, 1965-12-19 |
| mus00044c01213 | 12340 | Songs by Hibo Maxamad (Hibo Mohamed) and Cabdi Muxumad (Abdi Muhumed) Xareedo Ismaaciil Duniya (Haredo Ismail Dunia) | Side A. Track 1: Dab Dhaxmooday |
| mus00044c01214 | 12340 | Songs by Hibo Maxamad (Hibo Mohamed) and Cabdi Muxumad (Abdi Muhumed) Xareedo Ismaaciil Duniya (Haredo Ismail Dunia) | Side A. Track 2: Xubin na siiya |
| mus00044c01215 | 12340 | Songs by Hibo Maxamad (Hibo Mohamed) and Cabdi Muxumad (Abdi Muhumed) Xareedo Ismaaciil Duniya (Haredo Ismail Dunia) | Side A. Track 3: Geeraar Calaacal Ah |
| mus00044c01216 | 12340 | Songs by Hibo Maxamad (Hibo Mohamed) and Cabdi Muxumad (Abdi Muhumed) Xareedo Ismaaciil Duniya (Haredo Ismail Dunia) | Side A. Track 4: Adaa Garan Waxay Gubee (or: Garwaaqso) |
| mus00044c01217 | 12340 | Songs by Hibo Maxamad (Hibo Mohamed) and Cabdi Muxumad (Abdi Muhumed) Xareedo Ismaaciil Duniya (Haredo Ismail Dunia) | Side B. Track 1: Lahasho or Laqanyada jacaylkiyo |
| mus00044c01218 | 12340 | Songs by Hibo Maxamad (Hibo Mohamed) and Cabdi Muxumad (Abdi Muhumed) Xareedo Ismaaciil Duniya (Haredo Ismail Dunia) | Side B. Track 2: Baraarug |
| mus00044c01219 | 12340 | Songs by Hibo Maxamad (Hibo Mohamed) and Cabdi Muxumad (Abdi Muhumed) Xareedo Ismaaciil Duniya (Haredo Ismail Dunia) | Side B. Track 3: Faalkii caashaqa (or: Fikir) |
| mus00044c01221 | 12341 | Heeso Xul ah (Selection of songs) | Side A. Track 1: Hayee hayee halbowlahaygaay (or: Hoobaalla Hoobaallayoow) |
| mus00044c01222 | 12341 | Heeso Xul ah (Selection of songs) | Side A. Track 2: Googgaa Waa Hadal |
| mus00044c01223 | 12341 | Heeso Xul ah (Selection of songs) | Side A. Track 3: Rucubka naasaha (or: Mid Kuu Roon Rabbaa Og) |
| mus00044c01224 | 12341 | Heeso Xul ah (Selection of songs) | Side A. Track 4: Jaw, Nabadgalyo (or: Ciao, nabadgalyo) |
| mus00044c01225 | 12341 | Heeso Xul ah (Selection of songs) | Side B. Track 1: Hooyo la'aanta (or: Hooyo) |
| mus00044c01226 | 12341 | Heeso Xul ah (Selection of songs) | Side B. Track 2: Ma Jin Baa Ma Jaan Baa |
| mus00044c01227 | 12341 | Heeso Xul ah (Selection of songs) | Side B. Track 3: Soo Haabo Hobo oo Kac |
| mus00044c01198 | 12342 | Heeso xul ah (Selection of songs) | Side A. Track 1: Soo Hor Caahaqa (or: Ragga iyo Haweenkuba), 1974 |
| mus00044c01199 | 12342 | Heeso xul ah (Selection of songs) | Side A. Track 2: Waa Duulisteennii, 1976 |
| mus00044c01200 | 12342 | Heeso xul ah (Selection of songs) | Side A. Track 3: Ha Liicin Ha Libdhin, 1976 |
| mus00044c01201 | 12342 | Heeso xul ah (Selection of songs) | Side B. Track 1: Dhoof Dhoof, 1974 |
| mus00044c01202 | 12342 | Heeso xul ah (Selection of songs) | Side B. Track 2: Shaan-Shaan |
| mus00044c01203 | 12342 | Heeso xul ah (Selection of songs) | Side B. Track 3: Sidaa Ma Isku Qabnaa |
| mus00044c01229 | 12342 | Heeso xul ah (Selection of songs) | Side A. Track 1: Weli Daad Ma Kula Tagay |
| mus00044c01230 | 12342 | Heeso xul ah (Selection of songs) | Side A. Track 2: Baxnaanoo |
| mus00044c01231 | 12342 | Heeso xul ah (Selection of songs) | Side A. Track 3: Haygu Daalinee Samiree |
| mus00044c01232 | 12342 | Heeso xul ah (Selection of songs) | Side A. Track 4: Guurkii runta ahaa |
| mus00044c01233 | 12342 | Heeso xul ah (Selection of songs) | Side B. Track 1: Ima Baranee Ha i Nicin |
| mus00044c01234 | 12342 | Heeso xul ah (Selection of songs) | Side B. Track 2: Hadmaad Gacaliye Soo Noqon, 1975-04-12 |
| mus00044c01235 | 12342 | Heeso xul ah (Selection of songs) | Side B. Track 3: Dun Jacayl (or: Waa Degel Adduunyadu), 1977-02-28 |
| mus00044c01236 | 12342 | Heeso xul ah (Selection of songs) | Side B. Track 4: Gudgudo Roob (or: Godobtayda la carroow), 1981 |
| mus00044c01238 | 12343 | Songs by Axmed Cali Dararamle (Ahmed Ali Daramle) | Side A. Track 1: Skushuban |
| mus00044c01239 | 12343 | Songs by Axmed Cali Dararamle (Ahmed Ali Daramle) | Side A. Track 2: Shacni Iyo Wanaag |
| mus00044c01240 | 12343 | Songs by Axmed Cali Dararamle (Ahmed Ali Daramle) | Side A. Track 3: Qaraami |
| mus00044c01241 | 12343 | Songs by Axmed Cali Dararamle (Ahmed Ali Daramle) | Side A. Track 4: Qadar music ah (a bit of music) |
| mus00044c01242 | 12343 | Songs by Axmed Cali Dararamle (Ahmed Ali Daramle) | Side B. Track 1: Ha i Gabinee ha i goynee |
| mus00044c01243 | 12343 | Songs by Axmed Cali Dararamle (Ahmed Ali Daramle) | Side B. Track 2: Subcis or Subcis Faisal |
| mus00044c01244 | 12343 | Songs by Axmed Cali Dararamle (Ahmed Ali Daramle) | Side B. Track 3: Ha igu daynina |
| mus00044c01245 | 12343 | Songs by Axmed Cali Dararamle (Ahmed Ali Daramle) | Side B. Track 4: Ya naasiina |
| mus00044c01247 | 12344 | Waa madays adduunyadu | Side A. Track 1: Songs from the play Waa Madays Adduunyadu |
| mus00044c01248 | 12344 | Waa madays adduunyadu | Side A. Track 2: Hiddiyo hiddi (or: Diiyoo hiddii) |
| mus00044c01249 | 12344 | Waa madays adduunyadu | Side A. Track 3: Allow Yaa Timo Ku Siiya |
| mus00044c01250 | 12344 | Waa madays adduunyadu | Side A. Track 4: Ciyoowgii Habeen |
| mus00044c01251 | 12344 | Waa madays adduunyadu | Side A. Track 5: Addunyadan |
| mus00044c01252 | 12344 | Waa madays adduunyadu | Side B. Track 1: Hadduu Beerku Qaybsamo |
| mus00044c01253 | 12344 | Waa madays adduunyadu | Side B. Track 2: Xero Dayo Xalaaleey |
| mus00044c01254 | 12344 | Waa madays adduunyadu | Side B. Track 3: Hiddiyo hiddi (or: Diiyoo hiddii) |
| mus00044c01255 | 12344 | Waa madays adduunyadu | Side B. Track 4: Badanaa Adduunyadu |
| mus00044c01257 | 12345 | Heeso xul ah (A selection of songs) | Side A. Track 1: Naagtii Walaalkaa (or: Naagtii shalay) |
| mus00044c01258 | 12345 | Heeso xul ah (A selection of songs) | Side A. Track 2: Gudcur aan Caddo ba Jirin |
| mus00044c01259 | 12345 | Heeso xul ah (A selection of songs) | Side A. Track 3: Axmad Guray, 1976 |
| mus00044c01260 | 12345 | Heeso xul ah (A selection of songs) | Side A. Track 4: Waa layaab jacaylku (or: Lahashadaydiyo) |
| mus00044c01261 | 12345 | Heeso xul ah (A selection of songs) | Side B. Track 1: Adun baa Gabaddyahay |
| mus00044c01262 | 12345 | Heeso xul ah (A selection of songs) | Side B. Track 2: Sharac Alleh |
| mus00044c01263 | 12345 | Heeso xul ah (A selection of songs) | Side B. Track 3: Waa lama illaawaan |
| mus00044c01264 | 12345 | Heeso xul ah (A selection of songs) | Side B. Track 4: Intaad waab i saartaba |
| mus00044c01266 | 12346 | Songs by Khadra Daahir (Khadra dahir) and Cabdulqaadir Juba (Abdulkadir Juba) | Side A. Track 1: Waa La I Heloo |
| mus00044c01267 | 12346 | Songs by Khadra Daahir (Khadra dahir) and Cabdulqaadir Juba (Abdulkadir Juba) | Side A. Track 2: Xaggeen Talo Kaga Hagaagaa |
| mus00044c01268 | 12346 | Songs by Khadra Daahir (Khadra dahir) and Cabdulqaadir Juba (Abdulkadir Juba) | Side A. Track 3: Calaf Lama Dago |
| mus00044c01269 | 12346 | Songs by Khadra Daahir (Khadra dahir) and Cabdulqaadir Juba (Abdulkadir Juba) | Side A. Track 4: Naas-naasiyo |
| mus00044c01270 | 12346 | Songs by Khadra Daahir (Khadra dahir) and Cabdulqaadir Juba (Abdulkadir Juba) | Side B. Track 1: Qalbi Gudhan |
| mus00044c01271 | 12346 | Songs by Khadra Daahir (Khadra dahir) and Cabdulqaadir Juba (Abdulkadir Juba) | Side B. Track 2: Caashaqu Habeen Ma Leh |
| mus00044c01272 | 12346 | Songs by Khadra Daahir (Khadra dahir) and Cabdulqaadir Juba (Abdulkadir Juba) | Side B. Track 3: Meel Quruurux Badan |
| mus00044c01274 | 12347 | Songs by Hibo Maxamed Huddoon (Hibo Mohamed Huddoon) | Side A. Track 1: Kaftan (or: Waa I kan ee ku aaway) |
| mus00044c01275 | 12347 | Songs by Hibo Maxamed Huddoon (Hibo Mohamed Huddoon) | Side A. Track 2: Fanka Loolka Caashaqa |
| mus00044c01276 | 12347 | Songs by Hibo Maxamed Huddoon (Hibo Mohamed Huddoon) | Side A. Track 3: Kow iyo Kun Habeen |
| mus00044c01277 | 12347 | Songs by Hibo Maxamed Huddoon (Hibo Mohamed Huddoon) | Side A. Track 4: Naxariista ha i mirin (or: Lebi yahow) |
| mus00044c01278 | 12347 | Songs by Hibo Maxamed Huddoon (Hibo Mohamed Huddoon) | Side B. Track 1: Muhasho (or: Inuu muruggadda iga meershoo), 1970-06-20 |
| mus00044c01279 | 12347 | Songs by Hibo Maxamed Huddoon (Hibo Mohamed Huddoon) | Side B. Track 2: Had iyo Goor (or: Hiyiga kaan ku hayey) |
| mus00044c01280 | 12347 | Songs by Hibo Maxamed Huddoon (Hibo Mohamed Huddoon) | Side B. Track 3: Umul Garasho Dheeree  (or: Gudcurkaan habeensaday) |
| mus00044c01281 | 12347 | Songs by Hibo Maxamed Huddoon (Hibo Mohamed Huddoon) | Side B. Track 4: Naf jacayl haleeley |
| mus00044c01283 | 12348 | Untitled: Cassette 150 | Side A. Track 1: Dadnimadda Aqoonso, 1975-07-12 |
| mus00044c01284 | 12348 | Untitled: Cassette 150 | Side A. Track 2: Ka Bul dheh |
| mus00044c01285 | 12348 | Untitled: Cassette 150 | Side A. Track 3: Kalgayl Illayn Igama Suuree (or: Naftaydaan samir) |
| mus00044c01286 | 12348 | Untitled: Cassette 150 | Side B. Track 1: Naagtii Walaalkaa (or: Naagtii shalay) |
| mus00044c01287 | 12348 | Untitled: Cassette 150 | Side B. Track 2: Daawada Caashaqa |
| mus00044c01288 | 12348 | Untitled: Cassette 150 | Side B. Track 3: Allahayoow Dal Ma Aqaan |
| mus00044c01289 | 12348 | Untitled: Cassette 150 | Side B. Track 4: Jacayl Biri Ma Goyso |
| mus00044c01291 | 12349 | Songs by Maryan Mursal | Side A. Track 1: Ladi waayey (or: Liqi waayey) |
| mus00044c01292 | 12349 | Songs by Maryan Mursal | Side A. Track 2: Kuu imi Ina abtow |
| mus00044c01293 | 12349 | Songs by Maryan Mursal | Side A. Track 3: Kaaf iyo Kala-dheeri |
| mus00044c01294 | 12349 | Songs by Maryan Mursal | Side A. Track 4: Saddex Cadaw Ayaa Jiray (or: Caashaqa ha lagu daro) |
| mus00044c01295 | 12349 | Songs by Maryan Mursal | Side B. Track 1: Baxnaano |
| mus00044c01296 | 12349 | Songs by Maryan Mursal | Side B. Track 2: Waa Aqoon Jacayloo |
| mus00044c01297 | 12349 | Songs by Maryan Mursal | Side B. Track 3: Adaa Garan Waxay Gubee (or: Garwaaqso) |
| mus00044c01298 | 12349 | Songs by Maryan Mursal | Side B. Track 4: Indho Caashaq |
| mus00044c01300 | 12350 | Songs by Axmed Naaji Sacad (Ahmed Naji Saad) | Side A. Track 1: Gabdhahaan Gacalkooda |
| mus00044c01301 | 12350 | Songs by Axmed Naaji Sacad (Ahmed Naji Saad) | Side A. Track 2: Waa La Guursadee (or: Garan waayee) |
| mus00044c01302 | 12350 | Songs by Axmed Naaji Sacad (Ahmed Naji Saad) | Side A. Track 3: Waan Guurayeey (or: Gaabo guurkaaga) |
| mus00044c01303 | 12350 | Songs by Axmed Naaji Sacad (Ahmed Naji Saad) | Side B. Track 1: Dal iyo Duunyo (or: Meel daawo leh) |
| mus00044c01304 | 12350 | Songs by Axmed Naaji Sacad (Ahmed Naji Saad) | Side B. Track 2: Ani ku jeelaa |
| mus00044c01305 | 12350 | Songs by Axmed Naaji Sacad (Ahmed Naji Saad) | Side B. Track 3: Waqti Dhaaxaa |
| mus00044c01306 | 12350 | Songs by Axmed Naaji Sacad (Ahmed Naji Saad) | Side B. Track 4: Calaf Waa Xumaadaa (or: Cariiri waaye) |

## 7. Cassette-level objects with no digital object (2)

| cid | cassette | title |
| --- | --- | --- |
| mus00044c00880 | 12301 | Songs from Djibouti by Cabdinuur Alaale (Abdinur Alaleh) |
| mus00044c00045 | 12243 | [BLANK TAPE] Maxamed Axmed "Kuluc" (Mohamed Ahmed Kulu') [BLANK TAPE] |

## 8. Legacy files on disk with no manifest row (3)

`*.mp3` files in `data/harvard_raw/legacy` that no manifest row names. They are in no count above, no hours figure, and no training set (`build_sets` reads the manifest only). A 2025 file is identified by its `track_NNNN` prefix, the 1-based row of `harvard_tracks_metadata.csv`; when two files point at one URN, the fetcher's legacy index keeps one and the other has no row, and the title of at least one of the pair is wrong in that metadata, so the identity of both stays unresolved until someone listens to them against the catalog.

| file | bytes | URN from the 2025 metadata | note |
| --- | --- | --- | --- |
| somali_test_001.mp3 | 71863001 | ? | no track_NNNN prefix, so no row of harvard_tracks_metadata.csv names it; identity unknown |
| track_0255_Side_A_Track_1_Naftu_lama_diido.mp3 | 23278377 | fhcl.loeb:33944591 | identity unresolved: shares URN fhcl.loeb:33944591 with track_0316_Side_A_Track_1_I_soo_lali.mp3 (23277335 B, has a manifest row); the fetcher's legacy index keeps one file per URN, so this one has no row and one of the two carries a wrong title in the 2025 metadata |
| track_0319_Side_A_Track_4_Kani_waa_hannadkii.mp3 | 21186492 | fhcl.loeb:42364498 | identity unresolved: shares URN fhcl.loeb:42364498 with track_0320_Side_B_Track_1_Niyadda_beenta_ah.mp3 (21184403 B, has a manifest row); the fetcher's legacy index keeps one file per URN, so this one has no row and one of the two carries a wrong title in the 2025 metadata |
