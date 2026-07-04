package com.cloumy.common.response;

import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;

@Getter
@RequiredArgsConstructor
public enum ErrorCode {

    // JWT
    JWT_EXPIRED(HttpStatus.UNAUTHORIZED, "TOKEN_EXPIRED", "토큰이 만료되었습니다"),
    JWT_INVALID(HttpStatus.UNAUTHORIZED, "TOKEN_INVALID", "유효하지 않은 토큰입니다"),
    JWT_REVOKED(HttpStatus.UNAUTHORIZED, "TOKEN_REVOKED", "로그아웃된 토큰입니다"),
    JWT_UNSUPPORTED(HttpStatus.UNAUTHORIZED, "TOKEN_UNSUPPORTED", "지원하지 않는 토큰 형식입니다"),

    // OAuth
    OAUTH_PROVIDER_ERROR(HttpStatus.BAD_GATEWAY, "OAUTH_ERROR", "소셜 로그인 처리에 실패했습니다"),
    OAUTH_USER_INFO_FAILED(HttpStatus.BAD_GATEWAY, "OAUTH_USER_INFO_FAILED",
            "사용자 정보 조회에 실패했습니다"),

    // 사용자
    USER_NOT_FOUND(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다"),

    // 여행 루트
    ROUTE_NOT_FOUND(HttpStatus.NOT_FOUND, "ROUTE_NOT_FOUND", "루트를 찾을 수 없습니다"),
    ROUTE_ACCESS_DENIED(HttpStatus.FORBIDDEN, "ROUTE_ACCESS_DENIED", "루트에 접근 권한이 없습니다"),

    // 슬롯
    SLOT_NOT_FOUND(HttpStatus.NOT_FOUND, "SLOT_NOT_FOUND", "슬롯을 찾을 수 없습니다"),
    SLOT_PINNED(HttpStatus.BAD_REQUEST, "SLOT_PINNED", "고정된 슬롯은 삭제할 수 없습니다"),

    // 결제/패스
    PASS_REQUIRED(HttpStatus.PAYMENT_REQUIRED, "PASS_REQUIRED", "트립 패스가 필요한 기능입니다"),
    PASS_EXPIRED(HttpStatus.PAYMENT_REQUIRED, "PASS_EXPIRED", "트립 패스가 만료되었습니다"),

    // 장소
    PLACE_NOT_FOUND(HttpStatus.NOT_FOUND, "PLACE_NOT_FOUND", "장소를 찾을 수 없습니다"),
    GPS_VERIFICATION_FAILED(HttpStatus.BAD_REQUEST, "GPS_VERIFICATION_FAILED",
            "GPS 인증에 실패했습니다. 100m 이내에 위치해야 합니다"),

    // 숙소
    ACCOMMODATION_NOT_FOUND(HttpStatus.NOT_FOUND, "ACCOMMODATION_NOT_FOUND", "숙소를 찾을 수 없습니다"),
    KAKAO_API_ERROR(HttpStatus.BAD_GATEWAY, "KAKAO_API_ERROR", "숙소 검색에 실패했습니다"),

    // Rate Limiting
    RATE_LIMIT_EXCEEDED(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMIT_EXCEEDED",
            "잠시 후 다시 시도해주세요. 1분에 최대 3회까지 요청할 수 있습니다"),

    // 공통
    INVALID_INPUT(HttpStatus.BAD_REQUEST, "INVALID_INPUT", "잘못된 입력값입니다"),
    FORBIDDEN(HttpStatus.FORBIDDEN, "FORBIDDEN", "접근 권한이 없습니다"),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "서버 내부 오류가 발생했습니다");

    private final HttpStatus httpStatus;
    private final String code;
    private final String message;
}
