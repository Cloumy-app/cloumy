package com.cloumy.auth.entity;

import com.cloumy.common.entity.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.UUID;

@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@Entity
@Table(
        name = "users",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_users_provider_id",
                columnNames = {"oauth_provider", "oauth_id"}
        )
)
public class User extends BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "oauth_provider", nullable = false, length = 20)
    private String oauthProvider;

    @Column(name = "oauth_id", nullable = false)
    private String oauthId;

    @Column(nullable = false)
    private String nickname;

    @Column(name = "profile_image_url")
    private String profileImageUrl;

    @Column(name = "pass_type", nullable = false, length = 10)
    private String passType = "none";

    @Column(name = "pass_expires_at")
    private LocalDateTime passExpiresAt;

    @Column(name = "is_beta_tester", nullable = false)
    private boolean betaTester = false;

    @Builder
    private User(String oauthProvider, String oauthId, String nickname, String profileImageUrl) {
        this.oauthProvider = oauthProvider;
        this.oauthId = oauthId;
        this.nickname = nickname;
        this.profileImageUrl = profileImageUrl;
        this.passType = "none";
        this.betaTester = false;
    }

    public void updateProfile(String nickname, String profileImageUrl) {
        this.nickname = nickname;
        if (profileImageUrl != null) {
            this.profileImageUrl = profileImageUrl;
        }
    }

    public void grantDayPass() {
        this.passType = "day";
        this.passExpiresAt = LocalDateTime.now().plusHours(24);
    }

    public void updatePass(String passType, LocalDateTime expiresAt) {
        this.passType = passType;
        this.passExpiresAt = expiresAt;
    }
}
