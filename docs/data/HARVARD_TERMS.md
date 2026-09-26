# Harvard collection — rights and terms on record (verbatim)

The Maryan "Aryette" Omar Ali Collection (*Somali Songs, 1955–1991*, Archive of
World Music, Eda Kuhn Loeb Music Library, Harvard University; call number AWM
Spec Coll 103; EAD id `mus00044`) is the source of `data/harvard_raw/`. This
file records, word for word, every rights, access and terms statement the
project has captured about that collection, where each statement came from,
and what has *not* been read. It draws no legal conclusion. The captures
themselves are on disk under `data/harvard_catalog/terms_capture/` (fetched
with curl on **2026-09-25T20:26:32Z**, per `FETCHED_AT.txt` in that folder).

| file | what it is |
| --- | --- |
| `primo2.json` | HOLLIS (Primo) search response, one record |
| `lc.json` | Harvard LibraryCloud `items.json` response, three MODS records (collection + two components) |
| `lc2.json` | LibraryCloud `items.json` response, one component record (track `mus00044c00092`) |
| `track_page.html` | Streaming Delivery Service (SDS) player page for that track |
| `cass_page.html` | SDS player page for cassette AWM SC 12200 (`mus00044c00002`) |
| `hdr1.txt` | response headers of the finding-aid request that was refused (see "Not captured") |

Quoted strings below are byte-for-byte as saved, including trailing spaces and
doubled full stops.

## 1. Collection record in HOLLIS (Primo)

- **Source URL:** <https://hollis.harvard.edu/primaws/rest/pub/pnxs?q=any,contains,Maryan%20Aryette%20Omar%20Ali%20collection&vid=01HVD_INST:HVD2&lang=en&tab=everything&scope=default_scope&limit=5&offset=0>
- **Fetched:** 2026-09-25 (`FETCHED_AT.txt`: 2026-09-25T20:26:32Z)
- **Saved as:** `data/harvard_catalog/terms_capture/primo2.json`
- **Record:** `docs[0].pnx.control.recordid[0]` = `alma99153882501003941`; `docs[0].pnx.display.mms[0]` = `99153882501003941`; permanent link (`docs[0].pnx.display.lds03[0]`, inside an `<a>`): <https://id.lib.harvard.edu/alma/99153882501003941/catalog>. Note: the SDS pages (section 4) link a different, older HOLLIS identifier for the same collection (`aleph/015085410`); that record was not captured separately.
- **Title** (`docs[0].pnx.display.title[0]`): `Somali songs : the Maryan "Aryette" Omar Ali collection : audiocassettes, 1955-1991`

| statement (verbatim) | JSON path in `primo2.json` |
| --- | --- |
| `This collection is open for research. ` | `docs[0].pnx.display.lds27[0]` |
| `Rights status not evaluated.. ` | `docs[0].pnx.display.lds15[0]` |
| `Somali songs, 1955-1991 : The Maryan "Aryette" Omar Ali Collection. Archive of World Music, Eda Kuhn Loeb Music Library, Harvard University.` (preferred citation) | `docs[0].pnx.display.lds12[0]` |
| `Electronic finding aid available <a href="https://id.lib.harvard.edu/ead/mus00044/catalog">https://id.lib.harvard.edu/ead/mus00044/catalog</a>` | `docs[0].pnx.display.lds09[0]` |
| `https://id.lib.harvard.edu/ead/mus00044/catalog` | `docs[0].pnx.display.lds08[0]` |
| `This collection contains recordings of popular songs recorded in Somalia between 1955 and 1991, collected from radio broadcasts and privately circulated cassettes by the life-long collector of Somali popular songs and leading expert on the subject, Maryan Omar Ali.` | `docs[0].pnx.display.description[0]` |
| `Eventually, the collection will be made freely available to a number of educational institutions in different parts of Somalia.` (one sentence of the biographical/historical note) | `docs[0].pnx.display.lds16[0]` (excerpt) |
| `Ali, Maryan Omar [collector, former owner]$$QAli, Maryan Omar` | `docs[0].pnx.display.contributor[0]` |

The Primo field labels (`lds27`, `lds15`, ...) are Harvard's local display
fields; the same two sentences appear in the MODS record below with their
element types, which is how the labels are known to mean "restriction on
access" and "use and reproduction".

## 2. Collection MODS record in Harvard LibraryCloud

- **Source URL:** <https://api.lib.harvard.edu/v2/items.json?q=Maryan+Aryette+Omar+Ali&limit=3>
- **Fetched:** 2026-09-25
- **Saved as:** `data/harvard_catalog/terms_capture/lc.json` (`pagination.numFound` = 1304 for that query; three records returned)
- **Record:** `items.mods[0]`, `recordInfo.recordIdentifier` = `99153882501003941` (`@source` `MH:ALMA`); `extension[0].librarycloud.processingDate` = `2025-03-02T09:15Z`

| statement (verbatim) | JSON path in `lc.json` |
| --- | --- |
| `This collection is open for research.` | `items.mods[0].accessCondition[0]["#text"]`, with `["@type"]` = `restriction on access` |
| `Rights status not evaluated.` | `items.mods[0].accessCondition[1]["#text"]`, with `["@type"]` = `use and reproduction` |
| `Somali songs, 1955-1991 : The Maryan "Aryette" Omar Ali Collection. Archive of World Music, Eda Kuhn Loeb Music Library, Harvard University.` | `items.mods[0].note[0]["#text"]`, with `["@type"]` = `preferred citation` |
| `Electronic finding aid available https://id.lib.harvard.edu/ead/mus00044/catalog` | `items.mods[0].note[3]["#text"]`, `["@href"]` = `https://id.lib.harvard.edu/ead/mus00044/catalog` |
| `Eda Kuhn Loeb Music Library, Harvard University` (repository) | `items.mods[0].location[0].physicalLocation["#text"]` |

The other two records in the same response are component records of the same
finding aid and carry **no `accessCondition` element**:

| record | `recordInfo.recordIdentifier` | `extension[0].DRSMetadata.accessFlag` | `ownerCodeDisplayName` |
| --- | --- | --- | --- |
| `items.mods[1]` — cassette `Maryan Mursal, Cabdi Salaad Beerdilaacshe, Cumar Dhuule (Maryan Omar, Abdi Adan Beerdilashe, and Omar Dhule)`, `ownerSuppliedName` `AWM_SC_12217` | `mus00044c00019` | `P` | `Eda Kuhn Loeb Music Library` |
| `items.mods[2]` — track `Side A. Track 4: Dhabta Miyaan Ku Saaraa` | `mus00044c00219` | `P` | `Eda Kuhn Loeb Music Library` |

## 3. Component record for one track in LibraryCloud

- **Source URL:** <https://api.lib.harvard.edu/v2/items.json?q=Ayaamaha+toddobada+ah&limit=2>
- **Fetched:** 2026-09-25
- **Saved as:** `data/harvard_catalog/terms_capture/lc2.json` (`pagination.numFound` = 1; `items.mods` is a single object)
- **Record:** `items.mods.recordInfo.recordIdentifier["#text"]` = `mus00044c00092` (`@source` `MH:OASIS`); title `Side B. Track 1: Ayaamaha toddobada ah`; parent `Songs of the Play: Ninkeeda ku amaahday` (`mus00044c00003`); `extension[1].librarycloud.processingDate` = `2026-07-28T08:32Z`; `recordInfo.recordChangeDate["#text"]` = `20260727`

| statement (verbatim) | JSON path in `lc2.json` |
| --- | --- |
| `P` | `items.mods.extension[0].DRSMetadata.accessFlag` |
| `Everyone` | `items.mods.extension[1].librarycloud.availableTo` |
| `https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33897963` | `items.mods.location.url["#text"]`, with `["@access"]` = `raw object` |
| `https://nrs.harvard.edu/urn-3:fhcl.loeb:33897963` | `items.mods.extension[0].DRSMetadata.fileDeliveryURL` (`uriType` = `SDS`, `inDRS` = `true`, `ownerCode` = `FHCL.MUSI`, `ownerCodeDisplayName` = `Eda Kuhn Loeb Music Library`) |
| `https://id.lib.harvard.edu/ead/c/mus00044c00092/catalog` | `items.mods.relatedItem[0].location.url` (`@otherType` = `HOLLIS for Archival Discovery record`) |
| `https://id.lib.harvard.edu/ead/mus00044/catalog` | `items.mods.relatedItem[1].relatedItem.relatedItem.relatedItem.location.url` (`@otherType` = `Finding Aid`) and `extension[0].DRSMetadata.harvardMetadataLinks.harvardMetadataLink[1].metadataIdentifier` (as `http://`) |

The component record has **no `accessCondition` element** of its own. The
`accessFlag` and `availableTo` values are delivery-system flags from Harvard's
DRS and LibraryCloud metadata; they are quoted because they are the only
component-level access statements on record, not because the project reads
them as a licence.

## 4. Streaming Delivery Service player pages

### 4.1 Track page (`mus00044c00092`)

- **Source URL:** <https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33897963> → redirects to <https://mps.lib.harvard.edu/sds/audio/434915658>
- **Fetched:** 2026-09-25 (the page's own `Accessed:` line says `25 September 2026`)
- **Saved as:** `data/harvard_catalog/terms_capture/track_page.html`

| statement (verbatim) | page element |
| --- | --- |
| `Streaming Delivery Service: Songs of the Play: Ninkeeda ku amaahday` | `<title>` |
| `Description: No label` | `div#citeModal .modal-body`, first `<p>` (label in `<span style="font-weight: bold;">`) |
| `Persistent Link: https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33897963` | `div#citeModal .modal-body`, `<p>` with `<a href="https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33897963">` |
| `Repository: Eda Kuhn Loeb Music Library` | `div#citeModal .modal-body`, `<p>` |
| `Institution: Harvard University` | `div#citeModal .modal-body`, `<p>` |
| `Accessed: 25 September 2026` | `div#citeModal .modal-body`, `<p>` |
| `Streaming Delivery Service<br>` `&copy; 2017 xxxxxPresident and Fellows of Harvard College` | `div#footer p#footerp`, static HTML as served |
| `"Streaming Delivery Service<br>" + "&copy; " + new Date().getFullYear() + " President and Fellows of Harvard College"` | the `<script>` immediately after the footer, which rewrites `#footerp` at load; a browser therefore shows `Streaming Delivery Service © 2026 President and Fellows of Harvard College` |
| `1. Ayaamaha toddobada ah Performer: Khadra Daahir (Khadra Dahir); Author: Maxamuud Cabdullaahi Sangub (Mahmud Abdullahi Sangub)` | `ul.itemsList li#items0_0` (text plus `span.ccs`) |
| `Identifier: AWM_SC_12201<br/>Songs of the Play: Ninkeeda ku amaahday<br/> Duration: 04:01.925` | JavaScript variable `listdata` in the `<head>` script, rendered into `span#playlistinfop` |
| `HOLLIS: https://id.lib.harvard.edu/aleph/015085410/catalog` and `Finding Aid: https://id.lib.harvard.edu/ead/mus00044/catalog` | `div#linkModal .modal-body ul li` |
| Help link `https://wiki.harvard.edu/confluence/x/qnOpD` | navbar `<a ... target="sds_help">` |

The page carries no terms-of-use text other than the footer copyright line.
The stream itself is an HLS playlist (`file: "https://mps.lib.harvard.edu/vod/_definst_/smil:s3/drs-delivery-prod/434915658.smil_.../playlist.m3u8"` in the JWPlayer setup script).

### 4.2 Cassette page (`mus00044c00002`, AWM SC 12200)

- **Source URL:** <https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33901476> (the page's own Persistent Link; the `mps.lib.harvard.edu/sds/audio/...` URL it resolved to was not recorded with this capture)
- **Fetched:** 2026-09-25 (`Accessed: 25 September 2026` on the page)
- **Saved as:** `data/harvard_catalog/terms_capture/cass_page.html`

| statement (verbatim) | page element |
| --- | --- |
| `Repository: Eda Kuhn Loeb Music Library.` | `div#metadata-panel`, first `<p>` |
| `Local identifier: AWM_SC_12200` | `div#metadata-panel`, second `<p>` |
| `Duration: 21:50:00` | `div#metadata-panel`, third `<p>` |
| `Description: No label` / `Persistent Link: https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33901476` / `Repository: Eda Kuhn Loeb Music Library` / `Institution: Harvard University` / `Accessed: 25 September 2026` | `div#citeModal .modal-body`, one `<p>` each |
| Help link `https://wiki.harvard.edu/confluence/x/qnOpD` | navbar `<a ... target="sds_help">` |

This page variant has **no `<title>` element and no footer block**; it carries
no copyright or terms text at all. Its stream is
`file: "https://mps.lib.harvard.edu/vod/_definst_/mp3:s3/drs-delivery-prod/5741/0933/33901475/v00001/content/data/434922603.mp3/playlist.m3u8"`.

## 5. Not captured

The following were requested and **were not read**, so nothing from them is
on record:

- **The finding aid itself** — <https://id.lib.harvard.edu/ead/mus00044/catalog>, which redirects to <https://hollisarchives.lib.harvard.edu/catalog/mus00044>, and the per-component pages of the same form (for example <https://id.lib.harvard.edu/ead/c/mus00044c00092/catalog>, the "HOLLIS for Archival Discovery record" link in section 3). curl received an AWS WAF JavaScript challenge instead of the page: `hdr1.txt` records `HTTP/2 202`, `server: awselb/2.0`, `x-amzn-waf-action: challenge`, `date: Fri, 25 Sep 2026 20:15:51 GMT`, `content-type: text/html; charset=UTF-8`, content-length 2047. Any **"Conditions Governing Access"** or **"Conditions Governing Use"** text in the finding aid — the place where an archival collection's use terms are normally stated in full — is therefore still to be read by Khalid in a browser and added to this file verbatim.
- **The SDS help page** — <https://wiki.harvard.edu/confluence/x/qnOpD> (the "Help" link on every player page) returned an Atlassian JavaScript challenge to curl and was not read.
- The older HOLLIS record the SDS pages link (<https://id.lib.harvard.edu/aleph/015085410/catalog>) was not fetched separately; the Primo record in section 1 is the Alma record for the collection.
- No licence, terms-of-use document, permission letter, or any communication from the Loeb Music Library or the Archive of World Music has been received or captured. `Rights status not evaluated.` is the only use-and-reproduction statement on record, and it is the library's, about the underlying recordings.

## 6. How the project treats this

Restating the standing rule (`docs/DATA_PROVENANCE.md` §1, `CLAUDE.md`
"Hard rules — Research"), unchanged by anything in this file:

- Every file under `data/harvard_raw/` (the 2025 legacy files and the 2026-09-25 completion fetch) is **research-only staging material**: git-ignored (`data/harvard_raw/` and every audio extension in `.gitignore`), never committed, never uploaded anywhere, never served by the platform, never placed on the website or in a public demo, never shared outside the machine it was fetched to.
- The fetch used the same public route as the 2025 download: the finding aid's persistent URN, the public SDS player page with its anonymous session, and the HLS stream it embeds (`apps/ai-service/scripts/harvard_fetch.py`). Nothing that required a Harvard login was requested, and objects that answered with a login page, a non-200 status or no playlist were skipped and listed (`docs/data/HARVARD_GAP_LIST.md`).
- Training on the material is inside the research context; the project treats the public use of any output of a model trained on it as blocked until the library has answered (`CLAUDE.md`, "Left", item 7).
- **A letter to, and a meeting with, the Eda Kuhn Loeb Music Library / Archive of World Music are pending** (owner: Khalid Ibrahim). Written permission from the library is the condition in `docs/DATA_PROVENANCE.md` for any collection audio to move beyond the private research context.
- When the collection is cited in research writing, the library's preferred citation (section 1, `lds12`) is used.
- This file is a record of statements, not an evaluation of them. It is updated, verbatim, whenever a new statement is read or received.
