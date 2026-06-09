# DB 설정

## 구성

| 구성 요소 | 버전 | 역할 |
|-----------|------|------|
| PostgreSQL | 16 | 메인 DB |
| PostGIS | 3.4 | 위치 기반 반경 검색 (`ST_DWithin`) |
| pgvector | 0.8 | 임베딩 유사도 검색 (`<=>`) |

## 로컬 실행

```bash
make up       # 컨테이너 시작
make db       # psql 접속
make clean    # 볼륨 포함 전체 삭제
```

## 커스텀 이미지

`postgis/postgis:16-3.4` 이미지에는 pgvector가 미포함이라
`db/Dockerfile`에서 PGDG apt 저장소로 추가 설치한다.

## 초기화 스크립트

`db/init.sql` — 새 볼륨 생성 시 자동 실행:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
```
