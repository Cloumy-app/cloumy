from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # 필수값 — 누락 시 앱 기동 즉시 ValidationError로 차단
    anthropic_api_key: str
    openai_api_key: str
    postgres_url: str
    redis_url: str
    internal_api_key: str

    # 선택값 — 배치 수집기·Phase 2에서 사용
    kakao_rest_api_key: str = ""
    tmap_api_key: str = ""  # 대중교통 이동시간 계산 (자동차/도보는 거리 근사치라 API 불필요)
    google_maps_api_key: str = ""
    openweathermap_api_key: str = ""
    tourapi_key: str = ""
    naver_search_client_id: str = ""
    naver_search_client_secret: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",  # .env에 모르는 키가 있어도 에러 무시
    )

    @computed_field
    @property
    def asyncpg_url(self) -> str:
        # asyncpg는 SQLAlchemy DSN 포맷(postgresql+asyncpg://) 미지원
        # → postgresql:// 로 변환해서 전달
        return self.postgres_url.replace("postgresql+asyncpg://", "postgresql://")


settings = Settings()
