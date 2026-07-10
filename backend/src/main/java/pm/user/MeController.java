package pm.user;

import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pm.auth.AuthService;
import pm.auth.CurrentUser;
import pm.common.ApiException;
import pm.common.FieldLimits;
import pm.tenantadmin.MembershipRepository;
import pm.tenantadmin.TenantRepository;

import java.util.List;

@RestController
@RequestMapping("/api/me")
public class MeController {

    private final MembershipRepository memberships;
    private final TenantRepository tenants;
    private final UserRepository users;
    private final AuthService auth;

    public MeController(MembershipRepository memberships, TenantRepository tenants,
                        UserRepository users, AuthService auth) {
        this.memberships = memberships;
        this.tenants = tenants;
        this.users = users;
        this.auth = auth;
    }

    public record TenantView(String slug, String name, String role) {
    }

    public record ProfileView(Long id, String email, String displayName) {
    }

    public record UpdateProfileRequest(String displayName) {
    }

    public record ChangePasswordRequest(String oldPassword, String newPassword) {
    }

    @GetMapping("/tenants")
    List<TenantView> myTenants() {
        long userId = CurrentUser.id();
        return memberships.findByUserId(userId).stream()
                .map(m -> {
                    var tenant = tenants.findById(m.getTenantId()).orElseThrow();
                    return new TenantView(tenant.getSlug(), tenant.getName(), m.getRole().name());
                })
                .toList();
    }

    /** 改显示名。 */
    @PatchMapping
    @Transactional
    ProfileView updateProfile(@RequestBody UpdateProfileRequest req) {
        User user = users.findById(CurrentUser.id()).orElseThrow(ApiException::notFound);
        if (req.displayName() != null) {
            String name = req.displayName().strip();
            if (name.isBlank()) {
                throw ApiException.badRequest("VALIDATION", "显示名不能为空");
            }
            FieldLimits.check(name, FieldLimits.DISPLAY_NAME, "显示名");
            user.setDisplayName(name);
            users.save(user); // MyBatis 无脏检查，显式落库
        }
        return new ProfileView(user.getId(), user.getEmail(), user.getDisplayName());
    }

    /** 改密码：校验旧密码。 */
    @PutMapping("/password")
    @Transactional
    void changePassword(@RequestBody ChangePasswordRequest req) {
        if (req.newPassword() == null || req.newPassword().length() < 6) {
            throw ApiException.badRequest("VALIDATION", "新密码至少 6 位");
        }
        User user = users.findById(CurrentUser.id()).orElseThrow(ApiException::notFound);
        if (req.oldPassword() == null || !auth.passwordMatches(req.oldPassword(), user.getPasswordHash())) {
            throw ApiException.badRequest("WRONG_PASSWORD", "原密码不正确");
        }
        user.setPasswordHash(auth.hashPassword(req.newPassword()));
        users.save(user); // MyBatis 无脏检查，显式落库
    }
}
