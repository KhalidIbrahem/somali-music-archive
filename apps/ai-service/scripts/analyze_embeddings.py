"""Embedding-space analysis: similarity neighbours, clustering, 2-D map (Phase F4/F5).

Consumes the MERT embeddings written by `process_harvard embed` and produces:

    data/analysis/similarity_neighbors.json  — top-K most similar tracks per
        track (cosine), with titles/artists for human inspection; feeds the
        app's "related recordings" feature and the paper's retrieval section.
    data/analysis/embedding_clusters.json    — k-means assignments plus
        agreement scores (ARI) between clusters and cassette / dated-era
        groupings. The cassette-ARI is an HONESTY metric: high agreement
        means the embeddings partly encode recording conditions (tape/deck/
        noise), not only musical content — exactly the caveat a reviewer
        would demand for any retrieval claim on single-source archival audio.
    docs/figures/fig4_embedding_map.png (+ .svg) — t-SNE projection, points
        coloured by cluster, dated tracks outlined; Figure 4 of the paper.

Usage:
    cd apps/ai-service
    python -m scripts.analyze_embeddings [--k 8] [--neighbors 5]
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

_SERVICE_ROOT = Path(__file__).resolve().parent.parent
if str(_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVICE_ROOT))

import numpy as np

from scripts.process_harvard import PipelineConfig, default_config

log = logging.getLogger("analyze_embeddings")

DEFAULT_K_CLUSTERS = 8
DEFAULT_N_NEIGHBORS = 5
TSNE_SEED = 20260712

# Validated categorical palette (dataviz reference instance) — 8 slots in the
# CVD-safe fixed order, one per cluster.
CLUSTER_COLORS = (
    "#2a78d6", "#1baf7a", "#eda100", "#008300",
    "#4a3aa7", "#e34948", "#e87ba4", "#eb6834",
)
TEXT_PRIMARY = "#1a1a19"
TEXT_SECONDARY = "#5f5e56"


def load_embeddings(config: PipelineConfig) -> tuple[list[str], np.ndarray]:
    """All embeddings on disk as (track_ids, matrix); rows L2-normalized."""
    files = sorted(config.embeddings_dir.glob("*.npy"))
    if not files:
        raise SystemExit(f"no embeddings in {config.embeddings_dir} — run the embed stage first")
    ids = [f.stem for f in files]
    matrix = np.stack([np.load(f) for f in files]).astype(np.float64)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    return ids, matrix / np.maximum(norms, 1e-12)


def top_neighbors(
    ids: Sequence[str], matrix: np.ndarray, n_neighbors: int
) -> dict[str, list[dict[str, Any]]]:
    """Top-N cosine neighbours per track (self excluded). Pure; unit-tested."""
    sims = matrix @ matrix.T
    np.fill_diagonal(sims, -np.inf)
    out: dict[str, list[dict[str, Any]]] = {}
    take = min(n_neighbors, len(ids) - 1)  # never surface the -inf self slot
    for i, track_id in enumerate(ids):
        order = np.argsort(sims[i])[::-1][:take]
        out[track_id] = [
            {"track_id": ids[j], "cosine": round(float(sims[i, j]), 4)} for j in order
        ]
    return out


def same_cassette_audit(
    ids: Sequence[str],
    neighbors: dict[str, list[dict[str, Any]]],
    meta: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Channel-leakage audit: how often is the top-1 neighbour same-cassette?

    Chance rate is the probability two uniformly drawn distinct tracks share
    a cassette (Σ sᵢ(sᵢ−1) / n(n−1)) — the honest baseline for a corpus whose
    cassettes differ in size. Pure; unit-tested; feeds paper §7.3.
    """
    with_cassette = [t for t in ids if meta.get(t, {}).get("cassette") is not None]
    n = len(with_cassette)
    if n < 2:
        return {"n_with_cassette": n, "top1_same_cassette_rate": None, "chance_rate": None}
    same = sum(
        1
        for t in with_cassette
        if neighbors.get(t)
        and meta.get(neighbors[t][0]["track_id"], {}).get("cassette") == meta[t]["cassette"]
    )
    sizes: dict[Any, int] = {}
    for t in with_cassette:
        sizes[meta[t]["cassette"]] = sizes.get(meta[t]["cassette"], 0) + 1
    chance = sum(s * (s - 1) for s in sizes.values()) / (n * (n - 1))
    top1_cosines = sorted(ns[0]["cosine"] for ns in neighbors.values() if ns)
    return {
        "n_with_cassette": n,
        "n_cassettes": len(sizes),
        "top1_same_cassette": same,
        "top1_same_cassette_rate": round(same / n, 4),
        "chance_rate": round(chance, 4),
        "top1_cosine_median": round(float(top1_cosines[len(top1_cosines) // 2]), 4),
    }


def _inventory_lookup(config: PipelineConfig) -> dict[str, dict[str, Any]]:
    import pandas as pd

    df = pd.read_csv(config.inventory_csv)
    out: dict[str, dict[str, Any]] = {}
    for _, row in df.iterrows():
        out[str(row["track_id"])] = {
            "title": None if pd.isna(row.get("title")) else str(row["title"]),
            "artists": None if pd.isna(row.get("artists")) else str(row["artists"]),
            "cassette": None
            if pd.isna(row.get("cassette_number"))
            else int(row["cassette_number"]),
            "year": None if pd.isna(row.get("recorded_year")) else int(row["recorded_year"]),
        }
    return out


def cluster_and_score(
    ids: Sequence[str],
    matrix: np.ndarray,
    meta: dict[str, dict[str, Any]],
    k: int,
) -> dict[str, Any]:
    """K-means clusters + agreement (ARI) with cassette and dated-era groupings."""
    from sklearn.cluster import KMeans
    from sklearn.metrics import adjusted_rand_score

    labels = KMeans(n_clusters=k, n_init=10, random_state=TSNE_SEED).fit_predict(matrix)

    def ari_against(key: str) -> tuple[float | None, int]:
        pairs = [
            (int(labels[i]), meta[t][key])
            for i, t in enumerate(ids)
            if t in meta and meta[t].get(key) is not None
        ]
        if len(pairs) < 10:
            return None, len(pairs)
        pred, truth = zip(*pairs, strict=True)
        return round(float(adjusted_rand_score(truth, pred)), 4), len(pairs)

    cassette_ari, n_cassette = ari_against("cassette")
    year_groups = {
        t: ("early" if m["year"] < 1970 else "late")
        for t, m in meta.items()
        if m.get("year") is not None
    }
    era_pairs = [
        (int(labels[i]), year_groups[t]) for i, t in enumerate(ids) if t in year_groups
    ]
    era_ari: float | None = None
    if len(era_pairs) >= 10:
        from sklearn.metrics import adjusted_rand_score as _ars

        pred, truth = zip(*era_pairs, strict=True)
        era_ari = round(float(_ars(truth, pred)), 4)

    return {
        "k": k,
        "assignments": {t: int(labels[i]) for i, t in enumerate(ids)},
        "cluster_sizes": np.bincount(labels, minlength=k).tolist(),
        "ari_vs_cassette": cassette_ari,
        "n_with_cassette": n_cassette,
        "ari_vs_dated_era": era_ari,
        "n_dated": len(era_pairs),
    }


def figure_embedding_map(
    ids: Sequence[str],
    matrix: np.ndarray,
    clusters: dict[str, Any],
    meta: dict[str, dict[str, Any]],
    out_dir: Path,
) -> list[Path]:
    """Figure 4 — t-SNE of MERT embeddings, coloured by k-means cluster.

    Dated tracks get a dark outline so the era analysis's subjects are
    locatable; perplexity is set for a ~100-point corpus.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from sklearn.manifold import TSNE

    coords = TSNE(
        n_components=2,
        perplexity=min(15, max(2, len(ids) // 7)),
        random_state=TSNE_SEED,
        init="pca",
    ).fit_transform(matrix)

    fig, ax = plt.subplots(figsize=(6.6, 5.0))
    assignments = clusters["assignments"]
    for cluster_id in range(clusters["k"]):
        idx = [i for i, t in enumerate(ids) if assignments[t] == cluster_id]
        if not idx:
            continue
        ax.scatter(
            coords[idx, 0],
            coords[idx, 1],
            s=46,
            color=CLUSTER_COLORS[cluster_id % len(CLUSTER_COLORS)],
            edgecolor="white",
            linewidth=0.6,
            label=f"cluster {cluster_id} (n={len(idx)})",
            zorder=3,
        )
    dated = [i for i, t in enumerate(ids) if meta.get(t, {}).get("year") is not None]
    if dated:
        ax.scatter(
            coords[dated, 0],
            coords[dated, 1],
            s=110,
            facecolors="none",
            edgecolors=TEXT_PRIMARY,
            linewidths=1.0,
            zorder=4,
            label="date-stamped",
        )
    ari = clusters.get("ari_vs_cassette")
    ax.set_title(
        f"MERT embedding map (t-SNE), k-means k={clusters['k']} — "
        f"cluster–cassette ARI {ari}",
        fontsize=10,
        color=TEXT_PRIMARY,
    )
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_color("#e5e4dc")
    ax.legend(frameon=False, fontsize=7, loc="upper right", ncols=2)
    fig.tight_layout()
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = [out_dir / "fig4_embedding_map.png", out_dir / "fig4_embedding_map.svg"]
    for p in paths:
        fig.savefig(p, dpi=300, bbox_inches="tight")
    plt.close(fig)
    return paths


def run(config: PipelineConfig, k: int, n_neighbors: int, make_figure: bool = True) -> None:
    ids, matrix = load_embeddings(config)
    meta = _inventory_lookup(config)
    log.info("%d embeddings, dim %d", len(ids), matrix.shape[1])

    neighbors = top_neighbors(ids, matrix, n_neighbors)
    enriched = {
        t: [
            {**n, "title": meta.get(n["track_id"], {}).get("title"),
             "artists": meta.get(n["track_id"], {}).get("artists")}
            for n in ns
        ]
        for t, ns in neighbors.items()
    }
    out_dir = config.data_root / "analysis"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "similarity_neighbors.json").write_text(
        json.dumps(enriched, ensure_ascii=False, indent=2)
    )
    clusters = cluster_and_score(ids, matrix, meta, k)
    clusters["same_cassette_audit"] = same_cassette_audit(ids, neighbors, meta)
    (out_dir / "embedding_clusters.json").write_text(json.dumps(clusters, indent=2))
    log.info(
        "clusters: sizes %s | ARI vs cassette %s (n=%d) | ARI vs dated era %s (n=%d)",
        clusters["cluster_sizes"],
        clusters["ari_vs_cassette"],
        clusters["n_with_cassette"],
        clusters["ari_vs_dated_era"],
        clusters["n_dated"],
    )
    audit = clusters["same_cassette_audit"]
    log.info(
        "leakage audit: top-1 same-cassette %s/%s = %s | chance %s | median top-1 cosine %s",
        audit.get("top1_same_cassette"),
        audit.get("n_with_cassette"),
        audit.get("top1_same_cassette_rate"),
        audit.get("chance_rate"),
        audit.get("top1_cosine_median"),
    )
    if make_figure:
        figures_dir = _SERVICE_ROOT.parent.parent / "docs" / "figures"
        for p in figure_embedding_map(ids, matrix, clusters, meta, figures_dir):
            log.info("figure → %s", p)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--k", type=int, default=DEFAULT_K_CLUSTERS)
    parser.add_argument("--neighbors", type=int, default=DEFAULT_N_NEIGHBORS)
    parser.add_argument("--no-figure", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
    run(default_config(), args.k, args.neighbors, make_figure=not args.no_figure)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
