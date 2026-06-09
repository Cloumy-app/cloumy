package com.cloumy.common.response;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse<T>(
        boolean success,
        T data,
        ErrorDetail error
) {

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, data, null);
    }

    // 데이터 없는 성공 응답 (DELETE, 로그아웃 등)
    public static <T> ApiResponse<T> ok() {
        return new ApiResponse<>(true, null, null);
    }

    public static <T> ApiResponse<T> error(ErrorCode errorCode) {
        return new ApiResponse<>(false, null, new ErrorDetail(errorCode.getCode(), errorCode.getMessage()));
    }

    public static <T> ApiResponse<T> error(ErrorCode errorCode, String detail) {
        return new ApiResponse<>(false, null, new ErrorDetail(errorCode.getCode(), detail));
    }

    public record ErrorDetail(String code, String message) {}
}
