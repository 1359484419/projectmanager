package pm.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
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

    public record AcceptInviteRequest(@NotBlank(message = "邀请令牌不能为空") String token,
                                      @NotBlank(message = "邮箱不能为空")
                                      @Email(message = "邮箱格式不正确") String email,
                                      @NotBlank(message = "密码不能为空")
                                      @Size(min = AuthService.MIN_PASSWORD_LENGTH, max = 128,
                                              message = "密码至少 " + AuthService.MIN_PASSWORD_LENGTH + " 位")
                                      String password,
                                      @NotBlank(message = "显示名不能为空") String displayName) {
    }

    @PostMapping("/api/auth/accept-invite")
    AuthService.TokenPair accept(@RequestBody @Validated AcceptInviteRequest req) {
        return inviteService.accept(req.token(), req.email(), req.password(), req.displayName());
    }
}
