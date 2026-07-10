package pm.tenantadmin;

import jakarta.validation.constraints.NotNull;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import pm.auth.CurrentUser;
import pm.tenant.TenantContext;
import pm.user.User;
import pm.user.UserRepository;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@RestController
@Validated
public class TenantAdminController {

    private final InviteService inviteService;
    private final MemberService memberService;
    private final MembershipRepository memberships;
    private final UserRepository users;
    private final TenantRepository tenants;

    public TenantAdminController(InviteService inviteService, MemberService memberService,
                                 MembershipRepository memberships, UserRepository users,
                                 TenantRepository tenants) {
        this.inviteService = inviteService;
        this.memberService = memberService;
        this.memberships = memberships;
        this.users = users;
        this.tenants = tenants;
    }

    public record CreateInviteRequest(@NotNull Membership.Role role) {
    }

    public record MemberView(Long userId, String displayName, String email,
                             Membership.Role role) {
    }

    @PostMapping("/api/t/{slug}/invites")
    InviteService.InviteView createInvite(@PathVariable String slug,
                                          @RequestBody @Validated CreateInviteRequest req) {
        return inviteService.create(req.role(), CurrentUser.id());
    }

    /** 成员列表：任何成员可见（Admin 页与 assignee 下拉共用）。 */
    @GetMapping("/api/t/{slug}/members")
    @Transactional(readOnly = true)
    List<MemberView> members(@PathVariable String slug) {
        List<Membership> ms = memberships.findByTenantId(TenantContext.require());
        Map<Long, User> byId = users.findAllById(ms.stream().map(Membership::getUserId).toList())
                .stream().collect(Collectors.toMap(User::getId, Function.identity()));
        return ms.stream()
                .map(m -> {
                    User u = byId.get(m.getUserId());
                    return new MemberView(m.getUserId(),
                            u == null ? null : u.getDisplayName(),
                            u == null ? null : u.getEmail(), m.getRole());
                })
                .toList();
    }

    /** 移除成员：仅 ADMIN（MEMBER → 404）；约束与副作用见 MemberService.remove。 */
    @DeleteMapping("/api/t/{slug}/members/{userId}")
    void removeMember(@PathVariable String slug, @PathVariable Long userId) {
        memberService.remove(userId, CurrentUser.id());
    }

    public record UpdateTenantRequest(String name) {
    }

    public record TenantView(String slug, String name) {
    }

    /** 改租户名：仅 ADMIN（MEMBER → 404，与其他管理动作一致）。slug 不可改。 */
    @org.springframework.web.bind.annotation.PatchMapping("/api/t/{slug}")
    @Transactional
    TenantView updateTenant(@PathVariable String slug, @RequestBody UpdateTenantRequest req) {
        if (TenantContext.requireRole() != Membership.Role.ADMIN) {
            throw pm.common.ApiException.notFound();
        }
        Tenant tenant = tenants.findById(TenantContext.require())
                .orElseThrow(pm.common.ApiException::notFound);
        if (req.name() != null) {
            String name = req.name().strip();
            if (name.isBlank()) {
                throw pm.common.ApiException.badRequest("VALIDATION", "租户名不能为空");
            }
            pm.common.FieldLimits.check(name, pm.common.FieldLimits.TENANT_NAME, "租户名");
            tenant.setName(name);
            tenants.save(tenant); // MyBatis 无脏检查，显式保存
        }
        return new TenantView(tenant.getSlug(), tenant.getName());
    }
}
