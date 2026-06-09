# --- 빌드 스테이지 ---
FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /app

# Gradle 래퍼 & 빌드 스크립트만 먼저 복사 → 의존성 레이어 캐시
COPY gradlew settings.gradle build.gradle ./
COPY gradle ./gradle/
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon 2>/dev/null || true

# 소스 복사 후 빌드
COPY src ./src/
RUN ./gradlew bootJar -x test --no-daemon

# --- 런타임 스테이지 (JDK 제외로 이미지 크기 절감) ---
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /app/build/libs/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
