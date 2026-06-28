import os

# settings.py는 모듈 레벨에서 env var를 읽으므로,
# 테스트 모듈 임포트 전에 더미 값을 주입한다.
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("POSTGRES_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key")
