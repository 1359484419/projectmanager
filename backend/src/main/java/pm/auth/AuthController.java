package pm.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
@Validated
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    /** 注册入参：邮箱格式、密码 ≥8 位、slug 规则在此声明式校验（失败 → 400 VALIDATION 中文）。 */
    public record RegisterRequest(@NotBlank(message = "邮箱不能为空")
                                  @Email(message = "邮箱格式不正确") String email,
                                  @NotBlank(message = "密码不能为空")
                                  @Size(min = AuthService.MIN_PASSWORD_LENGTH, max = 128,
                                          message = "密码至少 " + AuthService.MIN_PASSWORD_LENGTH + " 位")
                                  String password,
                                  @NotBlank(message = "显示名不能为空") String displayName,
                                  @NotBlank(message = "团队名不能为空") String tenantName,
                                  @NotBlank(message = "团队标识不能为空")
                                  @Pattern(regexp = AuthService.SLUG_REGEX,
                                          message = "团队标识只能是 3-32 位小写字母、数字或短横线")
                                  String tenantSlug) {
    }

    public record LoginRequest(@NotBlank(message = "邮箱不能为空") String email,
                               @NotBlank(message = "密码不能为空") String password) {
    }

    public record RefreshRequest(@NotBlank(message = "refreshToken 不能为空") String refreshToken) {
    }

    @PostMapping("/register")
    AuthService.TokenPair register(@RequestBody @Validated RegisterRequest req) {
        return authService.register(req.email(), req.password(), req.displayName(),
                req.tenantName(), req.tenantSlug());
    }

    @PostMapping("/login")
    AuthService.TokenPair login(@RequestBody @Validated LoginRequest req) {
        return authService.login(req.email(), req.password());
    }

    @PostMapping("/refresh")
    AuthService.TokenPair refresh(@RequestBody @Validated RefreshRequest req) {
        return authService.refresh(req.refreshToken());
    }
}
