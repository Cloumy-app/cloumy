from langchain_core.documents import Document

from app.services.geo_clustering import cluster_candidates, cluster_label


def _doc(lat: float, lng: float, name: str) -> Document:
    return Document(
        page_content=name,
        metadata={"id": name, "name": name, "lat": lat, "lng": lng},
    )


def test_cluster_label_maps_index_to_alphabet():
    assert cluster_label(0) == "A"
    assert cluster_label(1) == "B"
    assert cluster_label(5) == "F"


def test_cluster_candidates_skips_when_too_few():
    candidates = [_doc(37.5, 127.0, f"p{i}") for i in range(4)]
    result = cluster_candidates(candidates, k=2)
    assert len(result) == 1
    assert result[0] == candidates


def test_cluster_candidates_skips_when_k_exceeds_candidates():
    candidates = [_doc(37.5, 127.0, f"p{i}") for i in range(8)]
    result = cluster_candidates(candidates, k=20)
    assert len(result) == 1
    assert len(result[0]) == 8


def test_cluster_candidates_empty_input():
    assert cluster_candidates([], k=3) == []


def test_cluster_count_matches_k_for_well_separated_points():
    # 서울 좌표군 5개 + 부산 좌표군 5개 — 명확히 분리된 두 그룹
    seoul = [_doc(37.50 + i * 0.001, 127.00 + i * 0.001, f"seoul{i}") for i in range(5)]
    busan = [_doc(35.10 + i * 0.001, 129.00 + i * 0.001, f"busan{i}") for i in range(5)]
    candidates = seoul + busan

    result = cluster_candidates(candidates, k=2)

    assert len(result) == 2
    names_per_cluster = [{d.metadata["name"] for d in cluster} for cluster in result]
    seoul_names = {d.metadata["name"] for d in seoul}
    busan_names = {d.metadata["name"] for d in busan}
    # 두 클러스터 각각이 서울 그룹 또는 부산 그룹과 정확히 일치해야 함
    assert names_per_cluster[0] in (seoul_names, busan_names)
    assert names_per_cluster[1] in (seoul_names, busan_names)
    assert names_per_cluster[0] != names_per_cluster[1]


def test_cluster_candidates_prevents_extreme_imbalance():
    # 실측 사례(50건 → 3구역이 34/14/2로 쏠림) 재현: 도심에 30곳 밀집 + 외곽에 4곳뿐
    center = [_doc(37.50 + (i % 6) * 0.002, 127.00 + (i // 6) * 0.002, f"c{i}") for i in range(30)]
    outskirt = [_doc(37.55, 127.05, f"o{i}") for i in range(4)]
    candidates = center + outskirt

    result = cluster_candidates(candidates, k=3)

    sizes = [len(c) for c in result]
    assert sum(sizes) == len(candidates)
    assert max(sizes) <= len(candidates) * 0.7  # 34/50=68%였던 실측 사례 같은 극단적 쏠림 방지


def test_cluster_preserves_relative_order_within_cluster():
    # 서울 그룹에 인위적 순서(유사도 랭킹 흉내)를 부여
    seoul = [_doc(37.50 + i * 0.001, 127.00 + i * 0.001, f"s{i}") for i in range(5)]
    busan = [_doc(35.10 + i * 0.001, 129.00 + i * 0.001, f"b{i}") for i in range(5)]
    candidates = seoul + busan

    result = cluster_candidates(candidates, k=2)

    for cluster in result:
        names = [d.metadata["name"] for d in cluster]
        # 원본 리스트 내 등장 순서와 클러스터 내 순서가 동일해야 함 (stable partition)
        original_indices = [candidates.index(d) for d in cluster]
        assert original_indices == sorted(original_indices)
        assert names  # sanity
