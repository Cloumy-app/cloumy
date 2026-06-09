package com.cloumy.payment.service;

import com.cloumy.auth.entity.User;
import com.cloumy.auth.repository.UserRepository;
import com.cloumy.common.exception.BusinessException;
import com.cloumy.common.response.ErrorCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class PassValidationService {

    private final UserRepository userRepository;

    public void validate(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND));

        if ("none".equals(user.getPassType())) {
            throw new BusinessException(ErrorCode.PASS_REQUIRED);
        }

        if (user.getPassExpiresAt() == null || user.getPassExpiresAt().isBefore(LocalDateTime.now())) {
            throw new BusinessException(ErrorCode.PASS_EXPIRED);
        }
    }
}
