package pm.user;

import java.time.Instant;

/**
 * users 表实体（纯 POJO，MyBatis 映射，全局表无租户字段）。
 * created_at 由 DB DEFAULT now() 生成，INSERT 不写入。
 */
public class User {

    private Long id;

    private String email;

    private String passwordHash;

    private String displayName;

    private Instant createdAt;

    protected User() {
    }

    public User(String email, String passwordHash, String displayName) {
        this.email = email;
        this.passwordHash = passwordHash;
        this.displayName = displayName;
    }

    public Long getId() {
        return id;
    }

    public String getEmail() {
        return email;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }
}
