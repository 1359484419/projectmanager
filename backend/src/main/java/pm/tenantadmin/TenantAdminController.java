package pm.tenantadmin;

import jakarta.validation.constraints.NotNull;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
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
    private final MembershipRepository memberships;
    private final UserRepository users;

    public TenantAdminController(InviteService inviteService, MembershipRepository memberships,
                                 UserRepository users) {
        this.inviteService = inviteService;
        this.memberships = memberships;
        this.users = users;
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
}
