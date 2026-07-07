package pm.tenantadmin;

import jakarta.validation.constraints.NotNull;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import pm.auth.CurrentUser;

@RestController
@Validated
public class TenantAdminController {

    private final InviteService inviteService;

    public TenantAdminController(InviteService inviteService) {
        this.inviteService = inviteService;
    }

    public record CreateInviteRequest(@NotNull Membership.Role role) {
    }

    @PostMapping("/api/t/{slug}/invites")
    InviteService.InviteView createInvite(@PathVariable String slug,
                                          @RequestBody @Validated CreateInviteRequest req) {
        return inviteService.create(req.role(), CurrentUser.id());
    }
}
