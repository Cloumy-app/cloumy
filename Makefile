.PHONY: up down build logs ps clean

# 로컬 개발 환경 (DB + Redis만)
up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build

rebuild:
	docker compose down && docker compose up -d --build

logs:
	docker compose logs -f

ps:
	docker compose ps

# DB 직접 접속
db:
	docker exec -it cloumy-postgres-1 psql -U cloumy

# Redis CLI
redis:
	docker exec -it cloumy-redis-1 redis-cli

# 볼륨까지 전체 초기화 (주의: 데이터 삭제)
clean:
	docker compose down -v

# 운영 환경
prod-up:
	docker compose -f docker-compose.prod.yml up -d

prod-down:
	docker compose -f docker-compose.prod.yml down

# 익스텐션 설치 확인
check-ext:
	docker exec cloumy-postgres-1 psql -U cloumy -c '\dx'
