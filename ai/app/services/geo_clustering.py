"""
후보 장소를 지리적으로 nights+1개 구역으로 미리 나누는 클러스터링 서비스.
day별 지역 분리를 프롬프트 텍스트 지시에만 맡기지 않고, 코드가 후보를
구역으로 나눠 LLM에 "Day N = 구역 N"을 구조적으로 강제하기 위함.
"""
import logging

import numpy as np
from langchain_core.documents import Document

from app.services.tsp_service import _haversine_m

logger = logging.getLogger(__name__)

_MIN_CANDIDATES_FOR_CLUSTERING = 5
_KMEANS_MAX_ITER = 20
_MIN_CLUSTER_SIZE = 3


def cluster_label(idx: int) -> str:
    """0→A, 1→B, ... (nights 1~5 → day 최대 6이므로 알파벳 범위 내 충분)."""
    return chr(ord("A") + idx)


def _kmeans_labels(coords: np.ndarray, k: int, seed: int) -> np.ndarray:
    """(n, 2) 좌표 배열을 k개 클러스터로 나눈 라벨 배열을 반환한다. Lloyd's algorithm."""
    n = coords.shape[0]
    rng = np.random.default_rng(seed)

    # k-means++ 초기화
    centroids = [coords[rng.integers(n)]]
    for _ in range(k - 1):
        d2 = np.min(
            [np.sum((coords - c) ** 2, axis=1) for c in centroids], axis=0
        )
        total = d2.sum()
        probs = d2 / total if total > 0 else np.full(n, 1.0 / n)
        centroids.append(coords[rng.choice(n, p=probs)])
    centroids = np.array(centroids)

    labels = np.zeros(n, dtype=int)
    for _ in range(_KMEANS_MAX_ITER):
        dists = np.linalg.norm(coords[:, None, :] - centroids[None, :, :], axis=2)
        labels = dists.argmin(axis=1)

        # 빈 클러스터 방지: 가장 큰 클러스터에서 포인트 1개를 강제 이관
        for i in range(k):
            if not np.any(labels == i):
                sizes = np.bincount(labels, minlength=k)
                biggest = sizes.argmax()
                idx = np.where(labels == biggest)[0][0]
                labels[idx] = i

        new_centroids = np.array(
            [coords[labels == i].mean(axis=0) for i in range(k)]
        )
        if np.allclose(new_centroids, centroids):
            centroids = new_centroids
            break
        centroids = new_centroids

    return labels


def _greedy_chain_order(centroids: np.ndarray) -> list[int]:
    """centroid 간 최근접 그리디 체인으로 클러스터 순서를 정렬한다.
    Day 1 → Day 2 지역이 가급적 인접하도록 (완전 TSP 불필요, k<=6이라 그리디로 충분)."""
    k = len(centroids)
    remaining = set(range(k))
    current = 0
    order = [current]
    remaining.discard(current)

    while remaining:
        cur_lat, cur_lng = centroids[current]
        nearest = min(
            remaining,
            key=lambda i: _haversine_m(cur_lat, cur_lng, centroids[i][0], centroids[i][1]),
        )
        order.append(nearest)
        remaining.discard(nearest)
        current = nearest

    return order


def cluster_candidates(
    candidates: list[Document], k: int, seed: int = 42
) -> list[list[Document]]:
    """
    후보 Document 리스트를 k개의 지리적 구역으로 나눈다.
    - 후보가 너무 적거나(<=5) k가 후보 수보다 크면 클러스터링을 건너뛰고
      단일 그룹(길이 1 리스트)을 반환한다 — 호출부는 len(result) == 1로 비활성 판별.
    - 각 클러스터 내부는 원본 순서(=pgvector 유사도 랭킹)를 보존한다.
    - 반환 리스트는 centroid 간 그리디 최근접 순서로 정렬돼 있다.
    """
    if not candidates:
        return []

    if len(candidates) <= _MIN_CANDIDATES_FOR_CLUSTERING or k <= 1 or len(candidates) < k:
        logger.info(
            "지역 클러스터링 스킵: 후보 %d건, k=%d (최소 %d건 필요)",
            len(candidates), k, _MIN_CANDIDATES_FOR_CLUSTERING + 1,
        )
        return [candidates]

    coords = np.array([[c.metadata["lat"], c.metadata["lng"]] for c in candidates])
    labels = _kmeans_labels(coords, k, seed)

    # 최소 클러스터 크기 보장: k-means 수렴 후 특정 구역이 극단적으로 작으면
    # (예: 후보 1건짜리 고립 구역) 가장 큰 클러스터에서 지리적으로 가장 가까운
    # 포인트를 이관한다. 수렴 루프 내부가 아니라 후처리로 한 번만 적용해 진동을 피한다.
    sizes = np.bincount(labels, minlength=k)
    for i in range(k):
        while sizes[i] < _MIN_CLUSTER_SIZE:
            biggest = sizes.argmax()
            if biggest == i or sizes[biggest] <= _MIN_CLUSTER_SIZE:
                break  # 이관할 여유 있는 클러스터가 없음
            biggest_idx = np.where(labels == biggest)[0]
            centroid_i = coords[labels == i].mean(axis=0)
            nearest = biggest_idx[np.argmin(np.linalg.norm(coords[biggest_idx] - centroid_i, axis=1))]
            labels[nearest] = i
            sizes = np.bincount(labels, minlength=k)

    clusters = [
        [c for c, lbl in zip(candidates, labels) if lbl == i] for i in range(k)
    ]
    centroids = np.array([coords[labels == i].mean(axis=0) for i in range(k)])
    order = _greedy_chain_order(centroids)

    logger.info(
        "지역 클러스터링 완료: 후보 %d건 → %d개 구역, 크기=%s",
        len(candidates), k, [len(clusters[i]) for i in order],
    )
    return [clusters[i] for i in order]
