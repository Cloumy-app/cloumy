FROM python:3.11-slim
WORKDIR /app

# 의존성 먼저 복사 → pip install 레이어 캐시
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
