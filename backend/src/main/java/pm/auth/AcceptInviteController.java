package pm.auth;

import jakarta.validation.constraints.NotBlank;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import pm.tenantadmin.InviteService;

@RestController
@Validated
public class AcceptInviteController {

    private final InviteService inviteService;

    public AcceptInviteController(InviteService inviteService) {
        this.inviteService = inviteService;
    }

    public record AcceptInviteRequest(@NotBlank String token, @NotBlank String email,
                                      @NotBlank String password, @NotBlank String displayName) {
    }

    @PostMapping("/api/auth/accept-invite")
    AuthService.TokenPair accept(@RequestBody @Validated AcceptInviteRequest req) {
        return inviteService.accept(req.token(), req.email(), req.password(), req.displayName());
    }
}
